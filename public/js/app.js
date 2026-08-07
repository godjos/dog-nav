// ═══════════════════════════════════════════
// DogNav 首页脚本
// 站点设置（favicon、标题、主题色、页脚、投稿/天气开关）由
// /js/settings-loader.js 统一加载；本文件含天气组件交互逻辑。
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// THEME — persisted across pages via localStorage
// ══════════════════════════════════════════
const H = document.documentElement;
const savedTheme = localStorage.getItem('dognav-theme');
if (savedTheme) H.setAttribute('data-theme', savedTheme);

document.getElementById('themeBtn').addEventListener('click', () => {
    const next = H.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    // Briefly disable transitions to avoid jank from 150+ cards
    H.classList.add('notransition');
    H.setAttribute('data-theme', next);
    localStorage.setItem('dognav-theme', next);
    requestAnimationFrame(() => {
        requestAnimationFrame(() => H.classList.remove('notransition'));
    });
});

// ═══════════════════════════════════════════
// DATA — 站点与分类只来自后端 API，无硬编码回退
// ═══════════════════════════════════════════
const S = []; // GET /api/sites（仅 status === 'active'）

const E = {
    baidu: { u: 'https://www.baidu.com/s?wd=', n: '百度' },
    google: { u: 'https://www.google.com/search?q=', n: 'Google' },
    bing: { u: 'https://www.bing.com/search?q=', n: 'Bing' },
    github: { u: 'https://github.com/search?q=', n: 'GitHub' },
    bilibili: { u: 'https://search.bilibili.com/all?keyword=', n: 'B站' },
    zhihu: { u: 'https://www.zhihu.com/search?type=content&q=', n: '知乎' },
};

const C = {}; // GET /api/categories → { id: { i, l } }

const VIEW_META = {
    featured: { i: '⭐', l: '编辑精选' },
    hot: { i: '🔥', l: '热门' },
    new: { i: '🆕', l: '最近新增' },
    fav: { i: '❤️', l: '我的收藏' },
    recent: { i: '🕘', l: '最近访问' },
};

let curE = 'baidu', curC = 'all', curView = 'all', curTag = null;
let sitesLoaded = false; // /api/sites 成功返回后才为 true

// ═══════════════════════════════════════════
// LOCAL STORAGE — 收藏与最近访问（无账号）
// ═══════════════════════════════════════════
function loadJSON(key, fallback) {
    try {
        const v = JSON.parse(localStorage.getItem(key));
        return v === null || v === undefined ? fallback : v;
    } catch { return fallback; }
}

let favs = loadJSON('dognav-favorites', []);
if (!Array.isArray(favs)) favs = [];
let recent = loadJSON('dognav-recent', []);
if (!Array.isArray(recent)) recent = [];

function saveFavs() { localStorage.setItem('dognav-favorites', JSON.stringify(favs)); }
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
    localStorage.setItem('dognav-recent', JSON.stringify(recent));
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
// favicon 加载失败时的回退图标：按站名 hash 取柔和底色 + 首字母，
// 圆角方块与卡片图标位对齐（避免圆形占位与容器形状冲突）。
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

function buildCard(s) {
    const name = s.name;
    const url = sanitizeUrl(s.url);
    // 名称缺失或 URL 非法（非 http/https）时不渲染该卡片
    if (!name || !url) return null;
    const desc = s.description || '';
    const icon = s.icon || '🌐';
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
    const fav = document.createElement('div');
    fav.className = 'card-fav';

    // 只有明确是 URL（http(s)://、站内绝对路径、data:image/）的图标才走 <img>；
    // emoji、字母等文本图标直接按文本渲染——否则会被 sanitizeUrl 解析成同源
    // 相对地址，每张卡片白走一次 404 再落回兜底
    const isUrlIcon = typeof icon === 'string' && /^(https?:\/\/|\/|data:image\/)/i.test(icon);
    const iconUrl = isUrlIcon
        ? (sanitizeUrl(icon) || (icon.startsWith('data:image/') ? icon : null))
        : null;
    if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.style.cssText = 'width:26px;height:26px;border-radius:6px;object-fit:cover';
        img.onerror = () => { img.onerror = null; img.src = iconFallbackUri(name); };
        fav.appendChild(img);
    } else {
        // 文本图标（emoji / 字母等），isUrlIcon 已排除 URL 形态
        fav.textContent = icon || '🌐';
    }

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

