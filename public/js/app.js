// ═══════════════════════════════════════════
// DogNav 首页脚本（个人工作台 Start Page）
// 站点设置（favicon、标题、主题色、页脚、投稿开关）由
// /js/settings-loader.js 统一加载。
// 两个视图：home = 工作台首页（问候/时钟 → 搜索 → 常用 Dock →
// 轻量状态 → 分类工作流区）；all = 全部应用（分类 + 精选/收藏/最近/
// 热门/最新，由右下角「全部应用」进入）。搜索、收藏、最近访问、
// 点击统计等业务逻辑两端视图共用。
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// THEME — persisted across pages via localStorage
// ═══════════════════════════════════════════
const H = document.documentElement;
const previewMode = new URLSearchParams(location.search).get('preview') === '1' && window.parent !== window;
const savedTheme = previewMode ? null : localStorage.getItem('dognav-theme');
function writePreference(key, value) { if (!previewMode) localStorage.setItem(key, value); }
// 后台「首页设置」预览：接收父页面推送的预览设置并应用到当前页
window.addEventListener('message', (event) => {
    if (!previewMode || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.type !== 'dognav:preview' || typeof data.settings !== 'object') return;
    window.DogNavSettings.apply(data.settings);
    applyHomeConfig(window.DogNavSettings.current);
});
if (savedTheme) H.setAttribute('data-theme', savedTheme);

// ═══════════════════════════════════════════
// DATA — 站点与分类只来自后端 API，无硬编码回退
// ═══════════════════════════════════════════
const S = []; // GET /api/sites（仅 status === 'active'）

let homeConfig = DogNavHomeConfig.parse(null);
let E = Object.fromEntries(homeConfig.engines.map(e => [e.id, { u: e.url, n: e.name }]));

const C = {}; // GET /api/categories → { id: { i, l } }

// 顺序即界面优先级：个人工作台视角下收藏/最近高于热门/最新
const VIEW_META = {
    featured: { i: '⭐', l: '编辑精选' },
    fav: { i: '❤️', l: '我的收藏' },
    recent: { i: '🕘', l: '最近访问' },
    hot: { i: '🔥', l: '热门' },
    new: { i: '🆕', l: '最近新增' },
};

let curE = 'baidu', curC = 'all', curView = 'all', curTag = null;
let pageView = 'home'; // 'home' 工作台首页 | 'all' 全部应用
let sitesLoaded = false; // /api/sites 成功返回后才为 true
let initialCatResolved = false; // 首屏默认分类（推荐 → 第一个有效分类）只解析一次

// ═══════════════════════════════════════════
// LOCAL STORAGE — 收藏与最近访问（无账号）
// ═══════════════════════════════════════════
function loadJSON(key, fallback) {
    if (previewMode) return fallback;
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
}

let favs = loadJSON('dognav-favorites', []);
if (!Array.isArray(favs)) favs = [];
let recent = loadJSON('dognav-recent', []);
if (!Array.isArray(recent)) recent = [];

function saveFavs() { writePreference('dognav-favorites', JSON.stringify(favs)); }
function isFav(id) { return favs.some(f => String(f) === String(id)); }
function toggleFav(id) {
    if (isFav(id)) favs = favs.filter(f => String(f) !== String(id));
    else favs.push(id);
    saveFavs();
}

function addRecent(id) {
    recent = recent.filter(r => String(r.id) !== String(id));
    recent.unshift({ id, t: Date.now() });
    if (recent.length > 20) recent.length = 20;
    writePreference('dognav-recent', JSON.stringify(recent));
}

// ── 我的常用（首页 Dock 高频入口）──
// null 表示首次访问尚未初始化（区别于用户主动清空后的 []，后者保持空不再预填）
const PINNED_MAX = 12;
let pinned = loadJSON('dognav-pinned', null);
if (!Array.isArray(pinned)) pinned = null;
let personalPins = pinned !== null;
let dockEditing = false;

function savePinned() { personalPins = true; writePreference('dognav-pinned', JSON.stringify(pinned)); }
function isPinned(id) { return Array.isArray(pinned) && pinned.some(p => String(p) === String(id)); }
function togglePin(id) {
    if (!Array.isArray(pinned)) pinned = [];
    if (isPinned(id)) {
        pinned = pinned.filter(p => String(p) !== String(id));
    } else {
        if (pinned.length >= PINNED_MAX) { toast(`常用入口最多固定 ${PINNED_MAX} 个站点`); return; }
        pinned.push(id);
    }
    savePinned();
    render(); // home 视图刷新 Dock；all 视图刷新卡片图钉状态
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
let toastTimer = null;
function toast(text) {
    let el = document.getElementById('toast');
    if (!el) {
        el = document.createElement('div');
        el.id = 'toast';
        el.className = 'toast';
        el.setAttribute('role', 'status');
        document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

// ═══════════════════════════════════════════
// RENDER — DOM API 构建，数据不拼 innerHTML
// ═══════════════════════════════════════════
// favicon 加载失败时的回退图标：按站名 hash 取柔和底色 + 首字母
const FALLBACK_COLORS = ['#5b8def', '#45b983', '#e9a13b', '#e06c6c', '#8b7cf6', '#4ecdc4', '#ec8cbb', '#7fb069'];
function iconFallbackUri(name) {
    const str = name || '网';
    let h = 0;
    for (const ch of str) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    const color = encodeURIComponent(FALLBACK_COLORS[h % FALLBACK_COLORS.length]);
    const letter = encodeURIComponent([...str][0]);
    return `data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 36 36%22><rect fill=%22${color}%22 width=%2236%22 height=%2236%22 rx=%228%22/><text x=%2218%22 y=%2224%22 text-anchor=%22middle%22 fill=%22white%22 font-size=%2216%22>${letter}</text></svg>`;
}

const STATUS_META = {
    online: { cls: 'st-online', label: '在线' },
    slow: { cls: 'st-slow', label: '缓慢' },
    offline: { cls: 'st-offline', label: '离线' },
};

function buildStatusDot(s) {
    const meta = STATUS_META[s.last_status] || { cls: 'st-none', label: '未检测' };
    const dot = document.createElement('span');
    dot.className = `st-dot ${meta.cls}`;
    let tip = `状态：${meta.label}`;
    if (s.last_check_at) {
        const d = new Date(s.last_check_at);
        if (!isNaN(d)) tip += ` · 最后检测：${d.toLocaleString()}`;
    }
    dot.title = tip;
    return dot;
}

function isValidHexColor(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(c);
}

function buildTagChip(tag) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'card-tag';
    chip.textContent = tag.name || '';
    if (isValidHexColor(tag.color)) {
        chip.style.color = tag.color;
        chip.style.borderColor = tag.color;
    }
    chip.title = `筛选标签：${tag.name || ''}`;
    chip.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        setTagFilter(tag);
    });
    return chip;
}

// 站点图标：URL 图标走 <img>（加载失败回退到首字母色块），emoji/字母等文本图标直接渲染。
// 只有明确是 URL（http(s)://、站内绝对路径、data:image/）的图标才走 <img>——否则会被
// sanitizeUrl 解析成同源相对地址，每张卡片白走一次 404 再落回兜底。
function buildFavIcon(s, size = 36) {
    const icon = s.icon || '🌐';
    const name = s.name || '';
    const isUrlIcon = typeof icon === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(icon);
    const iconUrl = isUrlIcon
        ? (sanitizeUrl(icon) || (icon.startsWith('data:image/') ? icon : null))
        : null;
    const el = document.createElement('div');
    if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = `width:${size}px;height:${size}px;border-radius:${Math.max(4, Math.round(size * 0.28))}px;object-fit:cover`;
        img.onerror = () => { img.onerror = null; img.src = iconFallbackUri(name); };
        el.appendChild(img);
    } else {
        // 文本图标（emoji / 字母等），isUrlIcon 已排除 URL 形态
        el.textContent = icon || '🌐';
    }
    return el;
}

