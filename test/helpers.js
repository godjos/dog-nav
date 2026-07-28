// Test helpers — start a real server instance against a throwaway database.
//
// server.js keeps its db as a module-level singleton, so a process can only
// ever have ONE database open. All API tests therefore live in a single test
// file (api.test.js) and share one server started via module-level
// before/after hooks. Do not call startTestServer() from more than one file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');

const TEST_ADMIN_PASSWORD = 'TestAdmin123!';

async function startTestServer() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dognav-test-'));

    // server.js reads these at require() time, so set them before requiring.
    process.env.DB_PATH = path.join(tmpDir, 'test.db');
    process.env.UPLOAD_DIR = path.join(tmpDir, 'uploads');
    process.env.INITIAL_ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;
    // POST /api/weather must hit its 503 "Weather not configured" branch;
    // never let an ambient WEATHER_API_KEY leak into the test server.
    delete process.env.WEATHER_API_KEY;

    const { start } = require('../server.js');
    const server = await start(0);
    if (!server.address()) await once(server, 'listening');
    const port = server.address().port;

    return {
        baseUrl: `http://127.0.0.1:${port}`,
        server,
        tmpDir,
        adminPassword: TEST_ADMIN_PASSWORD,
        async close() {
            await new Promise((resolve) => server.close(resolve));
            fs.rmSync(tmpDir, { recursive: true, force: true });
        },
    };
}

// Small fetch wrapper: returns { status, headers, body } with JSON parsed.
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

module.exports = { startTestServer, api, TEST_ADMIN_PASSWORD };