function render() {
    if (!sitesLoaded) return; // 数据未就绪：保留加载/错误态，不覆盖
    const a = document.getElementById('cardsArea');
    a.textContent = '';

    if (S.length === 0) {
        a.appendChild(buildNote('暂无站点，欢迎投稿。', '去投稿 →', 'contribute.html'));
        return;
    }

    let items = S.filter(siteMatchesFilters);

    if (curView === 'all') {
        // 按分类分组展示
        const g = {};
        items.forEach(s => { if (!g[s.category]) g[s.category] = []; g[s.category].push(s); });
        const orderedKeys = [...new Set([...Object.keys(C), ...Object.keys(g)])].filter(k => g[k]);
        for (const k of orderedKeys) {
            const c = C[k] || { i: '📁', l: k };
            a.appendChild(buildSecHead(c.i, c.l));
            const grid = document.createElement('div');
            grid.className = 'card-grid';
            g[k].forEach(s => {
                const card = buildCard(s);
                if (card) grid.appendChild(card);
            });
            a.appendChild(grid);
        }
    } else {
        const byId = new Map(S.map(s => [String(s.id), s]));
        if (curView === 'hot') {
            items = [...items].sort((x, y) => (y.click_count || 0) - (x.click_count || 0));
        } else if (curView === 'new') {
            items = [...items].sort((x, y) => parseSqliteTime(y.created_at) - parseSqliteTime(x.created_at));
        } else if (curView === 'fav') {
            items = favs.map(id => byId.get(String(id))).filter(s => s && siteMatchesFilters(s));
        } else if (curView === 'recent') {
            items = recent.map(r => byId.get(String(r.id))).filter(s => s && siteMatchesFilters(s));
        }

        if (items.length === 0) {
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
        const grid = document.createElement('div');
        grid.className = 'card-grid';
        items.forEach(s => {
            const card = buildCard(s);
            if (card) grid.appendChild(card);
        });
        a.appendChild(grid);
    }

    // 「全部」视图 + 筛选条件下也可能为空
    if (!a.hasChildNodes()) {
        a.appendChild(buildNote('没有符合当前筛选条件的站点。', null, null, '清除筛选', clearFilters));
        return;
    }

    initReveal();
}

function clearFilters() {
    curC = 'all';
    curView = 'all';
    curTag = null;
    document.querySelectorAll('.cat-pill').forEach(x => x.classList.toggle('on', x.dataset.cat === 'all'));
    document.querySelectorAll('.view-pill').forEach(x => x.classList.toggle('on', x.dataset.view === 'all'));
    updateTagChip();
    render();
}

// ═══════════════════════════════════════════
// SEARCH — 站内优先 + 外部引擎兜底
// ═══════════════════════════════════════════
const searchInput = document.getElementById('searchInput');
const searchPanel = document.getElementById('searchPanel');
const searchBox = searchInput.closest('.search-box');
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

function siteMatchesQuery(s, ql) {
    const fields = [s.name, s.description, s.category, (C[s.category] || {}).l];
    if (Array.isArray(s.tags)) s.tags.forEach(t => fields.push(t.name));
    return fields.some(f => typeof f === 'string' && f.toLowerCase().includes(ql));
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

    const matches = S.filter(s => siteMatchesQuery(s, ql)).slice(0, 10);
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
        [['baidu', '百度搜'], ['google', 'Google 搜']].forEach(([eng, label], i) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'sr-ext-btn';
            btn.textContent = `${label}「${q}」`;
            const item = { kind: 'ext', url: E[eng].u + encodeURIComponent(q), el: btn };
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
    if (q) window.open(E[curE].u + encodeURIComponent(q), '_blank', 'noopener');
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

document.getElementById('engRow').addEventListener('click', e => {
    const b = e.target.closest('.eng-btn'); if (!b) return;
    document.querySelectorAll('.eng-btn').forEach(x => x.classList.remove('on'));
    b.classList.add('on'); curE = b.dataset.engine;
    searchInput.placeholder = `在 ${E[curE].n} 中搜索...`;
});

// ═══════════════════════════════════════════
// CATEGORY / VIEW / TAG FILTER
// ═══════════════════════════════════════════
document.getElementById('catBar').addEventListener('click', e => {
    const p = e.target.closest('.cat-pill'); if (!p) return;
    document.querySelectorAll('.cat-pill').forEach(x => x.classList.remove('on'));
    p.classList.add('on'); curC = p.dataset.cat; render();
});

document.getElementById('viewBar').addEventListener('click', e => {
    const p = e.target.closest('.view-pill'); if (!p) return;
    document.querySelectorAll('.view-pill').forEach(x => x.classList.remove('on'));
    p.classList.add('on'); curView = p.dataset.view; render();
});

function setTagFilter(tag) {
    if (curTag && String(curTag.id) === String(tag.id) && curTag.name === tag.name) {
        curTag = null; // 再点一次取消
    } else {
        curTag = { id: tag.id, name: tag.name };
    }
    updateTagChip();
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
    x.addEventListener('click', () => { curTag = null; updateTagChip(); render(); });
    chip.append(label, x);
}

// ═══════════════════════════════════════════
// MOBILE NAV
// ═══════════════════════════════════════════
document.getElementById('mobBtn').addEventListener('click', () => document.getElementById('navLinks').classList.toggle('open'));

// ═══════════════════════════════════════════
// REVEAL
// ═══════════════════════════════════════════
function initReveal() {
    document.querySelectorAll('.rv').forEach(el => el.classList.add('vis'));
}

// ═══════════════════════════════════════════
// WEATHER — 用户主动点击才请求定位与天气（服务端代理 /api/weather）
// ═══════════════════════════════════════════
(function initWeather() {
    const widget = document.getElementById('weatherWidget');
    if (!widget) return;
    const btn = document.getElementById('weatherBtn');
    const content = document.getElementById('weatherContent');
    const msg = document.getElementById('weatherMsg');

    // 和风天气图标代码 → emoji（只取前两位大类，避免引用第三方图标资源）
    function iconEmoji(code) {
        const n = parseInt(code, 10);
        if (n === 100) return '☀️';
        if (n === 101 || n === 102 || n === 103) return '⛅';
        if (n === 104) return '☁️';
        if (n >= 300 && n < 400) return '🌧️';
        if (n >= 400 && n < 500) return '🌨️';
        if (n >= 500 && n < 600) return '🌫️';
        if (n >= 600 && n < 700) return '🌪️';
        return '🌡️';
    }

    function showMsg(text, canRetry) {
        content.hidden = true;
        msg.hidden = false;
        msg.textContent = text;
        btn.hidden = !canRetry;
        if (canRetry) btn.textContent = '重试';
    }

    function renderWeather(d) {
        msg.hidden = true;
        btn.hidden = true;
        content.hidden = false;
        const cityEl = document.getElementById('weatherCity');
        if (d.city) {
            cityEl.hidden = false;
            cityEl.textContent = '📍 ' + d.city;
        } else {
            cityEl.hidden = true;
            cityEl.textContent = '';
        }
        document.getElementById('weatherIcon').textContent = iconEmoji(d.icon);
        document.getElementById('weatherTemp').textContent = d.temp + '°';
        document.getElementById('weatherDesc').textContent = d.text + ' · 体感 ' + d.feelsLike + '°';
        document.getElementById('weatherHumidity').textContent = '💧 湿度 ' + d.humidity + '%';
        document.getElementById('weatherWind').textContent = '🌬️ ' + d.windDir + ' ' + d.windScale + '级';
    }

    function fetchWeather(lat, lon) {
        msg.hidden = false;
        msg.textContent = '加载天气中...';
        btn.hidden = true;
        fetch('/api/weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lon })
        }).then(res => {
            if (res.ok) return res.json().then(renderWeather);
            if (res.status === 404 || res.status === 503) {
                // 天气功能被关闭或未配置：隐藏组件
                widget.classList.remove('show');
                return;
            }
            // 502 / 其他错误：允许重试
            showMsg('天气暂不可用', true);
        }).catch(() => {
            showMsg('天气暂不可用', true);
        });
    }

    btn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            showMsg('定位被拒绝', false);
            return;
        }
        msg.hidden = false;
        msg.textContent = '定位中...';
        btn.hidden = true;
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
            () => showMsg('定位被拒绝', false), // 用户拒绝：静态提示，不重试、不回退 IP 定位
            { timeout: 8000, maximumAge: 300000 }
        );
    });
})();

