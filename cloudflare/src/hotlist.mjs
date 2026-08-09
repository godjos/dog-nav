// ═══════════════════════════════════════════
// DogNav 热榜聚合（Worker 端；Express 端为 lib/hotlist.js，逻辑保持一致）
// 从官方公开接口抓取各平台热榜，统一输出 [{ title, url, hot }]。
// 上游固定为白名单域名，不接受用户传入 URL，无 SSRF 面。
//
// 缓存规则（持久化 SWR，store 由调用方注入：Express 为 sql.js，Worker 为 D1）：
//   - 10 分钟内：直接返回新鲜缓存。
//   - 10 分钟至 24 小时：立即返回 stale:true，后台执行一次合并刷新。
//   - 超过 24 小时或从未成功：等待实时抓取；失败抛错由路由返回 502。
//   - forceRefresh（管理后台）：绕过新鲜缓存并等待抓取结果。
// 成功后持久化榜单并清零失败数；失败时仅保存标准错误码，不保存原始响应。
// ═══════════════════════════════════════════

const HOT_CACHE_TTL_MS = 10 * 60 * 1000;                    // 新鲜期：10 分钟
const HOT_CACHE_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;       // 陈旧缓存硬上限：24 小时
const UPSTREAM_TIMEOUT_MS = 8000;
const UPSTREAM_RETRY_DELAY_MS = 250;
const RETRYABLE_UPSTREAM_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const UPSTREAM_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MAX_ITEMS = 30;
const MIN_ITEMS = 5;

// 上游响应结构不符预期（空榜、风控页、JSON 解析失败）统一归为 INVALID_PAYLOAD
function invalidPayload(message) {
    const err = new Error(message);
    err.hotErrorCode = 'INVALID_PAYLOAD';
    return err;
}

// 失败原因归类为标准错误码；只存错误码，不存原始响应
function hotErrorCode(err) {
    if (err && err.hotErrorCode) return err.hotErrorCode;
    if (err && err.upstreamStatus) return `HTTP_${err.upstreamStatus}`;
    if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'TIMEOUT';
    if (err && err.name === 'SyntaxError') return 'INVALID_PAYLOAD'; // JSON.parse 失败
    return 'NETWORK';
}

async function fetchText(url, init = {}) {
    // 参考 NewsNow 的有限重试，但只重试网络错误和瞬时状态码；403 等确定性
    // 风控错误立即失败，避免把一次请求拖成多次无效撞墙。
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
            const resp = await fetch(url, {
                ...init,
                signal: controller.signal,
                headers: {
                    'User-Agent': UPSTREAM_UA,
                    'Accept': 'application/json, text/html;q=0.9',
                    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                    // 上游域名作为默认 Referer：B站等接口对无 Referer 的
                    // 数据中心 IP 直接风控（412/403），可被 init.headers 覆盖
                    'Referer': new URL(url).origin + '/',
                    ...(init.headers || {}),
                },
            });
            if (!resp.ok) {
                const err = new Error(`upstream status ${resp.status}`);
                err.upstreamStatus = resp.status;
                throw err;
            }
            return await resp.text();
        } catch (err) {
            const retryable = !err.upstreamStatus || RETRYABLE_UPSTREAM_STATUSES.has(err.upstreamStatus);
            if (attempt === 1 || !retryable) throw err;
        } finally {
            clearTimeout(timer);
        }
        await new Promise(resolve => setTimeout(resolve, UPSTREAM_RETRY_DELAY_MS));
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

