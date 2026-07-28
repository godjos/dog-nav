// ═══════════════════════════════════════════
// 管理后台共享认证脚本
// 每个 /admin/ 页面在自己的 <script> 之前引入本文件（并先引入
// /js/utils.js），然后调用 requireLogin() 即可。提供：
//   requireLogin()  — 校验登录态：无 token 或 token 失效则跳回登录页；
//                     有效则缓存 role（dognav-role）与用户名（dognav-username），
//                     并按角色刷新菜单/页面可见性
//   getRole()       — 当前登录用户角色（sessionStorage 缓存）
//   authHeaders()   — 带 Bearer token 的请求头
//   logout()        — 注销（同时使服务端 session 失效）
//   showToast(msg, type)     — 全局轻提示（success/error），各页可直接使用
//   setBtnLoading(btn, on, loadingText) — 按钮请求期间禁用 + loading 文案
// 角色控制：
//   标记 data-role="admin" 的元素（侧边栏菜单、批量清空按钮等）在
//   非 admin 角色下自动隐藏；<body data-require-role="admin"> 的页面
//   在非 admin 角色下整页替换为「无权限访问」提示。
// 并包装 window.fetch，统一处理 API 错误：
//   401 → 跳回登录页；403 → toast「没有执行此操作的权限」
//   （password_change_required 时打标记跳回登录页强制改密）；
//   409 → toast 透出服务端 error 文案；429 → toast 频率提示。
// ═══════════════════════════════════════════
(function () {
    // ── 全局轻提示（不依赖页面 CSS，所有后台页可用）──
    let toastTimer = null;
    function showToast(msg, type = 'success') {
        let toast = document.getElementById('globalToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'globalToast';
            toast.style.cssText = 'position:fixed;top:20px;right:20px;padding:12px 20px;background:#333;color:#fff;border-radius:8px;font-size:14px;z-index:9999;opacity:0;transition:opacity .3s;max-width:360px;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.background = type === 'error' ? '#ef4444' : '#22c55e';
        toast.style.opacity = '1';
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
    }

    // ── 按钮 loading 状态：请求期间禁用并替换文案，结束后恢复 ──
    function setBtnLoading(btn, loading, loadingText) {
        if (!btn) return;
        if (loading) {
            if (btn.dataset.origText === undefined) btn.dataset.origText = btn.textContent;
            btn.disabled = true;
            if (loadingText) btn.textContent = loadingText;
        } else {
            btn.disabled = false;
            if (btn.dataset.origText !== undefined) {
                btn.textContent = btn.dataset.origText;
                delete btn.dataset.origText;
            }
        }
    }

    // ── 角色驱动的界面可见性 ──
    function applyRoleUI(role) {
        if (!role) return; // 角色未知时不做任何隐藏，避免误伤 admin
        if (role !== 'admin') {
            document.querySelectorAll('[data-role="admin"]').forEach(el => {
                el.style.display = 'none';
            });
        }
        // 整页权限：<body data-require-role="admin">
        const needRole = document.body && document.body.dataset.requireRole;
        if (needRole && role !== needRole) {
            const main = document.querySelector('.main');
            if (main) {
                main.textContent = '';
                const box = document.createElement('div');
                box.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;color:#999;';
                const icon = document.createElement('div');
                icon.style.cssText = 'font-size:48px;margin-bottom:16px;';
                icon.textContent = '🔒';
                const text = document.createElement('div');
                text.style.fontSize = '16px';
                text.textContent = '无权限访问：此页面仅管理员可用';
                box.appendChild(icon);
                box.appendChild(text);
                main.appendChild(box);
            }
        }
    }

    async function requireLogin() {
        const token = sessionStorage.getItem('admin_token');
        if (!sessionStorage.getItem('admin_logged_in') || !token) {
            window.location.href = '/admin';
            return null;
        }
        try {
            // 用服务端接口确认 token 仍然有效，并同步角色信息
            const res = await origFetch('/api/auth/me', {
                headers: { 'Authorization': 'Bearer ' + token }
            });
            if (res.status === 401) {
                clearSession();
                window.location.href = '/admin';
                return null;
            }
            if (!res.ok) return null; // 接口暂不可用等情况：保持现有会话
            const user = await res.json();
            if (user && user.role) {
                sessionStorage.setItem('dognav-role', user.role);
                applyRoleUI(user.role);
            }
            if (user && user.username) sessionStorage.setItem('dognav-username', user.username);
            return user;
        } catch (err) {
            return null; // 网络异常：保持现有会话
        }
    }

    function getRole() {
        return sessionStorage.getItem('dognav-role');
    }

    function authHeaders() {
        return {
            'Authorization': 'Bearer ' + sessionStorage.getItem('admin_token'),
            'Content-Type': 'application/json'
        };
    }

    function clearSession() {
        sessionStorage.removeItem('admin_logged_in');
        sessionStorage.removeItem('admin_token');
        sessionStorage.removeItem('admin_must_change');
        sessionStorage.removeItem('dognav-role');
        sessionStorage.removeItem('dognav-username');
    }

    function logout() {
        // 先通知服务端删除 session（尽力而为），再清理本地并跳转
        origFetch('/api/auth/logout', { method: 'POST', headers: authHeaders() })
            .catch(() => {})
            .finally(() => {
                clearSession();
                window.location.href = '/admin';
            });
    }

    const origFetch = window.fetch.bind(window);
    window.fetch = async function (url, opts) {
        const res = await origFetch(url, opts);
        const path = typeof url === 'string' ? url : (url && url.url) || '';
        if (path.includes('/api/') && !path.includes('/api/auth/')) {
            if (res.status === 401) {
                clearSession();
                window.location.href = '/admin';
            } else if (res.status === 403) {
                res.clone().json().then(data => {
                    if (data && data.error === 'password_change_required') {
                        sessionStorage.setItem('admin_must_change', '1');
                        window.location.href = '/admin';
                    } else {
                        showToast((data && data.error) || '没有执行此操作的权限', 'error');
                    }
                }).catch(() => {
                    showToast('没有执行此操作的权限', 'error');
                });
            } else if (res.status === 409) {
                res.clone().json().then(data => {
                    showToast((data && data.error) || '数据冲突，操作未完成', 'error');
                }).catch(() => {
                    showToast('数据冲突，操作未完成', 'error');
                });
            } else if (res.status === 429) {
                showToast('操作过于频繁，请稍后再试', 'error');
            }
        }
        return res;
    };

    window.requireLogin = requireLogin;
    window.getRole = getRole;
    window.authHeaders = authHeaders;
    window.logout = logout;
    window.showToast = showToast;
    window.setBtnLoading = setBtnLoading;

    // 先用缓存的角色刷新一次界面（登录时已写入 dognav-role），减少闪烁；
    // requireLogin 拿到最新角色后会再次刷新
    applyRoleUI(getRole());

    // 侧边栏“退出登录”链接的事件绑定（脚本在 body 末尾加载，DOM 已就绪）
    const logoutLink = document.querySelector('.sidebar-footer a');
    if (logoutLink) logoutLink.addEventListener('click', logout);
})();
