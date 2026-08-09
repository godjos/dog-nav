// deploy.js 可信发布流程的单元测试 — 全部注入假 exec / 假 fetch，
// 不发起真实网络或进程调用。
const test = require('node:test');
const assert = require('node:assert/strict');

const {
    createRun,
    extractWorkerUrl,
    extractLatestDeploymentId,
    createVerifier,
    shouldRollback,
    HOT_SOURCES,
} = require('../deploy.js');

const SILENT = () => {};

// ─── run 执行器 ─────────────────────────────────────────────────────────────

test('run: 命令成功时返回 stdout（trim 后）', () => {
    const run = createRun(() => 'some output\n', { log: SILENT });
    assert.equal(run('echo hi'), 'some output');
});

test('run: 非零退出默认 throw，摘要含 stdout/stderr', () => {
    const err = new Error('exit 1');
    err.stdout = 'partial output';
    err.stderr = 'boom happened';
    const run = createRun(() => { throw err; }, { log: SILENT });
    assert.throws(() => run('false'), /命令执行失败: false/);
    assert.throws(() => run('false'), /boom happened/);
});

test('run: allowFailure 探测模式不 throw，返回合并输出', () => {
    const err = new Error('exit 1');
    err.stdout = 'whoami out';
    err.stderr = 'not logged in';
    const run = createRun(() => { throw err; }, { log: SILENT });
    const out = run('npx wrangler whoami', { allowFailure: true });
    assert.match(out, /whoami out/);
    assert.match(out, /not logged in/);
});

// ─── extractWorkerUrl ───────────────────────────────────────────────────────

test('extractWorkerUrl: 从典型 wrangler deploy 输出提取 URL', () => {
    const out = [
        ' ⛅️ wrangler 4.20.0',
        '───────────────────',
        'Uploaded dognav (3.21 sec)',
        'Deployed dognav triggers (1.02 sec)',
        '  https://dognav.ccgg.workers.dev',
        'Current Version ID: 9f2c1a2b-0000-0000-0000-abcdefabcdef',
        '',
    ].join('\n');
    assert.equal(extractWorkerUrl(out), 'https://dognav.ccgg.workers.dev');
});

test('extractWorkerUrl: 输出中没有 URL 时返回 null', () => {
    assert.equal(extractWorkerUrl('Uploaded dognav\nDeployed dognav triggers'), null);
    assert.equal(extractWorkerUrl(''), null);
    assert.equal(extractWorkerUrl(null), null);
});

// ─── extractLatestDeploymentId ──────────────────────────────────────────────

test('extractLatestDeploymentId: 取最新一条的 id；坏输入返回 null', () => {
    const json = JSON.stringify([
        { id: 'old-version', created_on: '2026-08-01T00:00:00Z' },
        { id: 'new-version', created_on: '2026-08-09T00:00:00Z' },
    ]);
    assert.equal(extractLatestDeploymentId(json), 'new-version');
    assert.equal(extractLatestDeploymentId('not json'), null);
    assert.equal(extractLatestDeploymentId('[]'), null);
});

// ─── 验证器（注入假 fetch）─────────────────────────────────────────────────

function fakeResponse(status, body, contentType = 'application/json') {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        status,
        headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : null) },
        text: async () => text,
    };
}

// 默认全部通过的路由；overrides 以 URL 路径结尾匹配，返回替代响应
function makeFetch(overrides = {}) {
    return async (url) => {
        const u = String(url);
        for (const [suffix, res] of Object.entries(overrides)) {
            if (u.endsWith(suffix)) return typeof res === 'function' ? res() : res;
        }
        if (u.endsWith('/')) return fakeResponse(200, '<!doctype html><title>DogNav</title>', 'text/html; charset=utf-8');
        if (u.endsWith('/api/settings')) return fakeResponse(200, { site_name: 'DogNav' });
        if (u.endsWith('/api/hot/not-a-source')) return fakeResponse(400, { error: 'Unknown hot list source' });
        const m = u.match(/\/api\/hot\/(\w+)$/);
        if (m) return fakeResponse(200, { source: m[1], items: [1, 2, 3, 4, 5] });
        throw new Error(`unexpected url: ${u}`);
    };
}