function buildCard(s) {
    const name = s.name;
    const url = sanitizeUrl(s.url);
    // 名称缺失或 URL 非法（非 http/https）时不渲染该卡片
    if (!name || !url) return null;
    const desc = s.description || '';
    const id = s.id || '';

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = s.nofollow ? 'noopener nofollow' : 'noopener';
    a.className = 'card rv';
    a.title = `${name} — ${desc}`;
    a.dataset.id = id;
    a.addEventListener('click', () => {
        if (id) addRecent(id);
        trackClick(String(id));
    });

    const row = document.createElement('div');
    row.className = 'card-row';
    const fav = buildFavIcon(s);
    fav.className = 'card-fav';

    const nameEl = document.createElement('div');
    nameEl.className = 'card-name';
    nameEl.textContent = name;

    const descEl = document.createElement('div');
    descEl.className = 'card-desc';
    descEl.textContent = desc;

    const textCol = document.createElement('div');
    textCol.className = 'card-text';
    textCol.append(nameEl, descEl);

    row.append(fav, textCol, buildStatusDot(s));
    a.append(row);

    if (Array.isArray(s.tags) && s.tags.length > 0) {
        const tagsRow = document.createElement('div');
        tagsRow.className = 'card-tags';
        s.tags.slice(0, 3).forEach(t => tagsRow.appendChild(buildTagChip(t)));
        a.appendChild(tagsRow);
    }

    if (id) {
        const pin = document.createElement('button');
        pin.type = 'button';
        pin.className = 'card-pin' + (isPinned(id) ? ' on' : '');
        pin.textContent = '📌';
        pin.title = isPinned(id) ? '从我的常用移除' : '固定到我的常用';
        pin.setAttribute('aria-pressed', isPinned(id) ? 'true' : 'false');
        pin.setAttribute('aria-label', pin.title);
        pin.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            togglePin(id);
            const on = isPinned(id);
            pin.classList.toggle('on', on);
            pin.title = on ? '从我的常用移除' : '固定到我的常用';
            pin.setAttribute('aria-pressed', on ? 'true' : 'false');
            pin.setAttribute('aria-label', pin.title);
        });
        a.appendChild(pin);

        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'card-star' + (isFav(id) ? ' on' : '');
        star.textContent = isFav(id) ? '★' : '☆';
        star.title = isFav(id) ? '取消收藏' : '收藏';
        star.setAttribute('aria-pressed', isFav(id) ? 'true' : 'false');
        star.setAttribute('aria-label', star.title);
        star.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            toggleFav(id);
            const on = isFav(id);
            star.classList.toggle('on', on);
            star.textContent = on ? '★' : '☆';
            star.title = on ? '取消收藏' : '收藏';
            star.setAttribute('aria-pressed', on ? 'true' : 'false');
            star.setAttribute('aria-label', star.title);
            if (curView === 'fav' && !on) render();
        });
        a.appendChild(star);

        const report = document.createElement('button');
        report.type = 'button';
        report.className = 'card-report';
        report.textContent = '⚑';
        report.title = '报告失效';
        report.setAttribute('aria-label', '报告失效');
        report.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            reportSite(id, report);
        });
        a.appendChild(report);
    }

    return a;
}

// ═══════════════════════════════════════════
// REPORT PANEL — 卡片「报告失效」弹出面板（选择原因 + 可选补充说明）
// ═══════════════════════════════════════════
const REPORT_REASONS = [
    { value: 'link_dead', label: '链接失效' },
    { value: 'wrong_info', label: '信息有误' },
    { value: 'spam', label: '垃圾信息' },
    { value: 'inappropriate', label: '内容不当' }
];
let reportPanel = null;
let reportPanelSiteId = null;

function closeReportPanel() {
    if (reportPanel) { reportPanel.remove(); reportPanel = null; reportPanelSiteId = null; }
}

function reportSite(id, btn) {
    // 再次点击同一按钮 → 收起面板
    if (reportPanel && reportPanelSiteId === id) { closeReportPanel(); return; }
    closeReportPanel();
    reportPanelSiteId = id;

    let selectedReason = REPORT_REASONS[0].value;
    const panel = document.createElement('div');
    panel.className = 'report-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '举报网站');

    const title = document.createElement('div');
    title.className = 'report-panel-title';
    title.textContent = '举报该网站';
    panel.appendChild(title);

    const reasonWrap = document.createElement('div');
    reasonWrap.className = 'report-panel-reasons';
    REPORT_REASONS.forEach((r, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'report-reason' + (i === 0 ? ' active' : '');
        b.textContent = r.label;
        b.dataset.reason = r.value;
        b.addEventListener('click', () => {
            selectedReason = r.value;
            reasonWrap.querySelectorAll('.report-reason').forEach(x => x.classList.toggle('active', x === b));
        });
        reasonWrap.appendChild(b);
    });
    panel.appendChild(reasonWrap);

    const detail = document.createElement('textarea');
    detail.className = 'report-panel-detail';
    detail.placeholder = '补充说明（选填，200 字以内）';
    detail.maxLength = 200;
    panel.appendChild(detail);

    const actions = document.createElement('div');
    actions.className = 'report-panel-actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'report-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', closeReportPanel);
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'report-submit';
    submit.textContent = '提交';
    submit.addEventListener('click', () => submitReport(id, btn, selectedReason, detail.value.trim(), submit));
    actions.append(cancel, submit);
    panel.appendChild(actions);

    // 面板在卡片 <a> 内部点击链路之外，但仍阻止冒泡触发卡片跳转/外部关闭
    panel.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });

    document.body.appendChild(panel);
    const rect = btn.getBoundingClientRect();
    const pw = 260;
    let left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    panel.style.position = 'fixed';
    panel.style.left = left + 'px';
    panel.style.top = Math.min(rect.bottom + 8, window.innerHeight - 240) + 'px';
    reportPanel = panel;
}

async function submitReport(id, btn, reason, detail, submitBtn) {
    if (submitBtn.disabled) return;
    submitBtn.disabled = true;
    submitBtn.textContent = '提交中...';
    try {
        const res = await fetch('/api/reports', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ site_id: id, reason, detail: detail || undefined })
        });
        if (res.ok) {
            toast('已反馈，感谢！');
            btn.classList.add('done');
            btn.disabled = true;
            closeReportPanel();
        } else if (res.status === 429) {
            toast('提交过于频繁，请稍后再试');
            closeReportPanel();
        } else {
            const data = await res.json().catch(() => ({}));
            toast(data.error || '提交失败，请稍后再试');
            submitBtn.disabled = false;
            submitBtn.textContent = '提交';
        }
    } catch (err) {
        toast('网络错误，请稍后再试');
        submitBtn.disabled = false;
        submitBtn.textContent = '提交';
    }
}

// 点击面板外部 / 按 Esc 关闭
document.addEventListener('click', e => {
    if (reportPanel && !reportPanel.contains(e.target)) closeReportPanel();
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeReportPanel();
});

function siteMatchesFilters(s) {
    if (curC !== 'all' && s.category !== curC) return false;
    if (curTag && !(Array.isArray(s.tags) && s.tags.some(t => String(t.id) === String(curTag.id) || t.name === curTag.name))) return false;
    if (curView === 'featured' && !s.is_featured) return false;
    return true;
}

