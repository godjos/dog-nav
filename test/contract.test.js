// Dual-runtime contract tests — the SAME case table runs against both
// backends and asserts compatible status codes / response field shapes.
//
// Targets are selected via CONTRACT_TARGET=express|worker|both (default:
// express, so CI without wrangler still runs). Both targets are launched as
// child processes on random ports:
//   - express: `node server.js` with a throwaway DB_PATH/UPLOAD_DIR and
//     INITIAL_ADMIN_PASSWORD=TestAdmin123!. A child process (not an in-process
//     require) because server.js keeps its db as a module-level singleton —
//     see test/helpers.js.
//   - worker: `npx wrangler dev --local --port <random>` in cloudflare/ with
//     --var INITIAL_ADMIN_PASSWORD:TestAdmin123!. Local D1 state under
//     cloudflare/.wrangler/state is deleted first for a clean database.
//     If wrangler is missing or the dev server fails to boot (e.g. no network
//     to download workerd), every case SKIPs with the reason instead of
//     failing.
//
// Known dual-end differences use expectStatusByRuntime and are annotated with
// their D-number from docs/API_CONTRACT.md.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const CF_DIR = path.join(ROOT, 'cloudflare');
const WRANGLER_BIN = path.join(CF_DIR, 'node_modules', '.bin', 'wrangler');
const TEST_ADMIN_PASSWORD = 'TestAdmin123!';
const NEW_ADMIN_PASSWORD = 'NewAdmin123!';

const CONTRACT_TARGET = process.env.CONTRACT_TARGET || 'express';
if (!['express', 'worker', 'both'].includes(CONTRACT_TARGET)) {
    throw new Error(`Invalid CONTRACT_TARGET="${CONTRACT_TARGET}" (express|worker|both)`);
}
const TARGETS = CONTRACT_TARGET === 'both' ? ['express', 'worker'] : [CONTRACT_TARGET];

// ── process plumbing ───────────────────────────────────────────────────────

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const { port } = srv.address();
            srv.close(() => resolve(port));
        });
    });
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Poll until the server answers HTTP, the child exits, or the timeout hits.
// Returns null on success, or a failure reason string.
async function waitReady(proc, port, timeoutMs, getOutput) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (proc.exitCode !== null || proc.signalCode !== null) {
            return `process exited early (code=${proc.exitCode} signal=${proc.signalCode})\n${getOutput()}`;
        }
        try {
            const res = await fetch(`http://127.0.0.1:${port}/api/sites`);
            if (res.status > 0) return null; // any HTTP response means it's up
        } catch { /* not listening yet */ }
        await sleep(300);
    }
    return `not ready after ${timeoutMs}ms\n${getOutput()}`;
}

function spawnLogged(cmd, args, options) {
    // detached: the child leads its own process group so close() can SIGTERM
    // the whole tree — `npx wrangler dev` otherwise orphans wrangler/workerd,
    // which hold our stdout/stderr pipes open and keep the test process alive.
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...options });
    let output = '';
    const cap = (chunk) => { output = (output + chunk).slice(-8000); };
    proc.stdout.on('data', cap);
    proc.stderr.on('data', cap);
    return { proc, getOutput: () => output.trim() };
}

function killTree(proc) {
    try { process.kill(-proc.pid, 'SIGTERM'); } catch { /* group already gone */ }
    try { proc.kill('SIGTERM'); } catch { /* already dead */ }
    // Drop our end of the pipes: grandchildren may keep theirs open, and the
    // streams must not hold the test runner's event loop alive.
    proc.stdout.destroy();
    proc.stderr.destroy();
    proc.unref();
}

async function startExpress() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dognav-contract-'));
    const port = await getFreePort();
    // Strip WEATHER_API_KEY so POST /api/weather deterministically hits its
    // 503 "Weather not configured" branch regardless of the ambient shell.
    const env = { ...process.env };
    delete env.WEATHER_API_KEY;
    const { proc, getOutput } = spawnLogged(process.execPath, [path.join(ROOT, 'server.js')], {
        cwd: ROOT,
        env: {
            ...env,
            DB_PATH: path.join(tmpDir, 'contract.db'),
            UPLOAD_DIR: path.join(tmpDir, 'uploads'),
            PORT: String(port),
            INITIAL_ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
        },
    });
    const fail = await waitReady(proc, port, 20000, getOutput);
    if (fail) {
        killTree(proc);
        throw new Error(`express server failed to start: ${fail}`);
    }
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        async close() {
            killTree(proc);
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
}

