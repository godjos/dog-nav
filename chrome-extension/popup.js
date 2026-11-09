// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Popup Controller
// ═══════════════════════════════════════════

(function () {
    const DEFAULT_SERVER_URL = 'http://localhost:3000';

    // DOM Elements
    const loginView = document.getElementById('loginView');
    const addView = document.getElementById('addView');
    const successView = document.getElementById('successView');
    const btnToggleSettings = document.getElementById('btnToggleSettings');

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
    const btnSave = document.getElementById('btnSave');
    const btnClose = document.getElementById('btnClose');
    const successDesc = document.getElementById('successDesc');

    let currentServerUrl = DEFAULT_SERVER_URL;
    let currentToken = '';
    let allCategories = [];
    let allTags = [];
    let existingSites = [];

    // ── 辅助工具 ──
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
        if (!rawUrl || !/^https?:\/\//i.test(rawUrl.trim())) {
            urlDupNotice.style.display = 'none';
            return;
        }

        const norm = normalizeUrl(rawUrl);
        const host = extractHostname(rawUrl);

        const exact = existingSites.find(s => normalizeUrl(s.url) === norm);
        if (exact) {
            const catName = (allCategories.find(c => c.id === exact.category)?.name) || exact.category;
            urlDupNotice.className = 'dup-alert warning';
            urlDupNotice.style.display = 'block';
            urlDupNotice.innerHTML = `⚠️ <b>该网址已存在！</b> 站点名称：【${escapeHtml(exact.name)}】（分类：${escapeHtml(catName)}）`;
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
        successView.style.display = 'none';
        cfgServerUrl.value = currentServerUrl;
        cfgPassword.focus();
    }

    async function showAddView() {
        loginView.style.display = 'none';
        addView.style.display = 'flex';
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

    // ── 保存站点 ──
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

        btnSave.disabled = true;
        btnSave.innerHTML = '<span class="spinner"></span> 正在保存...';

        try {
            const res = await fetch(`${currentServerUrl}/api/sites`, {
                method: 'POST',
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

            const data = await res.json();
            if (!res.ok) {
                showAddError(data.error || '保存失败，请重试');
                btnSave.disabled = false;
                btnSave.innerHTML = '<span>保存到 Dog-Nav</span>';
                return;
            }

            const siteId = Number(data.id);
            const tagIds = getSelectedTagIds();
            if (siteId > 0 && tagIds.length > 0) {
                await fetch(`${currentServerUrl}/api/sites/${siteId}/tags`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ tag_ids: tagIds })
                }).catch(() => {});
            }

            // 成功视图
            const selectedCatText = selectCategory.options[selectCategory.selectedIndex]?.textContent || '已选分类';
            addView.style.display = 'none';
            successDesc.textContent = `已成功添加【${name}】至【${selectedCatText}】分类。`;
            successView.style.display = 'flex';

            setTimeout(() => {
                window.close();
            }, 1200);

        } catch (err) {
            showAddError('网络请求失败：' + err.message);
            btnSave.disabled = false;
            btnSave.innerHTML = '<span>保存到 Dog-Nav</span>';
        }
    }

    // ── 登录认证 ──
    async function doLogin() {
        showLoginError('');
        let server = cfgServerUrl.value.trim().replace(/\/+$/, '');
        const username = cfgUsername.value.trim();
        const password = cfgPassword.value;

        if (!server || !/^https?:\/\//i.test(server)) {
            showLoginError('请输入合法的导航站地址（需以 http:// 或 https:// 开头）');
            return;
        }
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

            const data = await res.json();
            if (!res.ok || !data.success) {
                showLoginError(data.error || '登录失败，请检查账号密码');
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
            showLoginError('无法连接到服务器，请检查网址是否正确或服务是否运行');
            btnLogin.disabled = false;
            btnLogin.innerHTML = '<span>连接并登录</span>';
        }
    }

    // ── 初始化检查配置 ──
    async function init() {
        if (chrome.storage && chrome.storage.local) {
            const stored = await chrome.storage.local.get(['dognav_server_url', 'dognav_token']);
            if (stored.dognav_server_url) currentServerUrl = stored.dognav_server_url;
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