function parseSqliteTime(v) {
    if (!v) return 0;
    const d = new Date(String(v).replace(' ', 'T') + 'Z');
    return isNaN(d) ? 0 : d.getTime();
}

function buildSecHead(icon, label) {
    const secHead = document.createElement('div');
    secHead.className = 'sec-head rv';
    const secIco = document.createElement('div');
    secIco.className = 'sec-ico';
    secIco.textContent = icon;
    const secTitle = document.createElement('div');
    secTitle.className = 'sec-title';
    secTitle.textContent = label;
    const secLine = document.createElement('div');
    secLine.className = 'sec-line';
    secHead.append(secIco, secTitle, secLine);
    return secHead;
}

function buildNote(text, linkText, linkHref, btnText, btnFn) {
    const note = document.createElement('div');
    note.className = 'area-note rv vis';
    const p = document.createElement('p');
    p.textContent = text;
    note.appendChild(p);
    if (linkText && linkHref) {
        const link = document.createElement('a');
        link.href = linkHref;
        link.textContent = linkText;
        note.appendChild(link);
    }
    if (btnText && btnFn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'note-btn';
        btn.textContent = btnText;
        btn.addEventListener('click', btnFn);
        note.appendChild(btn);
    }
    return note;
}

function buildCardGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    items.forEach(s => {
        const card = buildCard(s);
        if (card) grid.appendChild(card);
    });
    return grid;
}

// ═══════════════════════════════════════════
// HOME — 工作台首页视图（Dock / 状态卡 / 分类区）
// ═══════════════════════════════════════════
function pinnedSites() {
    const byId = new Map(S.map(s => [String(s.id), s]));
    return (Array.isArray(pinned) ? pinned : [])
        .map(id => byId.get(String(id)))
        .filter(s => s && s.status === 'active');
}

// Dock：8~10 个高频入口，图标为视觉主体；固定/移除在「全部应用」卡片 📌 上操作
function renderDock() {
    const dock = document.getElementById('dockBar');
    const hint = document.getElementById('dockHint');
    if (!dock) return;
    dock.textContent = '';
    const items = pinnedSites().slice(0, PINNED_MAX);
    if (hint) hint.hidden = items.length > 0;
    items.forEach(s => {
        const url = sanitizeUrl(s.url);
        if (!url) return;
        const a = document.createElement('a');
        a.className = 'dock-item';
        a.href = url;
        a.target = '_blank';
        a.rel = s.nofollow ? 'noopener nofollow' : 'noopener';
        a.title = s.name;
        const ico = buildFavIcon(s, 32);
        ico.className = 'dock-ic';
        const name = document.createElement('span');
        name.className = 'dock-name';
        name.textContent = s.name;
        a.append(ico, name);
        a.addEventListener('click', () => {
            if (s.id) {
                addRecent(s.id);
                trackClick(String(s.id));
            }
        });
        const entry = document.createElement('div');
        entry.className = 'dock-entry';
        entry.appendChild(a);
        if (dockEditing) {
            const controls = document.createElement('div');
            controls.className = 'dock-tools';
            const index = items.indexOf(s);
            for (const [label, text, offset] of [['前移', '←', -1], ['后移', '→', 1], ['移除', '×', 0]]) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = text;
                btn.setAttribute('aria-label', label + s.name);
                btn.disabled = offset !== 0 && (index + offset < 0 || index + offset >= items.length);
                btn.addEventListener('click', () => {
                    pinned = items.map(item => item.id);
                    if (!offset) pinned.splice(index, 1);
                    else [pinned[index], pinned[index + offset]] = [pinned[index + offset], pinned[index]];
                    savePinned();
                    renderDock();
                    const next = dock.querySelectorAll('.dock-tools')[Math.min(index + offset, pinned.length - 1)];
                    next?.querySelector('button:not(:disabled)')?.focus();
                });
                controls.appendChild(btn);
            }
            entry.appendChild(controls);
        }
        dock.appendChild(entry);
    });
}

// 状态区：最近使用 4 个（内联横排）/ 收藏计数 / 服务状态聚合；稍后阅读自动检测 Karakeep
function renderStatusRow() {
    const byId = new Map(S.map(s => [String(s.id), s]));

    const recentBody = document.getElementById('stRecentBody');
    if (recentBody) {
        recentBody.textContent = '';
        const items = recent.map(r => byId.get(String(r.id)))
            .filter(s => s && s.status === 'active')
            .slice(0, 4);
        if (items.length === 0) {
            const empty = document.createElement('span');
            empty.className = 'st-empty';
            empty.textContent = '点击任意站点后出现在这里';
            recentBody.appendChild(empty);
        }
        items.forEach(s => {
            const url = sanitizeUrl(s.url);
            if (!url) return;
            const a = document.createElement('a');
            a.className = 'st-recent-item';
            a.href = url;
            a.target = '_blank';
            a.rel = s.nofollow ? 'noopener nofollow' : 'noopener';
            a.title = s.name;
            const ic = buildFavIcon(s, 18);
            ic.className = 'st-recent-ic';
            const nm = document.createElement('span');
            nm.className = 'st-recent-name';
            nm.textContent = s.name;
            a.append(ic, nm);
            a.addEventListener('click', () => {
                if (s.id) {
                    addRecent(s.id);
                    trackClick(String(s.id));
                }
            });
            recentBody.appendChild(a);
        });
    }

    // 稍后阅读：CMS 收录了 Karakeep 才显示该入口（无独立数据源，不伪造计数）
    const read = S.find(s => /karakeep/i.test(`${s.name || ''} ${s.url || ''} ${s.keywords || ''}`));
    const stRead = document.getElementById('stRead');
    if (stRead) {
        stRead.hidden = !read || !homeConfig.show_read_later;
        stRead.onclick = null;
        if (read) {
            const url = sanitizeUrl(read.url);
            if (url) stRead.onclick = () => window.open(url, '_blank', 'noopener');
        }
    }

    const favNum = document.getElementById('stFavNum');
    if (favNum) favNum.textContent = String(favs.length);

    const healthBody = document.getElementById('stHealthBody');
    if (healthBody) {
        healthBody.textContent = '';
        const monitored = S.filter(s => ['online', 'slow', 'offline'].includes(s.last_status));
        const line = document.createElement('span');
        line.className = 'st-health-line';
        const dot = document.createElement('span');
        dot.className = 'st-dot';
        const text = document.createElement('span');
        if (monitored.length === 0) {
            dot.classList.add('st-none');
            text.textContent = '未启用检测';
        } else {
            const ok = monitored.filter(s => s.last_status !== 'offline');
            const anyOffline = ok.length < monitored.length;
            dot.classList.add(anyOffline ? 'st-offline' : 'st-online');
            text.textContent = `${ok.length}/${monitored.length} 正常`;
            text.classList.toggle('st-health-ok', !anyOffline);
            if (anyOffline) {
                const bad = monitored.filter(s => s.last_status === 'offline').map(s => s.name).join('、');
                line.title = `离线：${bad}`;
            }
        }
        line.append(dot, text);
        healthBody.appendChild(line);
    }
}

