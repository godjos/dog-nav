// API regression suite — pins the current behaviour of server.js.
//
// All API tests live in this ONE file and run sequentially (node:test runs
// top-level tests in a file one at a time) because server.js holds its db as
// a module-level singleton: a second server instance in the same process
// would share the same database. See test/helpers.js.
//
// ORDERING CONSTRAINT: the login rate limiter (lib/auth.js createRateLimiter)
// keys on req.ip and locks for 15 minutes after 5 failures, with no way to
// unlock from outside. The 429 test therefore runs LAST; every test that
// needs a fresh login must come before it.
//
// RATE-LIMIT BUDGET: POST /api/submissions (5/h per IP) and POST /api/reports
// (10/h per IP) have their own limiters, independent of the login limiter and
// of each other. All tests here share one IP (127.0.0.1), so the submissions
// tests below are budgeted to stay within 5 counted POSTs per run — the
// limiter is consulted BEFORE field validation, so even a 400 consumes a
// token (the honeypot path returns before the limiter and is free). For
// reports the limiter runs AFTER reason/detail validation, so 400s are free
// and only valid reports consume. Keep new submission/report POST tests
// within these budgets or they will flap into 429s.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, api, TEST_ADMIN_PASSWORD } = require('./helpers');

let ctx; // { baseUrl, server, close() }
let adminToken; // valid token for admin AFTER password change
let editorToken; // valid token for a non-admin (editor) user
let adminUserId;

before(async () => {
    ctx = await startTestServer();
});

after(async () => {
    await ctx.close();
});

// ── Login ────────────────────────────────────────────────────────────────

test('login: wrong password returns 401', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin', password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid credentials');
});

test('login: correct password returns token/user/mustChangePassword', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin', password: TEST_ADMIN_PASSWORD },
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.token, 'token present');
    assert.equal(res.body.user.username, 'admin');
    assert.equal(res.body.user.role, 'admin');
    // Initial admin is created with must_change_password=1
    assert.equal(res.body.mustChangePassword, true);
    ctx.initialToken = res.body.token;
    adminUserId = res.body.user.id;
});

// ── Forced password change ───────────────────────────────────────────────

test('forced password change: any other API returns 403 password_change_required', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/sites', {
        token: ctx.initialToken,
        body: { name: 'X', url: 'https://x.example', category: 'tools' },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'password_change_required');
});

test('auth/me: reachable while must_change_password=1, reports mustChangePassword=true', async () => {
    // /api/auth/me is exempt from the forced-password-change gate so clients
    // can inspect the account state before changing the password.
    const res = await api(ctx.baseUrl, 'GET', '/api/auth/me', { token: ctx.initialToken });
    assert.equal(res.status, 200);
    assert.equal(res.body.username, 'admin');
    assert.equal(res.body.role, 'admin');
    assert.equal(res.body.mustChangePassword, true);
});

test('forced password change: wrong old password rejected, then change succeeds', async () => {
    const bad = await api(ctx.baseUrl, 'PUT', '/api/auth/password', {
        token: ctx.initialToken,
        body: { oldPassword: 'nope-nope-nope', newPassword: 'NewAdmin123!' },
    });
    assert.equal(bad.status, 401);

    const ok = await api(ctx.baseUrl, 'PUT', '/api/auth/password', {
        token: ctx.initialToken,
        body: { oldPassword: TEST_ADMIN_PASSWORD, newPassword: 'NewAdmin123!' },
    });
    assert.equal(ok.status, 200);

    // Re-login with the new password; mustChangePassword should now be false.
    const login = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin', password: 'NewAdmin123!' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.mustChangePassword, false);
    adminToken = login.body.token;
});

// ── /api/auth/me ─────────────────────────────────────────────────────────

test('auth/me: with token returns 200 with id/username/role/mustChangePassword', async () => {
    const res = await api(ctx.baseUrl, 'GET', '/api/auth/me', { token: adminToken });
    assert.equal(res.status, 200);
    assert.equal(typeof res.body.id, 'number');
    assert.equal(res.body.username, 'admin');
    assert.equal(res.body.role, 'admin');
    assert.equal(res.body.mustChangePassword, false);
});

test('auth/me: without token returns 401', async () => {
    const res = await api(ctx.baseUrl, 'GET', '/api/auth/me');
    assert.equal(res.status, 401);
});

