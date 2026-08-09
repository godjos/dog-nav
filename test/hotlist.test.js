const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const projectRoot = path.resolve(__dirname, '..');

async function loadRuntime(runtime) {
    if (runtime === 'express') {
        const modulePath = require.resolve('../lib/hotlist');
        delete require.cache[modulePath];
        return require(modulePath);
    }
    const moduleUrl = pathToFileURL(path.join(projectRoot, 'cloudflare/src/hotlist.mjs'));
    moduleUrl.search = `test=${Date.now()}-${Math.random()}`;
    return import(moduleUrl.href);
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function zhihuItems(count = 5) {
    return Array.from({ length: count }, (_, index) => ({
        target: {
            title_area: { text: `知乎话题 ${index + 1}` },
            link: { url: `https://www.zhihu.com/question/${1000 + index}` },
            metrics_area: { text: `${index + 1} 万热度` },
        },
    }));
}

function weiboItems(count = 5) {
    return Array.from({ length: count }, (_, index) => ({
        word: `微博话题 ${index + 1}`,
        raw_hot: 10000 + index,
    }));
}

// ── 持久化 SWR 缓存：共享 fake store 与 payload 构造 ──

function createMemoryStore() {
    const rows = new Map();
    return {
        rows,
        async read(source) { return rows.get(source) || null; },
        async readAll() { return [...rows.values()]; },
        async writeSuccess(source, payload, nowIso) {
            rows.set(source, {
                source, payload,
                updated_at: nowIso, last_attempt_at: nowIso,
                last_error_code: null, consecutive_failures: 0,
            });
        },
        async writeFailure(source, errorCode, nowIso) {
            const prev = rows.get(source);
            rows.set(source, {
                source,
                payload: prev ? prev.payload : null,
                updated_at: prev ? prev.updated_at : null,
                last_attempt_at: nowIso,
                last_error_code: errorCode,
                consecutive_failures: (prev ? prev.consecutive_failures : 0) + 1,
            });
        },
    };
}

function seedRow(store, source, ageMs, payload) {
    const updated = new Date(Date.now() - ageMs).toISOString();
    store.rows.set(source, {
        source,
        payload: payload === undefined ? payloadFor(source, 6, updated) : payload,
        updated_at: updated, last_attempt_at: updated,
        last_error_code: null, consecutive_failures: 0,
    });
}

function payloadFor(source, count = 6, updated = new Date().toISOString()) {
    return JSON.stringify({
        source, name: source, updated,
        items: Array.from({ length: count }, (_, i) => ({
            title: `条目 ${i + 1}`, url: `https://example.com/${i}`, hot: i,
        })),
    });
}

function weiboFetch() {
    return async () => jsonResponse({ data: { realtime: weiboItems() } });
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

for (const runtime of ['express', 'worker']) {
    test(`${runtime}: Zhihu uses the JSON hot-list endpoint`, async () => {
        const originalFetch = global.fetch;
        const urls = [];
        global.fetch = async (url) => {
            urls.push(String(url));
            return jsonResponse({ data: zhihuItems() });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('zhihu');
            assert.equal(result.items.length, 5);
            assert.match(urls[0], /\/api\/v3\/feed\/topstory\/hot-list-web/);
            assert.equal(result.items[0].url, 'https://www.zhihu.com/question/1000');
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: bilibili uses ranking/v2 when it succeeds`, async () => {
        const originalFetch = global.fetch;
        const urls = [];
        global.fetch = async (url) => {
            urls.push(String(url));
            return jsonResponse({ code: 0, data: { list: [
                { title: '排行榜视频', bvid: 'BV1rank', stat: { view: 100 } },
                { title: '条目2', bvid: 'BV2', stat: { view: 99 } },
                { title: '条目3', bvid: 'BV3', stat: { view: 98 } },
                { title: '条目4', bvid: 'BV4', stat: { view: 97 } },
                { title: '条目5', bvid: 'BV5', stat: { view: 96 } },
            ] } });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('bilibili');
            assert.equal(urls.length, 1, 'ranking 成功时不再请求 popular');
            assert.match(urls[0], /ranking\/v2/);
            assert.deepEqual(result.items[0], {
                title: '排行榜视频',
                url: 'https://www.bilibili.com/video/BV1rank',
                hot: 100,
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: bilibili falls back to popular when ranking is risk-controlled (-352)`, async () => {
        const originalFetch = global.fetch;
        const urls = [];
        global.fetch = async (url) => {
            urls.push(String(url));
            if (String(url).includes('ranking/v2')) {
                return jsonResponse({ code: -352, message: '-352', ttl: 1 });
            }
            return jsonResponse({ code: 0, data: { list: [
                { title: '热门视频', bvid: 'BV1hot', stat: { view: 123456 } },
                { title: '条目2', bvid: 'BV2', stat: { view: 99 } },
                { title: '条目3', bvid: 'BV3', stat: { view: 98 } },
                { title: '条目4', bvid: 'BV4', stat: { view: 97 } },
                { title: '条目5', bvid: 'BV5', stat: { view: 96 } },
            ] } });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('bilibili');
            assert.equal(urls.length, 2, 'ranking 被风控后回退 popular');
            assert.match(urls[0], /ranking\/v2/);
            assert.match(urls[1], /popular/);
            assert.deepEqual(result.items[0], {
                title: '热门视频',
                url: 'https://www.bilibili.com/video/BV1hot',
                hot: 123456,
            });
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: bilibili rejects when both endpoints fail`, async () => {
        const originalFetch = global.fetch;
        global.fetch = async () => jsonResponse({ code: -352, message: '-352', ttl: 1 });
        try {
            const { getHotList } = await loadRuntime(runtime);
            await assert.rejects(getHotList('bilibili'), /bilibili code -352/);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: retries one transient upstream failure`, async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            return calls === 1
                ? new Response('busy', { status: 503 })
                : jsonResponse({ data: { realtime: weiboItems() } });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('weibo');
            assert.equal(result.items.length, 5);
            assert.equal(calls, 2);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: does not retry a deterministic 403`, async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            return new Response('blocked', { status: 403 });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            await assert.rejects(getHotList('weibo'), /upstream status 403/);
            assert.equal(calls, 1);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: coalesces concurrent requests for the same source`, async () => {
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = async () => {
            calls += 1;
            await new Promise(resolve => setTimeout(resolve, 10));
            return jsonResponse({ data: { realtime: weiboItems() } });
        };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const [first, second] = await Promise.all([
                getHotList('weibo'),
                getHotList('weibo'),
            ]);
            assert.equal(first.items.length, 5);
            assert.deepEqual(second, first);
            assert.equal(calls, 1);
        } finally {
            global.fetch = originalFetch;
        }
    });
}

test('front-end does not permanently hide a source after one failure', () => {
    const app = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');
    assert.doesNotMatch(app, /hotFailed/);
    assert.match(app, /重新加载/);
});

// ── 持久化 SWR 缓存行为：Express 与 Worker 模块跑同一组用例 ──

for (const runtime of ['express', 'worker']) {
    test(`${runtime}: fresh persisted cache (<10min) is served without fetching`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 5 * MIN);
        const originalFetch = global.fetch;
        global.fetch = async () => { throw new Error('fetch must not be called'); };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('weibo', { store });
            assert.equal(result.items.length, 6);
            assert.equal(result.stale, undefined);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: 10-minute boundary returns stale and triggers one merged background refresh`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 10 * MIN); // 恰好过新鲜期
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = async () => { calls += 1; return jsonResponse({ data: { realtime: weiboItems() } }); };
        const deferred = [];
        try {
            const { getHotList } = await loadRuntime(runtime);
            const opts = { store, defer: (p) => deferred.push(p) };
            const [first, second] = await Promise.all([
                getHotList('weibo', opts),
                getHotList('weibo', opts),
            ]);
            assert.equal(first.stale, true);
            assert.equal(second.stale, true);
            assert.equal(first.items.length, 6); // 旧缓存内容
            await Promise.all(deferred);
            assert.equal(calls, 1, '并发陈旧请求只合并刷新一次');
            assert.equal(store.rows.get('weibo').consecutive_failures, 0);
            assert.ok(Date.parse(store.rows.get('weibo').updated_at) > Date.now() - 60 * 1000,
                '后台刷新成功后持久化了新的 updated_at');
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: cache older than 24h waits for live fetch and persists success`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 24 * HOUR); // 恰好过陈旧上限
        const originalFetch = global.fetch;
        global.fetch = weiboFetch();
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('weibo', { store });
            assert.equal(result.stale, undefined); // 实时抓取成功：非 stale
            assert.equal(result.items.length, 5);
            assert.equal(store.rows.get('weibo').consecutive_failures, 0);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: cache older than 24h + upstream failure rejects (502 path, no older fallback)`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 25 * HOUR);
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('blocked', { status: 403 });
        try {
            const { getHotList } = await loadRuntime(runtime);
            await assert.rejects(getHotList('weibo', { store }), /upstream status 403/);
            const row = store.rows.get('weibo');
            assert.equal(row.consecutive_failures, 1);
            assert.equal(row.last_error_code, 'HTTP_403');
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: cold start falls back to persisted payload (cross-module restart)`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 20 * MIN);
        const originalFetch = global.fetch;
        global.fetch = weiboFetch();
        const deferred = [];
        try {
            // 模块刚加载（内存层为空），只能来自持久层
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('weibo', { store, defer: (p) => deferred.push(p) });
            assert.equal(result.stale, true);
            assert.equal(result.items.length, 6);
            await Promise.all(deferred);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: corrupted persisted cache is treated as missing`, async () => {
        const corruptPayloads = [
            'not-json{{{',
            payloadFor('zhihu', 6),                      // 来源不匹配
            payloadFor('weibo', 4),                      // 条目数量不足
            JSON.stringify({ source: 'weibo', items: [   // 非 HTTP(S) URL
                ...Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, url: `https://example.com/${i}` })),
                { title: 'bad', url: 'javascript:alert(1)' },
            ] }),
        ];
        for (const payload of corruptPayloads) {
            const store = createMemoryStore();
            seedRow(store, 'weibo', 2 * MIN, payload);
            const originalFetch = global.fetch;
            let calls = 0;
            global.fetch = async () => { calls += 1; return jsonResponse({ data: { realtime: weiboItems() } }); };
            try {
                const { getHotList } = await loadRuntime(runtime);
                const result = await getHotList('weibo', { store });
                assert.equal(result.items.length, 5, `live fetch used for corrupt payload: ${payload.slice(0, 40)}`);
                assert.ok(calls > 0);
            } finally {
                global.fetch = originalFetch;
            }
        }
    });

    test(`${runtime}: failure counting increments with standard codes, success resets to zero`, async () => {
        const store = createMemoryStore();
        const originalFetch = global.fetch;
        global.fetch = async () => new Response('blocked', { status: 403 });
        try {
            const { getHotList } = await loadRuntime(runtime);
            await assert.rejects(getHotList('weibo', { store, forceRefresh: true }));
            await assert.rejects(getHotList('weibo', { store, forceRefresh: true }));
            let row = store.rows.get('weibo');
            assert.equal(row.consecutive_failures, 2);
            assert.equal(row.last_error_code, 'HTTP_403');
            assert.equal(row.payload, null);

            global.fetch = weiboFetch();
            await getHotList('weibo', { store, forceRefresh: true });
            row = store.rows.get('weibo');
            assert.equal(row.consecutive_failures, 0);
            assert.equal(row.last_error_code, null);
            assert.ok(row.payload, '成功榜单已持久化');
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: forceRefresh bypasses fresh cache and awaits the fetch`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 1 * MIN); // 新鲜缓存
        const originalFetch = global.fetch;
        let calls = 0;
        global.fetch = async () => { calls += 1; return jsonResponse({ data: { realtime: weiboItems() } }); };
        try {
            const { getHotList } = await loadRuntime(runtime);
            const result = await getHotList('weibo', { store, forceRefresh: true });
            assert.equal(calls, 1, '绕过新鲜缓存直接抓取');
            assert.equal(result.items.length, 5);
        } finally {
            global.fetch = originalFetch;
        }
    });

    test(`${runtime}: error codes — TIMEOUT / NETWORK / INVALID_PAYLOAD`, async () => {
        for (const [fetchImpl, expected] of [
            [async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, 'TIMEOUT'],
            [async () => { throw new TypeError('fetch failed'); }, 'NETWORK'],
            [async () => new Response('not json at all', { status: 200 }), 'INVALID_PAYLOAD'],
        ]) {
            const store = createMemoryStore();
            const originalFetch = global.fetch;
            global.fetch = fetchImpl;
            try {
                const { getHotList } = await loadRuntime(runtime);
                await assert.rejects(getHotList('weibo', { store, forceRefresh: true }));
                assert.equal(store.rows.get('weibo').last_error_code, expected,
                    `expected ${expected}`);
            } finally {
                global.fetch = originalFetch;
            }
        }
    });

    test(`${runtime}: getHotStatus maps fresh / stale / unavailable / never`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'zhihu', 5 * MIN);                    // fresh
        seedRow(store, 'weibo', 1 * HOUR);                   // stale
        seedRow(store, 'bilibili', 25 * HOUR);               // unavailable（>24h）
        store.rows.set('ithome', {                           // unavailable（失败且无可用缓存）
            source: 'ithome', payload: null, updated_at: null,
            last_attempt_at: new Date().toISOString(),
            last_error_code: 'HTTP_403', consecutive_failures: 3,
        });
        // 36kr / sspai 无行 → never
        const { getHotStatus } = await loadRuntime(runtime);
        const list = await getHotStatus(store);
        assert.equal(list.length, 6);
        const byStatus = Object.fromEntries(list.map(s => [s.source, s]));
        assert.equal(byStatus.zhihu.status, 'fresh');
        assert.equal(byStatus.weibo.status, 'stale');
        assert.equal(byStatus.bilibili.status, 'unavailable');
        assert.equal(byStatus.ithome.status, 'unavailable');
        assert.equal(byStatus.ithome.consecutiveFailures, 3);
        assert.equal(byStatus.ithome.lastErrorCode, 'HTTP_403');
        assert.equal(byStatus['36kr'].status, 'never');
        assert.equal(byStatus.sspai.status, 'never');
        for (const s of list) {
            for (const f of ['source', 'name', 'status', 'updated', 'lastAttempt', 'consecutiveFailures', 'lastErrorCode']) {
                assert.ok(f in s, `field "${f}" present`);
            }
        }
        assert.equal(byStatus['36kr'].updated, null);
    });

    test(`${runtime}: getHotStatus never touches the upstream`, async () => {
        const store = createMemoryStore();
        seedRow(store, 'weibo', 5 * MIN);
        const originalFetch = global.fetch;
        global.fetch = async () => { throw new Error('fetch must not be called'); };
        try {
            const { getHotStatus } = await loadRuntime(runtime);
            const list = await getHotStatus(store);
            assert.equal(list.find(s => s.source === 'weibo').status, 'fresh');
        } finally {
            global.fetch = originalFetch;
        }
    });
}
