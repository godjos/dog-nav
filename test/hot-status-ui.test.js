const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');

const healthHtml = fs.readFileSync(path.join(projectRoot, 'public/admin/health.html'), 'utf8');
const healthJs = fs.readFileSync(path.join(projectRoot, 'public/admin/js/health.js'), 'utf8');

test('health.html: contains hot-source table container and status badge classes', () => {
    // 6 行由 JS 渲染，这里只断言容器存在
    assert.match(healthHtml, /id="hotStatusBody"/);
    assert.match(healthHtml, /热榜来源/);
    // 表头：来源 / 状态 / 最后成功 / 最后尝试 / 失败次数 / 操作
    for (const col of ['来源', '状态', '最后成功', '最后尝试', '失败次数', '操作']) {
        assert.ok(healthHtml.includes(`<th>${col}</th>`), `missing column: ${col}`);
    }
    for (const cls of ['badge-fresh', 'badge-stale', 'badge-unavailable', 'badge-never']) {
        assert.ok(healthHtml.includes(`.${cls}`), `missing badge class: ${cls}`);
    }
});

test('health.js: calls hot-status list and per-source refresh endpoints', () => {
    assert.match(healthJs, /\/api\/admin\/hot-status/);
    // POST /api/admin/hot-status/<source>/refresh（模板拼接或等价形式）
    assert.match(healthJs, /\/api\/admin\/hot-status\/\$\{[^}]+\}\/refresh/);
    // 读取接口走 GET（不带 method），刷新必须 POST
    assert.match(healthJs, /method:\s*'POST'/);
    // 带鉴权头，与页面其它请求一致
    assert.match(healthJs, /authHeaders\(\)/);
});

test('health.js: renders four status labels with localized time and recheck button', () => {
    for (const label of ['新鲜', '陈旧', '不可用', '从未成功']) {
        assert.ok(healthJs.includes(label), `missing status label: ${label}`);
    }
    assert.match(healthJs, /toLocaleString/);
    assert.ok(healthJs.includes('重新检测'), 'missing recheck button text');
    // null 时间显示为 "-"
    assert.match(healthJs, /if \(!iso\) return '-'/);
});