// ── Sites CRUD ───────────────────────────────────────────────────────────

test('sites: POST without auth returns 401; GET is public', async () => {
    const unauth = await api(ctx.baseUrl, 'POST', '/api/sites', {
        body: { name: 'X', url: 'https://x.example', category: 'tools' },
    });
    assert.equal(unauth.status, 401);

    const pub = await api(ctx.baseUrl, 'GET', '/api/sites');
    assert.equal(pub.status, 200);
    assert.ok(Array.isArray(pub.body));
});

test('sites: create / update / delete with auth', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/api/sites', {
        token: adminToken,
        body: { name: 'Test Site', url: 'https://test-site.example', category: 'tools', description: 'crud' },
    });
    assert.equal(created.status, 200);
    // CONTRACT-PIN: 现状行为，后续阶段可能调整 — the endpoint responds with
    // {"id": 0} because last_insert_rowid() is read after the log insert /
    // db export, not after the site insert. The real id is only observable
    // through GET /api/sites.
    assert.equal(created.body.id, 0);
    const listAfterCreate = await api(ctx.baseUrl, 'GET', '/api/sites');
    const createdSite = listAfterCreate.body.find((s) => s.url === 'https://test-site.example');
    assert.ok(createdSite, 'created site visible in public list');
    const id = createdSite.id;

    const updated = await api(ctx.baseUrl, 'PUT', `/api/sites/${id}`, {
        token: adminToken,
        body: { name: 'Test Site v2', url: 'https://test-site.example', category: 'tools', status: 'active' },
    });
    assert.equal(updated.status, 200);

    const list = await api(ctx.baseUrl, 'GET', '/api/sites');
    const site = list.body.find((s) => s.id === id);
    assert.equal(site.name, 'Test Site v2');

    const del = await api(ctx.baseUrl, 'DELETE', `/api/sites/${id}`, { token: adminToken });
    assert.equal(del.status, 200);
    const after = await api(ctx.baseUrl, 'GET', '/api/sites');
    assert.ok(!after.body.some((s) => s.id === id));
});

// ── Site tags (GET /api/sites appends `tags`) ──────────────────────────────

test('sites: GET appends tags — {id,name,color} sorted by name, untagged site gets []', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/api/sites', {
        token: adminToken,
        body: { name: 'Tagged Site', url: 'https://tagged.example', category: 'tools' },
    });
    assert.equal(created.status, 200);
    // CONTRACT-PIN: POST /api/sites responds {"id":0} (see the CRUD test above);
    // resolve the real id through the public list.
    let list = await api(ctx.baseUrl, 'GET', '/api/sites');
    const site = list.body.find((s) => s.url === 'https://tagged.example');
    assert.ok(site, 'created site visible in public list');
    const id = site.id;
    assert.deepEqual(site.tags, [], 'new site has no tags');

    // Two tags in reverse name order, so the name sort is observable.
    for (const [name, color] of [['zz-api-tag', '#111111'], ['aa-api-tag', '#222222']]) {
        const r = await api(ctx.baseUrl, 'POST', '/api/tags', {
            token: adminToken, body: { name, color },
        });
        assert.equal(r.status, 200, `create tag ${name}`);
    }
    const tags = await api(ctx.baseUrl, 'GET', '/api/tags');
    const tagIdAa = tags.body.find((t) => t.name === 'aa-api-tag').id;
    const tagIdZz = tags.body.find((t) => t.name === 'zz-api-tag').id;

    // zz first on the wire — the list must still come back name-sorted.
    const assign = await api(ctx.baseUrl, 'POST', `/api/sites/${id}/tags`, {
        token: adminToken, body: { tag_ids: [tagIdZz, tagIdAa] },
    });
    assert.equal(assign.status, 200);
    assert.equal(assign.body.message, 'Tags updated');

    list = await api(ctx.baseUrl, 'GET', '/api/sites');
    const tagged = list.body.find((s) => s.id === id);
    assert.deepEqual(tagged.tags.map((t) => t.name), ['aa-api-tag', 'zz-api-tag'],
        'tags sorted by tag name');
    for (const t of tagged.tags) {
        assert.equal(typeof t.id, 'number');
        assert.equal(typeof t.name, 'string');
        assert.equal(typeof t.color, 'string');
    }
    assert.deepEqual(tagged.tags.map((t) => t.id), [tagIdAa, tagIdZz]);

    const del = await api(ctx.baseUrl, 'DELETE', `/api/sites/${id}`, { token: adminToken });
    assert.equal(del.status, 200);
});