// 分类工作流区：左侧分类标题纵向居中，右侧一行 5 个紧凑站点 + › 查看全部
const HOME_CAT_MAX = 5;
function renderHomeCats() {
    const box = document.getElementById('catSections');
    if (!box) return;
    box.textContent = '';
    const categories = homeConfig.category_ids === null ? Object.entries(C) : homeConfig.category_ids.filter(id => C[id]).map(id => [id, C[id]]);
    categories.forEach(([id, c]) => {
        const all = S.filter(s => s.category === id);
        if (all.length === 0) return;
        const items = all.slice(0, homeConfig.category_limit || HOME_CAT_MAX);
        const sec = document.createElement('section');
        sec.className = 'wf-sec';
        const head = document.createElement('div');
        head.className = 'wf-head';
        const title = document.createElement('h2');
        title.className = 'wf-title';
        title.textContent = c.l;
        head.appendChild(title);
        const grid = document.createElement('div');
        grid.className = 'wf-grid';
        items.forEach(s => {
            const url = sanitizeUrl(s.url);
            if (!url) return;
            const a = document.createElement('a');
            a.className = 'wf-item';
            a.href = url;
            a.target = '_blank';
            a.rel = s.nofollow ? 'noopener nofollow' : 'noopener';
            a.title = s.name;
            const ic = buildFavIcon(s, 24);
            ic.className = 'wf-ic';
            const nm = document.createElement('span');
            nm.className = 'wf-item-name';
            nm.textContent = s.name;
            a.append(ic, nm);
            a.addEventListener('click', () => {
                if (s.id) {
                    addRecent(s.id);
                    trackClick(String(s.id));
                }
            });
            grid.appendChild(a);
        });
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'wf-more';
        more.textContent = '›';
        more.title = `查看全部分类「${c.l}」（共 ${all.length} 个）`;
        more.setAttribute('aria-label', more.title);
        more.addEventListener('click', () => openAllView(id));
        sec.append(head, grid, more);
        box.appendChild(sec);
    });
}

function renderHome() {
    renderDock();
    renderStatusRow();
    document.getElementById('stRecent').hidden = !homeConfig.show_recent;
    document.getElementById('stFav').hidden = !homeConfig.show_favorites;
    document.getElementById('stHealth').hidden = !homeConfig.show_health;
    renderHomeCats();
}

// 视图切换：home（工作台）↔ all（全部应用，承载分类/精选/热门/最新/收藏/最近）
function openAllView(target) {
    pageView = 'all';
    document.getElementById('homeView').hidden = true;
    document.getElementById('allView').hidden = false;
    const btn = document.getElementById('btnAllApps');
    if (btn) btn.textContent = '返回首页';
    if (target && VIEW_META[target]) {
        selectView(target);
    } else if (typeof target === 'string' && target && C[target]) {
        selectCategory(target);
    } else {
        render();
    }
    window.scrollTo({ top: 0 });
    layoutCatPills();
}

function goHome() {
    pageView = 'home';
    document.getElementById('allView').hidden = true;
    document.getElementById('homeView').hidden = false;
    const btn = document.getElementById('btnAllApps');
    if (btn) btn.textContent = '全部应用';
    render();
    window.scrollTo({ top: 0 });
}

function render() {
    if (!sitesLoaded) return; // 数据未就绪：保留加载/错误态，不覆盖
    if (pageView === 'home') { renderHome(); return; }
    const a = document.getElementById('cardsArea');
    a.textContent = '';

    updateNavHighlight();
    buildTagNav();

    if (S.length === 0) {
        a.appendChild(buildNote('暂无站点，欢迎投稿。', '去投稿 →', 'contribute.html'));
        return;
    }

    const items = S.filter(siteMatchesFilters);

    if (curView === 'all') {
        if (curC === 'all') {
            // 「全部」模式：Kaka 式分组导航——分类标题 + 分隔线 + 该分类网站
            const g = {};
            items.forEach(s => { if (!g[s.category]) g[s.category] = []; g[s.category].push(s); });
            const orderedKeys = [...new Set([...Object.keys(C), ...Object.keys(g)])].filter(k => g[k]);
            for (const k of orderedKeys) {
                const c = C[k] || { i: '📁', l: k };
                a.appendChild(buildSecHead(c.i, c.l));
                a.appendChild(buildCardGrid(g[k]));
            }
        } else {
            // 默认单分类：分组标题简化（导航行已高亮当前分类）
            const c = C[curC] || { i: '📁', l: curC };
            a.appendChild(buildSecHead(c.i, c.l));
            a.appendChild(buildCardGrid(items));
        }
    } else {
        let viewItems = items;
        const byId = new Map(S.map(s => [String(s.id), s]));
        if (curView === 'hot') {
            viewItems = [...items].sort((x, y) => (y.click_count || 0) - (x.click_count || 0));
        } else if (curView === 'new') {
            viewItems = [...items].sort((x, y) => parseSqliteTime(y.created_at) - parseSqliteTime(x.created_at));
        } else if (curView === 'fav') {
            viewItems = favs.map(id => byId.get(String(id))).filter(s => s && siteMatchesFilters(s));
        } else if (curView === 'recent') {
            viewItems = recent.map(r => byId.get(String(r.id))).filter(s => s && siteMatchesFilters(s));
        }

        if (viewItems.length === 0) {
            if (curView === 'fav') {
                a.appendChild(buildNote('还没有收藏任何站点，点击卡片上的 ☆ 收藏喜欢的站点。'));
            } else if (curView === 'recent') {
                a.appendChild(buildNote('暂无最近访问记录，点击任意站点卡片后会出现在这里。'));
            } else {
                a.appendChild(buildNote('没有符合当前筛选条件的站点。', null, null, '清除筛选', clearFilters));
            }
            return;
        }

        const meta = VIEW_META[curView] || { i: '📁', l: '' };
        a.appendChild(buildSecHead(meta.i, meta.l));
        a.appendChild(buildCardGrid(viewItems));
    }

    // 「全部」视图 + 筛选条件下也可能为空
    if (!a.hasChildNodes()) {
        a.appendChild(buildNote('没有符合当前筛选条件的站点。', null, null, '清除筛选', clearFilters));
        return;
    }

    initReveal();
}

function clearFilters() {
    curC = defaultCategory();
    curView = 'all';
    curTag = null;
    updateTagChip();
    render();
}

// 默认分类：推荐优先，其次第一个有效分类，最后才退回「全部」
function defaultCategory() {
    if (C['recommend']) return 'recommend';
    const first = Object.keys(C)[0];
    return first || 'all';
}

// ═══════════════════════════════════════════
// SEARCH — 站内优先 + 外部引擎兜底（引擎选择内嵌输入框左侧）
// ═══════════════════════════════════════════
const searchInput = document.getElementById('searchInput');
const searchPanel = document.getElementById('searchPanel');
const searchBox = searchInput.closest('.search-wrap');
let searchTimer = null;
let srItems = [];   // 当前面板项 { kind:'url'|'site'|'ext', url, el }
let srActive = -1;

function tryUrl(q) {
    try {
        const u = new URL(q);
        if (u.protocol === 'http:' || u.protocol === 'https:') return u.href;
    } catch { /* not a URL */ }
    return null;
}

// 子序列模糊匹配：ql 的每个字符按顺序出现在 text 中（容忍 gihub→github 这类输入）
function isSubsequence(ql, text) {
    if (!ql) return false;
    let i = 0;
    for (const ch of text) {
        if (ch === ql[i]) i++;
        if (i >= ql.length) return true;
    }
    return false;
}

