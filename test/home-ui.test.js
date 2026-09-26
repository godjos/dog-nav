const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public/css/style.css'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

test('compact homepage keeps search and existing personal actions', () => {
    for (const id of ['clock', 'headerWidgets', 'searchInput', 'searchIco', 'searchPanel', 'statusRow',
        'pinnedGroup', 'dockBar', 'editDock', 'browseToolsToggle', 'browseTools', 'cardsArea',
        'btnSettings', 'stFavNum', 'stRecentBody']) {
        assert.match(html, new RegExp(`id="${id}"`), `${id} is missing`);
    }
    assert.match(html, /class="top-desc" id="siteDescription" hidden/);
    assert.doesNotMatch(html, /class="hero"/);
    assert.match(app, /function togglePin\(id\)/);
    assert.match(app, /function toggleFav\(id\)/);
    assert.match(app, /function reportSite\(id, btn\)/);
    assert.match(app, /function scoreSite\(s, ql\)/);
    assert.match(css, /\.browse-tools-toggle/);
    assert.match(css, /\.home-topbar/);
});

test('configured layout orders groups, honors variants and avoids duplicate pinned links', () => {
    assert.match(app, /Array\.isArray\(homeConfig\.layout\)/);
    assert.match(app, /\['pinned', \.\.\.orderedKeys\]/);
    assert.match(app, /items\.filter\(s => !isPinned\(s\.id\)\)/);
    assert.match(app, /const variant = entry\.variant/);
    assert.match(app, /entry\.columns/);
    assert.match(app, /applyGroupCollapse\(group, entry, head, grid\)/);
    assert.match(app, /function buildCard\(s, variant = 'service'\)/);
    assert.match(app, /card\.appendChild\(tagRow\)/);
    assert.match(app, /tags\.length - 2/);
    assert.match(css, /--group-columns/);
    assert.match(css, /\.card-tag\[hidden\]/);
});

test('widgets use public metadata and only use same-tab admin token for private data', () => {
    assert.match(app, /sessionStorage\.getItem\('admin_token'\)/);
    assert.match(app, /fetch\('\/api\/widgets'\)/);
    assert.match(app, /fetch\('\/api\/admin\/widgets'/);
    assert.match(app, /w\.visibility === 'private' \? \{ Authorization:/);
    assert.match(app, /widgetData\.set\(String\(w\.id\)/);
    assert.match(app, /buildWidgetFields\(null\)/);
    assert.match(app, /buildWidgetFields\(id\)/);
    assert.match(app, /value\.textContent =/);
});
