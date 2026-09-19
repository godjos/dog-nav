        function showToast(msg, type = 'success') {
            const toast = document.getElementById('toast');
            toast.textContent = msg;
            toast.className = 'toast ' + type + ' show';
            setTimeout(() => toast.classList.remove('show'), 3000);
        }

        // 公开可写设置键对应的表单控件
        const TEXT_FIELDS = ['site_name', 'site_description', 'site_icon', 'site_url',
            'footer_text', 'footer_blog_url', 'footer_github_url'];
        const COLOR_FIELDS = ['theme_primary_color', 'theme_secondary_color'];
        const BOOL_FIELDS = ['submission_enabled'];

        let isAdmin = false;
        let loadedSettings = null;

        function readSettingsForm() {
            const values = {};
            TEXT_FIELDS.concat(COLOR_FIELDS).forEach(key => values[key] = document.getElementById(key).value);
            BOOL_FIELDS.forEach(key => values[key] = document.getElementById(key).checked ? 'true' : 'false');
            values.home_config = DogNavHomeSettings.read();
            return values;
        }

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
            DogNavHomeSettings.setDisabled(disabled);
        }

        async function loadSettings() {
            setFormDisabled(true);
            document.getElementById('retrySettingsBtn').hidden = true;
            try {
                const res = await fetch('/api/admin/settings', { headers: authHeaders() });
                if (res.status === 403) {
                    document.getElementById('permNotice').hidden = false;
                    setFormDisabled(true);
                    showToast('无权限查看系统设置', 'error');
                    return;
                }
                if (!res.ok) throw new Error('加载设置失败');
                const settings = await res.json();
                TEXT_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    if (el && typeof settings[key] === 'string') el.value = settings[key];
                });
                COLOR_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    if (el) el.value = typeof settings[key] === 'string' ? settings[key] : '';
                });
                BOOL_FIELDS.forEach(key => {
                    const el = document.getElementById(key);
                    if (el) el.checked = settings[key] === 'true';
                });
                await DogNavHomeSettings.load(settings.home_config);
                loadedSettings = readSettingsForm();
                setFormDisabled(!isAdmin);
            } catch (err) {
                showToast('加载设置失败', 'error');
                document.getElementById('retrySettingsBtn').hidden = false;
            }
        }

        async function saveSettings() {
            if (!isAdmin || !loadedSettings) {
                showToast('无权限修改系统设置', 'error');
                return;
            }
            const formValues = readSettingsForm();
            const settings = Object.fromEntries(Object.entries(formValues).filter(([key, value]) => value !== loadedSettings[key]));
            if (!Object.keys(settings).length) { showToast('没有需要保存的修改'); return; }
            const validation = DogNavSettingsSchema.validateSettingsUpdate(settings);
            if (validation.error) {
                showToast(validation.error, 'error');
                document.getElementById(validation.field)?.focus();
                return;
            }
            setFormDisabled(true);

            try {
                const res = await fetch('/api/admin/settings', {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify(settings)
                });
                const data = await res.json();
                if (res.ok && data.message) {
                    loadedSettings = formValues;
                    showToast('设置已保存，前台刷新后生效');
                } else {
                    setFormDisabled(!isAdmin);
                    showToast(data.error || '保存失败', 'error');
                    if (data.field) document.getElementById(data.field)?.focus();
                }
            } catch (err) {
                showToast('保存失败', 'error');
            } finally {
                setFormDisabled(!isAdmin);
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
            document.getElementById('retrySettingsBtn').addEventListener('click', loadSettings);
            document.getElementById('previewHomeBtn').addEventListener('click', () => DogNavHomeSettings.preview(readSettingsForm()));

            loadSettings();
        })();