function wranglerUnavailableReason() {
    if (fs.existsSync(WRANGLER_BIN)) return null;
    const probe = spawnSync('npx', ['--no-install', 'wrangler', '--version'], {
        cwd: CF_DIR, encoding: 'utf8',
    });
    if (probe.status === 0) return null;
    return `wrangler not installed (run \`npm install\` in cloudflare/): ${(probe.stderr || probe.stdout || '').trim().slice(0, 300)}`;
}

async function startWorker() {
    const unavailable = wranglerUnavailableReason();
    if (unavailable) return { skipReason: unavailable };

    // Clean local D1 state so the seed runs against an empty database.
    fs.rmSync(path.join(CF_DIR, '.wrangler', 'state'), { recursive: true, force: true });

    const port = await getFreePort();
    // Strip WEATHER_API_KEY for the same reason as startExpress(): the
    // weather 503 contract case must not depend on the ambient shell.
    const env = { ...process.env };
    delete env.WEATHER_API_KEY;
    const { proc, getOutput } = spawnLogged('npx', [
        'wrangler', 'dev', '--local', '--port', String(port),
        '--var', `INITIAL_ADMIN_PASSWORD:${TEST_ADMIN_PASSWORD}`,
    ], { cwd: CF_DIR, env });
    // First boot may download workerd/miniflare — allow a generous window.
    const fail = await waitReady(proc, port, 120000, getOutput);
    if (fail) {
        killTree(proc);
        return { skipReason: `wrangler dev failed to start (no network for workerd download?): ${fail}` };
    }
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        async close() { killTree(proc); },
    };
}

// ── shared contract case table ─────────────────────────────────────────────
//
// Case shape:
//   name        display name
//   method      HTTP method
//   path        string or (state) => string
//   body        object or (state) => object (sent as JSON when defined)
//   auth        true → send `Authorization: Bearer <state.adminToken>`
//   authToken   (state) => token, overrides `auth` (used before adminToken exists)
//   expectStatus                single status valid for both runtimes
//   expectStatusByRuntime       { express, worker } for known differences (D-numbers)
//   expectFields                { field: 'string'|'number'|'boolean'|'array'|'object' }
//                               every listed field must exist with that JSON type
//   expectType                  'array' — top-level body must be an array
//   elementFields               like expectFields, applied to every array element
//   check(res, state)           extra assertions; may mutate state (async ok)

// The exact set of keys the public GET /api/settings endpoint may expose
// (both runtimes). weather_api_key stays server-side; auto_nofollow is gone.
const EXPECTED_PUBLIC_SETTING_KEYS = [
    'site_name', 'site_description', 'site_icon',
    'footer_text', 'footer_blog_url', 'footer_github_url',
    'theme_primary_color', 'theme_secondary_color',
    'submission_enabled', 'weather_enabled',
];

