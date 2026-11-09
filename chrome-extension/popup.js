// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Popup Controller
// ═══════════════════════════════════════════

(function () {
    const DEFAULT_SERVER_URL = 'http://localhost:3000';

    // DOM Elements
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
    const manageStats = document.getElementById('manageStats');
    const manageSiteList = document.getElementById('manageSiteList');
    const btnBackFromManage = document.getElementById('btnBackFromManage');

    // Success Elements
    const btnClose = document.getElementById('btnClose');
    const successIcon = document.getElementById('successIcon');
    const successTitle = document.getElementById('successTitle');
    const successDesc = document.getElementById('successDesc');
    const btnSuccessManage = document.getElementById('btnSuccessManage');

    let currentServerUrl = DEFAULT_SERVER_URL;
    let currentToken = '';
    let allCategories = [];
    let allTags = [];
    let existingSites = [];
    let currentMatchedSite = null;

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
            // 如果是相对路径，拼上完整的 serverUrl
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

    // ── 重复与同域名检查 ──
    function checkUrlDuplicate(rawUrl) {
        if (!urlDupNotice) return;
        currentMatchedSite = null;
        if (btnDeleteCurrent) btnDeleteCurrent.style.display = 'none';
        if (btnSaveText) btnSaveText.textContent = '保存到 Dog-Nav';

        if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
            urlDupNotice.style.display = 'none';
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
            urlDupNotice.innerHTML = `⚠️ <b>该网址已收录！</b> 站点：【${escapeHtml(exact.name)}】（分类：${escapeHtml(catName)}）<br><span style="font-size:11px; color:#b45309;">可直接修改后更新，或点击下方【删除此网址】</span>`;
            if (btnDeleteCurrent) {
                btnDeleteCurrent.style.display = 'inline-flex';
                btnDeleteCurrent.title = `从导航站删除【${exact.name}】`;
            }
            if (btnSaveText) btnSaveText.textContent = '更新此站点';
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

    // ── 抓取网站图标与信息 ──
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
            }

            if (tagRes.ok) {
                allTags = await tagRes.json();
                renderTags();
            }

            if (sitesRes.ok) {
                existingSites = await sitesRes.json();
                checkUrlDuplicate(inputUrl.value.trim());
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

        // 1. 获取当前活动标签页信息或 URL 参数
        const params = new URLSearchParams(window.location.search);
        let targetUrl = params.get('url') || '';
        let targetTitle = params.get('title') || '';

        if (!targetUrl && chrome.tabs && chrome.tabs.query) {
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('edge://')) {
                    targetUrl = tab.url;
                    targetTitle = tab.title || '';
                }
            } catch (e) {}
        }

        if (targetUrl) {
            inputUrl.value = targetUrl;
            inputName.value = targetTitle;
        }

        // 2. 加载分类、标签及查重列表
        await loadMeta();

        // 3. 异步抓取高分辨率图标
        if (targetUrl) {
            fetchPageInfo(targetUrl, !targetTitle, true);
        } else {
            inputUrl.focus();
        }
    }

    function showManageView() {
        loginView.style.display = 'none';
        addView.style.display = 'none';
        successView.style.display = 'none';
        if (manageView) manageView.style.display = 'flex';
        renderManageList('');
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

            // 从本地缓存中移除
            existingSites = existingSites.filter(s => s.id !== siteId);
            return true;
        } catch (e) {
            alert('删除请求失败：' + (e.message || '网络连接异常'));
            return false;
        }
    }

    // ── 渲染管理列表 ──
    function renderManageList(query = '') {
        if (!manageSiteList || !manageStats) return;
        const q = (query || '').trim().toLowerCase();
        const filtered = q
            ? existingSites.filter(s =>
                (s.name && s.name.toLowerCase().includes(q)) ||
                (s.url && s.url.toLowerCase().includes(q)) ||
                (s.description && s.description.toLowerCase().includes(q)) ||
                (s.category && String(s.category).toLowerCase().includes(q))
            )
            : existingSites;

        manageStats.textContent = `共 ${existingSites.length} 个站点${q ? `（匹配到 ${filtered.length} 个）` : ''}`;

        if (filtered.length === 0) {
            manageSiteList.innerHTML = `<div style="text-align: center; color: #a0aec0; padding: 40px 10px; font-size: 13px;">${q ? '未找到匹配的站点' : '导航站暂无收藏站点'}</div>`;
            return;
        }

        manageSiteList.innerHTML = '';
        filtered.forEach(site => {
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
                        renderManageList(manageSearchInput ? manageSearchInput.value : '');
                    }, 200);
                }
            });

            manageSiteList.appendChild(item);
        });
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
            if (siteId > 0 && tagIds.length > 0) {
                await fetch(`${currentServerUrl}/api/sites/${siteId}/tags`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ tag_ids: tagIds })
                }).catch(() => {});
            }

            // 更新本地 existingSites
            if (isUpdate) {
                const idx = existingSites.findIndex(s => s.id === siteId);
                if (idx !== -1) {
                    existingSites[idx] = { ...existingSites[idx], name, url: rawUrl, description, icon, category, is_featured, sort_order };
                }
            } else {
                existingSites.push({ id: siteId, name, url: rawUrl, description, icon, category, is_featured, sort_order });
            }

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
            } catch {
                // Non-JSON response (e.g. 404/500 HTML)
            }

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

        // 验证当前 token 是否有效
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
            // 网络异常时，依然尝试展示收藏面板
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

    if (manageSearchInput) {
        manageSearchInput.addEventListener('input', (e) => {
            renderManageList(e.target.value);
        });
    }

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
            window.close();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (addView.style.display !== 'none') {
                saveSite();
            }
        }
    });

    init();
})();