// ═══════════════════════════════════════════
// HITOKOTO
// ═══════════════════════════════════════════
(async () => {
    const el = document.getElementById('hitokoto');
    try {
        const r = await fetch('https://v1.hitokoto.cn/');
        const d = await r.json();
        el.textContent = `"${d.hitokoto}" `;
        const cite = document.createElement('cite');
        cite.textContent = `— ${d.from || '未知'}`;
        el.appendChild(cite);
    } catch {
        el.textContent = '"连接每一个节点"';
    }
})();

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
// CLEAR LOCAL DATA — 清除收藏与最近访问（保留主题）
// ═══════════════════════════════════════════
document.getElementById('clearLocalData').addEventListener('click', () => {
    if (!window.confirm('确定清除本地保存的收藏与最近访问记录吗？（主题设置会保留）')) return;
    localStorage.removeItem('dognav-favorites');
    localStorage.removeItem('dognav-recent');
    favs = [];
    recent = [];
    render();
    toast('本地数据已清除');
});

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

function applyCategories(apiCats) {
    Object.keys(C).forEach(k => delete C[k]);
    apiCats.filter(c => c.is_active).forEach(c => {
        C[c.id] = { i: c.icon || '📁', l: c.name };
    });

    const bar = document.getElementById('catBar');
    bar.textContent = '';
    const allBtn = document.createElement('button');
    allBtn.className = 'cat-pill' + (curC === 'all' ? ' on' : '');
    allBtn.dataset.cat = 'all';
    allBtn.textContent = '🔥 全部';
    bar.appendChild(allBtn);
    apiCats.filter(c => c.is_active).forEach(c => {
        const btn = document.createElement('button');
        btn.className = 'cat-pill' + (curC === c.id ? ' on' : '');
        btn.dataset.cat = c.id;
        btn.textContent = `${c.icon || '📁'} ${c.name}`;
        bar.appendChild(btn);
    });
}

