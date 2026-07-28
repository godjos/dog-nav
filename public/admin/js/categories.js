        requireLogin();

        function showToast(msg, type = 'success') {
            let toast = document.getElementById('toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'toast';
                toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;background:#333;color:#fff;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s;';
                document.body.appendChild(toast);
            }
            toast.textContent = msg;
            toast.style.background = type === 'error' ? '#ef4444' : '#22c55e';
            toast.style.opacity = '1';
            setTimeout(() => { toast.style.opacity = '0'; }, 2000);
        }

        // 403/409/429 已由 auth.js 的 fetch 包装统一 toast，这里只补其他错误
        async function toastApiError(res, fallback) {
            if (res.status === 403 || res.status === 409 || res.status === 429) return;
            const data = await res.json().catch(() => ({}));
            showToast(data.error || fallback, 'error');
        }

        let allCats = [];

        async function loadCategories() {
            const res = await fetch('/api/categories');
            allCats = await res.json();
            renderCategories();
        }

        function renderCategories() {
            document.getElementById('categoryList').innerHTML = allCats.map(c => {
                return `
                <div class="card">
                    <div class="card-info">
                        <div class="card-icon">${escapeHtml(c.icon || '📁')}</div>
                        <div>
                            <div class="card-name">${escapeHtml(c.name)}</div>
                            <div class="card-id">${escapeHtml(c.id)}</div>
                        </div>
                        <span class="badge ${c.is_active ? 'badge-active' : 'badge-inactive'}">${c.is_active ? '启用' : '禁用'}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn-edit" data-action="edit" data-id="${escapeHtml(c.id)}">编辑</button>
                        <button class="btn-delete" data-action="delete" data-id="${escapeHtml(c.id)}">删除</button>
                    </div>
                </div>`;
            }).join('');
        }

        function openModal(cat = null) {
            document.getElementById('modalTitle').textContent = cat ? '编辑分类' : '添加分类';
            document.getElementById('catId').value = cat ? cat.id : '';
            document.getElementById('catId').disabled = !!cat;
            document.getElementById('catName').value = cat ? cat.name : '';
            document.getElementById('catIcon').value = cat ? cat.icon || '' : '';
            document.getElementById('catSort').value = cat ? cat.sort_order || 0 : 0;
            document.getElementById('modalOverlay').classList.add('show');
        }

        function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

        function editCategory(id) {
            const cat = allCats.find(c => c.id === id);
            if (cat) openModal(cat);
        }

        async function deleteCategory(btn, id) {
            if (!confirm('确定删除此分类？')) return;
            setBtnLoading(btn, true, '删除中...');
            try {
                const res = await fetch(`/api/categories/${id}`, { method: 'DELETE', headers: authHeaders() });
                if (res.ok) {
                    showToast('已删除');
                    loadCategories();
                } else {
                    await toastApiError(res, '删除失败');
                }
            } catch (err) {
                showToast('删除失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        async function deleteAllCategories() {
            if (!confirm('警告：这将删除所有分类及下属站点，且不可恢复！')) return;
            if (!confirm('再次确认：确定清空所有分类和站点？')) return;
            const btn = document.getElementById('deleteAllBtn');
            setBtnLoading(btn, true, '清空中...');
            try {
                const res = await fetch('/api/categories/all', { method: 'DELETE', headers: authHeaders() });
                if (res.ok) {
                    showToast('已全部清空');
                } else {
                    await toastApiError(res, '清空失败');
                }
            } catch (err) {
                showToast('清空失败', 'error');
            }
            setBtnLoading(btn, false);
            loadCategories();
        }

        document.getElementById('categoryForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('.btn-save');
            const id = document.getElementById('catId').value;
            const isEdit = allCats.some(c => c.id === id);
            const data = {
                id,
                name: document.getElementById('catName').value,
                icon: document.getElementById('catIcon').value,
                sort_order: parseInt(document.getElementById('catSort').value) || 0
            };

            const url = isEdit ? `/api/categories/${id}` : '/api/categories';
            const method = isEdit ? 'PUT' : 'POST';
            setBtnLoading(btn, true, '保存中...');
            try {
                const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
                if (res.ok) {
                    showToast(isEdit ? '已更新' : '已添加');
                    closeModal();
                    loadCategories();
                } else {
                    await toastApiError(res, '保存失败');
                }
            } catch (err) {
                showToast('保存失败', 'error');
            }
            setBtnLoading(btn, false);
        });

        document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

        // ═══ 标签管理 ═══
        let allTags = [];
        let editingTagId = null;

        async function loadTags() {
            try {
                const res = await fetch('/api/tags');
                if (!res.ok) return;
                allTags = await res.json();
                renderTags();
            } catch (err) {
                showToast('加载标签失败', 'error');
            }
        }

        function renderTags() {
            const list = document.getElementById('tagList');
            if (allTags.length === 0) {
                list.innerHTML = '<div class="tag-empty">暂无标签，用上方表单创建第一个标签</div>';
                return;
            }
            list.innerHTML = allTags.map(t => {
                const tid = Number(t.id) || 0;
                const color = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#667eea';
                return `
                <div class="tag-item">
                    <div class="tag-info">
                        <span class="tag-color" style="background:${color}"></span>
                        <span class="tag-name">${escapeHtml(t.name)}</span>
                    </div>
                    <div class="card-actions">
                        <button class="btn-edit" data-tag-action="edit" data-id="${tid}">编辑</button>
                        <button class="btn-delete" data-tag-action="delete" data-id="${tid}">删除</button>
                    </div>
                </div>`;
            }).join('');
        }

        function resetTagForm() {
            editingTagId = null;
            document.getElementById('tagName').value = '';
            document.getElementById('tagColor').value = '#667eea';
            document.getElementById('tagSubmitBtn').textContent = '+ 新建标签';
            document.getElementById('tagCancelBtn').style.display = 'none';
        }

        function editTag(id) {
            const tag = allTags.find(t => Number(t.id) === Number(id));
            if (!tag) return;
            editingTagId = tag.id;
            document.getElementById('tagName').value = tag.name || '';
            document.getElementById('tagColor').value = /^#[0-9a-fA-F]{6}$/.test(tag.color || '') ? tag.color : '#667eea';
            document.getElementById('tagSubmitBtn').textContent = '保存标签';
            document.getElementById('tagCancelBtn').style.display = '';
            document.getElementById('tagName').focus();
        }

        async function deleteTag(btn, id) {
            if (!confirm('确定删除此标签？其与站点的关联会一并移除。')) return;
            setBtnLoading(btn, true, '删除中...');
            try {
                const res = await fetch(`/api/tags/${id}`, { method: 'DELETE', headers: authHeaders() });
                if (res.ok) {
                    showToast('标签已删除');
                    if (editingTagId === id) resetTagForm();
                    loadTags();
                } else {
                    await toastApiError(res, '删除失败');
                }
            } catch (err) {
                showToast('删除失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        document.getElementById('tagForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = document.getElementById('tagSubmitBtn');
            const data = {
                name: document.getElementById('tagName').value.trim(),
                color: document.getElementById('tagColor').value
            };
            if (!data.name) { showToast('请输入标签名称', 'error'); return; }
            const isEdit = editingTagId !== null;
            const url = isEdit ? `/api/tags/${editingTagId}` : '/api/tags';
            const method = isEdit ? 'PUT' : 'POST';
            setBtnLoading(btn, true, '保存中...');
            try {
                const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
                if (res.ok) {
                    showToast(isEdit ? '标签已更新' : '标签已创建');
                    resetTagForm();
                    loadTags();
                } else {
                    // 409 重名等错误由 fetch 包装透出服务端文案
                    await toastApiError(res, '保存失败');
                }
            } catch (err) {
                showToast('保存失败', 'error');
            }
            setBtnLoading(btn, false);
        });

        document.getElementById('tagCancelBtn').addEventListener('click', resetTagForm);
        document.getElementById('tagList').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-tag-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.tagAction === 'edit') editTag(id);
            else if (btn.dataset.tagAction === 'delete') deleteTag(btn, id);
        });

        // 静态按钮与卡片按钮的事件绑定（原 onclick，CSP 下改为 JS 绑定）
        document.getElementById('addCatBtn').addEventListener('click', () => openModal());
        document.getElementById('deleteAllBtn').addEventListener('click', deleteAllCategories);
        document.getElementById('catCancelBtn').addEventListener('click', closeModal);
        document.getElementById('categoryList').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            if (btn.dataset.action === 'edit') editCategory(btn.dataset.id);
            else if (btn.dataset.action === 'delete') deleteCategory(btn, btn.dataset.id);
        });

        loadCategories();
        loadTags();