// 站点搜索打分（0 = 不匹配）：name 前缀 > name 子串 > 别名/URL/描述/标签/分类 子串
// > 别名逐段模糊 > name 模糊。keywords 为后台维护的逗号分隔搜索别名（如 gpt,chatgpt）
function scoreSite(s, ql) {
    const name = (s.name || '').toLowerCase();
    if (name.startsWith(ql)) return 100;
    if (name.includes(ql)) return 80;
    const fields = [s.keywords, s.url, s.description, (C[s.category] || {}).l, s.category];
    if (Array.isArray(s.tags)) s.tags.forEach(t => fields.push(t.name));
    for (const f of fields) {
        if (typeof f === 'string' && f.toLowerCase().includes(ql)) return 60;
    }
    if (typeof s.keywords === 'string' &&
        s.keywords.toLowerCase().split(/[,，、\s]+/).some(k => k && isSubsequence(ql, k))) return 40;
    if (name && isSubsequence(ql, name)) return 20;
    return 0;
}

// 高亮：textContent 切分 + <mark>，不经过 innerHTML
function appendHighlighted(el, text, ql) {
    const t = String(text || '');
    if (!ql) { el.textContent = t; return; }
    const idx = t.toLowerCase().indexOf(ql);
    if (idx === -1) { el.textContent = t; return; }
    el.appendChild(document.createTextNode(t.slice(0, idx)));
    const mark = document.createElement('mark');
    mark.textContent = t.slice(idx, idx + ql.length);
    el.appendChild(mark);
    el.appendChild(document.createTextNode(t.slice(idx + ql.length)));
}

function openSrItem(item) {
    if (!item) return;
    const url = sanitizeUrl(item.url);
    if (!url) return;
    if (item.kind === 'site') {
        addRecent(item.site.id);
        trackClick(String(item.site.id));
    }
    window.open(url, '_blank', 'noopener');
    closePanel();
}

function setSrActive(idx) {
    srItems.forEach((it, i) => it.el.classList.toggle('active', i === idx));
    srActive = idx;
    if (idx >= 0 && srItems[idx]) {
        searchInput.setAttribute('aria-activedescendant', srItems[idx].el.id);
        srItems[idx].el.scrollIntoView({ block: 'nearest' });
    } else {
        searchInput.removeAttribute('aria-activedescendant');
    }
}

function closePanel() {
    searchPanel.hidden = true;
    searchPanel.textContent = '';
    srItems = [];
    srActive = -1;
    searchInput.setAttribute('aria-expanded', 'false');
    searchInput.removeAttribute('aria-activedescendant');
}

function buildSrOption(id) {
    const opt = document.createElement('div');
    opt.className = 'sr-opt';
    opt.id = id;
    opt.setAttribute('role', 'option');
    return opt;
}

function updateSearchPanel() {
    const q = searchInput.value.trim();
    if (!q) { closePanel(); return; }
    const ql = q.toLowerCase();

    searchPanel.textContent = '';
    srItems = [];
    srActive = -1;

    // 合法 URL → 第一项「直接访问」
    const directUrl = tryUrl(q);
    if (directUrl) {
        const opt = buildSrOption('sr-opt-0');
        const ico = document.createElement('span');
        ico.className = 'sr-ico';
        ico.textContent = '🔗';
        const body = document.createElement('div');
        body.className = 'sr-body';
        const title = document.createElement('div');
        title.className = 'sr-name';
        title.textContent = `直接访问 ${new URL(directUrl).host}`;
        const sub = document.createElement('div');
        sub.className = 'sr-desc';
        sub.textContent = directUrl;
        body.append(title, sub);
        opt.append(ico, body);
        const item = { kind: 'url', url: directUrl, el: opt };
        opt.addEventListener('mousedown', e => { e.preventDefault(); openSrItem(item); });
        opt.addEventListener('mousemove', () => setSrActive(srItems.indexOf(item)));
        srItems.push(item);
        searchPanel.appendChild(opt);
    }

    const matches = S.map(s => [scoreSite(s, ql), s])
        .filter(([score]) => score > 0)
        // 同分时：站名更短（更精确）优先，其次累计点击更高优先
        .sort((x, y) => y[0] - x[0] || (x[1].name || '').length - (y[1].name || '').length || (y[1].click_count || 0) - (x[1].click_count || 0))
        .slice(0, 10)
        .map(([, s]) => s);
    matches.forEach(s => {
        const opt = buildSrOption(`sr-opt-${srItems.length}`);
        opt.appendChild(buildStatusDot(s));
        const body = document.createElement('div');
        body.className = 'sr-body';
        const nameRow = document.createElement('div');
        nameRow.className = 'sr-name';
        appendHighlighted(nameRow, s.name, ql);
        const cat = (C[s.category] || {}).l || s.category;
        if (cat) {
            const badge = document.createElement('span');
            badge.className = 'sr-cat';
            badge.textContent = cat;
            nameRow.appendChild(badge);
        }
        body.appendChild(nameRow);
        if (s.description) {
            const desc = document.createElement('div');
            desc.className = 'sr-desc';
            appendHighlighted(desc, s.description, ql);
            body.appendChild(desc);
        }
        opt.appendChild(body);
        const item = { kind: 'site', url: s.url, site: s, el: opt };
        opt.addEventListener('mousedown', e => { e.preventDefault(); openSrItem(item); });
        opt.addEventListener('mousemove', () => setSrActive(srItems.indexOf(item)));
        srItems.push(item);
        searchPanel.appendChild(opt);
    });

    if (srItems.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'sr-empty';
        const p = document.createElement('p');
        p.textContent = '未找到相关站点';
        const row = document.createElement('div');
        row.className = 'sr-ext-row';
        Object.entries(E).slice(0, 2).map(([id, e]) => [id, e.n + ' 搜']).forEach(([eng, label]) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sr-ext-btn';
            btn.textContent = `${label}「${q}」`;
            const item = { kind: 'ext', url: E[eng].u.replace('{query}', encodeURIComponent(q)), el: btn };
            btn.addEventListener('mousedown', e => { e.preventDefault(); openSrItem(item); });
            row.appendChild(btn);
        });
        empty.append(p, row);
        searchPanel.appendChild(empty);
    }

    searchPanel.hidden = false;
    searchInput.setAttribute('aria-expanded', 'true');
    if (srItems.length > 0) setSrActive(0);
}

function externalSearch() {
    const q = searchInput.value.trim();
    if (q) window.open(E[curE].u.replace('{query}', encodeURIComponent(q)), '_blank', 'noopener');
}

document.getElementById('searchBtn').addEventListener('click', () => {
    if (srActive >= 0 && srItems[srActive]) openSrItem(srItems[srActive]);
    else {
        const direct = tryUrl(searchInput.value.trim());
        if (direct) window.open(direct, '_blank', 'noopener');
        else externalSearch();
    }
});

searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(updateSearchPanel, 200);
});

searchInput.addEventListener('focus', () => {
    if (searchInput.value.trim()) updateSearchPanel();
});

searchInput.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' && !searchPanel.hidden) {
        e.preventDefault();
        if (srItems.length) setSrActive((srActive + 1) % srItems.length);
    } else if (e.key === 'ArrowUp' && !searchPanel.hidden) {
        e.preventDefault();
        if (srItems.length) setSrActive((srActive - 1 + srItems.length) % srItems.length);
    } else if (e.key === 'Enter') {
        if (srActive >= 0 && srItems[srActive]) {
            e.preventDefault();
            openSrItem(srItems[srActive]);
        } else {
            const direct = tryUrl(searchInput.value.trim());
            if (direct) {
                e.preventDefault();
                window.open(direct, '_blank', 'noopener');
                closePanel();
            } else {
                externalSearch();
            }
        }
    } else if (e.key === 'Escape') {
        closePanel();
        searchInput.blur();
    }
});

// '/' 聚焦搜索框（焦点不在输入控件时）
document.addEventListener('keydown', e => {
    if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
});

