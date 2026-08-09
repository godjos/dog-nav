        requireLogin();

        let allSites = [];
        let isChecking = false;
        let currentFilter = 'all';

        const BATCH_SIZE = 50; // 服务端单次最多 50 个 siteIds
        const STALE_DAYS = 7;
        const FILTER_BTN_IDS = { all: 'statAll', online: 'statOnline', slow: 'statSlow', offline: 'statOffline', pending: 'statPending' };

        // ── 状态存取 ──
        // 初始状态来自站点字段 last_status（null → 未检测）；检测后写入会话内的 _ 前缀字段
        function siteStatus(s) {
            return s._healthStatus || s.last_status || 'pending';
        }
        function siteLatency(s) {
            return s._healthLatency !== undefined ? s._healthLatency : '-';
        }
        function siteLastCheck(s) {
            return s._healthTime || s.last_check_at || '-';
        }
        function siteFailures(s) {
            return s._failures !== undefined ? s._failures : (s.consecutive_failures || 0);
        }

        // sqlite datetime('now') 形如 "YYYY-MM-DD HH:MM:SS"（UTC）；
        // 本会话内 applyResult() 写入的是 ISO 字符串（含 'T'，自带时区），两种都要能解析
        function parseCheckTime(t) {
            if (!t) return null;
            const s = String(t);
            const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
            return isNaN(d.getTime()) ? null : d;
        }
        function isStale(s) {
            const d = parseCheckTime(s.last_check_at);
            if (!d) return true; // 从未检测
            return (Date.now() - d.getTime()) > STALE_DAYS * 24 * 3600 * 1000;
        }

        // ── Toast ──
        let toastTimer = null;
        function toast(text) {
            let el = document.getElementById('healthToast');
            if (!el) {
                el = document.createElement('div');
                el.id = 'healthToast';
                el.className = 'health-toast';
                el.setAttribute('role', 'status');
                document.body.appendChild(el);
            }
            el.textContent = text;
            el.classList.add('show');
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
        }

        function setFilter(filter) {
            currentFilter = filter;
            document.querySelectorAll('.stat').forEach(el => el.classList.remove('active'));
            document.getElementById(FILTER_BTN_IDS[filter]).classList.add('active');
            renderSites(allSites);
        }

        async function loadSites() {
            const res = await fetch('/api/sites');
            allSites = await res.json();
            renderSites(allSites);
            updateStats();
        }

        function getFiltered() {
            if (currentFilter === 'all') return allSites;
            return allSites.filter(s => siteStatus(s) === currentFilter);
        }

        function renderSites(sites) {
            const tbody = document.getElementById('sitesBody');
            const empty = document.getElementById('emptyState');

            const filtered = currentFilter === 'all' ? sites : sites.filter(s => siteStatus(s) === currentFilter);

            if (!filtered || filtered.length === 0) {
                tbody.innerHTML = '';
                empty.style.display = 'block';
                empty.textContent = currentFilter === 'all' ? '暂无站点' :
                    currentFilter === 'online' ? '没有在线站点' :
                    currentFilter === 'slow' ? '没有缓慢站点' :
                    currentFilter === 'offline' ? '没有离线站点' :
                    currentFilter === 'pending' ? '没有未检测站点' : '暂无站点';
                return;
            }
            empty.style.display = 'none';

            tbody.innerHTML = filtered.map(s => {
                const sid = Number(s.id) || 0;
                const status = siteStatus(s);
                const latency = siteLatency(s);
                const lastCheck = siteLastCheck(s);
                const failures = siteFailures(s);
                const badgeClass = status === 'online' ? 'badge-online' : status === 'offline' ? 'badge-offline' : status === 'slow' ? 'badge-slow' : status === 'checking' ? 'badge-checking' : 'badge-pending';
                const badgeText = status === 'online' ? '在线' : status === 'offline' ? '离线' : status === 'slow' ? '缓慢' : status === 'checking' ? '<span class="spinner"></span> 检测中' : '待检测';
                return `<tr>
                    <td class="site-name-cell"><span class="name">${escapeHtml(s.name)}</span><span class="url">${escapeHtml(s.url)}</span></td>
                    <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                    <td>${latency !== '-' ? escapeHtml(String(latency)) + 'ms' : '-'}</td>
                    <td>${escapeHtml(String(failures))}</td>
                    <td>${escapeHtml(String(lastCheck))}</td>
                    <td><button class="btn-recheck" data-action="recheck" data-id="${sid}">重新检测</button></td>
                </tr>`;
            }).join('');
        }

        function updateStats() {
            const total = allSites.length;
            const online = allSites.filter(s => siteStatus(s) === 'online').length;
            const slow = allSites.filter(s => siteStatus(s) === 'slow').length;
            const offline = allSites.filter(s => siteStatus(s) === 'offline').length;
            const pending = allSites.filter(s => siteStatus(s) === 'pending').length;
            document.getElementById('statAll').textContent = `全部: ${total}`;
            document.getElementById('statOnline').textContent = `在线: ${online}`;
            document.getElementById('statSlow').textContent = `缓慢: ${slow}`;
            document.getElementById('statOffline').textContent = `离线: ${offline}`;
            document.getElementById('statPending').textContent = `未检测: ${pending}`;
        }

        function applyResult(site, r) {
            site._healthStatus = r.status;
            site._healthLatency = r.latency;
            site._healthTime = r.time;
            site._failures = r.consecutive_failures || 0;
            // 同步 last_check_at，保证“长期未检查”判断反映本次会话的检测
            site.last_check_at = new Date().toISOString();
        }

        // 批量检测一组站点：按 50 分批（服务端上限），返回 { ok, fail } 统计
        async function runCheck(sites, onProgress) {
            let ok = 0, fail = 0;
            for (let i = 0; i < sites.length; i += BATCH_SIZE) {
                const batch = sites.slice(i, i + BATCH_SIZE);
                batch.forEach(s => { s._healthStatus = 'checking'; });
                renderSites(allSites);

                try {
                    const res = await fetch('/api/health-check', {
                        method: 'POST',
                        headers: authHeaders(),
                        body: JSON.stringify({ siteIds: batch.map(s => s.id) })
                    });
                    const data = await res.json();
                    if (res.ok && Array.isArray(data.results)) {
                        const byId = {};
                        data.results.forEach(r => { byId[r.id] = r; });
                        batch.forEach(s => {
                            const r = byId[s.id];
                            if (r) {
                                applyResult(s, r);
                                if (r.status === 'offline') fail++; else ok++;
                            } else {
                                s._healthStatus = s.last_status || 'pending';
                            }
                        });
                    } else {
                        batch.forEach(s => { s._healthStatus = s.last_status || 'pending'; });
                        fail += batch.length;
                    }
                } catch (err) {
                    batch.forEach(s => { s._healthStatus = s.last_status || 'pending'; });
                    fail += batch.length;
                }

                renderSites(allSites);
                updateStats();
                if (onProgress) onProgress(Math.min(i + batch.length, sites.length), sites.length);
            }
            return { ok, fail };
        }

        function setBtnLoading(btn, loading, html) {
            btn.disabled = loading;
            btn.innerHTML = html;
        }

        async function checkSites(sites, btn, idleHtml, doingText) {
            if (isChecking || !sites.length) return;
            isChecking = true;
            const otherBtns = document.querySelectorAll('.btn-check');
            otherBtns.forEach(b => { b.disabled = true; });
            setBtnLoading(btn, true, `<span class="spinner"></span> ${doingText}`);

            const progressBar = document.getElementById('progressBar');
            const progressFill = document.getElementById('progressFill');
            progressBar.style.display = 'block';

            const { ok, fail } = await runCheck(sites, (done, total) => {
                progressFill.style.width = (done / total * 100) + '%';
            });

            progressBar.style.display = 'none';
            progressFill.style.width = '0%';
            setBtnLoading(btn, false, idleHtml);
            otherBtns.forEach(b => { b.disabled = false; });
            isChecking = false;
            toast(`检测完成：成功 ${ok} 个，失败 ${fail} 个`);
        }

        // 检测当前筛选集合
        function checkAll() {
            checkSites(getFiltered(), document.getElementById('btnCheckAll'), '<span>💓</span> 检测全部站点', '检测中...');
        }

        // 检测长期未检查（last_check_at 为 null 或早于 7 天前）
        function checkStale() {
            const stale = allSites.filter(isStale);
            if (!stale.length) { toast('没有长期未检查的站点'); return; }
            checkSites(stale, document.getElementById('btnCheckStale'), '<span>🕒</span> 检测长期未检查', `检测中（${stale.length} 个）...`);
        }

        async function checkOne(id) {
            const site = allSites.find(s => s.id === id);
            if (!site || isChecking) return;
            site._healthStatus = 'checking';
            renderSites(allSites);

            try {
                const res = await fetch('/api/health-check', {
                    method: 'POST',
                    headers: authHeaders(),
                    body: JSON.stringify({ siteIds: [site.id] })
                });
                const data = await res.json();
                if (res.ok && data.results && data.results[0]) {
                    applyResult(site, data.results[0]);
                } else {
                    site._healthStatus = site.last_status || 'pending';
                }
            } catch (err) {
                site._healthStatus = site.last_status || 'pending';
            }
            renderSites(allSites);
            updateStats();
        }

        // 筛选统计、检测按钮与行内重新检测按钮的事件绑定（CSP 下用 JS 绑定，不用内联事件属性）
        document.getElementById('statAll').addEventListener('click', () => setFilter('all'));
        document.getElementById('statOnline').addEventListener('click', () => setFilter('online'));
        document.getElementById('statSlow').addEventListener('click', () => setFilter('slow'));
        document.getElementById('statOffline').addEventListener('click', () => setFilter('offline'));
        document.getElementById('statPending').addEventListener('click', () => setFilter('pending'));
        document.getElementById('btnCheckAll').addEventListener('click', checkAll);
        document.getElementById('btnCheckStale').addEventListener('click', checkStale);
        document.getElementById('sitesBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="recheck"]');
            if (!btn) return;
            checkOne(Number(btn.dataset.id));
        });

        loadSites();

        // ── 热榜来源状态 ──
        // GET /api/admin/hot-status 为只读接口（后端保证不触发上游抓取），前端只管渲染；
        // 只有点「重新检测」才会 POST 单个来源的 refresh。
        const HOT_STATUS_META = {
            fresh: { text: '新鲜', cls: 'badge-fresh' },
            stale: { text: '陈旧', cls: 'badge-stale' },
            unavailable: { text: '不可用', cls: 'badge-unavailable' },
            never: { text: '从未成功', cls: 'badge-never' }
        };

        function hotTimeText(iso) {
            if (!iso) return '-';
            const d = new Date(iso);
            return isNaN(d.getTime()) ? '-' : d.toLocaleString();
        }

        function hotRowHtml(h) {
            const meta = HOT_STATUS_META[h.status] || HOT_STATUS_META.never;
            const failures = Number(h.consecutiveFailures) || 0;
            const err = h.lastErrorCode ? `（${escapeHtml(String(h.lastErrorCode))}）` : '';
            return `<tr data-source="${escapeHtml(String(h.source))}">
                <td class="site-name-cell"><span class="name">${escapeHtml(String(h.name))}</span></td>
                <td><span class="badge ${meta.cls}">${meta.text}</span></td>
                <td>${hotTimeText(h.updated)}</td>
                <td>${hotTimeText(h.lastAttempt)}</td>
                <td>${failures}${err}</td>
                <td><button class="btn-recheck" data-action="hot-refresh" data-source="${escapeHtml(String(h.source))}">重新检测</button></td>
            </tr>`;
        }

        function renderHotStatus(list) {
            const tbody = document.getElementById('hotStatusBody');
            const empty = document.getElementById('hotStatusEmpty');
            if (!Array.isArray(list) || list.length === 0) {
                tbody.innerHTML = '';
                empty.style.display = 'block';
                return;
            }
            empty.style.display = 'none';
            tbody.innerHTML = list.map(hotRowHtml).join('');
        }

        // 用单个来源的最新状态对象只更新对应行
        function updateHotRow(h) {
            if (!h || !h.source) return;
            const row = document.querySelector(`tr[data-source="${h.source}"]`);
            if (row) row.outerHTML = hotRowHtml(h);
        }

        async function loadHotStatus() {
            try {
                const res = await fetch('/api/admin/hot-status', { headers: authHeaders() });
                if (!res.ok) { toast('热榜来源状态加载失败'); return; }
                renderHotStatus(await res.json());
            } catch (err) {
                toast('热榜来源状态加载失败');
            }
        }

        async function refreshHotSource(source, btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> 检测中';
            try {
                const res = await fetch(`/api/admin/hot-status/${encodeURIComponent(source)}/refresh`, {
                    method: 'POST',
                    headers: authHeaders()
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    updateHotRow(data);
                    toast(`${data.name || source} 检测完成`);
                } else {
                    toast(`热榜来源检测失败${data.lastErrorCode ? `（${data.lastErrorCode}）` : ''}`);
                    // 失败时重新拉取状态刷新该行（GET 为只读，不会触发其它来源抓取）
                    const st = await fetch('/api/admin/hot-status', { headers: authHeaders() });
                    if (st.ok) {
                        const list = await st.json();
                        const item = Array.isArray(list) ? list.find(h => h.source === source) : null;
                        if (item) updateHotRow(item);
                    }
                }
            } catch (err) {
                toast('热榜来源检测失败：网络错误');
            } finally {
                // 行未被替换（按钮仍在 DOM 中）时恢复按钮
                if (btn.isConnected) {
                    btn.disabled = false;
                    btn.textContent = '重新检测';
                }
            }
        }

        document.getElementById('hotStatusBody').addEventListener('click', (e) => {
            const btn = e.target.closest('button[data-action="hot-refresh"]');
            if (!btn || btn.disabled) return;
            refreshHotSource(btn.dataset.source, btn);
        });

        loadHotStatus();
