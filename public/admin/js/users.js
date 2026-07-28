        requireLogin();

        // 403/409/429 已由 auth.js 的 fetch 包装统一 toast，这里只补其他错误
        async function toastApiError(res, fallback) {
            if (res.status === 403 || res.status === 409 || res.status === 429) return;
            const data = await res.json().catch(() => ({}));
            showToast(data.error || fallback, 'error');
        }

        async function loadUsers() {
            const res = await fetch('/api/users', { headers: authHeaders() });
            if (!res.ok) return; // 403 时整页提示已由 auth.js 处理
            const users = await res.json();
            document.getElementById('userList').innerHTML = users.map(u => {
                const uid = Number(u.id) || 0;
                const roleCls = String(u.role || '').replace(/[^a-z0-9-]/gi, '');
                const isAdmin = u.role === 'admin';
                return `
                <div class="card">
                    <div>
                        <strong>${escapeHtml(u.username)}</strong>
                        <span class="badge badge-${roleCls}">${escapeHtml(u.role)}</span>
                        <span class="badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? '启用' : '禁用'}</span>
                        <div style="color:#888; font-size:13px; margin-top:4px">${escapeHtml(new Date(u.created_at).toLocaleDateString('zh-CN'))}</div>
                    </div>
                    <div class="card-actions">
                        <button class="btn-toggle" data-action="toggle" data-id="${uid}" data-active="${u.is_active ? 1 : 0}">${u.is_active ? '禁用' : '启用'}</button>
                        <button class="btn-role" data-action="role" data-id="${uid}" data-role="${escapeHtml(u.role)}">${isAdmin ? '设为编辑' : '设为管理员'}</button>
                        <button class="btn-reset" data-action="reset" data-id="${uid}" data-name="${escapeHtml(u.username)}">重置密码</button>
                        <button class="btn-delete" data-action="delete" data-id="${uid}">删除</button>
                    </div>
                </div>`;
            }).join('');
        }

        // 启用/禁用切换；停用最后一名管理员会被服务端 403 拦截并透出文案
        async function toggleUser(btn, id, currentlyActive) {
            const action = currentlyActive ? '禁用' : '启用';
            if (!confirm(`确定${action}该用户？`)) return;
            setBtnLoading(btn, true, '处理中...');
            try {
                const res = await fetch(`/api/users/${id}`, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ is_active: currentlyActive ? 0 : 1 })
                });
                if (res.ok) {
                    showToast(`已${action}`);
                    loadUsers();
                } else {
                    await toastApiError(res, `${action}失败`);
                }
            } catch (err) {
                showToast(`${action}失败`, 'error');
            }
            setBtnLoading(btn, false);
        }

        // 角色切换（admin <-> editor），二次确认；降级最后一名管理员会被服务端 403 拦截
        async function changeRole(btn, id, currentRole) {
            const newRole = currentRole === 'admin' ? 'editor' : 'admin';
            const label = newRole === 'admin' ? '管理员' : '编辑';
            if (!confirm(`确定将该用户角色修改为「${label}」？`)) return;
            setBtnLoading(btn, true, '处理中...');
            try {
                const res = await fetch(`/api/users/${id}`, {
                    method: 'PUT',
                    headers: authHeaders(),
                    body: JSON.stringify({ role: newRole })
                });
                if (res.ok) {
                    showToast('角色已更新');
                    loadUsers();
                } else {
                    await toastApiError(res, '角色修改失败');
                }
            } catch (err) {
                showToast('角色修改失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        // 重置密码：prompt 输入新密码（≥8 位），成功后该用户所有会话失效、下次登录需改密
        async function resetPassword(btn, id, username) {
            const pwd = prompt(`为用户「${username}」设置新密码（至少 8 位）：`);
            if (pwd === null) return;
            if (pwd.length < 8) {
                showToast('新密码至少 8 位', 'error');
                return;
            }
            setBtnLoading(btn, true, '处理中...');
            try {
                const res = await fetch(`/api/users/${id}/reset-password`, {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ newPassword: pwd })
                });
                if (res.ok) {
                    showToast('密码已重置，该用户下次登录需修改密码');
                } else {
                    await toastApiError(res, '重置密码失败');
                }
            } catch (err) {
                showToast('重置密码失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        async function deleteUser(btn, id) {
            if (!confirm('确定删除该用户？此操作不可恢复。')) return;
            setBtnLoading(btn, true, '删除中...');
            try {
                const res = await fetch(`/api/users/${id}`, { method: 'DELETE', headers: authHeaders() });
                if (res.ok) {
                    showToast('已删除');
                    loadUsers();
                } else {
                    await toastApiError(res, '删除失败');
                }
            } catch (err) {
                showToast('删除失败', 'error');
            }
            setBtnLoading(btn, false);
        }

        function openModal() { document.getElementById('modalOverlay').classList.add('show'); }
        function closeModal() { document.getElementById('modalOverlay').classList.remove('show'); }

        document.getElementById('userForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('.btn-save');
            setBtnLoading(btn, true, '保存中...');
            try {
                const res = await fetch('/api/users', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({
                        username: document.getElementById('userName').value,
                        password: document.getElementById('userPassword').value,
                        role: document.getElementById('userRole').value
                    })
                });
                if (res.ok) {
                    showToast('用户已创建');
                    closeModal();
                    loadUsers();
                } else {
                    await toastApiError(res, '创建失败');
                }
            } catch (err) {
                showToast('创建失败', 'error');
            }
            setBtnLoading(btn, false);
        });

        document.getElementById('modalOverlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeModal(); });

        // 静态按钮与卡片按钮的事件绑定（原 onclick，CSP 下改为 JS 绑定）
        document.getElementById('addUserBtn').addEventListener('click', openModal);
        document.getElementById('userCancelBtn').addEventListener('click', closeModal);
        document.getElementById('userList').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action]');
            if (!btn) return;
            const id = Number(btn.dataset.id);
            if (btn.dataset.action === 'delete') deleteUser(btn, id);
            else if (btn.dataset.action === 'toggle') toggleUser(btn, id, btn.dataset.active === '1');
            else if (btn.dataset.action === 'role') changeRole(btn, id, btn.dataset.role);
            else if (btn.dataset.action === 'reset') resetPassword(btn, id, btn.dataset.name);
        });

        loadUsers();
