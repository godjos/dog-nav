// ═══════════════════════════════════════════
// DogNav 热榜聚合（Worker 端；Express 端为 lib/hotlist.js）
// 从官方公开接口抓取各平台热榜，统一输出 [{ title, url, hot }]。
// 上游固定为白名单域名，不接受用户传入 URL，无 SSRF 面。
// 抓取失败：有旧缓存则回退陈旧数据（stale: true），否则抛错由路由返回 502。
// ═══════════════════════════════════════════

const HOT_CACHE_TTL_MS = 10 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 8000;
const UPSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_ITEMS = 30;

async function fetchText(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
        const resp = await fetch(url, {
            ...init,
            signal: controller.signal,
            headers: {
                'User-Agent': UPSTREAM_UA,
                'Accept': 'application/json, text/html;q=0.9',
                ...(init.headers || {}),
            },
        });
        if (!resp.ok) throw new Error(`upstream status ${resp.status}`);
        return await resp.text();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJSON(url, init) {
    return JSON.parse(await fetchText(url, init));
}

// HTML 抓取的标题可能带实体，解码最常见的几种
function decodeEntities(s) {
    return String(s)
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;|&apos;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&');
}

// ── 知乎热榜：billboard 页内嵌 js-initialData JSON ──
async function fetchZhihu() {
    const html = await fetchText('https://www.zhihu.com/billboard');
    const m = html.match(/<script id="js-initialData" type="text\/json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('zhihu initialData not found');
    const data = JSON.parse(m[1]);
    const list = data?.initialState?.topstory?.hotList;
    if (!Array.isArray(list) || list.length === 0) throw new Error('zhihu hot list empty');
    return list.slice(0, MAX_ITEMS).map(it => ({
        title: it?.title?.text || '',
        url: it?.link?.url || '',
        // metricsArea.text 已是本地化文案（如 "1234 万热度"），原样透传
        hot: it?.metricsArea?.text || '',
    })).filter(x => x.title && /^https?:\/\//.test(x.url));
}

// ── 微博热搜 ──
async function fetchWeibo() {
    const data = await fetchJSON('https://weibo.com/ajax/side/hotSearch');
    const list = data?.data?.realtime;
    if (!Array.isArray(list) || list.length === 0) throw new Error('weibo hot list empty');
    return list.filter(it => !it.is_ad).slice(0, MAX_ITEMS).map(it => ({
        title: it.word || it.note || '',
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(it.word || '')}`,
        hot: Number(it.raw_hot) || 0,
    })).filter(x => x.title);
}

// ── B站全站热榜 ──
async function fetchBilibili() {
    const data = await fetchJSON('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all');
    if (data?.code !== 0) throw new Error(`bilibili code ${data?.code}`);
    const list = data?.data?.list;
    if (!Array.isArray(list) || list.length === 0) throw new Error('bilibili hot list empty');
    return list.slice(0, MAX_ITEMS).map(it => ({
        title: it.title || '',
        url: it.bvid ? `https://www.bilibili.com/video/${it.bvid}` : '',
        hot: Number(it?.stat?.view) || 0,
    })).filter(x => x.title && x.url);
}

// ── IT之家热榜：移动版 rankm 页服务端渲染，按 placeholder 块解析 ──
async function fetchIthome() {
    const html = await fetchText('https://m.ithome.com/rankm/');
    const items = [];
    // 按 placeholder 块切分，避免跨块误匹配
    for (const chunk of html.split('<div class="placeholder').slice(1)) {
        const idM = chunk.match(/data-news-id="(\d+)"/);
        const titleM = chunk.match(/plc-title">([^<]+)/);
        if (!idM || !titleM) continue;
        const id = idM[1];
        const hotM = chunk.match(/review-num">(\d+)/);
        items.push({
            title: decodeEntities(titleM[1]).trim(),
            url: `https://www.ithome.com/0/${id.slice(0, 3)}/${id.slice(3)}.htm`,
            hot: hotM ? Number(hotM[1]) : 0, // 评论数
        });
        if (items.length >= MAX_ITEMS) break;
    }
    if (items.length === 0) throw new Error('ithome hot list empty');
    return items;
}

// ── 36氪人气榜：gateway POST（接口形态参考 DailyHotApi）──
async function fetch36kr() {
    const data = await fetchJSON('https://gateway.36kr.com/api/mis/nav/home/nav/rank/hot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Referer': 'https://36kr.com/' },
        body: JSON.stringify({ partner_id: 'wap', param: { siteId: 1, platformId: 2 }, timestamp: Date.now() }),
    });
    const list = data?.data?.hotRankList;
    if (!Array.isArray(list) || list.length === 0) throw new Error('36kr hot list empty');
    return list.slice(0, MAX_ITEMS).map(it => ({
        title: it?.templateMaterial?.widgetTitle || '',
        url: it.itemId ? `https://www.36kr.com/p/${it.itemId}` : '',
        hot: Number(it?.templateMaterial?.statRead) || Number(it?.templateMaterial?.statCollect) || 0,
    })).filter(x => x.title && x.url);
}

// ── 少数派热门文章 ──
async function fetchSspai() {
    const data = await fetchJSON('https://sspai.com/api/v1/article/tag/page/get?limit=30&tag=' + encodeURIComponent('热门文章'));
    const list = data?.data;
    if (!Array.isArray(list) || list.length === 0) throw new Error('sspai hot list empty');
    return list.slice(0, MAX_ITEMS).map(it => ({
        title: it.title || '',
        url: it.id ? `https://sspai.com/post/${it.id}` : '',
        hot: Number(it.like_count) || 0,
    })).filter(x => x.title && x.url);
}

const HOT_SOURCES = {
    zhihu: { name: '知乎热榜', fetch: fetchZhihu },
    weibo: { name: '微博热搜', fetch: fetchWeibo },
    bilibili: { name: 'B站热榜', fetch: fetchBilibili },
    ithome: { name: 'IT之家', fetch: fetchIthome },
    '36kr': { name: '36氪', fetch: fetch36kr },
    sspai: { name: '少数派', fetch: fetchSspai },
};

const hotCache = new Map(); // source -> { data, expires }

// 返回 { source, name, items, updated, stale? }；未知源返回 null；上游失败且无缓存时抛错
async function getHotList(source) {
    const entry = HOT_SOURCES[source];
    if (!entry) return null;
    const now = Date.now();
    const cached = hotCache.get(source);
    if (cached && cached.expires > now) return cached.data;
    try {
        const items = await entry.fetch();
        if (items.length < 5) throw new Error(`${source} returned too few items`); // 多半是风控页
        const data = { source, name: entry.name, items, updated: new Date(now).toISOString() };
        hotCache.set(source, { data, expires: now + HOT_CACHE_TTL_MS });
        return data;
    } catch (err) {
        // 上游挂了但有旧数据：回退陈旧缓存，标注 stale
        if (cached) return { ...cached.data, stale: true };
        throw err;
    }
}

export { HOT_SOURCES, getHotList };