// ── 知乎热榜：使用 NewsNow 同款 JSON 接口；billboard HTML 对服务器 IP 返回 403 ──
async function fetchZhihu() {
    const data = await fetchJSON('https://www.zhihu.com/api/v3/feed/topstory/hot-list-web?limit=30&desktop=true', {
        headers: { 'Referer': 'https://www.zhihu.com/hot' },
    });
    const list = data?.data;
    if (!Array.isArray(list) || list.length === 0) throw invalidPayload('zhihu hot list empty');
    return list.slice(0, MAX_ITEMS).map(it => ({
        title: it?.target?.title_area?.text || '',
        url: it?.target?.link?.url || '',
        // metrics_area.text 已是本地化文案（如 "1234 万热度"），原样透传
        hot: it?.target?.metrics_area?.text || '',
    })).filter(x => x.title && /^https?:\/\//.test(x.url));
}

// ── 微博热搜 ──
async function fetchWeibo() {
    const data = await fetchJSON('https://weibo.com/ajax/side/hotSearch');
    const list = data?.data?.realtime;
    if (!Array.isArray(list) || list.length === 0) throw invalidPayload('weibo hot list empty');
    return list.filter(it => !it.is_ad).slice(0, MAX_ITEMS).map(it => ({
        title: it.word || it.note || '',
        url: `https://s.weibo.com/weibo?q=${encodeURIComponent(it.word || '')}`,
        hot: Number(it.raw_hot) || 0,
    })).filter(x => x.title);
}

// ── B站全站热榜：Referer 必须是 www.bilibili.com，API 域名做 Referer 会被 -352 风控 ──
async function fetchBilibili() {
    const data = await fetchJSON('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', {
        headers: { 'Referer': 'https://www.bilibili.com/' },
    });
    if (data?.code !== 0) throw invalidPayload(`bilibili code ${data?.code}`);
    const list = data?.data?.list;
    if (!Array.isArray(list) || list.length === 0) throw invalidPayload('bilibili hot list empty');
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
    if (items.length === 0) throw invalidPayload('ithome hot list empty');
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
    if (!Array.isArray(list) || list.length === 0) throw invalidPayload('36kr hot list empty');
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
    if (!Array.isArray(list) || list.length === 0) throw invalidPayload('sspai hot list empty');
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

const hotCache = new Map();    // source -> { data, updatedMs }；内存层，持久层见注入的 store
const hotInFlight = new Map(); // source -> Promise；前台抓取与后台 SWR 刷新共用，合并并发

// 持久层接口（由运行时注入）：
//   read(source)            -> row | null
//   readAll()               -> row[]
//   writeSuccess(source, payloadJson, nowIso)
//   writeFailure(source, errorCode, nowIso)
// row = { source, payload, updated_at, last_attempt_at, last_error_code, consecutive_failures }

// 使用持久化 JSON 前重新验证来源、条目数量、标题和 HTTP(S) URL；损坏缓存视为不存在
function validateCachedPayload(source, json) {
    let data;
    try {
        data = typeof json === 'string' ? JSON.parse(json) : json;
    } catch {
        return null;
    }
    if (!data || data.source !== source) return null;
    if (!Array.isArray(data.items) || data.items.length < MIN_ITEMS) return null;
    for (const it of data.items) {
        if (!it || typeof it.title !== 'string' || !it.title) return null;
        if (!/^https?:\/\//.test(String(it.url || ''))) return null;
    }
    return { source, name: data.name, items: data.items, updated: data.updated };
}

async function readStoredCache(source, store) {
    try {
        const row = await store.read(source);
        if (!row || !row.payload || !row.updated_at) return null;
        const data = validateCachedPayload(source, row.payload);
        const updatedMs = Date.parse(row.updated_at);
        if (!data || !Number.isFinite(updatedMs)) return null; // 损坏缓存视为不存在
        return { data, updatedMs };
    } catch (err) {
        console.error(`[hotlist] ${source} store read failed: ${err && err.message}`);
        return null;
    }
}

// 抓取成功：更新内存层 + 持久化并清零失败数；失败：仅记录标准错误码
async function refreshSource(source, entry, store) {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    try {
        const items = await entry.fetch();
        if (items.length < MIN_ITEMS) throw invalidPayload(`${source} returned too few items`); // 多半是风控页
        const data = { source, name: entry.name, items, updated: nowIso };
        hotCache.set(source, { data, updatedMs: now });
        if (store) {
            try {
                await store.writeSuccess(source, JSON.stringify(data), nowIso);
            } catch (err) {
                console.error(`[hotlist] ${source} store writeSuccess failed: ${err && err.message}`);
            }
        }
        return data;
    } catch (err) {
        // 打日志便于 wrangler tail / 服务端排查具体是 403/412 还是解析失败
        const code = hotErrorCode(err);
        console.error(`[hotlist] ${source} fetch failed: ${code} (${err && err.message})`);
        if (store) {
            try {
                await store.writeFailure(source, code, nowIso);
            } catch (storeErr) {
                console.error(`[hotlist] ${source} store writeFailure failed: ${storeErr && storeErr.message}`);
            }
        }
        throw err;
    }
}

function defaultDefer(promise) {
    // 后台刷新失败已在 refreshSource 里记录日志与错误码，这里只吞掉避免 unhandled rejection
    promise.catch(() => {});
}

// 后台执行一次合并刷新：同一来源同时只跑一个上游请求
function scheduleBackgroundRefresh(source, entry, store, defer) {
    if (hotInFlight.has(source)) return;
    const request = refreshSource(source, entry, store);
    hotInFlight.set(source, request);
    const done = request.finally(() => {
        if (hotInFlight.get(source) === request) hotInFlight.delete(source);
    });
    defer(done);
}

// getHotList(source, { store, forceRefresh, defer })
// 返回 { source, name, items, updated, stale? }；未知源返回 null；
// 超过 24 小时或从未成功且实时抓取失败时抛错（路由返回 502，不展示更旧热点）。
async function getHotList(source, options = {}) {
    const entry = HOT_SOURCES[source];
    if (!entry) return null;
    const { store = null, forceRefresh = false, defer = defaultDefer } = options;
    const now = Date.now();

    let cached = hotCache.get(source);
    if (!cached && store) {
        // 冷启动 / 跨模块：回退到持久层（sql.js / D1）里的最后成功榜单
        cached = await readStoredCache(source, store);
        if (cached) hotCache.set(source, cached);
    }
    const age = cached ? now - cached.updatedMs : Infinity;

    if (!forceRefresh && age < HOT_CACHE_TTL_MS) return cached.data; // 10 分钟内：新鲜缓存
    if (!forceRefresh && age < HOT_CACHE_STALE_LIMIT_MS) {
        // 10 分钟至 24 小时：立即返回陈旧数据，后台执行一次合并刷新
        scheduleBackgroundRefresh(source, entry, store, defer);
        return { ...cached.data, stale: true };
    }

    // 超过 24 小时 / 从未成功 / 强制刷新：等待实时抓取结果
    const inFlight = hotInFlight.get(source);
    if (inFlight) return inFlight;
    const request = refreshSource(source, entry, store);
    hotInFlight.set(source, request);
    try {
        return await request;
    } finally {
        if (hotInFlight.get(source) === request) hotInFlight.delete(source);
    }
}

// 管理后台热榜健康状态：只读持久层，绝不主动访问上游
// status: fresh（≤10 分钟）| stale（≤24 小时）| unavailable（>24 小时或无可用缓存）| never（从未成功）
async function getHotStatus(store) {
    const now = Date.now();
    const rows = {};
    if (store) {
        try {
            for (const row of await store.readAll()) rows[row.source] = row;
        } catch (err) {
            console.error(`[hotlist] status store readAll failed: ${err && err.message}`);
        }
    }
    return Object.entries(HOT_SOURCES).map(([source, { name }]) => {
        const row = rows[source] || null;
        const updatedMs = row && row.updated_at ? Date.parse(row.updated_at) : NaN;
        const usable = !!row && Number.isFinite(updatedMs) &&
            !!validateCachedPayload(source, row.payload || '');
        let status;
        if (usable) {
            const age = now - updatedMs;
            status = age < HOT_CACHE_TTL_MS ? 'fresh'
                : age < HOT_CACHE_STALE_LIMIT_MS ? 'stale' : 'unavailable';
        } else {
            status = row && row.last_attempt_at ? 'unavailable' : 'never';
        }
        return {
            source,
            name,
            status,
            updated: usable ? row.updated_at : null,
            lastAttempt: (row && row.last_attempt_at) || null,
            consecutiveFailures: (row && row.consecutive_failures) || 0,
            lastErrorCode: (row && row.last_error_code) || null,
        };
    });
}

export {
    HOT_SOURCES,
    HOT_CACHE_TTL_MS,
    HOT_CACHE_STALE_LIMIT_MS,
    getHotList,
    getHotStatus,
    validateCachedPayload,
    hotErrorCode,
};
