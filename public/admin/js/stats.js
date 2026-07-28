        requireLogin();

        async function loadStats() {
            const [overview, popular, categories] = await Promise.all([
                fetch('/api/stats/overview', { headers: authHeaders() }).then(r => r.json()),
                fetch('/api/stats/popular', { headers: authHeaders() }).then(r => r.json()),
                fetch('/api/stats/category-distribution', { headers: authHeaders() }).then(r => r.json())
            ]);

            document.getElementById('statsGrid').innerHTML = `
                <div class="stat-card"><div class="value">${escapeHtml(String(overview.totalSites))}</div><div class="label">总站点数</div></div>
                <div class="stat-card"><div class="value">${escapeHtml(String(overview.activeSites))}</div><div class="label">活跃站点</div></div>
                <div class="stat-card"><div class="value">${escapeHtml(String(overview.totalClicks))}</div><div class="label">总点击数</div></div>
                <div class="stat-card"><div class="value">${escapeHtml(String(overview.pendingSubmissions))}</div><div class="label">待审提交</div></div>
                <div class="stat-card"><div class="value">${escapeHtml(String(overview.pendingReports))}</div><div class="label">待处理举报</div></div>
            `;

            // 侧边栏待办角标（复用本次 overview 数据，不额外请求）
            const navBadge = document.getElementById('navPendingSubs');
            const pendingSubs = Number(overview.pending_submissions) || 0;
            if (navBadge && pendingSubs > 0) {
                navBadge.textContent = String(pendingSubs);
                navBadge.style.display = 'inline-block';
            }

            document.getElementById('popularList').innerHTML = popular.map((s, i) => `
                <li><span class="name">${i + 1}. ${escapeHtml(s.name)}</span><span class="count">${escapeHtml(String(s.click_count))} 次</span></li>
            `).join('');

            const maxCount = Math.max(...categories.map(c => c.count), 1);
            document.getElementById('categoryChart').innerHTML = categories.map(c => `
                <div class="bar-item">
                    <div class="label">${escapeHtml(c.name)}</div>
                    <div class="bar"><div class="bar-fill" style="width:${(c.count / maxCount * 100)}%">${escapeHtml(String(c.count))}</div></div>
                </div>
            `).join('');
        }

        loadStats();