document.addEventListener('click', e => {
    if (!searchBox.contains(e.target)) closePanel();
});

// 引擎选择器：点击搜索框左侧放大镜打开（视觉上保持极简，不显示当前引擎文字）
(function initEngineSelect() {
    const icoBtn = document.getElementById('searchIco');
    const menu = document.getElementById('engMenu');

    function renderMenu() {
        menu.textContent = '';
        Object.entries(E).forEach(([key, eng]) => {
            const opt = document.createElement('button');
            opt.type = 'button';
            opt.className = 'eng-option' + (key === curE ? ' on' : '');
            opt.setAttribute('role', 'option');
            opt.setAttribute('aria-selected', key === curE ? 'true' : 'false');
            opt.textContent = eng.n;
            opt.dataset.engine = key;
            menu.appendChild(opt);
        });
    }

    function openMenu() {
        renderMenu();
        menu.hidden = false;
        icoBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
        menu.hidden = true;
        icoBtn.setAttribute('aria-expanded', 'false');
    }

    icoBtn.addEventListener('click', () => {
        if (menu.hidden) openMenu(); else closeMenu();
    });
    menu.addEventListener('click', e => {
        const opt = e.target.closest('.eng-option'); if (!opt) return;
        curE = opt.dataset.engine;
        writePreference('dognav-engine', curE);
        syncEngineLabel();
        closeMenu();
        searchInput.focus();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.search-wrap')) closeMenu();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeMenu();
    });
})();

// ═══════════════════════════════════════════
// CATEGORY / VIEW / TAG FILTER — 分类与模式互斥
// ═══════════════════════════════════════════
function selectCategory(id) {
    curC = id;
    curView = 'all';
    curTag = null;
    updateTagChip();
    render();
}

function selectView(view) {
    curView = view;
    curC = 'all';
    curTag = null;
    updateTagChip();
    render();
    // 模式切换后让面板头部回到视口顶部附近，避免长列表停在中间
    const head = document.querySelector('.panel-head');
    if (head) head.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateNavHighlight() {
    // 分类行：仅在普通浏览（curView==='all'）时高亮分类
    document.querySelectorAll('#catPills .cat-pill, #catMoreMenu .cat-pill').forEach(x => {
        x.classList.toggle('on', curView === 'all' && x.dataset.cat === curC);
    });
    // 模式行
    document.querySelectorAll('.view-pill').forEach(x => {
        x.classList.toggle('on', curView === x.dataset.view);
    });
    // 移动端抽屉
    document.querySelectorAll('#drawerCats .drawer-item').forEach(x => {
        x.classList.toggle('on', curView === 'all' && x.dataset.cat === curC);
    });
    document.querySelectorAll('#drawerModes .drawer-item').forEach(x => {
        x.classList.toggle('on', curView === x.dataset.view);
    });
    syncMoreBtnLabel();
}

function syncMoreBtnLabel() {
    const btn = document.getElementById('catMoreBtn');
    if (!btn) return;
    const activeInMenu = curView === 'all' &&
        document.querySelector('#catMoreMenu .cat-pill.on') !== null;
    btn.classList.toggle('has-active', activeInMenu);
}

document.getElementById('catPills').addEventListener('click', e => {
    const p = e.target.closest('.cat-pill[data-cat]'); if (!p) return;
    selectCategory(p.dataset.cat);
});
document.getElementById('catMoreMenu').addEventListener('click', e => {
    const p = e.target.closest('.cat-pill[data-cat]'); if (!p) return;
    selectCategory(p.dataset.cat);
    document.getElementById('catMoreMenu').hidden = true;
    document.getElementById('catMoreBtn').setAttribute('aria-expanded', 'false');
});

document.getElementById('catMoreBtn').addEventListener('click', () => {
    const menu = document.getElementById('catMoreMenu');
    const btn = document.getElementById('catMoreBtn');
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.addEventListener('click', e => {
    if (!e.target.closest('.cat-more')) {
        document.getElementById('catMoreMenu').hidden = true;
        document.getElementById('catMoreBtn').setAttribute('aria-expanded', 'false');
    }
});

document.getElementById('viewBar').addEventListener('click', e => {
    const p = e.target.closest('.view-pill'); if (!p) return;
    selectView(p.dataset.view);
});

function setTagFilter(tag) {
    if (curTag && String(curTag.id) === String(tag.id) && curTag.name === tag.name) {
        curTag = null; // 再点一次取消
    } else {
        curTag = { id: tag.id, name: tag.name };
    }
    updateTagChip();
    buildTagNav();
    render();
}

function updateTagChip() {
    const chip = document.getElementById('tagFilterChip');
    if (!chip) return;
    chip.textContent = '';
    if (!curTag) { chip.hidden = true; return; }
    chip.hidden = false;
    const label = document.createElement('span');
    label.textContent = `# ${curTag.name || curTag.id}`;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'tag-chip-x';
    x.textContent = '✕';
    x.setAttribute('aria-label', '清除标签筛选');
    x.addEventListener('click', () => { curTag = null; updateTagChip(); buildTagNav(); render(); });
    chip.append(label, x);
}

// 可选第二级导航：当前分类存在标签时显示标签筛选
function buildTagNav() {
    const nav = document.getElementById('tagNav');
    if (!nav) return;
    nav.textContent = '';
    const show = curView === 'all' && curC !== 'all';
    if (!show) { nav.hidden = true; return; }
    const scope = S.filter(s => s.category === curC);
    const byId = new Map();
    scope.forEach(s => (Array.isArray(s.tags) ? s.tags : []).forEach(t => {
        if (t && t.name && !byId.has(String(t.id))) byId.set(String(t.id), t);
    }));
    if (byId.size === 0) { nav.hidden = true; return; }
    [...byId.values()].forEach(t => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tag-filter-chip';
        chip.textContent = `# ${t.name}`;
        const active = curTag && String(curTag.id) === String(t.id);
        chip.classList.toggle('on', !!active);
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
        chip.addEventListener('click', () => setTagFilter(t));
        nav.appendChild(chip);
    });
    nav.hidden = false;
}

// ═══════════════════════════════════════════
// CATEGORY DRAWER（移动端分类/模式抽屉；全部应用视图内使用）
// ═══════════════════════════════════════════
(function initCatDrawer() {
    const drawer = document.getElementById('catDrawer');
    const overlay = document.getElementById('drawerOverlay');
    if (!drawer || !overlay) return;

    function openDrawer() {
        drawer.hidden = false;
        overlay.hidden = false;
        updateNavHighlight();
    }
    function closeDrawer() {
        drawer.hidden = true;
        overlay.hidden = true;
    }

    document.getElementById('catDrawerBtn').addEventListener('click', openDrawer);
    document.getElementById('drawerClose').addEventListener('click', closeDrawer);
    overlay.addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !drawer.hidden) closeDrawer();
    });

    // 抽屉列表在 applyCategories 填充；选择后关闭抽屉
    drawer.addEventListener('click', e => {
        const item = e.target.closest('.drawer-item'); if (!item) return;
        if (item.dataset.cat !== undefined) selectCategory(item.dataset.cat);
        else if (item.dataset.view) selectView(item.dataset.view);
        closeDrawer();
    });
})();

// ═══════════════════════════════════════════
// REVEAL
// ═══════════════════════════════════════════
function initReveal() {
    document.querySelectorAll('.rv').forEach(el => el.classList.add('vis'));
}

