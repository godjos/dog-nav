// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Popup Controller
// ═══════════════════════════════════════════

(function () {
    const DEFAULT_SERVER_URL = 'http://localhost:3000';
    const MANAGE_PAGE_STEP = 30;

    // DOM Elements - Views & Global Nav
    const loginView = document.getElementById('loginView');
    const addView = document.getElementById('addView');
    const manageView = document.getElementById('manageView');
    const successView = document.getElementById('successView');
    const btnToggleSettings = document.getElementById('btnToggleSettings');
    const btnToggleManage = document.getElementById('btnToggleManage');

    // Login Form Elements
    const cfgServerUrl = document.getElementById('cfgServerUrl');
    const cfgUsername = document.getElementById('cfgUsername');
    const cfgPassword = document.getElementById('cfgPassword');
    const btnLogin = document.getElementById('btnLogin');
    const loginError = document.getElementById('loginError');

    // Add Form Elements
    const addError = document.getElementById('addError');
    const urlDupNotice = document.getElementById('urlDupNotice');
    const inputUrl = document.getElementById('siteUrl');
    const inputName = document.getElementById('siteName');
    const selectCategory = document.getElementById('siteCategory');
    const inputIcon = document.getElementById('siteIcon');
    const inputDesc = document.getElementById('siteDesc');
    const tagChips = document.getElementById('tagChips');
    const inputFeatured = document.getElementById('siteFeatured');
    const inputSort = document.getElementById('siteSort');

    // Inline Creation Elements
    const btnToggleNewCat = document.getElementById('btnToggleNewCat');
    const newCatRow = document.getElementById('newCatRow');
    const newCatIcon = document.getElementById('newCatIcon');
    const newCatName = document.getElementById('newCatName');
    const btnConfirmNewCat = document.getElementById('btnConfirmNewCat');
    const btnCancelNewCat = document.getElementById('btnCancelNewCat');

    const btnToggleNewTag = document.getElementById('btnToggleNewTag');
    const newTagRow = document.getElementById('newTagRow');
    const newTagName = document.getElementById('newTagName');
    const btnConfirmNewTag = document.getElementById('btnConfirmNewTag');
    const btnCancelNewTag = document.getElementById('btnCancelNewTag');

    const iconBox = document.getElementById('iconBox');
    const iconEmoji = document.getElementById('iconEmoji');
    const iconImg = document.getElementById('iconImg');
    const iconStatus = document.getElementById('iconStatus');
    const btnRefetch = document.getElementById('btnRefetch');

    const btnCancel = document.getElementById('btnCancel');
    const btnDeleteCurrent = document.getElementById('btnDeleteCurrent');
    const btnSave = document.getElementById('btnSave');
    const btnSaveText = document.getElementById('btnSaveText');

    // Manage Elements
    const manageSearchInput = document.getElementById('manageSearchInput');
    const manageCategoryFilter = document.getElementById('manageCategoryFilter');
    const manageStats = document.getElementById('manageStats');
    const manageSiteList = document.getElementById('manageSiteList');
    const managePagination = document.getElementById('managePagination');
    const btnManageLoadMore = document.getElementById('btnManageLoadMore');
    const btnBackFromManage = document.getElementById('btnBackFromManage');

    // Success Elements
    const btnClose = document.getElementById('btnClose');
    const successIcon = document.getElementById('successIcon');
    const successTitle = document.getElementById('successTitle');
    const successDesc = document.getElementById('successDesc');
    const btnSuccessManage = document.getElementById('btnSuccessManage');

    // State
    let currentServerUrl = DEFAULT_SERVER_URL;
    let currentToken = '';
    let allCategories = [];
    let allTags = [];
    let existingSites = [];
    let currentMatchedSite = null;
    let manageCurrentLimit = MANAGE_PAGE_STEP;
    let unsavedDraft = null;

    // ── 辅助工具 ──
    function cleanServerUrl(raw) {
        if (!raw) return '';
        let url = String(raw).trim();
        url = url.replace(/#.*$/, '');
        url = url.replace(/\/admin(\/.*)?$/i, '');
        url = url.replace(/\/(index|quick-add)\.html$/i, '');
        return url.replace(/\/+$/, '');
    }

    function normalizeUrl(raw) {
        if (!raw) return '';
        try {
            const u = new URL(raw.trim());
            let path = u.pathname.replace(/\/+$/, '') || '/';
            return (u.protocol + '//' + u.hostname + (u.port ? ':' + u.port : '') + path + u.search).toLowerCase();
        } catch (e) {
            return raw.trim().toLowerCase().replace(/\/+$/, '');
        }
    }

    function extractHostname(raw) {
        try {
            return new URL(raw.trim()).hostname.toLowerCase().replace(/^www\./, '');
        } catch (e) {
            return '';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function authHeaders() {
        return {
            'Authorization': 'Bearer ' + currentToken,
            'Content-Type': 'application/json'
        };
    }

    // ── 错误与状态提示 ──
    function showLoginError(msg) {
        if (!msg) {
            loginError.style.display = 'none';
            loginError.textContent = '';
        } else {
            loginError.textContent = msg;
            loginError.style.display = 'block';
        }
    }

    function showAddError(msg) {
        if (!msg) {
            addError.style.display = 'none';
            addError.textContent = '';
        } else {
            addError.textContent = msg;
            addError.style.display = 'block';
        }
    }

    // ── 图标渲染 ──
    function renderIcon(iconVal) {
        if (!iconVal) {
            iconImg.style.display = 'none';
            iconEmoji.style.display = 'inline';
            iconEmoji.textContent = '🌐';
            return;
        }
        if (/^(https?:\/\/|\/|data:image\/)/i.test(iconVal)) {
            const fullSrc = iconVal.startsWith('/') ? (currentServerUrl + iconVal) : iconVal;
            iconImg.src = fullSrc;
            iconImg.style.display = 'inline-block';
            iconEmoji.style.display = 'none';
        } else {
            iconImg.style.display = 'none';
            iconEmoji.style.display = 'inline';
            iconEmoji.textContent = iconVal;
        }
    }

    // ── 标签高亮选中控制 ──
    function selectTagsForSite(tagList) {
        tagChips.querySelectorAll('.tag-chip').forEach(c => c.classList.remove('active'));
        if (!tagList || !Array.isArray(tagList) || tagList.length === 0) return;
        const activeIds = new Set(tagList.map(t => (typeof t === 'object' && t !== null ? t.id : Number(t))));
        tagChips.querySelectorAll('.tag-chip').forEach(c => {
            const id = Number(c.dataset.id);
            if (activeIds.has(id)) {
                c.classList.add('active');
            }
        });
    }

    // ── 重复与同域名检查 ──
    function checkUrlDuplicate(rawUrl) {
        if (!urlDupNotice) return;
        currentMatchedSite = null;
        if (btnDeleteCurrent) btnDeleteCurrent.style.display = 'none';
        if (btnSaveText) btnSaveText.textContent = '保存到 Dog-Nav';

        if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
            urlDupNotice.style.display = 'none';
            selectTagsForSite([]);
            return;
        }

        const norm = normalizeUrl(rawUrl);
        const host = extractHostname(rawUrl);

        const exact = existingSites.find(s => normalizeUrl(s.url) === norm);
        if (exact) {
            currentMatchedSite = exact;
            const catName = (allCategories.find(c => c.id === exact.category)?.name) || exact.category;
            urlDupNotice.className = 'dup-alert warning';
            urlDupNotice.style.display = 'block';
            urlDupNotice.innerHTML = `⚠️ <b>该网址已收录！</b> 站点：【${escapeHtml(exact.name)}】（分类：${escapeHtml(catName)}）<br><span style="font-size:11px; opacity:0.85;">可直接修改后更新，或点击下方【删除此网址】</span>`;
            if (btnDeleteCurrent) {
                btnDeleteCurrent.style.display = 'inline-flex';
                btnDeleteCurrent.title = `从导航站删除【${exact.name}】`;
            }
            if (btnSaveText) btnSaveText.textContent = '更新此站点';
            // 回显原站点的已有标签
            if (exact.tags) {
                selectTagsForSite(exact.tags);
            }
            return;
        }

        const sameHost = existingSites.find(s => extractHostname(s.url) === host);
        if (sameHost) {
            urlDupNotice.className = 'dup-alert info';
            urlDupNotice.style.display = 'block';
            urlDupNotice.innerHTML = `ℹ️ <b>同域名已有收录</b>：【${escapeHtml(sameHost.name)}】（${escapeHtml(sameHost.url)}）`;
            return;
        }

        urlDupNotice.style.display = 'none';
    }

    // ── 本地标签页 DOM 即时提取 (0ms 瞬时解析 + 支持局域网与内网网址) ──
    async function extractTabMeta(tab) {
        if (!tab || !tab.id || !tab.url || !/^https?:\/\//i.test(tab.url)) return null;

        const meta = {
            title: tab.title || '',
            icon: tab.favIconUrl || '',
            description: ''
        };

        if (chrome.scripting && chrome.scripting.executeScript) {
            try {
                const [res] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: () => {
                        const d = document.querySelector('meta[name="description"]') ||
                                  document.querySelector('meta[property="og:description"]') ||
                                  document.querySelector('meta[name="twitter:description"]');
                        const iconEl = document.querySelector('link[rel="apple-touch-icon"]') ||
                                       document.querySelector('link[rel="icon"]') ||
                                       document.querySelector('link[rel="shortcut icon"]');
                        return {
                            title: document.title || '',
                            description: d ? (d.content || '').trim() : '',
                            icon: iconEl ? (iconEl.href || '') : ''
                        };
                    }
                });
                if (res && res.result) {
                    if (res.result.title) meta.title = res.result.title;
                    if (res.result.description) meta.description = res.result.description;
                    if (res.result.icon) meta.icon = res.result.icon;
                }
            } catch (e) {
                // 部分特殊或受限页面无法注入，忽略报错
            }
        }
        return meta;
    }

    // ── 服务端后备抓取 ──
    let abortController = null;
    async function fetchPageInfo(url, fillTitle = false, fillDesc = false) {
        const trimmed = (url || '').trim();
        if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
            iconStatus.textContent = '请输入合法的 http/https 网址';
            return;
        }

        if (abortController) abortController.abort();
        abortController = new AbortController();

        iconStatus.innerHTML = '<span class="spinner" style="border-color: rgba(102,126,234,0.3); border-top-color: #667eea;"></span> 正在解析官方图标...';

        try {
            const res = await fetch(`${currentServerUrl}/api/fetch-icon`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ url: trimmed, includeText: true }),
                signal: abortController.signal
            });

            if (res.status === 401) {
                saveFormDraft();
                showLoginView();
                return;
            }

            if (!res.ok) {
                iconStatus.textContent = '未能提取到官方图标，可手动输入';
                return;
            }

            const data = await res.json();
            if (data.icon) {
                inputIcon.value = data.icon;
                renderIcon(data.icon);
                iconStatus.textContent = '✅ 高清图标已就绪';
            } else {
                iconStatus.textContent = '默认图标已就绪';
            }

            if (fillTitle && data.title && !inputName.value.trim()) {
                inputName.value = data.title.trim();
            }
            if (fillDesc && data.description && !inputDesc.value.trim()) {
                inputDesc.value = data.description.trim();
            }
        } catch (err) {
            if (err.name === 'AbortError') return;
            iconStatus.textContent = '图标解析超时或网络受阻';
        }
    }

    // ── 同步已收录 URLs 以便后台更新浏览器图标徽标 (Badge) ──
    async function syncCollectedUrls() {
        if (!chrome.storage || !chrome.storage.local) return;
        const urls = existingSites.map(s => normalizeUrl(s.url)).filter(Boolean);
        await chrome.storage.local.set({ dognav_collected_urls: urls });
        if (chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({ action: 'REFRESH_BADGES' }).catch(() => {});
        }
    }

    // ── 加载元数据（分类、标签、已有站点） ──
    async function loadMeta() {
        try {
            const [catRes, tagRes, sitesRes] = await Promise.all([
                fetch(`${currentServerUrl}/api/categories`),
                fetch(`${currentServerUrl}/api/tags`),
                fetch(`${currentServerUrl}/api/sites`)
            ]);

            if (catRes.ok) {
                allCategories = await catRes.json();
                renderCategories();
                renderManageCategoryFilter();
            }

            if (tagRes.ok) {
                allTags = await tagRes.json();
                renderTags();
            }

            if (sitesRes.ok) {
                existingSites = await sitesRes.json();
                checkUrlDuplicate(inputUrl.value.trim());
                await syncCollectedUrls();
            }
        } catch (e) {
            console.error('Failed to load metadata', e);
        }
    }

    function renderCategories() {
        selectCategory.innerHTML = '';
        const activeCats = allCategories.filter(c => c.is_active !== 0);
        if (activeCats.length === 0) {
            selectCategory.innerHTML = '<option value="">暂无分类</option>';
            return;
        }

        activeCats.forEach((c, idx) => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = (c.icon ? c.icon + ' ' : '') + c.name;
            if (idx === 0) opt.selected = true;
            selectCategory.appendChild(opt);
        });
    }

    function renderManageCategoryFilter() {
        if (!manageCategoryFilter) return;
        const curVal = manageCategoryFilter.value;
        manageCategoryFilter.innerHTML = '<option value="">全部分类</option>';
        allCategories.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.id;
            opt.textContent = (c.icon ? c.icon + ' ' : '') + c.name;
            if (c.id === curVal) opt.selected = true;
            manageCategoryFilter.appendChild(opt);
        });
    }

    function renderTags() {
        tagChips.innerHTML = '';
        if (!allTags || allTags.length === 0) {
            tagChips.innerHTML = '<span class="tag-empty">暂无可用标签</span>';
            return;
        }

        allTags.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.dataset.id = t.id;
            const dotColor = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#667eea';
            chip.innerHTML = `<span class="tag-dot" style="background:${dotColor}"></span>${escapeHtml(t.name)}`;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
            });
            tagChips.appendChild(chip);
        });
    }

    function getSelectedTagIds() {
        return Array.from(tagChips.querySelectorAll('.tag-chip.active'))
            .map(chip => Number(chip.dataset.id))
            .filter(n => Number.isInteger(n) && n > 0);
    }

    // ── 表单草稿保护（防止 401 丢失编辑数据） ──
    function saveFormDraft() {
        unsavedDraft = {
            url: inputUrl.value,
            name: inputName.value,
            category: selectCategory.value,
            icon: inputIcon.value,
            description: inputDesc.value,
            is_featured: inputFeatured.checked,
            sort_order: inputSort.value,
            tags: getSelectedTagIds()
        };
    }

    function restoreFormDraft() {
        if (!unsavedDraft) return;
        inputUrl.value = unsavedDraft.url || '';
        inputName.value = unsavedDraft.name || '';
        if (unsavedDraft.category) selectCategory.value = unsavedDraft.category;
        inputIcon.value = unsavedDraft.icon || '';
        renderIcon(unsavedDraft.icon);
        inputDesc.value = unsavedDraft.description || '';
        inputFeatured.checked = !!unsavedDraft.is_featured;
        inputSort.value = unsavedDraft.sort_order || 0;
        selectTagsForSite(unsavedDraft.tags || []);
        checkUrlDuplicate(inputUrl.value);
        unsavedDraft = null;
    }

    // ── 视图控制 ──
    function showLoginView() {
        loginView.style.display = 'flex';
        addView.style.display = 'none';
        if (manageView) manageView.style.display = 'none';
        successView.style.display = 'none';
        cfgServerUrl.value = currentServerUrl;
        cfgPassword.focus();
    }

    async function showAddView() {
        loginView.style.display = 'none';
        addView.style.display = 'flex';
        if (manageView) manageView.style.display = 'none';
        successView.style.display = 'none';

        // 1. 如果有未保存草稿，优先恢复草稿
        if (unsavedDraft) {
            await loadMeta();
            restoreFormDraft();
            return;
        }

        // 2. 获取当前活动标签页信息或 URL 参数
        const params = new URLSearchParams(window.location.search);
        let targetUrl = params.get('url') || '';
        let targetTitle = params.get('title') || '';
        let activeTabObj = null;

        if (!targetUrl && chrome.tabs && chrome.tabs.query) {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
                    targetUrl = tab.url;
                    targetTitle = tab.title || '';
                    activeTabObj = tab;
                }
            } catch (e) {}
        }

        if (targetUrl) {
            inputUrl.value = targetUrl;
            inputName.value = targetTitle;
        }

        // 3. 加载分类、标签及查重列表
        await loadMeta();

        // 4. 优先通过客户端瞬时提取 DOM 信息（兼顾速度与内网网址）
        let domExtracted = false;
        if (activeTabObj) {
            const meta = await extractTabMeta(activeTabObj);
            if (meta) {
                if (meta.title && !inputName.value.trim()) inputName.value = meta.title;
                if (meta.description && !inputDesc.value.trim()) inputDesc.value = meta.description;
                if (meta.icon) {
                    inputIcon.value = meta.icon;
                    renderIcon(meta.icon);
                    iconStatus.textContent = '⚡ 已从当前页面即时提取';
                    domExtracted = true;
                }
            }
        }

        // 5. 若客户端未能提取到图标，异步由服务端补全高分辨率图标
        if (targetUrl && !domExtracted) {
            fetchPageInfo(targetUrl, !targetTitle, true);
        } else if (!targetUrl) {
            inputUrl.focus();
        }
    }

    function showManageView() {
        loginView.style.display = 'none';
        addView.style.display = 'none';
        successView.style.display = 'none';
        if (manageView) manageView.style.display = 'flex';
        manageCurrentLimit = MANAGE_PAGE_STEP;
        renderManageList();
        if (manageSearchInput) {
            manageSearchInput.value = '';
            manageSearchInput.focus();
        }
    }

    function showSuccessView(title, desc, icon = '✓') {
        loginView.style.display = 'none';
        addView.style.display = 'none';
        if (manageView) manageView.style.display = 'none';
        successView.style.display = 'flex';
        if (successTitle) successTitle.textContent = title;
        if (successDesc) successDesc.textContent = desc;
        if (successIcon) successIcon.textContent = icon;
    }

    // ── 删除站点 ──
    async function deleteSite(siteId, siteName) {
        if (!confirm(`确定要从导航站中彻底删除【${siteName}】吗？\n（此操作不可撤销）`)) {
            return false;
        }

        try {
            const res = await fetch(`${currentServerUrl}/api/sites/${siteId}`, {
                method: 'DELETE',
                headers: authHeaders()
            });

            if (res.status === 401) {
                showLoginView();
                return false;
            }

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.error || '删除失败，请稍后重试');
                return false;
            }

            // 从本地缓存中移除并同步 Badge
            existingSites = existingSites.filter(s => s.id !== siteId);
            await syncCollectedUrls();
            return true;
        } catch (e) {
            alert('删除请求失败：' + (e.message || '网络连接异常'));
            return false;
        }
    }

    // ── 渲染管理列表（支持搜索、分类过滤与分页） ──
    function renderManageList() {
        if (!manageSiteList || !manageStats) return;
        const q = (manageSearchInput ? manageSearchInput.value : '').trim().toLowerCase();
        const catFilter = manageCategoryFilter ? manageCategoryFilter.value : '';

        let filtered = existingSites;
        if (catFilter) {
            filtered = filtered.filter(s => String(s.category) === String(catFilter));
        }

        if (q) {
            filtered = filtered.filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.url && s.url.toLowerCase().includes(q)) ||
                (s.description && s.description.toLowerCase().includes(q)) ||
                (s.category && String(s.category).toLowerCase().includes(q))
            );
        }

        const totalFiltered = filtered.length;
        manageStats.textContent = `共 ${existingSites.length} 个站点${(q || catFilter) ? `（筛选出 ${totalFiltered} 个）` : ''}`;

        if (totalFiltered === 0) {
            manageSiteList.innerHTML = `<div style="text-align: center; color: #a0aec0; padding: 40px 10px; font-size: 13px;">${(q || catFilter) ? '未找到匹配的站点' : '导航站暂无收藏站点'}</div>`;
            if (managePagination) managePagination.style.display = 'none';
            return;
        }

        const pagedItems = filtered.slice(0, manageCurrentLimit);
        manageSiteList.innerHTML = '';

        pagedItems.forEach(site => {
            const item = document.createElement('div');
            item.className = 'manage-site-item';

            const catName = (allCategories.find(c => c.id === site.category)?.name) || site.category || '默认';
            const iconSrc = site.icon
                ? (site.icon.startsWith('/') ? (currentServerUrl + site.icon) : site.icon)
                : '';

            const iconHtml = iconSrc
                ? `<img class="manage-site-icon" src="${escapeHtml(iconSrc)}" onerror="this.onerror=null;this.outerHTML='<span style=\\'font-size:16px;width:22px;text-align:center;\\'>🌐</span>';">`
                : `<span style="font-size: 16px; width: 22px; text-align: center; flex-shrink: 0;">🌐</span>`;

            item.innerHTML = `
                <div class="manage-site-info">
                    ${iconHtml}
                    <div class="manage-site-meta">
                        <div class="manage-site-name" title="${escapeHtml(site.name)}">
                            <span>${escapeHtml(site.name)}</span>
                            <span class="manage-site-cat">${escapeHtml(catName)}</span>
                        </div>
                        <div class="manage-site-url" title="${escapeHtml(site.url)}">${escapeHtml(site.url)}</div>
                    </div>
                </div>
                <div class="manage-site-actions">
                    <button type="button" class="btn-icon-manage btn-edit-site" title="编辑此站点">✏️</button>
                    <button type="button" class="btn-icon-manage btn-del-site" title="删除此站点">🗑️</button>
                </div>
            `;

            item.querySelector('.btn-edit-site').addEventListener('click', () => {
                loadSiteIntoAddView(site);
            });

            item.querySelector('.btn-del-site').addEventListener('click', async () => {
                const ok = await deleteSite(site.id, site.name);
                if (ok) {
                    item.style.transition = 'all 0.2s ease';
                    item.style.opacity = '0';
                    item.style.transform = 'translateX(20px)';
                    setTimeout(() => {
                        renderManageList();
                    }, 200);
                }
            });

            manageSiteList.appendChild(item);
        });

        // 分页加载按钮状态
        if (managePagination && btnManageLoadMore) {
            if (totalFiltered > manageCurrentLimit) {
                const remaining = totalFiltered - manageCurrentLimit;
                btnManageLoadMore.textContent = `加载更多站点 (剩余 ${remaining} 项)`;
                managePagination.style.display = 'flex';
            } else {
                managePagination.style.display = 'none';
            }
        }
    }

    function loadSiteIntoAddView(site) {
        if (manageView) manageView.style.display = 'none';
        addView.style.display = 'flex';
        inputUrl.value = site.url || '';
        inputName.value = site.name || '';
        selectCategory.value = site.category || '';
        inputIcon.value = site.icon || '';
        renderIcon(site.icon);
        inputDesc.value = site.description || '';
        inputFeatured.checked = !!site.is_featured;
        inputSort.value = site.sort_order || 0;
        checkUrlDuplicate(site.url || '');
        // 关键修复：编辑时回显既有标签
        selectTagsForSite(site.tags || []);
    }

    // ── 保存 / 更新站点 ──
    async function saveSite() {
        showAddError('');
        const rawUrl = inputUrl.value.trim();
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
            showAddError('请输入有效的 http:// 或 https:// 网址');
            inputUrl.focus();
            return;
        }

        const name = inputName.value.trim();
        if (!name) {
            showAddError('请输入网站名称');
            inputName.focus();
            return;
        }

        const category = selectCategory.value;
        if (!category) {
            showAddError('请选择归属分类');
            selectCategory.focus();
            return;
        }

        const icon = inputIcon.value.trim();
        const description = inputDesc.value.trim();
        const is_featured = inputFeatured.checked ? 1 : 0;
        const sort_order = parseInt(inputSort.value, 10) || 0;

        const isUpdate = Boolean(currentMatchedSite && currentMatchedSite.id);
        const method = isUpdate ? 'PUT' : 'POST';
        const endpoint = isUpdate ? `${currentServerUrl}/api/sites/${currentMatchedSite.id}` : `${currentServerUrl}/api/sites`;

        btnSave.disabled = true;
        btnSave.innerHTML = `<span class="spinner"></span> 正在${isUpdate ? '更新' : '保存'}...`;

        try {
            const res = await fetch(endpoint, {
                method,
                headers: authHeaders(),
                body: JSON.stringify({
                    name,
                    url: rawUrl,
                    description,
                    icon,
                    category,
                    is_featured,
                    sort_order
                })
            });

            if (res.status === 401) {
                saveFormDraft();
                showLoginView();
                return;
            }

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                showAddError(data.error || (isUpdate ? '更新失败，请重试' : '保存失败，请重试'));
                btnSave.disabled = false;
                btnSave.innerHTML = `<span>${isUpdate ? '更新此站点' : '保存到 Dog-Nav'}</span>`;
                return;
            }

            const siteId = isUpdate ? currentMatchedSite.id : Number(data.id);
            const tagIds = getSelectedTagIds();
            if (siteId > 0) {
                await fetch(`${currentServerUrl}/api/sites/${siteId}/tags`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ tag_ids: tagIds })
                }).catch(() => {});
            }

            // 更新本地 existingSites 及标签
            const savedTags = allTags.filter(t => tagIds.includes(t.id));
            if (isUpdate) {
                const idx = existingSites.findIndex(s => s.id === siteId);
                if (idx !== -1) {
                    existingSites[idx] = { ...existingSites[idx], name, url: rawUrl, description, icon, category, is_featured, sort_order, tags: savedTags };
                }
            } else {
                existingSites.push({ id: siteId, name, url: rawUrl, description, icon, category, is_featured, sort_order, tags: savedTags });
            }

            // 同步徽标
            await syncCollectedUrls();

            const selectedCatText = selectCategory.options[selectCategory.selectedIndex]?.textContent || '已选分类';
            showSuccessView(
                isUpdate ? '💾 更新成功！' : '🎉 收藏成功！',
                isUpdate ? `已成功更新【${name}】的站点信息。` : `已成功添加【${name}】至【${selectedCatText}】分类。`,
                isUpdate ? '💾' : '✓'
            );

            btnSave.disabled = false;
            btnSave.innerHTML = '<span>保存到 Dog-Nav</span>';
        } catch (err) {
            showAddError('网络请求失败：' + err.message);
            btnSave.disabled = false;
            btnSave.innerHTML = `<span>${isUpdate ? '更新此站点' : '保存到 Dog-Nav'}</span>`;
        }
    }

    // ── 登录认证 ──
    async function doLogin() {
        showLoginError('');
        let server = cleanServerUrl(cfgServerUrl.value);
        const username = cfgUsername.value.trim();
        const password = cfgPassword.value;

        if (!server || !/^https?:\/\//i.test(server)) {
            showLoginError('请输入合法的导航站主页地址（以 http:// 或 https:// 开头，不带 /admin）');
            return;
        }
        cfgServerUrl.value = server;

        if (!username || !password) {
            showLoginError('请输入管理员账号和密码');
            return;
        }

        btnLogin.disabled = true;
        btnLogin.innerHTML = '<span class="spinner"></span> 连接中...';

        try {
            const res = await fetch(`${server}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            let data = null;
            try {
                data = await res.json();
            } catch {}

            if (!res.ok) {
                const errMsg = (data && data.error) ? data.error : `HTTP ${res.status}`;
                showLoginError(`登录失败 (${errMsg})，请检查账号密码或站点主页地址`);
                btnLogin.disabled = false;
                btnLogin.innerHTML = '<span>连接并登录</span>';
                return;
            }

            if (!data || !data.token) {
                showLoginError((data && data.error) || '登录失败，服务器响应格式异常');
                btnLogin.disabled = false;
                btnLogin.innerHTML = '<span>连接并登录</span>';
                return;
            }

            currentServerUrl = server;
            currentToken = data.token;

            // 持久化存储到 chrome.storage.local
            if (chrome.storage && chrome.storage.local) {
                await chrome.storage.local.set({
                    dognav_server_url: currentServerUrl,
                    dognav_token: currentToken,
                    dognav_username: username
                });
            }

            await showAddView();
        } catch (e) {
            showLoginError(`无法连接到服务器 (${e.message || '网络连接失败'})，请检查网址是否正确或服务是否运行`);
            btnLogin.disabled = false;
            btnLogin.innerHTML = '<span>连接并登录</span>';
        }
    }

    // ── 初始化检查配置 ──
    async function init() {
        if (chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get(['dognav_server_url', 'dognav_token']);
            if (stored.dognav_server_url) currentServerUrl = cleanServerUrl(stored.dognav_server_url);
            if (stored.dognav_token) currentToken = stored.dognav_token;
        }

        if (!currentToken) {
            showLoginView();
            return;
        }

        try {
            const res = await fetch(`${currentServerUrl}/api/auth/me`, {
                headers: { 'Authorization': 'Bearer ' + currentToken }
            });
            if (res.status === 401) {
                currentToken = '';
                showLoginView();
                return;
            }
            await showAddView();
        } catch (e) {
            await showAddView();
        }
    }

    // ── 事件绑定 ──
    btnLogin.addEventListener('click', doLogin);
    cfgPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });

    btnToggleSettings.addEventListener('click', () => {
        if (loginView.style.display !== 'none') {
            showAddView();
        } else {
            showLoginView();
        }
    });

    if (btnToggleManage) {
        btnToggleManage.addEventListener('click', () => {
            if (manageView && manageView.style.display !== 'none') {
                showAddView();
            } else {
                showManageView();
            }
        });
    }

    if (btnBackFromManage) {
        btnBackFromManage.addEventListener('click', showAddView);
    }

    if (btnSuccessManage) {
        btnSuccessManage.addEventListener('click', showManageView);
    }

    // 快速新建分类
    if (btnToggleNewCat) {
        btnToggleNewCat.addEventListener('click', () => {
            const isHidden = newCatRow.style.display === 'none';
            newCatRow.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) newCatName.focus();
        });
    }
    if (btnCancelNewCat) {
        btnCancelNewCat.addEventListener('click', () => {
            newCatRow.style.display = 'none';
            newCatName.value = '';
        });
    }
    if (btnConfirmNewCat) {
        btnConfirmNewCat.addEventListener('click', async () => {
            const name = newCatName.value.trim();
            const icon = newCatIcon.value.trim() || '📁';
            if (!name) {
                newCatName.focus();
                return;
            }
            const catId = 'cat_' + Date.now().toString(36);
            btnConfirmNewCat.disabled = true;
            btnConfirmNewCat.textContent = '...';

            try {
                const res = await fetch(`${currentServerUrl}/api/categories`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ id: catId, name, icon, sort_order: allCategories.length + 1 })
                });

                if (res.status === 401) {
                    saveFormDraft();
                    showLoginView();
                    return;
                }

                if (!res.ok) {
                    const d = await res.json().catch(() => ({}));
                    alert(d.error || '创建分类失败');
                    return;
                }

                allCategories.push({ id: catId, name, icon, is_active: 1, sort_order: allCategories.length + 1 });
                renderCategories();
                selectCategory.value = catId;
                renderManageCategoryFilter();
                newCatRow.style.display = 'none';
                newCatName.value = '';
            } catch (err) {
                alert('网络请求失败：' + err.message);
            } finally {
                btnConfirmNewCat.disabled = false;
                btnConfirmNewCat.textContent = '添加';
            }
        });
    }

    // 快速新建标签
    if (btnToggleNewTag) {
        btnToggleNewTag.addEventListener('click', () => {
            const isHidden = newTagRow.style.display === 'none';
            newTagRow.style.display = isHidden ? 'flex' : 'none';
            if (isHidden) newTagName.focus();
        });
    }
    if (btnCancelNewTag) {
        btnCancelNewTag.addEventListener('click', () => {
            newTagRow.style.display = 'none';
            newTagName.value = '';
        });
    }
    if (btnConfirmNewTag) {
        btnConfirmNewTag.addEventListener('click', async () => {
            const name = newTagName.value.trim();
            if (!name) {
                newTagName.focus();
                return;
            }
            btnConfirmNewTag.disabled = true;
            btnConfirmNewTag.textContent = '...';

            try {
                const res = await fetch(`${currentServerUrl}/api/tags`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ name, color: '#667eea' })
                });

                if (res.status === 401) {
                    saveFormDraft();
                    showLoginView();
                    return;
                }

                if (!res.ok && res.status !== 409) {
                    const d = await res.json().catch(() => ({}));
                    alert(d.error || '创建标签失败');
                    return;
                }

                // 重新加载标签并自动高亮选中新标签
                const tagRes = await fetch(`${currentServerUrl}/api/tags`);
                if (tagRes.ok) {
                    allTags = await tagRes.json();
                    renderTags();
                    const newTag = allTags.find(t => t.name.toLowerCase() === name.toLowerCase());
                    if (newTag) {
                        const chip = tagChips.querySelector(`.tag-chip[data-id="${newTag.id}"]`);
                        if (chip) chip.classList.add('active');
                    }
                }
                newTagRow.style.display = 'none';
                newTagName.value = '';
            } catch (err) {
                alert('网络请求失败：' + err.message);
            } finally {
                btnConfirmNewTag.disabled = false;
                btnConfirmNewTag.textContent = '添加';
            }
        });
    }

    // 管理面板搜索与分类筛选
    if (manageSearchInput) {
        manageSearchInput.addEventListener('input', () => {
            manageCurrentLimit = MANAGE_PAGE_STEP;
            renderManageList();
        });
    }
    if (manageCategoryFilter) {
        manageCategoryFilter.addEventListener('change', () => {
            manageCurrentLimit = MANAGE_PAGE_STEP;
            renderManageList();
        });
    }
    if (btnManageLoadMore) {
        btnManageLoadMore.addEventListener('click', () => {
            manageCurrentLimit += MANAGE_PAGE_STEP;
            renderManageList();
        });
    }

    // 删除当前网址
    if (btnDeleteCurrent) {
        btnDeleteCurrent.addEventListener('click', async () => {
            if (!currentMatchedSite) return;
            btnDeleteCurrent.disabled = true;
            btnDeleteCurrent.innerHTML = '<span class="spinner" style="border-color: rgba(220,38,38,0.3); border-top-color: #dc2626;"></span> 删除中...';
            const ok = await deleteSite(currentMatchedSite.id, currentMatchedSite.name);
            if (ok) {
                const name = currentMatchedSite.name;
                currentMatchedSite = null;
                showSuccessView('🗑️ 删除成功！', `站点【${name}】已从导航站中彻底移除。`, '🗑️');
            } else {
                btnDeleteCurrent.disabled = false;
                btnDeleteCurrent.innerHTML = '🗑️ 删除此网址';
            }
        });
    }

    btnRefetch.addEventListener('click', () => {
        fetchPageInfo(inputUrl.value.trim(), true, true);
    });

    inputUrl.addEventListener('input', () => {
        checkUrlDuplicate(inputUrl.value);
    });

    inputUrl.addEventListener('blur', () => {
        checkUrlDuplicate(inputUrl.value);
        if (!inputIcon.value.trim()) {
            fetchPageInfo(inputUrl.value.trim(), !inputName.value.trim(), !inputDesc.value.trim());
        }
    });

    inputIcon.addEventListener('input', () => {
        renderIcon(inputIcon.value.trim());
    });

    btnSave.addEventListener('click', saveSite);

    btnCancel.addEventListener('click', () => {
        window.close();
    });

    btnClose.addEventListener('click', () => {
        window.close();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (newCatRow && newCatRow.style.display !== 'none') {
                newCatRow.style.display = 'none';
                return;
            }
            if (newTagRow && newTagRow.style.display !== 'none') {
                newTagRow.style.display = 'none';
                return;
            }
            if (manageView && manageView.style.display !== 'none') {
                showAddView();
                return;
            }
            window.close();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (addView.style.display !== 'none') {
                saveSite();
            }
        }
    });

    init();
})();