// ── Batch operations ─────────────────────────────────────────────────────

test('batch: update with a field outside the whitelist returns 400', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/sites/batch', {
        token: adminToken,
        body: { ids: [1], action: 'update', data: { bogus_field: 'x' } },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid field: bogus_field');
});

test('batch: unknown action returns 400', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/sites/batch', {
        token: adminToken,
        body: { ids: [1], action: 'nonsense' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid action');
});

// ── Upload ───────────────────────────────────────────────────────────────

test('upload: .txt file rejected (extension whitelist)', async () => {
    const form = new FormData();
    form.append('file', new Blob(['plain text'], { type: 'text/plain' }), 'evil.txt');
    const res = await fetch(ctx.baseUrl + '/api/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
        body: form,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid file type');
});

test('upload: disguised PNG rejected (magic-byte mismatch)', async () => {
    const form = new FormData();
    form.append('file', new Blob(['not really a png'], { type: 'image/png' }), 'fake.png');
    const res = await fetch(ctx.baseUrl + '/api/upload', {
        method: 'POST',
        headers: { authorization: `Bearer ${adminToken}` },
        body: form,
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'Invalid file content');
});

// ── Security headers ─────────────────────────────────────────────────────

test('security headers: GET / carries all four headers', async () => {
    const res = await fetch(ctx.baseUrl + '/');
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    const csp = res.headers.get('content-security-policy');
    assert.ok(csp && csp.includes("default-src 'self'"), 'CSP present');
});

// ── Submissions ──────────────────────────────────────────────────────────
//
// Rate-limit budget: 5 counted POSTs/h per IP (see file header). Current
// usage: 1 (main flow) + 2 (duplicate) + 1 (invalid category) = 4. The
// honeypot and all GET/PUT calls are free.

test('submissions: submit returns trackingToken, status query hides email, approve with edited name/category creates a site', async () => {
    const submit = await api(ctx.baseUrl, 'POST', '/api/submissions', {
        body: {
            name: 'Submitted Site', url: 'https://submitted.example',
            description: 'from public', category: 'tools',
            submitter_email: 'submitter@example.com',
        },
    });
    assert.equal(submit.status, 200);
    assert.equal(submit.body.message, 'Submission received');
    assert.equal(typeof submit.body.trackingToken, 'string');
    assert.ok(submit.body.trackingToken.length > 0, 'trackingToken present');
    const token = submit.body.trackingToken;

    // Public status lookup by token: exposes review fields, never the email.
    const status = await api(ctx.baseUrl, 'GET', `/api/submissions/status/${token}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.name, 'Submitted Site');
    assert.equal(status.body.url, 'https://submitted.example');
    assert.equal(status.body.status, 'pending');
    assert.ok('review_note' in status.body && 'created_at' in status.body && 'reviewed_at' in status.body);
    assert.ok(!('submitter_email' in status.body), 'status lookup must not leak the email');

    const unauthList = await api(ctx.baseUrl, 'GET', '/api/submissions');
    assert.equal(unauthList.status, 401);

    const list = await api(ctx.baseUrl, 'GET', '/api/submissions', { token: adminToken });
    assert.equal(list.status, 200);
    const sub = list.body.find((s) => s.url === 'https://submitted.example');
    assert.ok(sub, 'submission listed');
    assert.equal(sub.status, 'pending');

    // Approve while editing name + category: the site is created from the
    // edited values, not the original submission.
    const categories = await api(ctx.baseUrl, 'GET', '/api/categories');
    const otherCategory = categories.body.find((c) => c.id !== 'tools');
    assert.ok(otherCategory, 'a second seeded category exists');
    const review = await api(ctx.baseUrl, 'PUT', `/api/submissions/${sub.id}`, {
        token: adminToken,
        body: { status: 'approved', name: 'Submitted Site Edited', category: otherCategory.id },
    });
    assert.equal(review.status, 200);

    const sites = await api(ctx.baseUrl, 'GET', '/api/sites');
    const created = sites.body.find((s) => s.url === 'https://submitted.example');
    assert.ok(created, 'approved submission appears in public site list');
    assert.equal(created.name, 'Submitted Site Edited');
    assert.equal(created.category, otherCategory.id);
});

test('submissions: duplicate normalized URL (pending) returns 409', async () => {
    const first = await api(ctx.baseUrl, 'POST', '/api/submissions', {
        body: { name: 'Dup Site', url: 'https://dup.example/', category: 'tools' },
    });
    assert.equal(first.status, 200);
    ctx.dupToken = first.body.trackingToken;

    const dup = await api(ctx.baseUrl, 'POST', '/api/submissions', {
        body: { name: 'Dup Site Again', url: 'https://dup.example', category: 'tools' },
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error, 'Duplicate submission');
});

test('submissions: honeypot field fakes success and persists nothing', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/submissions', {
        body: { name: 'Bot Site', url: 'https://bot.example', website: 'http://spam.example' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Submission received');
    assert.equal(typeof res.body.trackingToken, 'string', 'fake token included');

    const list = await api(ctx.baseUrl, 'GET', '/api/submissions', { token: adminToken });
    assert.ok(!list.body.some((s) => s.url === 'https://bot.example'), 'honeypot submission not persisted');

    // The fake token resolves to nothing.
    const status = await api(ctx.baseUrl, 'GET', `/api/submissions/status/${res.body.trackingToken}`);
    assert.equal(status.status, 404);
});

test('submissions: unknown category returns 400 "Invalid category"', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/submissions', {
        body: { name: 'Bad Category', url: 'https://bad-category.example', category: 'no-such-category' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid category');
});

test('submissions: reject stores review_note, visible via public status query', async () => {
    const list = await api(ctx.baseUrl, 'GET', '/api/submissions', { token: adminToken });
    const sub = list.body.find((s) => s.url === 'https://dup.example/');
    assert.ok(sub, 'dup submission still pending');
    assert.equal(sub.status, 'pending');

    const review = await api(ctx.baseUrl, 'PUT', `/api/submissions/${sub.id}`, {
        token: adminToken,
        body: { status: 'rejected', review_note: 'duplicate of an existing listing' },
    });
    assert.equal(review.status, 200);

    const status = await api(ctx.baseUrl, 'GET', `/api/submissions/status/${ctx.dupToken}`);
    assert.equal(status.status, 200);
    assert.equal(status.body.status, 'rejected');
    assert.equal(status.body.review_note, 'duplicate of an existing listing');
    assert.ok(status.body.reviewed_at, 'reviewed_at set after review');
});

test('submissions: status query with unknown token returns 404', async () => {
    const res = await api(ctx.baseUrl, 'GET', `/api/submissions/status/${'0'.repeat(32)}`);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Not found');
});

// ── Reports ──────────────────────────────────────────────────────────────
//
// The report limiter (10/h per IP) runs AFTER reason/detail validation, so
// the two 400 cases below are free; only the two valid POSTs consume.

test('reports: invalid reason and overlong detail return 400', async () => {
    const bad = await api(ctx.baseUrl, 'POST', '/api/reports', {
        body: { site_id: 1, reason: 'bogus-reason' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Invalid reason');

    const longDetail = await api(ctx.baseUrl, 'POST', '/api/reports', {
        body: { site_id: 1, reason: 'spam', detail: 'x'.repeat(201) },
    });
    assert.equal(longDetail.status, 400);
    assert.equal(longDetail.body.error, 'Invalid detail');
});

test('reports: detail persisted; duplicate report (same site+IP within 24h) adds no row; overview exposes pending counts', async () => {
    const sites = await api(ctx.baseUrl, 'GET', '/api/sites');
    const siteId = sites.body[0].id;

    const first = await api(ctx.baseUrl, 'POST', '/api/reports', {
        body: { site_id: siteId, reason: 'link_dead', detail: 'site does not load' },
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.message, 'Report received');

    const reports = await api(ctx.baseUrl, 'GET', '/api/reports', { token: adminToken });
    const rows = reports.body.filter((r) => r.site_id === siteId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].detail, 'site does not load');
    assert.equal(rows[0].reason, 'link_dead');

    // Same site + same IP within 24h → 200 but no new row.
    const again = await api(ctx.baseUrl, 'POST', '/api/reports', {
        body: { site_id: siteId, reason: 'spam', detail: 'second report' },
    });
    assert.equal(again.status, 200);
    const reportsAfter = await api(ctx.baseUrl, 'GET', '/api/reports', { token: adminToken });
    assert.equal(reportsAfter.body.filter((r) => r.site_id === siteId).length, 1,
        'duplicate report suppressed');

    const overview = await api(ctx.baseUrl, 'GET', '/api/stats/overview', { token: adminToken });
    assert.equal(overview.status, 200);
    assert.equal(overview.body.pending_reports, 1);
    assert.equal(overview.body.pending_submissions, 0, 'one approved + one rejected, none pending');
    // snake_case fields mirror the camelCase ones
    assert.equal(overview.body.pending_reports, overview.body.pendingReports);
    assert.equal(overview.body.pending_submissions, overview.body.pendingSubmissions);
});

// ── Settings ─────────────────────────────────────────────────────────────

// The exact set of keys the public GET /api/settings endpoint may expose.
const PUBLIC_SETTING_KEYS = [
    'site_name', 'site_description', 'site_icon',
    'footer_text', 'footer_blog_url', 'footer_github_url',
    'theme_primary_color', 'theme_secondary_color',
    'submission_enabled', 'weather_enabled',
];

test('settings: GET is public and exposes exactly the 10 whitelisted keys', async () => {
    const res = await api(ctx.baseUrl, 'GET', '/api/settings');
    assert.equal(res.status, 200);
    assert.equal(res.body.site_name, 'DogNav');
    assert.deepEqual(Object.keys(res.body).sort(), [...PUBLIC_SETTING_KEYS].sort(),
        'public settings expose exactly the 10 whitelisted keys');
    assert.ok(!('weather_api_key' in res.body), 'secret key not exposed publicly');
    assert.ok(!('auto_nofollow' in res.body), 'removed key not exposed publicly');
});

test('settings: PUT (deprecated alias) requires auth and marks the response deprecated', async () => {
    const unauth = await api(ctx.baseUrl, 'PUT', '/api/settings', { body: { site_name: 'Hacked' } });
    assert.equal(unauth.status, 401);

    const bad = await api(ctx.baseUrl, 'PUT', '/api/settings', {
        token: adminToken,
        body: { bogus_key: 'x' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.error, 'Invalid setting key: bogus_key');

    const ok = await api(ctx.baseUrl, 'PUT', '/api/settings', {
        token: adminToken,
        body: { site_name: 'DogNav' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('deprecation'), 'true');
    assert.equal(ok.headers.get('sunset'), 'Sat, 01 Jan 2028 00:00:00 GMT');
    assert.equal(ok.body.message, 'Settings updated');
    assert.equal(ok.body.deprecated, true);
});

test('admin settings: PUT as admin returns 200 and normalizes boolean values', async () => {
    const ok = await api(ctx.baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { site_name: 'DogNav', weather_enabled: true },
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body, { message: 'Settings updated' });

    const pub = await api(ctx.baseUrl, 'GET', '/api/settings');
    assert.equal(pub.body.weather_enabled, 'true', 'boolean normalized to string');

    const restore = await api(ctx.baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { weather_enabled: false },
    });
    assert.equal(restore.status, 200);
});

test('admin settings: PUT rejects keys outside the whitelist (incl. weather_api_key)', async () => {
    const res = await api(ctx.baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { weather_api_key: 'should-not-stick' },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Invalid setting key: weather_api_key');
});

// ── Weather proxy ────────────────────────────────────────────────────────

test('weather: invalid coordinates return 400 "Invalid coordinates"', async () => {
    for (const body of [{ lat: 91, lon: 0 }, { lat: 0, lon: -181 }, { lat: 'abc', lon: 0 }, {}]) {
        const res = await api(ctx.baseUrl, 'POST', '/api/weather', { body });
        assert.equal(res.status, 400, `body ${JSON.stringify(body)}`);
        assert.equal(res.body.error, 'Invalid coordinates');
    }
});

test('weather: disabled by default returns 404 "Weather disabled"', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/weather', { body: { lat: 39.9, lon: 116.4 } });
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'Weather disabled');
});

test('weather: enabled but WEATHER_API_KEY unset returns 503 (helpers never set it)', async () => {
    const enable = await api(ctx.baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { weather_enabled: true },
    });
    assert.equal(enable.status, 200);

    const res = await api(ctx.baseUrl, 'POST', '/api/weather', { body: { lat: 39.9, lon: 116.4 } });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'Weather not configured');

    const disable = await api(ctx.baseUrl, 'PUT', '/api/admin/settings', {
        token: adminToken,
        body: { weather_enabled: false },
    });
    assert.equal(disable.status, 200);
});

// ── Users & roles ────────────────────────────────────────────────────────

test('users: admin can create an editor; editor is blocked from admin-only routes', async () => {
    const created = await api(ctx.baseUrl, 'POST', '/api/users', {
        token: adminToken,
        body: { username: 'editor1', password: 'EditorPass123!', role: 'editor' },
    });
    assert.equal(created.status, 200);

    const login = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'editor1', password: 'EditorPass123!' },
    });
    assert.equal(login.status, 200);
    editorToken = login.body.token;

    const listAsEditor = await api(ctx.baseUrl, 'GET', '/api/users', { token: editorToken });
    assert.equal(listAsEditor.status, 403);

    const listAsAdmin = await api(ctx.baseUrl, 'GET', '/api/users', { token: adminToken });
    assert.equal(listAsAdmin.status, 200);
    assert.ok(listAsAdmin.body.some((u) => u.username === 'editor1'));
});

// ── Admin-only routes (requireAdmin tightening) ─────────────────────────

test('permissions: editor gets 403 on admin-only routes, admin gets 200', async () => {
    for (const [method, path, body] of [
        ['PUT', '/api/settings', { site_name: 'DogNav' }],
        ['PUT', '/api/admin/settings', { site_name: 'DogNav' }],
        ['GET', '/api/admin/settings'],
        ['GET', '/api/logs'],
        ['GET', '/api/export'],
    ]) {
        const asEditor = await api(ctx.baseUrl, method, path, { token: editorToken, body });
        assert.equal(asEditor.status, 403, `${method} ${path} as editor`);

        const asAdmin = await api(ctx.baseUrl, method, path, { token: adminToken, body });
        assert.equal(asAdmin.status, 200, `${method} ${path} as admin`);
    }
});

// ── Backup (export / import) ─────────────────────────────────────────────

test('backup: export and import both require admin role', async () => {
    const unauthExport = await api(ctx.baseUrl, 'GET', '/api/export');
    assert.equal(unauthExport.status, 401);

    // Editor (non-admin) must be rejected by requireAdmin
    const editorExport = await api(ctx.baseUrl, 'GET', '/api/export', { token: editorToken });
    assert.equal(editorExport.status, 403);

    const exportRes = await api(ctx.baseUrl, 'GET', '/api/export', { token: adminToken });
    assert.equal(exportRes.status, 200);
    assert.ok(Array.isArray(exportRes.body.sites));
    assert.ok(exportRes.body.settings && typeof exportRes.body.settings === 'object');

    const unauthImport = await api(ctx.baseUrl, 'POST', '/api/import', { body: {} });
    assert.equal(unauthImport.status, 401);

    // Editor (non-admin) must be rejected by requireAdmin
    const editorImport = await api(ctx.baseUrl, 'POST', '/api/import', { token: editorToken, body: {} });
    assert.equal(editorImport.status, 403);

    const adminImport = await api(ctx.baseUrl, 'POST', '/api/import', { token: adminToken, body: {} });
    assert.equal(adminImport.status, 200);
});

// ── Last-admin protection ────────────────────────────────────────────────

test('users: cannot delete the last active admin (403)', async () => {
    // Editor is not even allowed to try (requireAdmin)
    const asEditor = await api(ctx.baseUrl, 'DELETE', `/api/users/${adminUserId}`, { token: editorToken });
    assert.equal(asEditor.status, 403);

    const asAdmin = await api(ctx.baseUrl, 'DELETE', `/api/users/${adminUserId}`, { token: adminToken });
    assert.equal(asAdmin.status, 403);
    assert.match(asAdmin.body.error, /last active admin/);
});

// ── Health check ─────────────────────────────────────────────────────────

test('health-check: requires auth', async () => {
    const unauth = await api(ctx.baseUrl, 'POST', '/api/health-check', {
        body: { siteIds: [1] },
    });
    assert.equal(unauth.status, 401);
});

test('health-check: legacy {urls} shape / missing / empty siteIds are no-ops returning {results:[]}', async () => {
    for (const body of [{ urls: ['http://127.0.0.1:1/'] }, {}, { siteIds: [] }, { siteIds: 'x' }]) {
        const res = await api(ctx.baseUrl, 'POST', '/api/health-check', {
            token: adminToken,
            body,
        });
        assert.equal(res.status, 200, `body ${JSON.stringify(body)}`);
        assert.deepEqual(res.body, { results: [] });
    }
});

test('health-check: more than 50 site IDs returns 400', async () => {
    const res = await api(ctx.baseUrl, 'POST', '/api/health-check', {
        token: adminToken,
        body: { siteIds: Array.from({ length: 51 }, (_, i) => i + 1) },
    });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'Too many site IDs');
});

test('health-check: failing site increments consecutive_failures, last_status flips to offline only at 3', async () => {
    // Port 1 on loopback refuses connections immediately — and 127.0.0.1 is
    // blocked as a private host anyway, so the probe fails fast offline.
    await api(ctx.baseUrl, 'POST', '/api/sites', {
        token: adminToken,
        body: { name: 'Dead Site', url: 'http://127.0.0.1:1/', category: 'tools' },
    });
    const list = await api(ctx.baseUrl, 'GET', '/api/sites');
    const site = list.body.find((s) => s.url === 'http://127.0.0.1:1/');
    assert.ok(site, 'site created');
    assert.equal(site.last_status, null, 'last_status starts unset');

    const checkOnce = async () => {
        const res = await api(ctx.baseUrl, 'POST', '/api/health-check', {
            token: adminToken,
            body: { siteIds: [site.id] },
        });
        assert.equal(res.status, 200);
        assert.equal(res.body.results.length, 1);
        return res.body.results[0];
    };
    const lastStatusOf = async () => {
        const l = await api(ctx.baseUrl, 'GET', '/api/sites');
        return l.body.find((s) => s.id === site.id).last_status;
    };

    const r1 = await checkOnce();
    assert.equal(r1.id, site.id);
    assert.equal(r1.url, 'http://127.0.0.1:1/');
    assert.equal(r1.status, 'offline');
    assert.equal(r1.consecutive_failures, 1);
    assert.equal(await lastStatusOf(), null, 'last_status untouched before 3 failures');

    const r2 = await checkOnce();
    assert.equal(r2.consecutive_failures, 2);
    assert.equal(await lastStatusOf(), null);

    const r3 = await checkOnce();
    assert.equal(r3.consecutive_failures, 3);
    assert.equal(await lastStatusOf(), 'offline', 'flipped to offline at 3 consecutive failures');

    const del = await api(ctx.baseUrl, 'DELETE', `/api/sites/${site.id}`, { token: adminToken });
    assert.equal(del.status, 200);
});

// ── Logout ───────────────────────────────────────────────────────────────

test('logout: old token is rejected afterwards', async () => {
    const login = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin', password: 'NewAdmin123!' },
    });
    assert.equal(login.status, 200);
    const token = login.body.token;

    const beforeLogout = await api(ctx.baseUrl, 'GET', '/api/submissions', { token });
    assert.equal(beforeLogout.status, 200);

    const logout = await api(ctx.baseUrl, 'POST', '/api/auth/logout', { token });
    assert.equal(logout.status, 200);

    const afterLogout = await api(ctx.baseUrl, 'GET', '/api/submissions', { token });
    assert.equal(afterLogout.status, 401);
});

// ── Login rate limiting — MUST STAY LAST (locks this IP for 15 minutes) ──

test('login: 5 consecutive failures trigger 429 with Retry-After', async () => {
    for (let i = 0; i < 5; i++) {
        const res = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
            body: { username: 'admin', password: `brute-force-${i}` },
        });
        assert.equal(res.status, 401, `attempt ${i + 1} still 401`);
    }
    const locked = await api(ctx.baseUrl, 'POST', '/api/auth/login', {
        body: { username: 'admin', password: 'NewAdmin123!' },
    });
    assert.equal(locked.status, 429);
    const retryAfter = locked.headers.get('retry-after');
    assert.ok(retryAfter, 'Retry-After header present');
    assert.ok(Number(retryAfter) > 0);
});
