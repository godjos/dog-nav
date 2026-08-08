        requireLogin();

        const REASON_TEXT = {
            link_dead: '链接失效',
            wrong_info: '信息有误',
            spam: '垃圾信息',
            inappropriate: '内容不当',
            other: '其他'
        };

        async function loadPendingCount() {
            try {
                const res = await fetch('/api/stats/overview', { headers: authHeaders() });
                if (!res.ok) return;
                const data = await res.json();
                const n = Number(data.pending_reports) || 0;
                if (n > 0) {
                    const el = document.getElementById('pendingCount');
                    el.textContent = `待处理 ${n}`;
                    el.style.display = 'inline-block';
                }
            } catch (err) { /* 角标加载失败静默降级 */ }
        }

        async function loadReports() {
            const res = await fetch('/api/reports', { headers: authHeaders() });
            const reports = await res.json();
            const tbody = document.getElementById('reportsBody');
            const empty = document.getElementById('emptyState');

            if (reports.length === 0) { tbody.innerHTML = ''; empty.style.display = 'block'; return; }
            empty.style.display = 'none';

            tbody.innerHTML = reports.map(r => {
                const rid = Number(r.id) || 0;
                const status = r.status === 'resolved' ? 'resolved' : 'pending';
                const reasonText = Object.prototype.hasOwnProperty.call(REASON_TEXT, r.reason) ? REASON_TEXT[r.reason] : (r.reason || '-');
                return `
                <tr>
                    <td><strong>${escapeHtml(r.site_name || '已删除')}</strong><br><small style="color:#888">${escapeHtml(r.site_url || '')}</small></td>
                    <td>${escapeHtml(reasonText)}</td>
                    <td class="detail-cell">${escapeHtml(r.detail || '-')}</td>
                    <td>${escapeHtml(r.reporter_email || '匿名')}</td>
                    <td><span class="badge badge-${status}">${status === 'pending' ? '待处理' : '已解决'}</span></td>
                    <td>${escapeHtml(parseUtcTime(r.created_at)?.toLocaleString('zh-CN') || '-')}</td>
                    <td>${r.status === 'pending' ? `<button class="btn-resolve" data-action="resolve" data-id="${rid}">标记解决</button>` : '-'}</td>
                </tr>`;
            }).join('');
        }

        async function resolve(id) {
            await fetch(`/api/reports/${id}`, {
                method: 'PUT',
                headers: authHeaders(),
                body: JSON.stringify({ status: 'resolved', remove_site: confirm('同时禁用该站点？') })
            });
            loadReports();
            loadPendingCount();
        }

        // 行内“标记解决”按钮：事件委托（原 onclick，CSP 下改为 JS 绑定）
        document.getElementById('reportsBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="resolve"]');
            if (!btn) return;
            resolve(Number(btn.dataset.id));
        });

        loadReports();
        loadPendingCount();
