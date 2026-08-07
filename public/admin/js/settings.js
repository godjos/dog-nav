        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // 10 个公开可写设置键对应的表单控件
        const TEXT_FIELDS = ['site_name', 'site_description', 'site_icon',
            'footer_text', 'footer_blog_url', 'footer_github_url'];
        const COLOR_FIELDS = ['theme_primary_color', 'theme_secondary_color'];
        const BOOL_FIELDS = ['submission_enabled', 'weather_enabled'];

        let isAdmin = false;

        function setFormDisabled(disabled) {
            TEXT_FIELDS.concat(COLOR_FIELDS).forEach(key => {
                const el = document.getElementById(key);
                if (el) el.disabled = disabled;
            });
            BOOL_FIELDS.forEach(key => {
                const el = document.getElementById(key);
                if (el) el.disabled = disabled;
            });
            document.getElementById('saveSettingsBtn').disabled = disabled;
        }

        async function loadSettings() {
            try {
                const res = await fetch('/api/admin/settings', { headers: authHeaders() });
                if (res.status === 403) {
                    document.getElementById('permNotice').hidden = false;
                    setFormDisabled(true);
                    showToast('无权限查看系统设置', 'error');
                    return;
                }
                if (!res.ok) { showToast('加载设置失败', 'error'); return; }
                const settings = await res.json();
                TEXT_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    if (el && typeof settings[key] === 'string') el.value = settings[key];
                });
                COLOR_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    // color input 只接受 #rrggbb，其他格式保留默认显示
                    if (el && /^#[0-9a-fA-F]{6}$/.test(settings[key] || '')) el.value = settings[key];
                });
                BOOL_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    if (el) el.checked = settings[key] === 'true';
                });
            } catch (err) {
                showToast('加载设置失败', 'error');
            }
        }

        async function saveSettings() {
            if (!isAdmin) {
                showToast('无权限修改系统设置', 'error');
                return;
            }
            const settings = {};
            TEXT_FIELDS.forEach(key => {
                settings[key] = document.getElementById(key).value;
            });
            COLOR_FIELDS.forEach(key => {
                settings[key] = document.getElementById(key).value;
            });
            BOOL_FIELDS.forEach(key => {
                settings[key] = document.getElementById(key).checked ? 'true' : 'false';
            });

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify(settings)
                });
                const data = await res.json();
                if (res.ok && data.message) {
                    showToast('设置已保存，前台刷新后生效');
                } else {
                    showToast(data.error || '保存失败', 'error');
                }
            } catch (err) {
                showToast('保存失败', 'error');
            }
        }

        async function changePassword() {
            const oldPwd = document.getElementById('old_password').value;
            const newPwd = document.getElementById('new_password').value;
            const confirmPwd = document.getElementById('confirm_password').value;

            if (!oldPwd || !newPwd) {
                showToast('请填写密码', 'error');
                return;
            }
            if (newPwd !== confirmPwd) {
                showToast('两次密码不一致', 'error');
                return;
            }
            if (newPwd.length < 8) {
                showToast('密码至少8位', 'error');
                return;
            }

            try {
                const res = await fetch('/api/auth/password', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ oldPassword: oldPwd, newPassword: newPwd })
                });
                const data = await res.json();
                if (data.message) {
                    showToast('密码已修改');
                    document.getElementById('old_password').value = '';
                    document.getElementById('new_password').value = '';
                    document.getElementById('confirm_password').value = '';
                } else {
                    showToast(data.error || '修改失败', 'error');
                }
            } catch (err) {
                showToast('修改失败', 'error');
            }
        }

        (async function init() {
            const me = await requireLogin();
            const role = (me && me.role) || getRole();
            isAdmin = role === 'admin';
            if (role && !isAdmin) {
                document.getElementById('permNotice').hidden = false;
                setFormDisabled(true);
            }

            // 按钮事件绑定（原 onclick，CSP 下改为 JS 绑定）
            document.getElementById('changePwdBtn').addEventListener('click', changePassword);
            document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);

            loadSettings();
        })();
