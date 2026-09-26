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
            const res = await api(ctx.baseUrl, 'POST', '/api/sites', { token, body: { name: names[i - 1], url: `https://site${i}.example/`, category: 'tools', icon: icons[i - 1], description: i === 1 ? '智能对话与写作' : '' } });
            assert.equal(res.status, 200);
        }
        const sites = (await api(ctx.baseUrl, 'GET', '/api/sites')).body;
        const ids = sites.map(s => s.id);
        for (const name of ['导航', '效率', '常用']) {
            const created = await api(ctx.baseUrl, 'POST', '/api/tags', { token, body: { name, color: '#2563eb' } });
            assert.equal(created.status, 200);
        }
        const tagIds = (await api(ctx.baseUrl, 'GET', '/api/tags')).body.map(tag => tag.id);
        assert.equal((await api(ctx.baseUrl, 'POST', `/api/sites/${ids[8]}/tags`, { token, body: { tag_ids: tagIds } })).status, 200);
        browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('https://**/*', route => route.abort());
        await page.route('**/api/widgets', route => route.fulfill({ json: [
            { id: 101, site_id: null, type: 'weather', visibility: 'public', enabled: true, sort_order: 0 },
            { id: 102, site_id: ids[0], type: 'github', visibility: 'public', enabled: true, sort_order: 1 },
        ] }));
        await page.route('**/api/admin/widgets', route => route.fulfill({ json: [
            { id: 103, site_id: ids[0], type: 'github', visibility: 'private', enabled: true, sort_order: 2 },
        ] }));
        await page.route('**/api/widgets/*/data', route => {
            const id = Number(route.request().url().match(/\/widgets\/(\d+)\/data$/)[1]);
            if (id === 103) assert.equal(route.request().headers().authorization, `Bearer ${token}`);
            route.fulfill({ json: { id, state: 'ok', fields: [{ label: 'Value', value: id }], updated_at: '2026-09-26T00:00:00Z' } });
        });
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
        await page.locator('#headerWidgets .widget-field').waitFor({ state: 'visible' });
        assert.equal(await page.locator('#pinnedGroup .widget-panel').count(), 2, 'public and private widgets belong to pinned site card');
        assert.equal(await page.locator('.card-tags .card-tag').count(), 4, 'three tags and overflow control render on the non-pinned card');
        assert.equal(await page.locator('.card-tags .card-tag:visible').count(), 3);
        await page.locator('.card-tag-more').first().click();
        assert.equal(await page.locator('.card-tags .card-tag:visible').count(), 4);
        assert.equal(await page.locator('.dock-desc').first().textContent(), '智能对话与写作');
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
                    const card = document.querySelector(innerWidth <= 768 ? '.dock-item' : '.card').getBoundingClientRect();
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
        await page.locator('#browseToolsToggle').click();
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
        for (let i = 1; i <= 5; i++) {
            const res = await api(ctx.baseUrl, 'POST', '/api/sites', { token, body: {
                name: `Developer ${i}`, url: `https://dev${i}.example/`, category: 'dev'
            } });
            assert.equal(res.status, 200);
        }
        for (let i = 1; i <= 2; i++) {
            const res = await api(ctx.baseUrl, 'POST', '/api/sites', { token, body: {
                name: `Design ${i}`, url: `https://design${i}.example/`, category: 'design', description: '设计工具'
            } });
            assert.equal(res.status, 200);
        }
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.reload();
        await page.waitForFunction(() => document.querySelectorAll('.site-group').length === 4);
        await page.locator('#loader').waitFor({ state: 'hidden' });
        assert.equal(await page.locator('.site-group .card-service').count(), 11);
        assert.equal(await page.locator('#pinnedGroup .dock-item').count(), 8);
        const pinnedIds = await page.locator('#pinnedGroup .dock-item').evaluateAll(links => links.map(a => new URL(a.href).href));
        const categoryIds = await page.locator('.card-link').evaluateAll(links => links.map(a => new URL(a.href).href));
        assert.equal(pinnedIds.some(url => categoryIds.includes(url)), false, 'pinned links must not duplicate in category groups');
        // 统一排版：所有分类组整行同列数，不再有半行/三分之一行组
        assert.equal(await page.locator('.site-group-full').count(), 4, 'every group renders full-width in unified layout');
        assert.equal(await page.locator('.site-group-half, .site-group-third').count(), 0, 'unified layout must not emit width-tier classes');
        assert.ok(await page.locator('.site-group .card-service').first().evaluate(el => el.getBoundingClientRect().width > 280), 'four-column cards must retain readable width');
        assert.equal(await page.locator('.card-abbr, .card-domain').count(), 0, 'unified compact cards must not render legacy bookmark parts');
        assert.equal(await page.locator('.card-link .card-star').count(), 0, 'card actions must be outside links');
        await page.evaluate(() => document.querySelectorAll('.rv').forEach(el => el.classList.add('vis')));
        await page.screenshot({ path: '/tmp/dognav-ui/home-mixed-groups-dark-full.png', fullPage: true });
        await page.setViewportSize({ width: 360, height: 800 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'mixed groups must not overflow mobile viewport');
        await page.screenshot({ path: '/tmp/dognav-ui/home-mixed-groups-mobile-dark-full.png', fullPage: true });
        assert.deepEqual(errors, []);
        console.log('Browser checks passed: 12-pin behavior, failure/retry, settings, search, editing, favorites, drawer, mixed group layouts, and 8 responsive light/dark layouts.');
    } finally {
        if (browser) await browser.close();
        await ctx.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
