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

    async function loadSettings() {
        if (!chrome.storage || !chrome.storage.local) return;
        const stored = await chrome.storage.local.get(['dognav_server_url', 'dognav_token']);
        serverUrlInput.value = stored.dognav_server_url || 'http://localhost:3000';
        authTokenInput.value = stored.dognav_token || '';
    }

    async function saveSettings() {
        let url = serverUrlInput.value.trim().replace(/\/+$/, '');
        const token = authTokenInput.value.trim();

        if (!url || !/^https?:\/\//i.test(url)) {
            showAlert('请输入合法的网址（以 http:// 或 https:// 开头）', 'error');
            return;
        }

        if (chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({
                dognav_server_url: url,
                dognav_token: token
            });
            showAlert('设置已成功保存！');
        }
    }

    async function testConnection() {
        let url = serverUrlInput.value.trim().replace(/\/+$/, '');
        const token = authTokenInput.value.trim();

        if (!url) {
            showAlert('请先输入导航站地址', 'error');
            return;
        }

        try {
            const headers = token ? { 'Authorization': 'Bearer ' + token } : {};
            const res = await fetch(`${url}/api/settings`, { headers });
            if (res.ok) {
                showAlert('✅ 连接成功！服务器响应正常。', 'success');
            } else {
                showAlert(`⚠️ 服务器响应异常：HTTP ${res.status}`, 'error');
            }
        } catch (e) {
            showAlert('❌ 无法连接到服务器，请检查地址是否正确或服务是否启动', 'error');
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
