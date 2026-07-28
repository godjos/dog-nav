        const CATEGORIES = {
            recommend: '⭐ 常用推荐', video: '🎬 影视资源', anime: '🌸 动漫',
            software: '💿 软件博客', tools: '🔧 在线工具', news: '📰 资讯',
            community: '💬 社区', ai: '🤖 AI 工具', dev: '💻 开发编程', design: '🎨 设计素材'
        };

        let allSites = [];
        let allTags = [];

        requireLogin();

        async function loadSites() {
            const res = await fetch('/api/sites?sort=created');
            allSites = await res.json();
            renderSites(allSites);
            updateStats();
            updateCategoryFilter();
        }

        function renderSites(sites) {
            const tbody = document.getElementById('sitesTableBody');
            const empty = document.getElementById('emptyState');
            if (sites.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
            empty.style.display = 'none';
            tbody.innerHTML = sites.map(s => {
                const sid = Number(s.id) || 0;
                const letter = encodeURIComponent([...(s.name || '网')][0]);
                const iconFallback = `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect fill=%22%237f5af0%22 width=%2236%22 height=%2236%22 rx=%2218%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2216%22>${letter}</text></svg>`;
                const iconUrl = s.icon ? (sanitizeUrl(s.icon) || (s.icon.startsWith('data:image/') ? s.icon : null)) : null;
                const iconHtml = s.icon
                    ? (iconUrl
                        ? `<img class="site-icon-img" src="${escapeHtml(iconUrl)}" alt="" loading="lazy" data-fallback="${iconFallback}">`
                        : escapeHtml(s.icon) + ' ')
                    : '';
                const safeUrl = sanitizeUrl(s.url);
                const urlCell = safeUrl
                    ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener" class="site-url">${escapeHtml(s.url)}</a>`
                    : escapeHtml(s.url || '-');
                return `
                <tr>
                    <td><div class="site-name">${iconHtml}${escapeHtml(s.name)}</div></td>
                    <td>${urlCell}</td>
                    <td>${escapeHtml(s.description || '-')}</td>
                    <td><span class="site-category">${escapeHtml(CATEGORIES[s.category] || s.category)}</span></td>
                    <td>
                        <button class="btn-edit" data-action="edit" data-id="${sid}">编辑</button>
                        <button class="btn-delete" data-action="delete" data-id="${sid}">删除</button>
                    </td>
                </tr>`;
            }).join('');
            // 图标加载失败时回退到字母占位图（原 onerror 内联处理，CSP 下改为事件绑定）
            tbody.querySelectorAll('.site-icon-img').forEach(img => {
                img.addEventListener('error', () => { img.src = img.dataset.fallback; }, { once: true });
            });
        }

        function updateStats() {
            document.getElementById('totalSites').textContent = allSites.length;
            document.getElementById('totalCategories').textContent = new Set(allSites.map(s => s.category)).size;
        }

        function updateCategoryFilter() {
            const select = document.getElementById('categoryFilter');
            const cats = [...new Set(allSites.map(s => s.category))];
            select.innerHTML = '<option value="">全部分类</option>' + cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(CATEGORIES[c] || c)}</option>`).join('');
        }

        function openModal(site = null) {
            document.getElementById('modalTitle').textContent = site ? '编辑网站' : '添加网站';
            document.getElementById('siteId').value = site ? site.id : '';
            document.getElementById('siteName').value = site ? site.name : '';
            document.getElementById('siteUrl').value = site ? site.url : '';
            document.getElementById('siteDesc').value = site ? site.description || '' : '';
            document.getElementById('siteIcon').value = site ? site.icon || '' : '';
            document.getElementById('siteCategory').value = site ? site.category : 'recommend';
            document.getElementById('siteSort').value = site ? site.sort_order || 0 : 0;
            // 回显当前站点已关联的标签（GET /api/sites 返回的 tags 字段）
            const selectedTagIds = site && Array.isArray(site.tags) ? site.tags.map(t => Number(t.id)) : [];
            renderTagChecks(selectedTagIds);
            document.getElementById('modalOverlay').classList.add('show');
        }

        function renderTagChecks(selectedIds) {
            const box = document.getElementById('siteTags');
            if (allTags.length === 0) {
                box.innerHTML = '<span class="tag-empty">暂无标签，可在「分类管理」页创建</span>';
                return;
            }
            box.innerHTML = allTags.map(t => {
                const tid = Number(t.id) || 0;
                const color = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#667eea';
                const checked = selectedIds.includes(tid) ? ' checked' : '';
                return `<label class="tag-check"><input type="checkbox" value="${tid}"${checked}><span class="tag-dot" style="background:${color}"></span>${escapeHtml(t.name)}</label>`;
            }).join('');
        }

        function getCheckedTagIds() {
            return Array.from(document.querySelectorAll('#siteTags input[type="checkbox"]:checked'))
                .map(cb => Number(cb.value))
                .filter(n => Number.isInteger(n) && n > 0);
        }

        async function loadTags() {
            try {
                const res = await fetch('/api/tags');
                if (!res.ok) return;
                allTags = await res.json();
            } catch (err) {
                console.error('Failed to load tags', err);
            }
        }

        function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

        function editSite(id) { const site = allSites.find(s => s.id === id); if (site) openModal(site); }

        async function deleteSite(btn, id) {
            if (!confirm('确定要删除这个网站吗？')) return;
            setBtnLoading(btn, true, '删除中...');
            try {
                const res = await fetch(`/api/sites/${id}`, { method: 'DELETE', headers: authHeaders() });
                if (res.ok) {
                    showToast('已删除');
                    loadSites();
                } else {
                    const data = await res.json().catch(() => ({}));
                    if (res.status !== 403 && res.status !== 429) showToast(data.error || '删除失败', 'error');
                }
            } catch (err) {
                showToast('删除失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        async function fetchIcon() {
            const urlInput = document.getElementById('siteUrl');
            const iconInput = document.getElementById('siteIcon');
            const btn = document.getElementById('fetchIconBtn');
            const url = urlInput.value.trim();
            if (!url) { showToast('请先填写URL'); return; }
            btn.disabled = true;
            btn.textContent = '⏳ 获取中...';
            try {
                const res = await fetch('/api/fetch-icon?url=' + encodeURIComponent(url));
                const data = await res.json();
                if (data.icon) {
                    iconInput.value = data.icon;
                    showToast('图标已获取');
                } else {
                    showToast('未找到图标，可手动填写');
                }
            } catch (err) {
                showToast('获取失败');
            }
            btn.disabled = false;
            btn.textContent = ' 自动获取';
        }

        async function fetchDesc() {
            const urlInput = document.getElementById('siteUrl');
                        const descInput = document.getElementById('siteDesc');
            const btn = document.getElementById('fetchDescBtn');
            const url = urlInput.value.trim();
            if (!url) { showToast('请先填写URL'); return; }
            btn.disabled = true;
            btn.textContent = '⏳ 获取中...';
            try {
                const res = await fetch('/api/fetch-icon?url=' + encodeURIComponent(url));
                const data = await res.json();
                let filled = 0;
                if (data.description && !descInput.value.trim()) { descInput.value = data.description; filled++; }
                showToast(filled > 0 ? '已自动填充 ' + filled + ' 项' : '未获取到信息，可手动填写');
            } catch (err) {
                showToast('获取失败');
            }
            btn.disabled = false;
            btn.textContent = ' 自动获取';
        }

        document.getElementById('siteUrl').addEventListener('blur', () => {
            const iconInput = document.getElementById('siteIcon');
            if (!iconInput.value.trim()) {
                const url = document.getElementById('siteUrl').value.trim();
                if (url) fetchIcon();
            }
        });

        function showToast(msg, type = 'success') {
            let t = document.getElementById('toast');
            if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;background:#333;color:#fff;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s'; document.body.appendChild(t); }
            t.textContent = msg;
            t.style.background = type === 'error' ? '#ef4444' : '#22c55e';
            t.style.opacity = '1';
            setTimeout(() => { t.style.opacity = '0'; }, 2000);
        }

        document.getElementById('siteForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('.btn-save');
            const id = document.getElementById('siteId').value;
            const data = {
                name: document.getElementById('siteName').value,
                url: document.getElementById('siteUrl').value,
                description: document.getElementById('siteDesc').value,
                icon: document.getElementById('siteIcon').value,
                category: document.getElementById('siteCategory').value,
                sort_order: parseInt(document.getElementById('siteSort').value) || 0
            };
            const url = id ? `/api/sites/${id}` : '/api/sites';
            const method = id ? 'PUT' : 'POST';
            setBtnLoading(btn, true, '保存中...');
            try {
                const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(data) });
                const result = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (res.status !== 403 && res.status !== 409 && res.status !== 429) {
                        showToast(result.error || '保存失败', 'error');
                    }
                    return;
                }
                // 站点保存成功后同步标签关联（新建站点用返回的 id）
                const siteId = id ? Number(id) : Number(result.id);
                if (Number.isInteger(siteId) && siteId > 0) {
                    const tagRes = await fetch(`/api/sites/${siteId}/tags`, {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify({ tag_ids: getCheckedTagIds() })
                    });
                    if (!tagRes.ok) {
                        showToast('站点已保存，但标签关联失败', 'error');
                        closeModal();
                        loadSites();
                        return;
                    }
                }
                showToast(id ? '已更新' : '已添加');
                closeModal();
                loadSites();
            } catch (err) {
                showToast('保存失败', 'error');
            } finally {
                setBtnLoading(btn, false);
            }
        });

        async function loadCategories() {
            try {
                const res = await fetch('/api/categories');
                const cats = await res.json();
                cats.filter(c => c.is_active).forEach(c => {
                    CATEGORIES[c.id] = `${c.icon || '📁'} ${c.name}`;
                });
                const select = document.getElementById('siteCategory');
                select.innerHTML = cats.filter(c => c.is_active).map(c =>
                    `<option value="${escapeHtml(c.id)}">${escapeHtml(CATEGORIES[c.id])}</option>`
                ).join('');
                if (allSites.length) renderSites(allSites);
                updateCategoryFilter();
            } catch (err) {
                console.error('Failed to load categories', err);
            }
        }

        document.getElementById('searchBox').addEventListener('input', filterSites);
        document.getElementById('categoryFilter').addEventListener('change', filterSites);

        function filterSites() {
            const search = document.getElementById('searchBox').value.toLowerCase();
            const category = document.getElementById('categoryFilter').value;
            let filtered = allSites;
            if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search) || (s.description && s.description.toLowerCase().includes(search)));
            if (category) filtered = filtered.filter(s => s.category === category);
            renderSites(filtered);
        }

        document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

        // ═══ 静态按钮与表格行按钮的事件绑定（原 HTML onclick，CSP 下改为 JS 绑定）═══
        document.getElementById('addSiteBtn').addEventListener('click', () => openModal());
        document.getElementById('fetchDescBtn').addEventListener('click', fetchDesc);
        document.getElementById('fetchIconBtn').addEventListener('click', fetchIcon);
        document.getElementById('siteCancelBtn').addEventListener('click', closeModal);
        document.getElementById('sitesTableBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'edit') editSite(id);
            else if (btn.dataset.action === 'delete') deleteSite(btn, id);
        });

        loadTags();
        loadCategories();
        loadSites();
