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
        const names = ['ChatGPT', 'Claude', 'Cursor', 'Hugging Face', 'Kimi', 'Midjourney', 'Perplexity', 'Poe', '设计素材', '在线文档', '开发工具', '个人收藏'];
        const icons = ['🤖', '🧠', '⌨️', '🤗', '🌙', '🎨', '🔎', '🔮', 'S', '📄', 'D', '⭐'];
        for (let i = 1; i <= 12; i++) {
            const res = await api(ctx.baseUrl, 'POST', '/api/sites', { token, body: { name: names[i - 1], url: `https://site${i}.example/`, category: 'tools', icon: icons[i - 1] } });
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
            if (!localStorage.getItem('dognav-pinned')) localStorage.setItem('dognav-pinned', JSON.stringify(ids));
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
        const initialPrimary = (await api(ctx.baseUrl, 'GET', '/api/settings')).body.theme_primary_color;
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
        await api(ctx.baseUrl, 'PUT', '/api/admin/settings', { token, body: { theme_primary_color: initialPrimary } });
        await page.goto(ctx.baseUrl);
        await page.waitForFunction(() => document.getElementById('siteDescription').textContent === '浏览器回归验证');
        fs.mkdirSync('/tmp/dognav-ui', { recursive: true });
        await page.locator('#loader').waitFor({ state: 'hidden' });
        await page.evaluate(ids => localStorage.setItem('dognav-pinned', JSON.stringify(ids.slice(0, 8))), ids);
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.dock-item').length === 8);
        await page.locator('.card').first().waitFor({ state: 'attached' });
        await page.locator('#loader').waitFor({ state: 'hidden' });
        for (const [width, height] of [[1440, 900], [1024, 768], [390, 844], [360, 800]]) {
            await page.setViewportSize({ width, height });
            for (const theme of ['dark', 'light']) {
                await page.evaluate(theme => {
                    document.documentElement.classList.add('notransition');
                    document.documentElement.dataset.theme = theme;
                    window.scrollTo(0, 0);
                }, theme);
                await page.waitForFunction(() => document.querySelector('.card.vis'));
                const layout = await page.evaluate(() => {
                    const card = document.querySelector('.card').getBoundingClientRect();
                    const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
                    const chip = document.getElementById('tagFilterChip');
                    chip.hidden = false;
                    const chipDisplay = getComputedStyle(chip).display;
                    chip.hidden = true;
                    const active = getComputedStyle(document.querySelector('.view-pill.on'));
                    const channels = value => (value.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
                    const luminance = color => {
                        const [r, g, b] = channels(color).map(n => {
                            const c = n / 255;
                            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
                        });
                        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
                    };
                    const fg = luminance(active.color);
                    const bg = luminance(active.backgroundColor);
                    return {
                        overflow: document.documentElement.scrollWidth > innerWidth,
                        cardBottom: card.bottom,
                        navTop: nav.top,
                        browsePosition: getComputedStyle(document.getElementById('browseHead')).position,
                        navBackground: getComputedStyle(document.getElementById('bottomNav')).backgroundColor,
                        chipDisplay,
                        activeContrast: (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05),
                    };
                });
                assert.equal(layout.overflow, false, `${width}x${height} ${theme}: horizontal overflow`);
                assert.ok(layout.chipDisplay.includes('flex'), 'tag filter chip should retain its pill layout');
                assert.ok(layout.activeContrast >= 4.5, `${width}x${height} ${theme}: active filter text contrast ${layout.activeContrast}`);
                if (width <= 768) {
                    assert.equal(layout.browsePosition, 'static', 'mobile browse header must scroll with the page');
                    assert.ok(layout.cardBottom < layout.navTop - 4, `${width}x${height} ${theme}: first card must fit above bottom bar (${JSON.stringify(layout)})`);
                    assert.ok(!['transparent', 'rgba(0, 0, 0, 0)'].includes(layout.navBackground), 'mobile bottom bar needs an opaque surface');
                    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                    const end = await page.evaluate(() => ({ card: [...document.querySelectorAll('.card')].at(-1).getBoundingClientRect().bottom, nav: document.getElementById('bottomNav').getBoundingClientRect().top }));
                    assert.ok(end.card < end.nav, `${width}x${height} ${theme}: last card must scroll above bottom bar`);
                    await page.evaluate(() => window.scrollTo(0, 0));
                } else {
                    assert.ok(layout.cardBottom < height, `${width}x${height} ${theme}: first card should appear in first viewport`);
                }
                await page.screenshot({ path: `/tmp/dognav-ui/home-${width}x${height}-${theme}.png` });
                await page.screenshot({ path: `/tmp/dognav-ui/home-${width}x${height}-${theme}-full.png`, fullPage: true });
            }
        }
        await page.locator('#searchInput').fill('ChatGPT');
        await page.locator('#searchPanel').waitFor({ state: 'visible' });
        await page.keyboard.press('Escape');
        await page.locator('#searchInput').fill('');
        await page.locator('#editDock').click();
        assert.equal(await page.locator('.dock-tools').count(), 8);
        await page.locator('#editDock').click();
        await page.locator('.card-star').first().click();
        assert.equal(await page.locator('#stFavNum').textContent(), '1');
        await page.locator('.view-pill[data-view="fav"]').click();
        assert.equal(await page.locator('.card').count(), 1);
        await page.locator('.view-pill[data-view="all"]').click();
        await page.locator('#catDrawerBtn').click();
        assert.equal(await page.locator('#catDrawer').isVisible(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#catDrawer').isVisible(), false);
        await page.locator('#btnSettings').click();
        await page.locator('[data-set-theme="dark"]').click();
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: 12-pin behavior, failure/retry, settings, search, editing, favorites, drawer, and 8 responsive light/dark layouts.');
    } finally {
        if (browser) await browser.close();
        await ctx.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
