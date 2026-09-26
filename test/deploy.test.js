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
        if (u.endsWith('/')) return fakeResponse(200, '<!doctype html><title>Mirza</title>', 'text/html; charset=utf-8');
        if (u.endsWith('/api/settings')) return fakeResponse(200, { site_name: 'Mirza' });
        throw new Error(`unexpected url: ${u}`);
    };
}

function makeVerifier(fetchImpl) {
    return createVerifier({ fetchImpl });
}

test('验证器: 全部通过时 coreFailures 为空', async () => {
    const result = await makeVerifier(makeFetch())('https://dognav.ccgg.workers.dev');
    assert.deepEqual(result.coreFailures, []);
    assert.equal(shouldRollback(result), false);
});

test('验证器: / 返回 500 → coreFailures 非空，判定应回滚', async () => {
    const result = await makeVerifier(makeFetch({ '/': fakeResponse(500, 'err', 'text/html') }))('https://x.workers.dev');
    assert.ok(result.coreFailures.length > 0);
    assert.ok(result.coreFailures.some((f) => f.includes('GET /')));
    assert.equal(shouldRollback(result), true);
});

test('验证器: /api/settings 非 JSON → 核心失败', async () => {
    const result = await makeVerifier(makeFetch({
        '/api/settings': fakeResponse(200, '<html>nope</html>', 'text/html'),
    }))('https://x.workers.dev');
    assert.ok(result.coreFailures.some((f) => f.includes('/api/settings')));
    assert.equal(shouldRollback(result), true);
});
