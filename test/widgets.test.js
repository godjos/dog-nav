const { test } = require('node:test');
const assert = require('node:assert/strict');
const initSqlJs = require('sql.js');
const { validateWidget, widgetData } = require('../lib/widgets');

function row(id, type, config) { return { id, type, config_json: JSON.stringify(config) }; }
function response(data, status = 200, headers = {}) {
    return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
}
function memoryCache() {
    const rows = new Map();
    return { read: async id => rows.get(id), write: async (id, config_json, data_json, fetched_at) => rows.set(id, { config_json, data_json, fetched_at }) };
}

test('widget validation accepts four bounded public adapters', () => {
    const base = { site_id: null, visibility: 'public', enabled: true, sort_order: 0 };
    for (const [type, config] of Object.entries({
        github: { owner: 'octocat', repo: 'Hello-World' },
        uptimekuma: { url: 'https://status.example.org', slug: 'home' },
        custom_json: { url: 'https://api.example.org/data', mappings: [{ label: 'Count', path: 'stats.count' }] },
        weather: { latitude: 31.2, longitude: 121.5 },
    })) assert.equal(validateWidget({ ...base, type, config }).type, type);
    assert.throws(() => validateWidget({ ...base, type: 'custom_json', config: { url: 'http://localhost/data', mappings: [{ label: 'x', path: 'x' }] } }));
    assert.throws(() => validateWidget({ ...base, type: 'custom_json', config: { url: 'https://api.example.org/?token=abc', mappings: [{ label: 'x', path: 'x' }] } }));
    assert.throws(() => validateWidget({ ...base, type: 'custom_json', config: { url: 'https://api.example.org/', mappings: Array(5).fill({ label: 'x', path: 'x' }) } }));
});

test('GitHub adapter normalizes response fields and caches for five minutes', async () => {
    let calls = 0;
    const fetchMock = async (url, options) => {
        calls++;
        assert.equal(url, 'https://api.github.com/repos/octocat/Hello-World');
        assert.equal(options.redirect, 'manual');
        return response({ stargazers_count: 123, forks_count: 4, open_issues_count: 2, private: false });
    };
    const widget = row(9001, 'github', { owner: 'octocat', repo: 'Hello-World' });
    const cache = memoryCache();
    const result = await widgetData(widget, fetchMock, cache);
    assert.equal(result.state, 'ok');
    assert.deepEqual(result.fields.map(f => f.value), [123, 4, 2]);
    assert.ok(result.updated_at);
    assert.deepEqual(await widgetData(widget, fetchMock, cache), result);
    assert.equal(calls, 1);
});

test('Kuma picks the latest heartbeat; custom JSON preserves upstream values', async () => {
    const kuma = row(9002, 'uptimekuma', { url: 'https://status.example.org', slug: 'home' });
    const kumaData = await widgetData(kuma, async () => response({ heartbeatList: {
        '1': [{ status: 0, time: '2026-01-01' }, { status: 1, time: '2026-01-02' }],
        '2': [{ status: 1, time: '2026-01-01' }, { status: 0, time: '2026-01-02' }],
    } }), memoryCache());
    assert.equal(kumaData.state, 'degraded');
    assert.deepEqual(kumaData.fields.map(f => f.value), [1, 2]);
    const custom = row(9003, 'custom_json', { url: 'https://api.example.org', mappings: [{ label: 'Users', path: 'stats.users' }, { label: 'Active', path: 'active' }] });
    const customData = await widgetData(custom, async () => response({ stats: { users: 12 }, active: true }), memoryCache());
    assert.deepEqual(customData.fields.map(f => f.value), [12, true]);
});

test('failed, redirected and oversized upstream responses never fabricate metrics', async () => {
    const widget = row(9004, 'custom_json', { url: 'https://api.example.org', mappings: [{ label: 'Value', path: 'value' }] });
    const cache = memoryCache();
    const bad = await widgetData(widget, async () => response({ value: 99 }, 302), cache);
    assert.deepEqual(bad, { id: 9004, state: 'error', fields: [], updated_at: null });
    const large = await widgetData(widget, async () => response({ value: 99 }, 200, { 'content-length': '300000' }), cache);
    assert.equal(large.state, 'error');
    const missing = await widgetData(widget, async () => response({ missing: true }), cache);
    assert.equal(missing.state, 'error');
});

test('SQLite cache survives module reload and serves stale data on refresh failure', async () => {
    const SQL = await initSqlJs();
    const db = new SQL.Database();
    db.run('CREATE TABLE dashboard_widget_cache (widget_id INTEGER PRIMARY KEY, config_json TEXT, data_json TEXT, fetched_at INTEGER)');
    const persistentCache = {
        async read(id) {
            const stmt = db.prepare('SELECT * FROM dashboard_widget_cache WHERE widget_id=?');
            stmt.bind([id]);
            const value = stmt.step() ? stmt.getAsObject() : null;
            stmt.free();
            return value;
        },
        async write(id, configJson, dataJson, time) {
            db.run('INSERT OR REPLACE INTO dashboard_widget_cache VALUES (?,?,?,?)', [id, configJson, dataJson, time]);
        },
    };
    const widget = row(9005, 'weather', { latitude: 31.2, longitude: 121.5 });
    const fresh = await widgetData(widget, async (url) => {
        assert.ok(url.startsWith('https://api.open-meteo.com/v1/forecast?'));
        return response({ current: { temperature_2m: 20, relative_humidity_2m: 60, wind_speed_10m: 8 } });
    }, persistentCache);
    assert.equal(fresh.state, 'ok');
    assert.deepEqual(fresh.fields.map(f => f.value), [20, 60, 8]);
    const modulePath = require.resolve('../lib/widgets');
    delete require.cache[modulePath];
    const reloadedData = require('../lib/widgets').widgetData;
    assert.deepEqual(await reloadedData(widget, async () => { throw new Error('must use DB cache'); }, persistentCache), fresh);
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try {
        const stale = await reloadedData(widget, async () => { throw new Error('offline'); }, persistentCache);
        assert.equal(stale.state, 'stale');
        assert.deepEqual(stale.fields, fresh.fields);
        assert.equal(stale.updated_at, fresh.updated_at);
    } finally { Date.now = realNow; db.close(); }
});
