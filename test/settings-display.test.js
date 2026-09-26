const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public/js/settings-loader.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');

async function load(settings) {
    const elements = new Map();
    for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
        elements.set(id, { textContent: '', hidden: false, style: {} });
    }
    const meta = { setAttribute(key, value) { this[key] = value; } };
    const logo = { textContent: 'Mirza' };
    const favicon = {};
    const canonical = { setAttribute(key, value) { this[key] = value; } };
    const colors = {};
    const created = [];
    const submission = { style: {}, closest() { return null; } };
    const document = {
        title: 'Mirza - 个人导航工作台',
        getElementById: id => elements.get(id) || null,
        querySelector(selector) {
            if (selector === 'meta[name="description"]') return meta;
            if (selector === 'link[rel="icon"]') return favicon;
            if (selector === 'link[rel="canonical"]') return canonical;
            if (selector === 'meta[property="og:url"]') return null;
            if (selector === 'script[type="application/ld+json"]') return null;
            return null;
        },
        querySelectorAll(selector) {
            if (selector === '.logo-text') return [logo];
            if (selector === 'a[href="contribute.html"]') return [submission];
            return [];
        },
        createElement(tag) {
            const el = { tag, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
            created.push(el);
            return el;
        },
        head: { appendChild(el) { this.appended = el; } },
        documentElement: { style: { setProperty(key, value) { colors[key] = value; } } },
    };
    const window = { dispatchEvent() {} };
    vm.runInNewContext(source, {
        document, window,
        fetch: async () => ({ ok: true, json: async () => settings }),
        CustomEvent: class {},
        sanitizeUrl(value) {
            try {
                const url = new URL(value, 'https://dognav.example');
                return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
            } catch { return null; }
        },
    });
    await window.DogNavSettings.ready;
    return { elements, meta, logo, favicon, canonical, colors, created, submission, document, head: document.head };
}

test('后台设置应用到首页描述、名称、图标、页脚链接、主题与投稿入口', async () => {
    const page = await load({
        site_name: '我的导航', site_description: '每天使用的工具', site_icon: '/custom.ico',
        site_url: 'https://nav.example.com/',
        footer_text: '我的版权文字', footer_blog_url: 'https://blog.example/',
        footer_github_url: 'https://github.com/example',
        theme_primary_color: '#123456', theme_secondary_color: '#abcdef',
        submission_enabled: 'false',
    });
    assert.equal(page.elements.get('siteDescription').textContent, '每天使用的工具');
    assert.equal(page.elements.get('siteDescription').hidden, false);
    assert.equal(page.meta.content, '每天使用的工具');
    assert.equal(page.logo.textContent, '我的导航');
    assert.match(page.document.title, /我的导航/);
    assert.equal(page.favicon.href, 'https://dognav.example/custom.ico');
    assert.equal(page.canonical.href, 'https://nav.example.com/');
    assert.equal(page.head.appended.attrs.property, 'og:url');
    assert.equal(page.head.appended.attrs.content, 'https://nav.example.com/');
    assert.equal(page.elements.get('footerText').textContent, '我的版权文字');
    assert.equal(page.elements.get('footerText').hidden, false);
    assert.equal(page.elements.get('footerBlogLink').href, 'https://blog.example/');
    assert.equal(page.elements.get('footerGithubLink').href, 'https://github.com/example');
    assert.equal(page.elements.get('footerBlogWrap').style.display, '');
    assert.equal(page.colors['--accent'], '#123456');
    assert.equal(page.colors['--accent-on'], '#fff');
    assert.equal(page.colors['--accent-2'], '#abcdef');
    assert.equal(page.colors['--accent-soft'], 'rgba(18, 52, 86, 0.12)');
    assert.equal(page.submission.style.display, 'none');
});

test('强调色上的文字随背景亮度选择对比色', async () => {
    const page = await load({ theme_primary_color: '#667eea' });
    assert.equal(page.colors['--accent-on'], '#0d1420');
    const dark = await load({ theme_primary_color: 'rgb(12, 34, 56)' });
    assert.equal(dark.colors['--accent-on'], '#fff');
});

test('清空描述和页脚隐藏内容，空或非法外链不会显示', async () => {
    const page = await load({ site_description: '', footer_text: '',
        footer_blog_url: '', footer_github_url: 'javascript:alert(1)' });
    for (const id of ['siteDescription', 'footerText']) {
        assert.equal(page.elements.get(id).textContent, '');
        assert.equal(page.elements.get(id).hidden, true);
    }
    assert.equal(page.meta.content, '');
    assert.equal(page.elements.get('footerBlogWrap').style.display, 'none');
    assert.equal(page.elements.get('footerGithubWrap').style.display, 'none');
});