function makeVerifier(fetchImpl) {
    return createVerifier({ fetchImpl, retryDelayMs: 0, sources: HOT_SOURCES });
}

test('验证器: 全部通过时 coreFailures 与 sourceFailures 均为空', async () => {
    const result = await makeVerifier(makeFetch())('https://dognav.ccgg.workers.dev');
    assert.deepEqual(result.coreFailures, []);
    assert.deepEqual(result.sourceFailures, {});
    assert.equal(shouldRollback(result), false);
});

test('验证器: / 返回 500 → coreFailures 非空，判定应回滚', async () => {
    const result = await makeVerifier(makeFetch({ '/': fakeResponse(500, 'err', 'text/html') }))('https://x.workers.dev');
    assert.ok(result.coreFailures.length > 0);
    assert.ok(result.coreFailures.some((f) => f.includes('GET /')));
    assert.equal(shouldRollback(result), true);
});

test('验证器: /api/hot/not-a-source 返回 200（而非 400）→ 核心失败', async () => {
    const result = await makeVerifier(makeFetch({
        '/api/hot/not-a-source': fakeResponse(200, { source: 'not-a-source', items: [] }),
    }))('https://x.workers.dev');
    assert.ok(result.coreFailures.some((f) => f.includes('not-a-source') && f.includes('400')));
    assert.equal(shouldRollback(result), true);
});

test('验证器: 单个外部源 502 → 只进 sourceFailures，不触发回滚', async () => {
    const result = await makeVerifier(makeFetch({ '/api/hot/zhihu': fakeResponse(502, 'Bad Gateway') }))('https://x.workers.dev');
    assert.deepEqual(result.coreFailures, []);
    assert.equal(shouldRollback(result), false);
    assert.deepEqual(Object.keys(result.sourceFailures), ['zhihu']);
    assert.match(result.sourceFailures.zhihu, /502/);
});

test('验证器: 外部源 items 不足 5 条 → 判失败', async () => {
    const result = await makeVerifier(makeFetch({
        '/api/hot/weibo': fakeResponse(200, { source: 'weibo', items: [1, 2, 3] }),
    }))('https://x.workers.dev');
    assert.deepEqual(result.coreFailures, []);
    assert.deepEqual(Object.keys(result.sourceFailures), ['weibo']);
    assert.match(result.sourceFailures.weibo, /不足 5 条/);
});

test('验证器: source 字段与请求源不一致 → 判失败', async () => {
    const result = await makeVerifier(makeFetch({
        '/api/hot/36kr': fakeResponse(200, { source: 'sspai', items: [1, 2, 3, 4, 5] }),
    }))('https://x.workers.dev');
    assert.deepEqual(Object.keys(result.sourceFailures), ['36kr']);
    assert.match(result.sourceFailures['36kr'], /source 字段不匹配/);
});

test('验证器: 失败的源重试三轮，第三轮恢复则判通过', async () => {
    let calls = 0;
    const fetchImpl = makeFetch({
        '/api/hot/ithome': () => {
            calls += 1;
            if (calls < 3) return fakeResponse(502, 'Bad Gateway');
            return fakeResponse(200, { source: 'ithome', items: [1, 2, 3, 4, 5] });
        },
    });
    const result = await makeVerifier(fetchImpl)('https://x.workers.dev');
    assert.equal(calls, 3, 'ithome 应被请求三轮');
    assert.deepEqual(result.sourceFailures, {});
});

test('验证器: 重试间隔来自 retryDelayMs（sleepImpl 可注入）', async () => {
    const delays = [];
    const sleepImpl = async (ms) => { delays.push(ms); };
    const verify = createVerifier({
        fetchImpl: makeFetch({ '/api/hot/sspai': fakeResponse(503, 'nope') }),
        retryDelayMs: 1234,
        sources: ['sspai'],
        sleepImpl,
    });
    const result = await verify('https://x.workers.dev');
    assert.deepEqual(Object.keys(result.sourceFailures), ['sspai']);
    assert.deepEqual(delays, [1234, 1234], '三轮共两次间隔');
});
