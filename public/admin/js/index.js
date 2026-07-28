        const loginForm = document.getElementById('loginForm');
        const changeForm = document.getElementById('changeForm');
        const errorMsg = document.getElementById('errorMsg');
        const subtitle = document.querySelector('.subtitle');

        function showError(msg) {
            errorMsg.textContent = msg;
            errorMsg.classList.add('show');
        }

        function showChangeForm() {
            loginForm.style.display = 'none';
            changeForm.style.display = 'block';
            subtitle.textContent = '首次登录，请先修改密码';
            errorMsg.classList.remove('show');
        }

        function showLoginForm() {
            sessionStorage.removeItem('admin_must_change');
            sessionStorage.removeItem('admin_logged_in');
            sessionStorage.removeItem('admin_token');
            changeForm.style.display = 'none';
            loginForm.style.display = 'block';
            subtitle.textContent = '管理后台登录';
            errorMsg.classList.remove('show');
        }

        // 其他页面检测到“必须修改密码”后跳转回来，直接展示改密表单
        if (sessionStorage.getItem('admin_must_change') === '1' && sessionStorage.getItem('admin_token')) {
            showChangeForm();
        }

        document.getElementById('backToLogin').addEventListener('click', (e) => {
            e.preventDefault();
            showLoginForm();
        });

        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (data.success) {
                    sessionStorage.setItem('admin_logged_in', 'true');
                    sessionStorage.setItem('admin_token', data.token);
                    if (data.user && data.user.role) sessionStorage.setItem('dognav-role', data.user.role);
                    if (data.user && data.user.username) sessionStorage.setItem('dognav-username', data.user.username);
                    if (data.mustChangePassword) {
                        sessionStorage.setItem('admin_must_change', '1');
                        showChangeForm();
                    } else {
                        sessionStorage.removeItem('admin_must_change');
                        window.location.href = '/admin/dashboard';
                    }
                } else {
                    showError(data.error || '登录失败');
                }
            } catch (err) {
                showError('网络错误，请重试');
            }
        });

        changeForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const oldPassword = document.getElementById('oldPassword').value;
            const newPassword = document.getElementById('newPassword').value;
            const confirmPassword = document.getElementById('confirmPassword').value;

            if (newPassword.length < 8) {
                showError('新密码至少 8 位');
                return;
            }
            if (newPassword !== confirmPassword) {
                showError('两次输入的新密码不一致');
                return;
            }

            try {
                const res = await fetch('/api/auth/password', {
                    method: 'PUT',
                    headers: {
                        'Authorization': 'Bearer ' + sessionStorage.getItem('admin_token'),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ oldPassword, newPassword })
                });
                const data = await res.json();

                if (res.ok) {
                    sessionStorage.removeItem('admin_must_change');
                    window.location.href = '/admin/dashboard';
                } else {
                    showError(data.error || '修改失败');
                }
            } catch (err) {
                showError('网络错误，请重试');
            }
        });
