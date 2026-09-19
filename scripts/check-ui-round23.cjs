// Round-2/3 feature verification: admin home-settings preview (postMessage),
// Netscape bookmark HTML import with preview, site_url -> canonical/og:url,
// homepage preference export/import.
// Run with PLAYWRIGHT_BROWSERS_PATH=/tmp/dognav-browsers node scripts/check-ui-round23.cjs
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { startTestServer, api } = require('../test/helpers');

const BOOKMARK_HTM = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://alpha.example/">Alpha</A>
    <DT><H3>Dev</H3>
    <DL><p>
        <DT><A HREF="https://beta.example/">Beta &amp; Co</A>
        <DT><A HREF="https://gamma.example/">Gamma</A>
    </DL><p>
</DL><p>`;

(async () => {
    const ctx = await startTestServer();
    let browser;
    try {
        const login = await api(ctx.baseUrl, 'POST', '/api/auth/login', { body: { username: 'admin', password: ctx.adminPassword } });
        let token = login.body.token;
        await api(ctx.baseUrl, 'PUT', '/api/auth/password', { token, body: { oldPassword: ctx.adminPassword, newPassword: 'BrowserTest123!' } });
        token = (await api(ctx.baseUrl, 'POST', '/api/auth/login', { body: { username: 'admin', password: 'BrowserTest123!' } })).body.token;

        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.addInitScript(({ token }) => {
            sessionStorage.setItem('admin_token', token);
            sessionStorage.setItem('admin_logged_in', '1');
        }, { token });

        // ── 1. site_url → canonical / og:url ─────────────────────────────
        const siteUrl = 'https://nav-check.example/';
        assert.equal((await api(ctx.baseUrl, 'PUT', '/api/admin/settings', { token, body: { site_url: siteUrl } })).status, 200);
        await page.goto(ctx.baseUrl);
        await page.waitForFunction(() => document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.startsWith('https://nav-check.example'));
        assert.equal(await page.evaluate(() => document.querySelector('meta[property="og:url"]')?.getAttribute('content')), siteUrl);
        assert.match(await page.evaluate(() => document.querySelector('script[type="application/ld+json"]').textContent), /nav-check\.example/);

        // ── 2. 后台首页设置预览（postMessage → iframe）──────────────────
        await page.goto(ctx.baseUrl + '/admin/settings');
        await page.waitForFunction(() => !document.getElementById('saveSettingsBtn').disabled);
        await page.locator('#site_description').fill('预览验证副标题');
        await page.locator('#home_default_engine').selectOption({ index: 1 });
        const engineLabel = await page.locator('#home_default_engine option:checked').textContent();
        await page.locator('#previewHomeBtn').click();
        const frame = page.frameLocator('#home_preview');
        await frame.locator('#siteDescription').waitFor({ state: 'visible' });
        assert.equal(await frame.locator('#siteDescription').textContent(), '预览验证副标题');
        await page.waitForFunction(() => {
            const iframe = document.getElementById('home_preview');
            return iframe.contentDocument?.getElementById('engineLabel')?.textContent?.length > 0;
        });
        assert.equal(await page.evaluate(() => document.getElementById('home_preview').contentDocument.getElementById('engineLabel').textContent), engineLabel);

        // ── 3. Netscape 书签 HTML：解析预览 → 确认导入 ──────────────────
        await page.goto(ctx.baseUrl + '/admin/backup');
        const htmPath = path.join(os.tmpdir(), 'dognav-bookmarks-check.htm');
        fs.writeFileSync(htmPath, BOOKMARK_HTM);
        await page.setInputFiles('#bookmarkFile', htmPath);
        await page.waitForFunction(() => !document.getElementById('bookmarkPreview').hidden);
        assert.match(await page.locator('#bookmarkSummary').textContent(), /共 3 个站点/);
        assert.match(await page.locator('#bookmarkSummary').textContent(), /1 个分类/);
        assert.equal(await page.locator('#bookmarkList li').count(), 3);
        const imported = page.waitForResponse(res => res.url().endsWith('/api/import/bookmarks') && res.request().method() === 'POST');
        await page.locator('#bookmarkConfirmBtn').click();
        const importRes = await imported;
        assert.equal(importRes.status(), 200);
        assert.deepEqual(await importRes.json().then(b => [b.sites, b.categories]), [3, 2]);
        await page.waitForFunction(() => document.getElementById('bookmarkImportStatus').classList.contains('success'));
        const sites = (await api(ctx.baseUrl, 'GET', '/api/sites')).body.map(s => s.url);
        for (const u of ['https://alpha.example/', 'https://beta.example/', 'https://gamma.example/']) assert.ok(sites.includes(u), u);

        // ── 4. 个人偏好导出/导入 ─────────────────────────────────────────
        await page.goto(ctx.baseUrl);
        await page.locator('#btnSettings').click();
        const downloadPromise = page.waitForEvent('download');
        await page.locator('#setExportPrefs').click();
        const download = await downloadPromise;
        const prefPath = path.join(os.tmpdir(), 'dognav-prefs-check.json');
        await download.saveAs(prefPath);
        const prefs = JSON.parse(fs.readFileSync(prefPath, 'utf8'));
        assert.equal(prefs.app, 'dognav');
        assert.equal(prefs.kind, 'preferences');
        assert.ok(prefs.data && typeof prefs.data === 'object');
        // 导入：替换 pinned 后导入并刷新生效
        prefs.data['dognav-pinned'] = JSON.stringify([]);
        fs.writeFileSync(prefPath, JSON.stringify(prefs));
        await page.setInputFiles('#prefFileInput', prefPath);
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('dognav-pinned') || 'null')?.length === 0);

        assert.deepEqual(errors, []);
        console.log('Round-2/3 browser checks passed: site_url canonical/og/JSON-LD, admin preview postMessage, bookmark HTML import with preview, preference export/import.');
    } finally {
        if (browser) await browser.close();
        await ctx.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
