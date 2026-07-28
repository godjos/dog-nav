        requireLogin();

        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        let allLinks = [];

        async function loadLinks() {
            try {
                const res = await fetch('/api/links');
                allLinks = await res.json();
                renderLinks(allLinks);
                document.getElementById('stats').textContent = `共 ${allLinks.length} 个友链`;
            } catch (err) {
                showToast('加载友链失败', 'error');
            }
        }

        function renderLinks(links) {
            const tbody = document.getElementById('linksTableBody');
            const empty = document.getElementById('emptyState');

            if (links.length === 0) {
                tbody.innerHTML = '';
                empty.style.display = 'block';
                return;
            }

            empty.style.display = 'none';
            tbody.innerHTML = links.map(l => {
                const lid = Number(l.id) || 0;
                const safeUrl = sanitizeUrl(l.url);
                const urlCell = safeUrl
                    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener" class="link-url">${escapeHtml(l.url)}</a>`
                    : escapeHtml(l.url || '-');
                return `
                <tr>
                    <td><div class="link-name">${l.icon ? escapeHtml(l.icon) + ' ' : ''}${escapeHtml(l.name)}</div></td>
                    <td>${urlCell}</td>
                    <td>${escapeHtml(l.description || '-')}</td>
                    <td>
                        <button class="btn-edit" data-action="edit" data-id="${lid}">编辑</button>
                        <button class="btn-delete" data-action="delete" data-id="${lid}">删除</button>
                    </td>
                </tr>`;
            }).join('');
        }

        function openModal(link = null) {
            document.getElementById('modalTitle').textContent = link ? '编辑友链' : '添加友链';
            document.getElementById('linkId').value = link ? link.id : '';
            document.getElementById('linkName').value = link ? link.name : '';
            document.getElementById('linkUrl').value = link ? link.url : '';
            document.getElementById('linkDesc').value = link ? link.description || '' : '';
            document.getElementById('linkIcon').value = link ? link.icon || '' : '';
            document.getElementById('linkSort').value = link ? link.sort_order || 0 : 0;
            document.getElementById('modalOverlay').classList.add('show');
        }

        function closeModal() {
            document.getElementById('modalOverlay').classList.remove('show');
        }

        function editLink(id) {
            const link = allLinks.find(l => l.id === id);
            if (link) openModal(link);
        }

        async function deleteLink(id) {
            if (!confirm('确定要删除这个友链吗？')) return;
            try {
                await fetch(`/api/links/${id}`, { method: 'DELETE', headers: authHeaders() });
                showToast('已删除');
                loadLinks();
            } catch (err) {
                showToast('删除失败', 'error');
            }
        }

        async function fetchIcon() {
            const urlInput = document.getElementById('linkUrl');
            const iconInput = document.getElementById('linkIcon');
            const btn = document.getElementById('fetchIconBtn');
            const url = urlInput.value.trim();
            if (!url) { showToast('请先填写URL', 'error'); return; }
            btn.disabled = true;
            btn.textContent = '⏳ 获取中...';
            try {
                const res = await fetch('/api/fetch-icon?url=' + encodeURIComponent(url));
                const data = await res.json();
                if (data.icon) {
                    iconInput.value = data.icon;
                    showToast('图标已获取');
                } else {
                    showToast('未找到图标，可手动填写', 'error');
                }
            } catch (err) {
                showToast('获取失败', 'error');
            }
            btn.disabled = false;
            btn.textContent = ' 自动获取';
        }

        async function fetchDesc() {
            const urlInput = document.getElementById('linkUrl');
                        const descInput = document.getElementById('linkDesc');
            const btn = document.getElementById('fetchDescBtn');
            const url = urlInput.value.trim();
            if (!url) { showToast('请先填写URL', 'error'); return; }
            btn.disabled = true;
            btn.textContent = '⏳ 获取中...';
            try {
                const res = await fetch('/api/fetch-icon?url=' + encodeURIComponent(url));
                const data = await res.json();
                let filled = 0;
                if (data.description && !descInput.value.trim()) { descInput.value = data.description; filled++; }
                showToast(filled > 0 ? '已自动填充 ' + filled + ' 项' : '未获取到信息，可手动填写', filled > 0 ? 'success' : 'error');
            } catch (err) {
                showToast('获取失败', 'error');
            }
            btn.disabled = false;
            btn.textContent = ' 自动获取';
        }

        // Auto-fetch icon when URL field loses focus (only if icon is empty)
        document.getElementById('linkUrl').addEventListener('blur', () => {
            const iconInput = document.getElementById('linkIcon');
            if (!iconInput.value.trim()) {
                const url = document.getElementById('linkUrl').value.trim();
                if (url) fetchIcon();
            }
        });

        document.getElementById('linkForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('linkId').value;
            const data = {
                name: document.getElementById('linkName').value,
                url: document.getElementById('linkUrl').value,
                description: document.getElementById('linkDesc').value,
                icon: document.getElementById('linkIcon').value,
                sort_order: parseInt(document.getElementById('linkSort').value) || 0
            };

            const url = id ? `/api/links/${id}` : '/api/links';
            const method = id ? 'PUT' : 'POST';

            try {
                const res = await fetch(url, {
                    method,
                    headers: authHeaders(),
                    body: JSON.stringify(data)
                });
                const result = await res.json();
                if (result.message || result.id) {
                    showToast(id ? '已更新' : '已添加');
                    closeModal();
                    loadLinks();
                } else {
                    showToast('保存失败', 'error');
                }
            } catch (err) {
                showToast('保存失败', 'error');
            }
        });

        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal();
        });

        // 静态按钮与表格行按钮的事件绑定（原 onclick，CSP 下改为 JS 绑定）
        document.getElementById('addLinkBtn').addEventListener('click', () => openModal());
        document.getElementById('fetchDescBtn').addEventListener('click', fetchDesc);
        document.getElementById('fetchIconBtn').addEventListener('click', fetchIcon);
        document.getElementById('linkCancelBtn').addEventListener('click', closeModal);
        document.getElementById('linksTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'edit') editLink(id);
            else if (btn.dataset.action === 'delete') deleteLink(id);
        });

        loadLinks();