const CASES = [
    // ── Auth ──
    {
        name: 'login: wrong password returns 401 {"error"}',
        method: 'POST', path: '/api/auth/login',
        body: { username: 'admin', password: 'wrong-password' },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'login: correct password returns 200 + token/user/mustChangePassword',
        method: 'POST', path: '/api/auth/login',
        body: { username: 'admin', password: TEST_ADMIN_PASSWORD },
        expectStatus: 200,
        expectFields: { token: 'string', mustChangePassword: 'boolean', user: 'object' },
        check(res, state) {
            assert.equal(res.body.mustChangePassword, true, 'initial admin must change password');
            assert.equal(res.body.user.username, 'admin');
            state.initialToken = res.body.token;
        },
    },
    {
        name: 'forced password change: other endpoints return 403 before change',
        method: 'POST', path: '/api/sites',
        authToken: (state) => state.initialToken,
        body: { name: 'X', url: 'https://x.example', category: 'tools' },
        expectStatus: 403,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'password_change_required');
        },
    },
    {
        name: 'auth/me: reachable while must_change_password=1 (exempt from gate)',
        method: 'GET', path: '/api/auth/me',
        authToken: (state) => state.initialToken,
        expectStatus: 200,
        expectFields: { id: 'number', username: 'string', role: 'string', mustChangePassword: 'boolean' },
        check(res) {
            assert.equal(res.body.mustChangePassword, true);
        },
    },
    {
        name: 'change password: wrong old password returns 401',
        method: 'PUT', path: '/api/auth/password',
        authToken: (state) => state.initialToken,
        body: { oldPassword: 'nope-nope-nope', newPassword: NEW_ADMIN_PASSWORD },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'change password: correct old password returns 200 {"message"}',
        method: 'PUT', path: '/api/auth/password',
        authToken: (state) => state.initialToken,
        body: { oldPassword: TEST_ADMIN_PASSWORD, newPassword: NEW_ADMIN_PASSWORD },
        expectStatus: 200,
        expectFields: { message: 'string' },
    },
    {
        name: 're-login with new password: mustChangePassword=false, save admin token',
        method: 'POST', path: '/api/auth/login',
        body: { username: 'admin', password: NEW_ADMIN_PASSWORD },
        expectStatus: 200,
        expectFields: { token: 'string', mustChangePassword: 'boolean', user: 'object' },
        check(res, state) {
            assert.equal(res.body.mustChangePassword, false);
            state.adminToken = res.body.token;
        },
    },
    {
        name: 'auth/me: without token returns 401',
        method: 'GET', path: '/api/auth/me',
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'auth/me: with admin token returns current user (mustChangePassword=false)',
        method: 'GET', path: '/api/auth/me',
        auth: true,
        expectStatus: 200,
        expectFields: { id: 'number', username: 'string', role: 'string', mustChangePassword: 'boolean' },
        check(res) {
            assert.equal(res.body.username, 'admin');
            assert.equal(res.body.role, 'admin');
            assert.equal(res.body.mustChangePassword, false);
        },
    },

    // ── Editor user (for requireAdmin cases) ──
    {
        name: 'users: admin creates an editor account',
        method: 'POST', path: '/api/users',
        auth: true,
        body: { username: 'contract-editor', password: 'EditorPass123!', role: 'editor' },
        expectStatus: 200,
        expectFields: { message: 'string' },
    },
    {
        name: 'users: editor login succeeds, save editor token',
        method: 'POST', path: '/api/auth/login',
        body: { username: 'contract-editor', password: 'EditorPass123!' },
        expectStatus: 200,
        expectFields: { token: 'string', mustChangePassword: 'boolean', user: 'object' },
        check(res, state) {
            assert.equal(res.body.user.role, 'editor');
            assert.equal(res.body.mustChangePassword, false);
            state.editorToken = res.body.token;
        },
    },

    // ── Sites ──
    {
        name: 'sites: POST without auth returns 401',
        method: 'POST', path: '/api/sites',
        body: { name: 'X', url: 'https://x.example', category: 'tools' },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'sites: GET is public and returns an array of site objects',
        method: 'GET', path: '/api/sites',
        expectStatus: 200,
        expectType: 'array',
    },
    {
        // D1: success status is 200 on both ends (should semantically be 201 — pinned).
        // D2: Worker accepts a `status` column on create, Express ignores it; sending
        // it here is safe on both and pins the tolerant behaviour.
        name: 'sites: create with auth returns 200 {"id","message"} (D1: 200 not 201)',
        method: 'POST', path: '/api/sites',
        auth: true,
        body: { name: 'Contract Site', url: 'https://contract-site.example', category: 'tools', status: 'active' },
        expectStatus: 200,
        expectFields: { id: 'number', message: 'string' },
        async check(res, state, ctx) {
            // Both runtimes return the real insert id now (Express used to
            // respond {"id":0} — a last_insert_rowid-after-log-insert quirk).
            assert.ok(Number.isInteger(res.body.id) && res.body.id > 0,
                `real id returned, got ${res.body.id}`);
            const list = await ctx.api('GET', '/api/sites');
            const site = list.body.find((s) => s.url === 'https://contract-site.example');
            assert.ok(site, 'created site visible in public list');
            assert.equal(site.id, res.body.id, 'response id matches the public list id');
            state.siteId = site.id;
        },
    },
    {
        name: 'sites: update with auth returns 200 {"message"}',
        method: 'PUT', path: (state) => `/api/sites/${state.siteId}`,
        auth: true,
        body: { name: 'Contract Site v2', url: 'https://contract-site.example', category: 'tools', status: 'active' },
        expectStatus: 200,
        expectFields: { message: 'string' },
    },
    {
        name: 'sites: update visible in public list',
        method: 'GET', path: '/api/sites',
        expectStatus: 200,
        expectType: 'array',
        check(res, state) {
            const site = res.body.find((s) => s.id === state.siteId);
            assert.ok(site, 'site still listed');
            assert.equal(site.name, 'Contract Site v2');
        },
    },

    // ── Batch (field whitelist + action validation) ──
    {
        name: 'batch: update with field outside whitelist returns 400 "Invalid field"',
        method: 'POST', path: '/api/sites/batch',
        auth: true,
        body: (state) => ({ ids: [state.siteId], action: 'update', data: { bogus_field: 'x' } }),
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid field: bogus_field');
        },
    },
    {
        name: 'batch: unknown action returns 400 "Invalid action"',
        method: 'POST', path: '/api/sites/batch',
        auth: true,
        body: (state) => ({ ids: [state.siteId], action: 'nonsense' }),
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid action');
        },
    },

    // ── Categories ──
    {
        name: 'categories: GET is public and returns category objects',
        method: 'GET', path: '/api/categories',
        expectStatus: 200,
        expectType: 'array',
        check(res) {
            assert.ok(res.body.length > 0, 'seeded categories present');
        },
        elementFields: { id: 'string', name: 'string' },
    },

    // ── Submissions ──
    // Rate-limit budget: 5 counted POSTs/h per IP (limiter runs before field
    // validation; the honeypot path is free). Used here: 2 (submit + duplicate).
    {
        name: 'submissions: public submit returns 200 {"message","trackingToken"}',
        method: 'POST', path: '/api/submissions',
        body: { name: 'Contract Sub', url: 'https://contract-sub.example', category: 'tools', submitter_email: 'sub@example.com' },
        expectStatus: 200,
        expectFields: { message: 'string', trackingToken: 'string' },
        check(res, state) {
            assert.ok(res.body.trackingToken.length > 0, 'trackingToken present');
            state.submissionToken = res.body.trackingToken;
        },
    },
    {
        name: 'submissions: duplicate normalized URL (pending) returns 409 "Duplicate submission"',
        method: 'POST', path: '/api/submissions',
        body: { name: 'Contract Sub Again', url: 'https://contract-sub.example/', category: 'tools' },
        expectStatus: 409,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Duplicate submission');
        },
    },
    {
        // Pending submission: review_note/reviewed_at are still null, so only
        // presence (not type) is asserted for them.
        name: 'submissions: public status lookup by tracking token (never leaks email)',
        method: 'GET', path: (state) => `/api/submissions/status/${state.submissionToken}`,
        expectStatus: 200,
        check(res) {
            assert.equal(res.body.name, 'Contract Sub');
            assert.equal(res.body.url, 'https://contract-sub.example');
            assert.equal(res.body.status, 'pending');
            for (const f of ['review_note', 'created_at', 'reviewed_at']) {
                assert.ok(f in res.body, `field "${f}" present`);
            }
            assert.ok(!('submitter_email' in res.body), 'status lookup must not leak the email');
        },
    },
    {
        name: 'submissions: status lookup with unknown token returns 404 "Not found"',
        method: 'GET', path: `/api/submissions/status/${'0'.repeat(32)}`,
        expectStatus: 404,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Not found');
        },
    },
    {
        name: 'submissions: list without auth returns 401',
        method: 'GET', path: '/api/submissions',
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'submissions: list with auth returns pending submission',
        method: 'GET', path: '/api/submissions',
        auth: true,
        expectStatus: 200,
        expectType: 'array',
        check(res, state) {
            const sub = res.body.find((s) => s.url === 'https://contract-sub.example');
            assert.ok(sub, 'submission listed');
            assert.equal(sub.status, 'pending');
            state.submissionId = sub.id;
        },
    },
    {
        name: 'submissions: approve returns 200 and creates a public site',
        method: 'PUT', path: (state) => `/api/submissions/${state.submissionId}`,
        auth: true,
        body: { status: 'approved' },
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const sites = await ctx.api('GET', '/api/sites');
            assert.ok(sites.body.some((s) => s.url === 'https://contract-sub.example'),
                'approved submission appears in public site list');
        },
    },

    // ── Settings ──
    {
        name: 'settings: public GET returns exactly the 10 whitelisted keys',
        method: 'GET', path: '/api/settings',
        expectStatus: 200,
        expectFields: { site_name: 'string' },
        check(res) {
            assert.deepEqual(Object.keys(res.body).sort(), [...EXPECTED_PUBLIC_SETTING_KEYS].sort(),
                'public settings expose exactly the 10 whitelisted keys');
            assert.ok(!('weather_api_key' in res.body), 'secret key not exposed publicly');
            assert.ok(!('auto_nofollow' in res.body), 'removed key not exposed publicly');
        },
    },
    {
        name: 'settings: PUT without auth returns 401',
        method: 'PUT', path: '/api/settings',
        body: { site_name: 'Hacked' },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'settings: PUT as editor returns 403 (requireAdmin)',
        method: 'PUT', path: '/api/settings',
        authToken: (state) => state.editorToken,
        body: { site_name: 'Hacked' },
        expectStatus: 403,
        expectFields: { error: 'string' },
    },
    {
        name: 'settings: PUT rejects key outside whitelist (400 "Invalid setting key")',
        method: 'PUT', path: '/api/settings',
        auth: true,
        body: { bogus_key: 'x' },
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid setting key: bogus_key');
        },
    },
    {
        // Deprecated alias of PUT /api/admin/settings: same behaviour, plus
        // Deprecation/Sunset headers and a `deprecated: true` body flag.
        name: 'settings: PUT as admin returns 200 with Deprecation/Sunset headers',
        method: 'PUT', path: '/api/settings',
        auth: true,
        body: { site_name: 'DogNav' },
        expectStatus: 200,
        expectFields: { message: 'string', deprecated: 'boolean' },
        check(res) {
            assert.equal(res.headers.get('deprecation'), 'true');
            assert.equal(res.headers.get('sunset'), 'Sat, 01 Jan 2028 00:00:00 GMT');
            assert.equal(res.body.deprecated, true);
        },
    },
    {
        name: 'admin settings: PUT as editor returns 403 (requireAdmin)',
        method: 'PUT', path: '/api/admin/settings',
        authToken: (state) => state.editorToken,
        body: { site_name: 'Hacked' },
        expectStatus: 403,
        expectFields: { error: 'string' },
    },
    {
        name: 'admin settings: PUT rejects key outside whitelist (weather_api_key → 400)',
        method: 'PUT', path: '/api/admin/settings',
        auth: true,
        body: { weather_api_key: 'should-not-stick' },
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid setting key: weather_api_key');
        },
    },
    {
        // Leaves weather_enabled='true' for the weather cases below; the
        // restore case after them flips it back to the seeded 'false'.
        name: 'admin settings: PUT as admin returns 200, boolean value normalized to string',
        method: 'PUT', path: '/api/admin/settings',
        auth: true,
        body: { site_name: 'DogNav', weather_enabled: true },
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const pub = await ctx.api('GET', '/api/settings');
            assert.equal(pub.body.weather_enabled, 'true', 'boolean normalized to string');
        },
    },

    // ── Weather proxy (public; coordinate check runs before the enabled check) ──
    {
        name: 'weather: invalid coordinates return 400 "Invalid coordinates"',
        method: 'POST', path: '/api/weather',
        body: { lat: 91, lon: 0 },
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid coordinates');
        },
    },
    {
        // weather_enabled='true' (set above) but neither runtime is started
        // with WEATHER_API_KEY, so both must answer 503 before any upstream call.
        name: 'weather: enabled but WEATHER_API_KEY unset returns 503 "Weather not configured"',
        method: 'POST', path: '/api/weather',
        body: { lat: 39.9, lon: 116.4 },
        expectStatus: 503,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Weather not configured');
        },
    },
    {
        name: 'admin settings: restore weather_enabled=false',
        method: 'PUT', path: '/api/admin/settings',
        auth: true,
        body: { weather_enabled: false },
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const pub = await ctx.api('GET', '/api/settings');
            assert.equal(pub.body.weather_enabled, 'false', 'seeded default restored');
        },
    },
    {
        name: 'weather: disabled returns 404 "Weather disabled"',
        method: 'POST', path: '/api/weather',
        body: { lat: 39.9, lon: 116.4 },
        expectStatus: 404,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Weather disabled');
        },
    },

    // ── Hot list (热榜聚合) ──
    // 只有未知源的 400 是确定性行为；200/502 取决于外网与上游风控，
    // 不进契约用例（同 weather 的 502 分支一样靠人工/集成环境验证）。
    {
        name: 'hot: unknown source returns 400 "Unknown hot list source"',
        method: 'GET', path: '/api/hot/not-a-source',
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Unknown hot list source');
        },
    },

    // ── Tags ──
    {
        name: 'tags: GET is public and returns an array',
        method: 'GET', path: '/api/tags',
        expectStatus: 200,
        expectType: 'array',
    },
    {
        name: 'tags: create with auth returns 200 {"message"}',
        method: 'POST', path: '/api/tags',
        auth: true,
        body: { name: 'contract-tag', color: '#123456' },
        expectStatus: 200,
        expectFields: { message: 'string' },
    },

    // ── Site tags (GET /api/sites appends `tags`) ──
    // Two tags created in reverse name order so the JOIN ... ORDER BY t.name
    // sort is observable. Uses state.siteId (deleted at the very end).
    {
        name: 'site-tags: POST /api/sites/:id/tags without auth returns 401',
        method: 'POST', path: (state) => `/api/sites/${state.siteId}/tags`,
        body: { tag_ids: [] },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'tags: create zz/aa tags for the site-tags case (reverse name order)',
        method: 'POST', path: '/api/tags',
        auth: true,
        body: { name: 'zz-contract-tag', color: '#111111' },
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const second = await ctx.api('POST', '/api/tags', {
                token: state.adminToken,
                body: { name: 'aa-contract-tag', color: '#222222' },
            });
            assert.equal(second.status, 200, `second tag create (body: ${second.text.slice(0, 200)})`);
        },
    },
    {
        name: 'tags: resolve ids of the zz/aa contract tags',
        method: 'GET', path: '/api/tags',
        expectStatus: 200,
        expectType: 'array',
        check(res, state) {
            state.tagIdAa = res.body.find((t) => t.name === 'aa-contract-tag').id;
            state.tagIdZz = res.body.find((t) => t.name === 'zz-contract-tag').id;
            assert.ok(Number.isInteger(state.tagIdAa) && Number.isInteger(state.tagIdZz));
        },
    },
    {
        name: 'site-tags: assign tags returns 200 {"message"} (full replace semantics)',
        method: 'POST', path: (state) => `/api/sites/${state.siteId}/tags`,
        auth: true,
        // zz first on the wire — response must still come back name-sorted
        body: (state) => ({ tag_ids: [state.tagIdZz, state.tagIdAa] }),
        expectStatus: 200,
        expectFields: { message: 'string' },
    },
    {
        name: 'sites: GET appends tags array — {id,name,color} sorted by name, untagged site gets []',
        method: 'GET', path: '/api/sites',
        expectStatus: 200,
        expectType: 'array',
        check(res, state) {
            const site = res.body.find((s) => s.id === state.siteId);
            assert.ok(site, 'contract site listed');
            assert.deepEqual(site.tags.map((t) => t.name),
                ['aa-contract-tag', 'zz-contract-tag'], 'tags sorted by tag name');
            for (const t of site.tags) {
                assertFieldTypes(t, { id: 'number', name: 'string', color: 'string' }, 'site.tags element');
            }
            // Purely additive: every site carries a tags array
            for (const s of res.body) {
                assert.ok(Array.isArray(s.tags), `site ${s.id}: tags is an array`);
            }
            const untagged = res.body.find((s) => s.url === 'https://contract-sub.example');
            assert.ok(untagged, 'approved submission site listed');
            assert.deepEqual(untagged.tags, [], 'untagged site gets []');
        },
    },

    // ── Links ──
    {
        name: 'links: GET is public and returns an array',
        method: 'GET', path: '/api/links',
        expectStatus: 200,
        expectType: 'array',
    },
    {
        name: 'links: create with auth returns 200 {"message"}',
        method: 'POST', path: '/api/links',
        auth: true,
        body: { name: 'Contract Link', url: 'https://contract-link.example' },
        expectStatus: 200,
        expectFields: { message: 'string' },
    },

    // ── Pages ──
    {
        name: 'pages: GET is public and returns page objects',
        method: 'GET', path: '/api/pages',
        expectStatus: 200,
        expectType: 'array',
        elementFields: { id: 'string', title: 'string' },
    },
    {
        // D3 resolved: Express now implements POST /api/pages with the same
        // semantics as the Worker (400 validation, 409 duplicate id, 201 on
        // success), so both ends assert 201 here.
        name: 'pages: POST create — 201 both ends (D3 resolved)',
        method: 'POST', path: '/api/pages',
        auth: true,
        body: { id: 'contract-page', title: 'Contract Page', content: 'x' },
        expectStatus: 201,
        expectFields: { message: 'string', id: 'string' },
    },

    // ── Export ──
    {
        name: 'export: without auth returns 401',
        method: 'GET', path: '/api/export',
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'export: editor role returns 403 (requireAdmin)',
        method: 'GET', path: '/api/export',
        authToken: (state) => state.editorToken,
        expectStatus: 403,
        expectFields: { error: 'string' },
    },
    {
        // D10: Worker additionally includes `pages` — superset, not asserted here.
        name: 'export: as admin returns backup object (D10: Worker adds pages)',
        method: 'GET', path: '/api/export',
        auth: true,
        expectStatus: 200,
        expectFields: {
            sites: 'array', categories: 'array', tags: 'array',
            links: 'array', settings: 'object', exportDate: 'string',
        },
    },

    // ── Reports ──
    // The report limiter (10/h per IP) runs AFTER reason/detail validation,
    // so the 400 case is free; only the two valid POSTs consume.
    {
        name: 'reports: reason outside the enum returns 400 "Invalid reason"',
        method: 'POST', path: '/api/reports',
        body: (state) => ({ site_id: state.siteId, reason: 'bogus-reason' }),
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Invalid reason');
        },
    },
    {
        name: 'reports: create returns 200; duplicate (same site+IP within 24h) adds no row',
        method: 'POST', path: '/api/reports',
        body: (state) => ({ site_id: state.siteId, reason: 'link_dead', detail: 'site does not load' }),
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const dup = await ctx.api('POST', '/api/reports', {
                body: { site_id: state.siteId, reason: 'spam', detail: 'second report' },
            });
            assert.equal(dup.status, 200, `duplicate report still 200 (body: ${dup.text.slice(0, 200)})`);
            const list = await ctx.api('GET', '/api/reports', { token: state.adminToken });
            const rows = list.body.filter((r) => r.site_id === state.siteId);
            assert.equal(rows.length, 1, 'duplicate report suppressed');
            assert.equal(rows[0].reason, 'link_dead');
            assert.equal(rows[0].detail, 'site does not load');
        },
    },

    // ── Stats ──
    {
        name: 'stats: overview exposes pending_reports / pending_submissions counters',
        method: 'GET', path: '/api/stats/overview',
        auth: true,
        expectStatus: 200,
        expectFields: {
            pendingReports: 'number', pendingSubmissions: 'number',
            pending_reports: 'number', pending_submissions: 'number',
        },
        check(res) {
            assert.equal(res.body.pending_reports, 1, 'one report filed above');
            assert.equal(res.body.pending_submissions, 0, 'submission approved, duplicate rejected with 409');
            assert.equal(res.body.pending_reports, res.body.pendingReports);
            assert.equal(res.body.pending_submissions, res.body.pendingSubmissions);
        },
    },

    // ── Health check ──
    {
        name: 'health-check: without auth returns 401',
        method: 'POST', path: '/api/health-check',
        body: { siteIds: [1] },
        expectStatus: 401,
        expectFields: { error: 'string' },
    },
    {
        name: 'health-check: legacy {urls} shape / missing / empty siteIds return 200 {"results":[]}',
        method: 'POST', path: '/api/health-check',
        auth: true,
        body: { urls: ['http://127.0.0.1:1/'] },
        expectStatus: 200,
        expectFields: { results: 'array' },
        async check(res, state, ctx) {
            assert.deepEqual(res.body.results, []);
            for (const body of [{}, { siteIds: [] }]) {
                const r = await ctx.api('POST', '/api/health-check', { token: state.adminToken, body });
                assert.equal(r.status, 200, `body ${JSON.stringify(body)}`);
                assert.deepEqual(r.body.results, []);
            }
        },
    },
    {
        name: 'health-check: more than 50 site IDs returns 400 "Too many site IDs"',
        method: 'POST', path: '/api/health-check',
        auth: true,
        body: { siteIds: Array.from({ length: 51 }, (_, i) => i + 1) },
        expectStatus: 400,
        expectFields: { error: 'string' },
        check(res) {
            assert.equal(res.body.error, 'Too many site IDs');
        },
    },
    {
        // 127.0.0.1 is an IP literal, so both runtimes block it identically
        // ("Blocked private host") — no DNS needed, no expectStatusByRuntime.
        name: 'health-check: site with private IP literal is offline, consecutive_failures increments',
        method: 'POST', path: '/api/sites',
        auth: true,
        body: { name: 'Dead Contract Site', url: 'http://127.0.0.1:1/', category: 'tools' },
        expectStatus: 200,
        async check(res, state, ctx) {
            const list = await ctx.api('GET', '/api/sites');
            const site = list.body.find((s) => s.url === 'http://127.0.0.1:1/');
            assert.ok(site, 'site created');
            state.deadSiteId = site.id;

            for (const expected of [1, 2]) {
                const r = await ctx.api('POST', '/api/health-check', {
                    token: state.adminToken,
                    body: { siteIds: [site.id] },
                });
                assert.equal(r.status, 200, `health-check run (body: ${r.text.slice(0, 200)})`);
                assert.equal(r.body.results.length, 1);
                const result = r.body.results[0];
                assert.equal(result.id, site.id);
                assert.equal(result.url, 'http://127.0.0.1:1/');
                assert.equal(result.status, 'offline');
                assert.equal(result.error, 'Blocked private host');
                assert.equal(result.consecutive_failures, expected,
                    `failure #${expected} counted`);
            }
            const after = await ctx.api('GET', '/api/sites');
            const probed = after.body.find((s) => s.id === site.id);
            assert.ok(probed.last_status !== 'offline',
                'last_status only flips to offline at 3 consecutive failures');

            const del = await ctx.api('DELETE', `/api/sites/${site.id}`, { token: state.adminToken });
            assert.equal(del.status, 200);
        },
    },

    // ── Sites delete (last: needs state.siteId intact) ──
    {
        name: 'sites: delete with auth returns 200 and removes the site',
        method: 'DELETE', path: (state) => `/api/sites/${state.siteId}`,
        auth: true,
        expectStatus: 200,
        expectFields: { message: 'string' },
        async check(res, state, ctx) {
            const list = await ctx.api('GET', '/api/sites');
            assert.ok(!list.body.some((s) => s.id === state.siteId), 'site removed');
        },
    },
];