// ═══════════════════════════════════════════
// BACK TO TOP
// ═══════════════════════════════════════════
const btt = document.getElementById('btt');
window.addEventListener('scroll', () => { btt.classList.toggle('show', window.scrollY > 400); }, { passive: true });
btt.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ═══════════════════════════════════════════
// CLICK TRACKING
// ═══════════════════════════════════════════
function trackClick(id) {
    if (id) {
        fetch(`/api/sites/${id}/click`, { method: 'POST' }).catch(() => {});
    }
}

// ═══════════════════════════════════════════
// CLEAR LOCAL DATA — 清除收藏与最近访问（保留主题与常用入口）
// ═══════════════════════════════════════════
document.getElementById('setClearData').addEventListener('click', () => {
    if (!window.confirm('确定清除本地保存的收藏与最近访问记录吗？（常用入口与主题设置会保留）')) return;
    if (!previewMode) {
        localStorage.removeItem('dognav-favorites');
        localStorage.removeItem('dognav-recent');
    }
    favs = [];
    recent = [];
    render();
    toast('本地数据已清除');
    document.getElementById('setPop').hidden = true;
});

// 个人偏好导入导出：主题、搜索引擎、常用入口、收藏、最近访问
const PREF_KEYS = ['dognav-theme', 'dognav-engine', 'dognav-pinned', 'dognav-favorites', 'dognav-recent'];
const PREF_LIST_KEYS = { 'dognav-pinned': 12, 'dognav-favorites': 500, 'dognav-recent': 200 };

function validPrefList(key, raw) {
    let value;
    try { value = JSON.parse(raw); } catch { return false; }
    if (!Array.isArray(value) || value.length > PREF_LIST_KEYS[key]) return false;
    return value.every(item => (typeof item === 'number' && Number.isFinite(item)) ||
        (typeof item === 'string' && item.length <= 120));
}

function validPrefValue(key, value) {
    if (typeof value !== 'string') return false;
    if (key === 'dognav-theme') return value === 'dark' || value === 'light';
    if (key === 'dognav-engine') return value.length <= 64;
    return validPrefList(key, value);
}

document.getElementById('setExportPrefs').addEventListener('click', () => {
    const data = {};
    for (const key of PREF_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) data[key] = value;
    }
    const payload = {
        app: 'dognav', kind: 'preferences', version: 1,
        exportedAt: new Date().toISOString(),
        data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dognav-preferences-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('偏好已导出');
});

document.getElementById('setImportPrefs').addEventListener('click', () => {
    if (previewMode) { toast('预览模式下不能导入偏好'); return; }
    document.getElementById('prefFileInput').click();
});

document.getElementById('prefFileInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
        const payload = JSON.parse(await file.text());
        if (!payload || payload.app !== 'dognav' || payload.kind !== 'preferences' ||
            !payload.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) {
            toast('文件格式错误：不是 DogNav 偏好文件');
            return;
        }
        const entries = Object.entries(payload.data).filter(([key]) => PREF_KEYS.includes(key));
        if (!entries.length) { toast('文件中没有可导入的偏好项'); return; }
        const invalid = entries.find(([key, value]) => !validPrefValue(key, value));
        if (invalid) { toast(`偏好值无效：${invalid[0]}`); return; }
        for (const [key, value] of entries) localStorage.setItem(key, value);
        toast('偏好已导入，即将刷新页面');
        setTimeout(() => location.reload(), 600);
    } catch {
        toast('文件格式错误：不是有效的 JSON');
    }
});

// ═══════════════════════════════════════════
// WORKBENCH CHROME — 时钟/问候、⌘K、底部工具与设置弹层
// ═══════════════════════════════════════════
function tickClock() {
    const clock = document.getElementById('clock');
    const greet = document.getElementById('greet');
    if (!clock && !greet) return;
    const d = new Date();
    if (clock) {
        clock.textContent =
            d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' }) +
            ' · ' +
            d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    if (greet) {
        const h = d.getHours();
        greet.textContent = h < 6 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好';
    }
}
setInterval(tickClock, 20000);
tickClock();

// 按平台显示搜索快捷键提示（⌘K / Ctrl K）
(function initSearchKbd() {
    const kbd = document.getElementById('searchKbd');
    if (!kbd) return;
    const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') ||
        (navigator.userAgent || '').includes('Mac');
    kbd.textContent = mac ? '⌘ K' : 'Ctrl K';
})();

// ⌘K / Ctrl K 聚焦搜索（'/' 快捷键仍可用，见 SEARCH 段）
document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
    }
});

// 顶栏已移除：时钟为右上角浮动元素，主题切换在设置弹层内（见下方 syncThemeSeg）

// 右下角底部工具：全部应用 / 最近使用 / 设置
document.getElementById('btnAllApps').addEventListener('click', () => {
    if (pageView === 'home') openAllView(); else goHome();
});
document.getElementById('btnRecentView').addEventListener('click', () => openAllView('recent'));

// 状态卡点击：最近使用「全部 ›」与收藏卡进入对应全部应用视图
document.getElementById('statusRow').addEventListener('click', e => {
    const more = e.target.closest('[data-open]');
    if (more) { openAllView(more.dataset.open); return; }
    if (e.target.closest('#stFav')) openAllView('fav');
});
document.getElementById('stFav').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openAllView('fav'); }
});

// 设置弹层：主题切换 + 清除本地数据 + 自定义页面
const setPop = document.getElementById('setPop');
document.getElementById('btnSettings').addEventListener('click', e => {
    e.stopPropagation();
    const open = setPop.hidden;
    setPop.hidden = !open;
    document.getElementById('btnSettings').setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', e => {
    if (!setPop.hidden && !setPop.contains(e.target) &&
        !document.getElementById('btnSettings').contains(e.target)) {
        setPop.hidden = true;
    }
});
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !setPop.hidden) setPop.hidden = true;
});

function syncThemeSeg() {
    const cur = H.getAttribute('data-theme');
    document.querySelectorAll('[data-set-theme]').forEach(b => {
        b.classList.toggle('on', b.dataset.setTheme === cur);
    });
}
document.querySelectorAll('[data-set-theme]').forEach(b => {
    b.addEventListener('click', () => {
        H.setAttribute('data-theme', b.dataset.setTheme);
        writePreference('dognav-theme', b.dataset.setTheme);
        syncThemeSeg();
    });
});
syncThemeSeg();

// ═══════════════════════════════════════════
// LOADER
// ═══════════════════════════════════════════
window.addEventListener('load', () => setTimeout(() => document.getElementById('loader').classList.add('hide'), 350));

// ═══════════════════════════════════════════
// CMS INIT — fetch data from backend API（失败明确提示，不回退假数据）
// ═══════════════════════════════════════════
function showLoadingSkeleton() {
    const a = document.getElementById('cardsArea');
    a.textContent = '';
    const label = document.createElement('div');
    label.className = 'area-note';
    label.textContent = '加载中…';
    a.appendChild(label);
    const grid = document.createElement('div');
    grid.className = 'card-grid skel-grid';
    for (let i = 0; i < 8; i++) {
        const skel = document.createElement('div');
        skel.className = 'skel-card';
        grid.appendChild(skel);
    }
    a.appendChild(grid);
}

function fetchJSON(url) {
    return fetch(url).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    });
}