function showCatBarError() {
    const bar = document.getElementById('catBar');
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
        const a = document.getElementById('cardsArea');
        a.textContent = '';
        a.appendChild(buildNote('数据加载失败。', null, null, '点击重试', loadData));
        return;
    }

    S.length = 0;
    sitesR.value.filter(s => s.status === 'active').forEach(s => S.push(s));
    sitesLoaded = true;
    render();
}

(async function initCMS() {
    await loadData();

    // ?q=xxx — 与 index.html 的 SearchAction JSON-LD 对齐：自动填入并执行站内搜索
    const q = new URLSearchParams(window.location.search).get('q');
    if (q) {
        searchInput.value = q;
        updateSearchPanel();
    }

    try {
        // Fetch custom pages for navbar "更多" dropdown
        const pagesRes = await fetch('/api/pages');
        if (pagesRes.ok) {
            const pages = await pagesRes.json();
            const customPages = pages.filter(p => !['about','links','contribute'].includes(p.id));
            if (customPages.length > 0) {
                const dropdown = document.getElementById('moreDropdown');
                const menu = document.getElementById('moreDropdownMenu');
                menu.textContent = '';
                customPages.forEach(p => {
                    const link = document.createElement('a');
                    link.href = '/page.html?slug=' + encodeURIComponent(p.id);
                    link.textContent = p.title || p.id;
                    menu.appendChild(link);
                });
                dropdown.style.display = '';
            }
        }
    } catch (err) {
        // Pages dropdown stays hidden
    }

    // Auto-hide category bar scrollbar until scrolling or hovering
    function initCatBarScroll() {
        const bar = document.getElementById('catBar');
        if (!bar) return;
        let scrollTimeout;
        bar.addEventListener('scroll', () => {
            bar.classList.add('show-scroll');
            clearTimeout(scrollTimeout);
            scrollTimeout = setTimeout(() => bar.classList.remove('show-scroll'), 1000);
        });
    }
    initCatBarScroll();
})();
