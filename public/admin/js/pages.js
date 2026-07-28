        requireLogin();

        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        let allPages = [];
        let currentEditId = '';
        let pendingDeleteId = '';

        // ═══ QUILL EDITOR ═══
        const quill = new Quill('#quillEditor', {
            theme: 'snow',
            placeholder: '输入页面内容...',
            modules: {
                toolbar: [
                    [{ header: [1, 2, 3, false] }],
                    ['bold', 'italic', 'underline', 'strike'],
                    [{ color: [] }, { background: [] }],
                    [{ list: 'ordered' }, { list: 'bullet' }],
                    [{ align: [] }],
                    ['blockquote', 'code-block'],
                    ['link', 'image'],
                    ['clean']
                ]
            }
        });

        async function loadPages() {
            try {
                // 管理端用全量接口（含草稿）；公开 /api/pages 只返回已发布页面
                const res = await fetch('/api/admin/pages', { headers: authHeaders() });
                if (!res.ok) { showToast('加载页面失败', 'error'); return; }
                allPages = await res.json();
                renderPages();
            } catch (err) {
                showToast('加载页面失败', 'error');
            }
        }

        function renderPages() {
            const list = document.getElementById('pageList');
            if (allPages.length === 0) {
                list.innerHTML = '<div style="text-align:center;padding:48px;color:#999;font-size:14px;">还没有自定义页面，点击上方"新建页面"按钮创建第一个页面</div>';
                return;
            }
            list.innerHTML = allPages.map(page => {
                const status = page.status === 'draft' ? 'draft' : 'published';
                return `
                <div class="page-card">
                    <h3>${escapeHtml(page.title || '未命名')} <span class="badge badge-${status}">${status === 'published' ? '已发布' : '草稿'}</span></h3>
                    <div class="page-id">/page/${escapeHtml(page.id)}</div>
                    <div class="preview">${page.content ? sanitizeHtml(page.content) : '<em style="color:#bbb">暂无内容</em>'}</div>
                    <div class="card-actions">
                        <button class="btn-edit" data-action="edit" data-id="${escapeHtml(page.id)}">编辑内容</button>
                        <button class="btn-toggle" data-action="toggle" data-id="${escapeHtml(page.id)}" data-status="${status}">${status === 'published' ? '转草稿' : '发布'}</button>
                        <button class="btn-delete" data-action="delete" data-id="${escapeHtml(page.id)}" data-title="${escapeHtml(page.title || page.id)}">删除</button>
                    </div>
                </div>`;
            }).join('');
        }

        // 发布/转草稿：PUT 只带 status 单字段
        async function toggleStatus(btn, id, currentStatus) {
            const newStatus = currentStatus === 'published' ? 'draft' : 'published';
            setBtnLoading(btn, true, '处理中...');
            try {
                const res = await fetch(`/api/pages/${id}`, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ status: newStatus })
                });
                if (res.ok) {
                    showToast(newStatus === 'published' ? '页面已发布' : '已转为草稿');
                    loadPages();
                } else {
                    const data = await res.json().catch(() => ({}));
                    if (res.status !== 403 && res.status !== 429) showToast(data.error || '操作失败', 'error');
                }
            } catch (err) {
                showToast('操作失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        // ═══ CREATE ═══
        function showCreateModal() {
            document.getElementById('newPageSlug').value = '';
            document.getElementById('newPageTitle').value = '';
            document.getElementById('newPageStatus').value = 'published';
            document.getElementById('createModalOverlay').classList.add('show');
        }

        function closeCreateModal() {
            document.getElementById('createModalOverlay').classList.remove('show');
        }

        async function createPage() {
            const slug = document.getElementById('newPageSlug').value.trim();
            const title = document.getElementById('newPageTitle').value.trim();
            const status = document.getElementById('newPageStatus').value;

            if (!slug) { showToast('请输入页面标识', 'error'); return; }
            if (!/^[a-z0-9-]+$/.test(slug)) { showToast('页面标识只能包含小写字母、数字和连字符', 'error'); return; }
            if (!title) { showToast('请输入页面标题', 'error'); return; }

            const btn = document.getElementById('createSubmitBtn');
            setBtnLoading(btn, true, '创建中...');
            try {
                const res = await fetch('/api/pages', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ id: slug, title, content: '', status })
                });
                const data = await res.json();
                if (res.ok && data.message) {
                    showToast('页面已创建');
                    closeCreateModal();
                    loadPages();
                } else {
                    // 409 重名等错误由 fetch 包装透出服务端文案
                    if (res.status !== 403 && res.status !== 409 && res.status !== 429) {
                        showToast(data.error || '创建失败', 'error');
                    }
                }
            } catch (err) {
                showToast('创建失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        // ═══ EDIT ═══
        function editPage(id) {
            const page = allPages.find(p => p.id === id);
            if (!page) return;
            currentEditId = page.id;
            document.getElementById('pageTitle').value = page.title || '';
            document.getElementById('pageStatus').value = page.status === 'draft' ? 'draft' : 'published';
            document.getElementById('modalTitle').textContent = '编辑: ' + (page.title || page.id);

            if (page.content) {
                quill.root.innerHTML = page.content;
            } else {
                quill.setText('');
            }

            document.getElementById('editModalOverlay').classList.add('show');
        }

        function closeEditModal() {
            document.getElementById('editModalOverlay').classList.remove('show');
            currentEditId = '';
        }

        async function savePage() {
            const id = currentEditId;
            const title = document.getElementById('pageTitle').value;
            const status = document.getElementById('pageStatus').value;
            const content = quill.root.innerHTML;

            if (!title.trim()) {
                showToast('请输入页面标题', 'error');
                return;
            }

            const btn = document.getElementById('savePageBtn');
            setBtnLoading(btn, true, '保存中...');
            try {
                const res = await fetch(`/api/pages/${id}`, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ title, content, status })
                });
                const data = await res.json();
                if (res.ok && data.message) {
                    showToast('页面已保存');
                    closeEditModal();
                    loadPages();
                } else {
                    if (res.status !== 403 && res.status !== 409 && res.status !== 429) {
                        showToast(data.error || '保存失败', 'error');
                    }
                }
            } catch (err) {
                showToast('保存失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        // ═══ DELETE ═══
        function confirmDelete(id, title) {
            pendingDeleteId = id;
            document.getElementById('confirmMsg').textContent = `确定要删除页面 "${title}" 吗？此操作不可撤销。`;
            document.getElementById('confirmOverlay').classList.add('show');
        }

        function closeConfirm() {
            document.getElementById('confirmOverlay').classList.remove('show');
            pendingDeleteId = '';
        }

        document.getElementById('confirmYesBtn').addEventListener('click', async () => {
            const id = pendingDeleteId;
            const btn = document.getElementById('confirmYesBtn');
            closeConfirm();
            if (!id) return;

            setBtnLoading(btn, true, '删除中...');
            try {
                const res = await fetch(`/api/pages/${id}`, {
                    method: 'DELETE',
                    headers: authHeaders()
                });
                const data = await res.json();
                if (res.ok && data.message) {
                    showToast('页面已删除');
                    loadPages();
                } else {
                    if (res.status !== 403 && res.status !== 429) showToast(data.error || '删除失败', 'error');
                }
            } catch (err) {
                showToast('删除失败', 'error');
            }
            setBtnLoading(btn, false);
        });

        // ═══ MODAL CLICK OUTSIDE ═══
        document.getElementById('editModalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeEditModal();
        });
        document.getElementById('createModalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeCreateModal();
        });
        document.getElementById('confirmOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeConfirm();
        });

        // 静态按钮与卡片按钮的事件绑定（原 onclick，CSP 下改为 JS 绑定）
        document.getElementById('createPageBtn').addEventListener('click', showCreateModal);
        document.getElementById('editCancelBtn').addEventListener('click', closeEditModal);
        document.getElementById('savePageBtn').addEventListener('click', savePage);
        document.getElementById('createCancelBtn').addEventListener('click', closeCreateModal);
        document.getElementById('createSubmitBtn').addEventListener('click', createPage);
        document.getElementById('confirmNoBtn').addEventListener('click', closeConfirm);
        document.getElementById('pageList').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'edit') editPage(btn.dataset.id);
            else if (btn.dataset.action === 'delete') confirmDelete(btn.dataset.id, btn.dataset.title);
            else if (btn.dataset.action === 'toggle') toggleStatus(btn, btn.dataset.id, btn.dataset.status);
        });

        loadPages();