// 分类行桌面溢出：放不下的分类收进「更多」菜单（≤768px 由抽屉接管）
function layoutCatPills() {
    const pillsEl = document.getElementById('catPills');
    const moreEl = document.getElementById('catMore');
    const menuEl = document.getElementById('catMoreMenu');
    if (!pillsEl || !moreEl || !menuEl) return;
    if (window.innerWidth <= 768) { moreEl.hidden = true; return; }
    // 重置：菜单里的 pill 先全部放回
    while (menuEl.firstChild) pillsEl.appendChild(menuEl.firstChild);
    moreEl.hidden = true;
    const gap = 6;
    const pillsWidth = () => [...pillsEl.children].reduce((s, b) => s + b.offsetWidth + gap, 0);
    const fitsWithMore = () => pillsWidth() + moreEl.offsetWidth + gap <= pillsEl.clientWidth + 1;
    if (pillsWidth() <= pillsEl.clientWidth + 1) { syncMoreBtnLabel(); return; }
    moreEl.hidden = false;
    // 从末尾往前（跳过第一个「全部」）搬入菜单，直到放得下
    let i = pillsEl.children.length - 1;
    while (i > 0 && !fitsWithMore()) {
        menuEl.prepend(pillsEl.children[i]);
        i--;
    }
    syncMoreBtnLabel();
}

function buildCatPill(id, icon, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-pill';
    btn.dataset.cat = id;
    btn.textContent = `${icon || '📁'} ${label}`;
    return btn;
}

function buildDrawerItem(kind, id, label) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'drawer-item';
    if (kind === 'cat') btn.dataset.cat = id;
    else btn.dataset.view = id;
    btn.textContent = label;
    return btn;
}

function applyCategories(apiCats) {
    Object.keys(C).forEach(k => delete C[k]);
    const active = apiCats.filter(c => c.is_active);
    active.forEach(c => {
        C[c.id] = { i: c.icon || '📁', l: c.name };
    });

    // 首屏默认分类：推荐优先，其次第一个有效分类
    if (!initialCatResolved) {
        curC = defaultCategory();
        initialCatResolved = true;
    } else if (curC !== 'all' && !C[curC]) {
        // 重载后原分类被停用/删除：回落到默认分类
        curC = defaultCategory();
    }

    const pills = document.getElementById('catPills');
    pills.textContent = '';
    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'cat-pill';
    allBtn.dataset.cat = 'all';
    allBtn.textContent = '全部';
    pills.appendChild(allBtn);
    active.forEach(c => pills.appendChild(buildCatPill(c.id, c.icon, c.name)));

    // 移动端抽屉列表
    const drawerCats = document.getElementById('drawerCats');
    const drawerModes = document.getElementById('drawerModes');
    drawerCats.textContent = '';
    drawerCats.appendChild(buildDrawerItem('cat', 'all', '全部'));
    active.forEach(c => drawerCats.appendChild(buildDrawerItem('cat', c.id, `${c.icon || '📁'} ${c.name}`)));
    drawerModes.textContent = '';
    Object.entries(VIEW_META).forEach(([id, m]) => drawerModes.appendChild(buildDrawerItem('view', id, `${m.i} ${m.l}`)));

    layoutCatPills();
    updateNavHighlight();
}

let catLayoutRaf = null;
window.addEventListener('resize', () => {
    if (catLayoutRaf) cancelAnimationFrame(catLayoutRaf);
    catLayoutRaf = requestAnimationFrame(layoutCatPills);
});

function showCatBarError() {
    const bar = document.getElementById('catPills');
    bar.textContent = '';
    const msg = document.createElement('span');
    msg.className = 'bar-error';
    msg.textContent = '分类加载失败 ';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'note-btn';
    btn.textContent = '重试';
    btn.addEventListener('click', loadData);
    bar.append(msg, btn);
}

async function loadData() {
    showLoadingSkeleton();
    setHomeLoadState('正在加载站点…');

    const [sitesR, catsR] = await Promise.allSettled([
        fetchJSON('/api/sites'),
        fetchJSON('/api/categories'),
    ]);

    if (catsR.status === 'fulfilled') {
        applyCategories(catsR.value);
    } else {
        showCatBarError();
    }

    if (sitesR.status === 'rejected') {
        setHomeLoadState('站点加载失败，请重试。', true);
        const a = document.getElementById('cardsArea');
        a.textContent = '';
        a.appendChild(buildNote('数据加载失败。', null, null, '点击重试', loadData));
        return;
    }

    S.length = 0;
    sitesR.value.filter(s => s.status === 'active').forEach(s => S.push(s));
    sitesLoaded = true;
    setHomeLoadState(catsR.status === 'rejected' ? '分类加载失败，请重试。' : '', catsR.status === 'rejected');
    // 首次访问：用累计点击 Top 8 预填「我的常用」，避免空白首屏；之后由用户自行增删
    if (!personalPins) pinned = defaultPinnedIds();
    render();
}

function setHomeLoadState(message, retry = false) {
    const state = document.getElementById('homeLoadState');
    state.replaceChildren();
    state.hidden = !message;
    if (message) state.appendChild(buildNote(message, null, null, retry ? '重试' : null, retry ? loadData : null));
}

(async function initCMS() {
    await window.DogNavSettings.ready;
    applyHomeConfig(window.DogNavSettings.current);
    await loadData();

    // ?q=xxx — 与 index.html 的 SearchAction JSON-LD 对齐：自动填入并执行站内搜索
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) {
        searchInput.value = q;
        updateSearchPanel();
    }

    try {
        // Fetch custom pages → 设置弹层底部链接
        const pagesRes = await fetch('/api/pages');
        if (pagesRes.ok) {
            const pages = await pagesRes.json();
            const customPages = pages.filter(p => !['about','links','contribute'].includes(p.id));
            const links = document.getElementById('setLinks');
            if (customPages.length > 0 && links) {
                customPages.forEach(p => {
                    const link = document.createElement('a');
                    link.href = '/page.html?slug=' + encodeURIComponent(p.id);
                    link.textContent = p.title || p.id;
                    links.appendChild(link);
                });
            }
        }
    } catch (err) {
        // Custom page links stay hidden
    }
})();

function defaultPinnedIds() {
    return homeConfig.pinned_ids === null
        ? [...S].sort((a, b) => (b.click_count || 0) - (a.click_count || 0)).slice(0, 8).map(s => s.id)
        : homeConfig.pinned_ids.filter(id => S.some(s => String(s.id) === String(id)));
}
function syncEngineLabel() {
    document.getElementById('engineLabel').textContent = E[curE].n;
    document.getElementById('searchIco').title = '搜索引擎：' + E[curE].n;
}
function applyHomeConfig(settings) {
    homeConfig = DogNavHomeConfig.parse(settings.home_config);
    E = Object.fromEntries(homeConfig.engines.map(e => [e.id, { u: e.url, n: e.name }]));
    const saved = previewMode ? null : localStorage.getItem('dognav-engine');
    curE = saved && E[saved] ? saved : homeConfig.default_engine;
    syncEngineLabel();
    document.getElementById('engMenu').hidden = true;
    if (sitesLoaded) {
        if (!personalPins) pinned = defaultPinnedIds();
        render();
    }
}
window.addEventListener('dognav:settings', event => applyHomeConfig(event.detail));
document.getElementById('editDock').addEventListener('click', event => {
    dockEditing = !dockEditing;
    event.currentTarget.textContent = dockEditing ? '完成' : '编辑常用';
    event.currentTarget.setAttribute('aria-pressed', String(dockEditing));
    document.getElementById('dockEditActions').hidden = !dockEditing;
    renderDock();
});
document.getElementById('addDock').addEventListener('click', () => openAllView());
document.getElementById('resetDock').addEventListener('click', () => {
    if (!confirm('恢复管理员推荐的常用入口？你的自定义顺序将被替换。')) return;
    if (!previewMode) localStorage.removeItem('dognav-pinned');
    personalPins = false;
    pinned = defaultPinnedIds();
    renderDock();
});
