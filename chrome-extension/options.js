// ═══════════════════════════════════════════
// Dog-Nav Chrome Extension - Options Controller
// ═══════════════════════════════════════════

(function () {
    const serverUrlInput = document.getElementById('serverUrl');
    const authTokenInput = document.getElementById('authToken');
    const btnSave = document.getElementById('btnSave');
    const btnTest = document.getElementById('btnTest');
    const btnClear = document.getElementById('btnClear');
    const statusAlert = document.getElementById('statusAlert');

    function showAlert(msg, type = 'success') {
        statusAlert.className = `alert show ${type}`;
        statusAlert.textContent = msg;
        setTimeout(() => {
            statusAlert.classList.remove('show');
        }, 3500);
    }

    function cleanServerUrl(raw) {
        if (!raw) return '';
        let url = String(raw).trim();
        url = url.replace(/#.*$/, '');
        url = url.replace(/\/admin(\/.*)?$/i, '');
        url = url.replace(/\/(index|quick-add)\.html$/i, '');
        return url.replace(/\/+$/, '');
    }

    async function loadSettings() {
        if (!chrome.storage || !chrome.storage.local) return;
        const stored = await chrome.storage.local.get(['dognav_server_url', 'dognav_token']);
        serverUrlInput.value = cleanServerUrl(stored.dognav_server_url) || 'http://localhost:3000';
        authTokenInput.value = stored.dognav_token || '';
    }

    async function saveSettings() {
        let url = cleanServerUrl(serverUrlInput.value);
        const token = authTokenInput.value.trim();

        if (!url || !/^https?:\/\//i.test(url)) {
            showAlert('请输入合法的网址（以 http:// 或 https:// 开头，不带 /admin）', 'error');
            return;
        }
        serverUrlInput.value = url;

        if (chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({
                dognav_server_url: url,
                dognav_token: token
            });
            showAlert('设置已成功保存！');
        }
    }

    async function testConnection() {
        let url = cleanServerUrl(serverUrlInput.value);
        const token = authTokenInput.value.trim();

        if (!url) {
            showAlert('请先输入导航站主页地址（不带 /admin）', 'error');
            return;
        }
        serverUrlInput.value = url;

        try {
            const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
            const res = await fetch(`${url}/api/settings`, { headers });
            if (res.ok) {
                showAlert('✅ 连接成功！服务器响应正常。', 'success');
            } else {
                showAlert(`⚠️ 服务器响应异常：HTTP ${res.status}（请确认输入的是主页根地址）`, 'error');
            }
        } catch (e) {
            showAlert(`❌ 无法连接到服务器 (${e.message || '网络连接失败'})，请检查地址是否正确或服务是否启动`, 'error');
        }
    }

    async function clearCredentials() {
        if (!confirm('确定清除已保存的服务器与登录凭据吗？')) return;
        if (chrome.storage && chrome.storage.local) {
            await chrome.storage.local.clear();
            serverUrlInput.value = 'http://localhost:3000';
            authTokenInput.value = '';
            showAlert('已清除所有凭据。');
        }
    }

    btnSave.addEventListener('click', saveSettings);
    btnTest.addEventListener('click', testConnection);
    btnClear.addEventListener('click', clearCredentials);

    loadSettings();
})();
