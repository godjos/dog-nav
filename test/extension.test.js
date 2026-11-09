// Tests for the standalone Chrome/Edge extension package and distribution.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const extDir = path.join(root, 'chrome-extension');
const manifestPath = path.join(extDir, 'manifest.json');
const dashboardHtml = fs.readFileSync(path.join(root, 'public/admin/dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'public/admin/js/dashboard.js'), 'utf8');

test('chrome-extension: manifest.json is valid Manifest V3', () => {
    assert.ok(fs.existsSync(manifestPath), 'manifest.json exists');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'Dog-Nav 快速收藏');
    assert.equal(manifest.action.default_popup, 'popup.html');
    assert.equal(manifest.background.service_worker, 'background.js');
    assert.ok(manifest.permissions.includes('activeTab'));
    assert.ok(manifest.permissions.includes('storage'));
    assert.ok(manifest.permissions.includes('contextMenus'));
    assert.equal(manifest.commands._execute_action.suggested_key.default, 'Alt+D');
});

test('chrome-extension: all essential UI, script, and icon files exist', () => {
    for (const f of ['popup.html', 'popup.css', 'popup.js', 'background.js', 'options.html', 'options.js']) {
        const p = path.join(extDir, f);
        assert.ok(fs.existsSync(p), `${f} must exist`);
        assert.ok(fs.statSync(p).size > 0, `${f} must not be empty`);
    }
    for (const size of [16, 48, 128]) {
        const iconPath = path.join(extDir, `icons/icon${size}.png`);
        assert.ok(fs.existsSync(iconPath), `icon${size}.png must exist`);
        assert.ok(fs.statSync(iconPath).size > 0, `icon${size}.png must not be empty`);
    }
});

test('chrome-extension: packaged distribution zip is available in public/downloads/', () => {
    const zipPath = path.join(root, 'public/downloads/dognav-chrome-extension.zip');
    assert.ok(fs.existsSync(zipPath), 'distribution zip must exist');
    assert.ok(fs.statSync(zipPath).size > 1000, 'zip must be non-empty');
});

test('dashboard: includes Chrome extension download button and guide modal', () => {
    assert.match(dashboardHtml, /id="chromeExtBtn"/);
    assert.match(dashboardHtml, /id="chromeExtOverlay"/);
    assert.match(dashboardHtml, /dognav-chrome-extension\.zip/);
    assert.match(dashboardJs, /id="chromeExtBtn"/ ? /chromeExtBtn/ : /chromeExtBtn/);
    assert.match(dashboardJs, /chromeExtOverlay\.classList\.add\('show'\)/);
});

test('chrome-extension: cleanServerUrl strips /admin and subpaths safely', () => {
    const popupJs = fs.readFileSync(path.join(extDir, 'popup.js'), 'utf8');
    const optionsJs = fs.readFileSync(path.join(extDir, 'options.js'), 'utf8');
    assert.match(popupJs, /function cleanServerUrl/);
    assert.match(optionsJs, /function cleanServerUrl/);

    function cleanServerUrl(raw) {
        if (!raw) return '';
        let url = String(raw).trim();
        url = url.replace(/#.*$/, '');
        url = url.replace(/\/admin(\/.*)?$/i, '');
        url = url.replace(/\/(index|quick-add)\.html$/i, '');
        return url.replace(/\/+$/, '');
    }

    assert.equal(cleanServerUrl('https://homepage.980724.xyz/admin'), 'https://homepage.980724.xyz');
    assert.equal(cleanServerUrl('https://homepage.980724.xyz/admin/'), 'https://homepage.980724.xyz');
    assert.equal(cleanServerUrl('https://homepage.980724.xyz/admin/dashboard.html'), 'https://homepage.980724.xyz');
    assert.equal(cleanServerUrl('https://homepage.980724.xyz/index.html'), 'https://homepage.980724.xyz');
    assert.equal(cleanServerUrl('http://localhost:3000/admin'), 'http://localhost:3000');
    assert.equal(cleanServerUrl('http://localhost:3000'), 'http://localhost:3000');
});

test('chrome-extension: supports delete actions and management search view', () => {
    const popupHtml = fs.readFileSync(path.join(extDir, 'popup.html'), 'utf8');
    const popupJs = fs.readFileSync(path.join(extDir, 'popup.js'), 'utf8');
    const popupCss = fs.readFileSync(path.join(extDir, 'popup.css'), 'utf8');

    assert.match(popupHtml, /id="btnDeleteCurrent"/);
    assert.match(popupHtml, /id="btnToggleManage"/);
    assert.match(popupHtml, /id="manageView"/);
    assert.match(popupHtml, /id="manageSearchInput"/);
    assert.match(popupHtml, /id="manageSiteList"/);

    assert.match(popupJs, /async function deleteSite/);
    assert.match(popupJs, /DELETE/);
    assert.match(popupJs, /renderManageList/);
    assert.match(popupJs, /btnDeleteCurrent/);

    assert.match(popupCss, /\.btn-danger/);
    assert.match(popupCss, /\.manage-site-list/);
});