// ── runner ─────────────────────────────────────────────────────────────────

function assertFieldTypes(body, fields, where) {
    for (const [field, type] of Object.entries(fields)) {
        assert.ok(field in body, `${where}: field "${field}" present`);
        const actual = type === 'array'
            ? (Array.isArray(body[field]) ? 'array' : typeof body[field])
            : typeof body[field];
        assert.equal(actual, type, `${where}: field "${field}" is ${type}`);
    }
}

async function api(baseUrl, method, urlPath, { token, body } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(baseUrl + urlPath, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON response */ }
    return { status: res.status, headers: res.headers, body: json, text };
}

for (const target of TARGETS) {
    describe(`contract [${target}]`, () => {
        let ctx; // { baseUrl, close() }
        let skipReason = null;
        // State shared across the ordered cases of this target run (tokens,
        // created ids). Cases run sequentially within a describe block.
        const state = {};

        before(async () => {
            const started = target === 'express' ? await startExpress() : await startWorker();
            if (started.skipReason) {
                skipReason = started.skipReason;
                console.error(`[contract:${target}] SKIP — ${skipReason}`);
                return;
            }
            ctx = started;
        });

        after(async () => {
            if (ctx) await ctx.close();
        });

        for (const c of CASES) {
            it(c.name, async (t) => {
                if (skipReason) {
                    t.skip(`runtime unavailable: ${skipReason.split('\n')[0]}`);
                    return;
                }
                const urlPath = typeof c.path === 'function' ? c.path(state) : c.path;
                const body = typeof c.body === 'function' ? c.body(state) : c.body;
                const token = c.authToken ? c.authToken(state) : (c.auth ? state.adminToken : undefined);
                const res = await api(ctx.baseUrl, c.method, urlPath, { token, body });

                const expected = c.expectStatusByRuntime
                    ? c.expectStatusByRuntime[target]
                    : c.expectStatus;
                assert.equal(res.status, expected,
                    `${c.method} ${urlPath} status (body: ${res.text.slice(0, 300)})`);

                if (c.expectType === 'array') {
                    assert.ok(Array.isArray(res.body), 'response body is an array');
                }
                if (c.expectFields) {
                    assert.ok(res.body && typeof res.body === 'object' && !Array.isArray(res.body),
                        'response body is a JSON object');
                    assertFieldTypes(res.body, c.expectFields, 'response');
                }
                if (c.elementFields) {
                    for (const el of res.body) assertFieldTypes(el, c.elementFields, 'array element');
                }
                if (c.check) {
                    await c.check(res, state, { api: (m, p, opts) => api(ctx.baseUrl, m, p, opts) });
                }
            });
        }
    });
}
