// ═══════════════════════════════════════════
// DogNav 首页脚本（Kaka 式轻量首页）
// 站点设置（favicon、标题、主题色、页脚、投稿/天气开关）由
// /js/settings-loader.js 统一加载；本文件含天气组件交互逻辑。
// 视图层级：分类行（全部+分类+更多/抽屉）与内容模式行（精选/热门/
// 最新/收藏/最近/热榜）互斥；默认只展示「推荐」分类；热榜仅在进入
// 热榜模式后加载。
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// THEME — persisted across pages via localStorage
// ═══════════════════════════════════════════
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
let initialCatResolved = false; // 首屏默认分类（推荐 → 第一个有效分类）只解析一次

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
        img.style.cssText = 'width:36px;height:36px;border-radius:10px;object-fit:cover';
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

function buildCardGrid(items) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    items.forEach(s => {
        const card = buildCard(s);
        if (card) grid.appendChild(card);
    });
    return grid;
}

function render() {
    if (!sitesLoaded) return; // 数据未就绪：保留加载/错误态，不覆盖
    const a = document.getElementById('cardsArea');
    a.textContent = '';

    updateNavHighlight();
    buildTagNav();

    // 热榜视图与站点数据无关，走独立渲染分支（仅此刻才请求热榜接口）
    if (curView === 'trending') { renderTrending(a); initReveal(); return; }

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
// HOT LIST — 热榜模式（服务端聚合代理 /api/hot/:source）
// 仅在用户进入「热榜」模式后加载，不再默认展开六源数据
// ═══════════════════════════════════════════
const HOT_SOURCES_UI = [
    { id: 'zhihu', label: '知乎热榜' },
    { id: 'weibo', label: '微博热搜' },
    { id: 'bilibili', label: 'B站热榜' },
    { id: 'ithome', label: 'IT之家' },
    { id: '36kr', label: '36氪' },
    { id: 'sspai', label: '少数派' },
];
const hotDataCache = new Map(); // source -> { data, expires }（5 分钟；服务端另有 10 分钟缓存）
const hotRequests = new Map();  // source -> Promise；复用同一请求
const HOT_CLIENT_TTL_MS = 5 * 60 * 1000;
let curHotSource = localStorage.getItem('dognav-hot-source') || 'zhihu';

async function loadHot(source) {
    const hit = hotDataCache.get(source);
    if (hit && hit.expires > Date.now()) return hit.data;
    const pending = hotRequests.get(source);
    if (pending) return pending;
    const request = fetchJSON('/api/hot/' + encodeURIComponent(source)).then(data => {
        hotDataCache.set(source, { data, expires: Date.now() + HOT_CLIENT_TTL_MS });
        return data;
    }).finally(() => {
        if (hotRequests.get(source) === request) hotRequests.delete(source);
    });
    hotRequests.set(source, request);
    return request;
}

// 热度值：知乎已是文案（如 "1234 万热度"）原样透传；数字做万位缩写
function formatHotVal(v) {
    if (typeof v === 'string') return v;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return '';
    return n >= 10000 ? `${(n / 10000).toFixed(1).replace(/\.0$/, '')} 万` : String(n);
}

function renderTrending(a) {
    a.appendChild(buildSecHead('📈', '热榜'));

    if (!HOT_SOURCES_UI.some(s => s.id === curHotSource)) curHotSource = HOT_SOURCES_UI[0].id;

    // 源切换 pill
    const bar = document.createElement('div');
    bar.className = 'hot-src-bar rv vis';
    HOT_SOURCES_UI.forEach(s => {
        const btn = document.createElement('button');
        btn.className = 'cat-pill' + (s.id === curHotSource ? ' on' : '');
        btn.textContent = s.label;
        btn.addEventListener('click', () => {
            curHotSource = s.id;
            localStorage.setItem('dognav-hot-source', s.id);
            render();
        });
        bar.appendChild(btn);
    });
    a.appendChild(bar);

    // 异步数据只写入 holder：render() 重渲染时旧 holder 已脱离文档，天然防竞态
    const holder = document.createElement('div');
    holder.className = 'hot-list';
    const loading = document.createElement('div');
    loading.className = 'area-note';
    loading.textContent = '加载中…';
    holder.appendChild(loading);
    a.appendChild(holder);

    // 固定本次渲染对应的 source，避免用户快速切换时错误地清理另一个来源。
    const source = curHotSource;
    loadHot(source).then(data => {
        holder.textContent = '';
        const items = Array.isArray(data.items) ? data.items : [];
        items.forEach((it, i) => {
            const url = sanitizeUrl(it.url);
            if (!url || !it.title) return;
            const row = document.createElement('a');
            row.className = 'hot-item rv vis';
            row.href = url;
            row.target = '_blank';
            row.rel = 'noopener';
            const rank = document.createElement('span');
            rank.className = 'hot-rank' + (i < 3 ? ' top' : '');
            rank.textContent = String(i + 1);
            const title = document.createElement('span');
            title.className = 'hot-title';
            title.textContent = it.title;
            row.append(rank, title);
            const hotText = formatHotVal(it.hot);
            if (hotText) {
                const hot = document.createElement('span');
                hot.className = 'hot-val';
                hot.textContent = hotText;
                row.appendChild(hot);
            }
            holder.appendChild(row);
        });
        if (!holder.hasChildNodes()) {
            holder.appendChild(buildNote('该榜单暂无数据。'));
            return;
        }
        const updated = parseUtcTime(data.updated);
        if (data.stale || updated) {
            const meta = document.createElement('div');
            meta.className = 'hot-meta';
            meta.textContent = (data.stale ? '数据可能不是最新 · ' : '') +
                (updated ? `更新于 ${updated.toLocaleString('zh-CN')}` : '');
            holder.appendChild(meta);
        }
    }).catch(() => {
        // 一次上游失败不再永久隐藏入口，让用户明确看到状态并可单源重试。
        hotDataCache.delete(source);
        holder.textContent = '';
        const label = HOT_SOURCES_UI.find(s => s.id === source)?.label || '该榜单';
        holder.appendChild(buildNote(`${label}暂时无法更新。`, null, null, '重新加载', () => {
            hotDataCache.delete(source);
            if (curView === 'trending' && curHotSource === source) render();
        }));
    });
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
        [['baidu', '百度搜'], ['google', 'Google 搜']].forEach(([eng, label]) => {
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

// 引擎选择器：内嵌输入框左侧的自定义下拉
(function initEngineSelect() {
    const currentBtn = document.getElementById('engCurrent');
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
        currentBtn.setAttribute('aria-expanded', 'true');
    }
    function closeMenu() {
        menu.hidden = true;
        currentBtn.setAttribute('aria-expanded', 'false');
    }

    currentBtn.addEventListener('click', () => {
        if (menu.hidden) openMenu(); else closeMenu();
    });
    menu.addEventListener('click', e => {
        const opt = e.target.closest('.eng-option'); if (!opt) return;
        curE = opt.dataset.engine;
        currentBtn.textContent = E[curE].n;
        closeMenu();
        searchInput.focus();
    });
    document.addEventListener('click', e => {
        if (!e.target.closest('.eng-select')) closeMenu();
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
// MOBILE NAV + CATEGORY DRAWER
// ═══════════════════════════════════════════
document.getElementById('mobBtn').addEventListener('click', () => document.getElementById('navLinks').classList.toggle('open'));

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
// WEATHER — 顶栏紧凑入口：点击定位并获取（服务端代理 /api/weather），
// 再次点击展开/收起详情浮层
// ═══════════════════════════════════════════
(function initWeather() {
    const widget = document.getElementById('weatherWidget');
    if (!widget) return;
    const btn = document.getElementById('weatherBtn');
    const pop = document.getElementById('weatherContent');
    let loaded = false;
    let loading = false;

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
        pop.textContent = '';
        const msg = document.createElement('div');
        msg.className = 'weather-loading';
        msg.textContent = text;
        pop.appendChild(msg);
        if (canRetry) {
            const retry = document.createElement('button');
            retry.type = 'button';
            retry.className = 'note-btn';
            retry.textContent = '重试';
            retry.addEventListener('click', () => { pop.hidden = true; requestWeather(); });
            pop.appendChild(retry);
        }
    }

    function renderWeather(d) {
        pop.textContent = '';
        if (d.city) {
            const city = document.createElement('div');
            city.className = 'weather-city';
            city.textContent = '📍 ' + d.city;
            pop.appendChild(city);
        }
        const main = document.createElement('div');
        main.className = 'weather-main';
        const icon = document.createElement('span');
        icon.className = 'weather-icon';
        icon.textContent = iconEmoji(d.icon);
        const temp = document.createElement('span');
        temp.className = 'weather-temp';
        temp.textContent = d.temp + '°';
        main.append(icon, temp);
        pop.appendChild(main);
        const desc = document.createElement('div');
        desc.className = 'weather-desc';
        desc.textContent = d.text + ' · 体感 ' + d.feelsLike + '°';
        pop.appendChild(desc);
        const details = document.createElement('div');
        details.className = 'weather-details';
        const humidity = document.createElement('span');
        humidity.textContent = '💧 湿度 ' + d.humidity + '%';
        const wind = document.createElement('span');
        wind.textContent = '🌬️ ' + d.windDir + ' ' + d.windScale + '级';
        details.append(humidity, wind);
        pop.appendChild(details);

        // 顶栏按钮紧凑显示：图标 + 温度（+城市）
        btn.textContent = `${iconEmoji(d.icon)} ${d.temp}°${d.city ? ' ' + d.city : ''}`;
        btn.title = `${d.text} · 体感 ${d.feelsLike}°`;
        btn.classList.add('fetched');
        loaded = true;
    }

    function fetchWeather(lat, lon) {
        showMsg('加载天气中...', false);
        pop.hidden = false;
        fetch('/api/weather', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lat, lon })
        }).then(res => {
            if (res.ok) return res.json().then(renderWeather);
            if (res.status === 404 || res.status === 503) {
                // 天气功能被关闭或未配置：隐藏入口
                widget.classList.remove('show');
                pop.hidden = true;
                return;
            }
            // 502 / 其他错误：允许重试
            showMsg('天气暂不可用', true);
        }).catch(() => {
            showMsg('天气暂不可用', true);
        }).finally(() => {
            loading = false;
        });
    }

    function requestWeather() {
        if (loading) return;
        if (!navigator.geolocation) {
            pop.hidden = false;
            showMsg('定位被拒绝', false);
            return;
        }
        loading = true;
        pop.hidden = false;
        showMsg('定位中...', false);
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
            () => { loading = false; pop.hidden = false; showMsg('定位被拒绝', false); },
            { timeout: 8000, maximumAge: 300000 }
        );
    }

    btn.addEventListener('click', () => {
        if (!loaded && !loading) { requestWeather(); return; }
        pop.hidden = !pop.hidden;
    });
    document.addEventListener('click', e => {
        if (!widget.contains(e.target) && !pop.hidden) pop.hidden = true;
    });
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
    const trend = document.createElement('button');
    trend.type = 'button';
    trend.className = 'drawer-item';
    trend.dataset.view = 'trending';
    trend.textContent = '📈 热榜';
    drawerModes.appendChild(trend);

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
})();
