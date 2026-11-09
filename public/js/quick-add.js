// ═══════════════════════════════════════════
// Dog-Nav 快速收藏 (Quick Add) 脚本
// 支持 Bookmarklet 小书签与弹窗即时录入
// ═══════════════════════════════════════════
(function () {
    const params = new URLSearchParams(window.location.search);
    const initialUrl = (params.get('url') || '').trim();
    const initialTitle = (params.get('title') || '').trim();
    const initialDesc = (params.get('desc') || '').trim();
    const initialCategory = (params.get('category') || '').trim();

    // DOM 元素
    const headerStatus = document.getElementById('headerStatus');
    const loginView = document.getElementById('loginView');
    const quickAddView = document.getElementById('quickAddView');
    const quickAddFooter = document.getElementById('quickAddFooter');
    const splashView = document.getElementById('splashView');
    const splashDesc = document.getElementById('splashDesc');
    const loginError = document.getElementById('loginError');
    const addError = document.getElementById('addError');

    const inputUsername = document.getElementById('loginUsername');
    const inputPassword = document.getElementById('loginPassword');
    const btnLogin = document.getElementById('btnLogin');

    const inputUrl = document.getElementById('siteUrl');
    const inputName = document.getElementById('siteName');
    const selectCategory = document.getElementById('siteCategory');
    const inputIcon = document.getElementById('siteIcon');
    const inputDesc = document.getElementById('siteDesc');
    const inputFeatured = document.getElementById('siteFeatured');
    const inputSort = document.getElementById('siteSort');
    const tagList = document.getElementById('tagList');

    const iconImg = document.getElementById('iconImg');
    const iconFallback = document.getElementById('iconFallback');
    const iconStatus = document.getElementById('iconStatus');
    const btnRefetch = document.getElementById('btnRefetch');

    const btnCancel = document.getElementById('btnCancel');
    const btnSave = document.getElementById('btnSave');
    const btnCloseNow = document.getElementById('btnCloseNow');

    let allCategories = [];
    let allTags = [];

    // ── Token 管理 ──
    function getToken() {
        return sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token') || '';
    }

    function setToken(token) {
        if (!token) return;
        sessionStorage.setItem('admin_token', token);
        sessionStorage.setItem('admin_logged_in', 'true');
        localStorage.setItem('admin_token', token);
        localStorage.setItem('admin_logged_in', 'true');
    }

    function clearToken() {
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('admin_logged_in');
        localStorage.removeItem('admin_token');
        localStorage.removeItem('admin_logged_in');
    }

    function authHeaders() {
        return {
            'Authorization': 'Bearer ' + getToken(),
            'Content-Type': 'application/json'
        };
    }

    // ── 错误展示 ──
    function showAddError(msg) {
        if (!msg) {
            addError.classList.remove('show');
            addError.textContent = '';
        } else {
            addError.textContent = msg;
            addError.classList.add('show');
        }
    }

    function showLoginError(msg) {
        if (!msg) {
            loginError.classList.remove('show');
            loginError.textContent = '';
        } else {
            loginError.textContent = msg;
            loginError.classList.add('show');
        }
    }

    // ── 图标渲染与更新 ──
    function renderIcon(iconVal) {
        if (!iconVal) {
            iconImg.style.display = 'none';
            iconImg.src = '';
            iconFallback.style.display = 'inline';
            iconFallback.textContent = '🌐';
            return;
        }
        if (/^(https?:\/\/|\/|data:image\/)/i.test(iconVal)) {
            iconImg.src = iconVal;
            iconImg.style.display = 'inline-block';
            iconFallback.style.display = 'none';
        } else {
            iconImg.style.display = 'none';
            iconImg.src = '';
            iconFallback.style.display = 'inline';
            iconFallback.textContent = iconVal;
        }
    }

    // ── 异步抓取网站信息与图标 ──
    let fetchAbortController = null;
    async function fetchPageInfo(url, fillTitle = false, fillDesc = false) {
        const trimmed = (url || '').trim();
        if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
            iconStatus.textContent = '请输入合法的 http/https 网址';
            return;
        }

        if (fetchAbortController) fetchAbortController.abort();
        fetchAbortController = new AbortController();

        iconStatus.innerHTML = '<span class="spinner" style="border-color: rgba(102,126,234,0.3); border-top-color: #667eea;"></span> 正在解析高分辨率图标...';

        try {
            const res = await fetch('/api/fetch-icon', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ url: trimmed, includeText: true }),
                signal: fetchAbortController.signal
            });

            if (res.status === 401) {
                clearToken();
                showLoginView();
                return;
            }

            if (!res.ok) {
                iconStatus.textContent = '未提取到官方图标，可手动填写';
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
            iconStatus.textContent = '图标抓取超时或网络受阻';
        }
    }

    // ── 标签与分类数据加载 ──
    async function loadMeta() {
        try {
            const [catRes, tagRes] = await Promise.all([
                fetch('/api/categories'),
                fetch('/api/tags')
            ]);

            if (catRes.ok) {
                allCategories = await catRes.json();
                renderCategories();
            }

            if (tagRes.ok) {
                allTags = await tagRes.json();
                renderTags();
            }
        } catch (e) {
            console.error('Failed to load categories/tags', e);
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
            if (initialCategory ? c.id === initialCategory : idx === 0) opt.selected = true;
            selectCategory.appendChild(opt);
        });
    }

    function renderTags() {
        tagList.innerHTML = '';
        if (!allTags || allTags.length === 0) {
            tagList.innerHTML = '<span style="font-size: 12px; color: #a0aec0;">暂无可用标签</span>';
            return;
        }

        allTags.forEach(t => {
            const chip = document.createElement('span');
            chip.className = 'tag-chip';
            chip.dataset.id = t.id;
            const dotColor = /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#667eea';
            chip.innerHTML = `<span class="tag-dot" style="background:${dotColor}"></span>${typeof escapeHtml === 'function' ? escapeHtml(t.name) : t.name}`;
            chip.addEventListener('click', () => {
                chip.classList.toggle('active');
            });
            tagList.appendChild(chip);
        });
    }

    function getSelectedTagIds() {
        return Array.from(tagList.querySelectorAll('.tag-chip.active'))
            .map(chip => Number(chip.dataset.id))
            .filter(n => Number.isInteger(n) && n > 0);
    }

    // ── 视图切换 ──
    function showLoginView() {
        headerStatus.textContent = '请先登录';
        headerStatus.style.background = 'rgba(239, 68, 68, 0.25)';
        loginView.style.display = 'flex';
        quickAddView.style.display = 'none';
        quickAddFooter.style.display = 'none';
        splashView.classList.remove('show');
        inputPassword.focus();
    }

    async function showAddView(user) {
        headerStatus.textContent = '管理员: ' + ((user && user.username) || 'admin');
        headerStatus.style.background = 'rgba(34, 197, 94, 0.25)';
        loginView.style.display = 'none';
        quickAddView.style.display = 'flex';
        quickAddFooter.style.display = 'flex';
        splashView.classList.remove('show');

        // 载入分类与标签
        await loadMeta();

        // 初始参数填充
        if (initialUrl) {
            inputUrl.value = initialUrl;
            if (initialTitle) inputName.value = initialTitle;
            if (initialDesc) inputDesc.value = initialDesc;

            // 触发自动抓取
            fetchPageInfo(initialUrl, !initialTitle, !initialDesc);
        } else {
            inputUrl.focus();
        }
    }

    // ── 保存站点 ──
    async function saveSite() {
        showAddError('');
        const rawUrl = inputUrl.value.trim();
        const safeUrl = typeof sanitizeUrl === 'function' ? sanitizeUrl(rawUrl) : rawUrl;
        if (!safeUrl || !/^https?:\/\//i.test(safeUrl)) {
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
            showAddError('请选择一个归属分类');
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
            const res = await fetch('/api/sites', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({
                    name,
                    url: safeUrl,
                    description,
                    icon,
                    category,
                    is_featured,
                    sort_order
                })
            });

            if (res.status === 401) {
                clearToken();
                showLoginView();
                return;
            }

            const data = await res.json();
            if (!res.ok) {
                showAddError(data.error || '保存失败，请重试');
                btnSave.disabled = false;
                btnSave.innerHTML = '<span>保存并关闭</span>';
                return;
            }

            const siteId = Number(data.id);
            const tagIds = getSelectedTagIds();
            if (siteId > 0 && tagIds.length > 0) {
                await fetch(`/api/sites/${siteId}/tags`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ tag_ids: tagIds })
                }).catch(() => {});
            }

            // 保存成功：发送跨标签页/跨窗口同步事件
            try {
                const bc = new BroadcastChannel('dognav_channel');
                bc.postMessage({ type: 'site_added', siteId });
                bc.close();
            } catch (e) {}

            // 切换至轻量成功界面
            const selectedCatText = selectCategory.options[selectCategory.selectedIndex]?.textContent || '已选分类';
            quickAddView.style.display = 'none';
            quickAddFooter.style.display = 'none';
            splashDesc.textContent = `已成功添加【${name}】至【${selectedCatText}】分类。小窗即将自动关闭...`;
            splashView.classList.add('show');

            setTimeout(() => {
                try {
                    window.close();
                } catch (e) {}
            }, 1200);

        } catch (err) {
            showAddError('网络请求失败：' + err.message);
            btnSave.disabled = false;
            btnSave.innerHTML = '<span>保存并关闭</span>';
        }
    }

    // ── 登录认证 ──
    async function doLogin() {
        showLoginError('');
        const username = inputUsername.value.trim();
        const password = inputPassword.value;
        if (!username || !password) {
            showLoginError('请输入账号和密码');
            return;
        }

        btnLogin.disabled = true;
        btnLogin.innerHTML = '<span class="spinner"></span> 登录中...';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                showLoginError(data.error || '登录失败，请检查账号密码');
                btnLogin.disabled = false;
                btnLogin.textContent = '登录并继续';
                return;
            }

            setToken(data.token);
            await showAddView(data.user);
        } catch (e) {
            showLoginError('网络异常，请重试');
            btnLogin.disabled = false;
            btnLogin.textContent = '登录并继续';
        }
    }

    // ── 初始化检查认证状态 ──
    async function init() {
        const token = getToken();
        if (!token) {
            showLoginView();
            return;
        }

        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.status === 401) {
                clearToken();
                showLoginView();
                return;
            }
            const user = await res.json();
            await showAddView(user);
        } catch (e) {
            // 网络异常：若有本地 token，先尝试渲染
            await showAddView({ username: 'admin' });
        }
    }

    // ── 事件绑定 ──
    btnLogin.addEventListener('click', doLogin);
    inputPassword.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doLogin();
    });

    btnRefetch.addEventListener('click', () => {
        fetchPageInfo(inputUrl.value.trim(), true, true);
    });

    inputUrl.addEventListener('blur', () => {
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

    btnCloseNow.addEventListener('click', () => {
        window.close();
    });

    // 快捷键支持
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.close();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            if (quickAddView.style.display !== 'none') {
                saveSite();
            }
        }
    });

    // 启动
    init();
})();
