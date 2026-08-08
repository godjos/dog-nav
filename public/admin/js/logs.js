        requireLogin();

        async function loadLogs() {
            const res = await fetch('/api/logs', { headers: authHeaders() });
            if (!res.ok) return; // 403（editor 角色）时整页提示已由 auth.js 处理
            const logs = await res.json();
            document.getElementById('logsBody').innerHTML = logs.map(l => `
                <tr>
                    <td>${escapeHtml(parseUtcTime(l.created_at)?.toLocaleString('zh-CN') || '-')}</td>
                    <td>${escapeHtml(l.username || '系统')}</td>
                    <td><span class="action-tag">${escapeHtml(l.action)}</span></td>
                    <td style="color:#666">${escapeHtml(l.detail || '-')}</td>
                </tr>
            `).join('');
        }

        loadLogs();
