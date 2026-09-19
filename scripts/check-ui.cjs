// Run with PLAYWRIGHT_BROWSERS_PATH=/tmp/dognav-browsers node scripts/check-ui.cjs
// Uses the already-installed playwright-core and an isolated temporary database.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { startTestServer, api } = require('../test/helpers');
(async () => {
    const ctx = await startTestServer();
    let browser;
    try {
        const login = await api(ctx.baseUrl, 'POST', '/api/auth/login', { body: { username: 'admin', password: ctx.adminPassword } });
        let token = login.body.token;
        await api(ctx.baseUrl, 'PUT', '/api/auth/password', { token, body: { oldPassword: ctx.adminPassword, newPassword: 'BrowserTest123!' } });
        token = (await api(ctx.baseUrl, 'POST', '/api/auth/login', { body: { username: 'admin', password: 'BrowserTest123!' } })).body.token;
        for (let i = 1; i <= 12; i++) {
            const res = await api(ctx.baseUrl, 'POST', '/api/sites', { token, body: { name: `测试站点${i}`, url: `https://site${i}.example/`, category: 'tools', icon: 'T' } });
            assert.equal(res.status, 200);
        }
        const sites = (await api(ctx.baseUrl, 'GET', '/api/sites')).body;
        const ids = sites.map(s => s.id);
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://**/*', route => route.abort());
        await page.addInitScript(({ token, ids }) => {
            sessionStorage.setItem('admin_token', token);
            sessionStorage.setItem('admin_logged_in', '1');
            localStorage.setItem('dognav-pinned', JSON.stringify(ids));
        }, { token, ids });
        await page.goto(ctx.baseUrl);
        await page.waitForFunction(() => document.querySelectorAll('.dock-item').length === 12);
        assert.equal(await page.locator('.dock-item').count(), 12);
        await page.route('**/api/sites', route => route.fulfill({ status: 503, body: '{}' }));
        await page.reload();
        await page.locator('#homeLoadState button').waitFor({ state: 'visible' });
        await page.unroute('**/api/sites');
        await page.locator('#homeLoadState button').click();
        await page.waitForFunction(() => document.getElementById('homeLoadState').hidden);
        await api(ctx.baseUrl, 'PUT', '/api/admin/settings', { token, body: { theme_primary_color: 'rgb(12, 34, 56)' } });
        await page.goto(ctx.baseUrl + '/admin/settings');
        await page.waitForFunction(() => !document.getElementById('saveSettingsBtn').disabled);
        assert.equal(await page.locator('#theme_primary_color').inputValue(), 'rgb(12, 34, 56)');
        await page.locator('#site_description').fill('浏览器回归验证');
        const saved = page.waitForResponse(res => res.url().endsWith('/api/admin/settings') && res.request().method() === 'PUT');
        await page.locator('#saveSettingsBtn').click();
        const response = await saved;
        assert.equal(response.status(), 200);
        assert.deepEqual(response.request().postDataJSON(), { site_description: '浏览器回归验证' });
        assert.equal((await api(ctx.baseUrl, 'GET', '/api/settings')).body.theme_primary_color, 'rgb(12, 34, 56)');
        await page.goto(ctx.baseUrl);
        await page.waitForFunction(() => document.getElementById('siteDescription').textContent === '浏览器回归验证');
        fs.mkdirSync('/tmp/dognav-ui', { recursive: true });
        await page.locator('#loader').waitFor({ state: 'hidden' });
        for (const width of [1440, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const theme of ['dark', 'light']) {
                await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
                await page.screenshot({ path: `/tmp/dognav-ui/home-${width}-${theme}.png`, fullPage: true });
            }
        }
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: 12 pins, visible failure/retry, unchanged color, partial settings update, desktop/mobile light/dark.');
    } finally {
        if (browser) await browser.close();
        await ctx.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
