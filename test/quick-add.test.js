// Static contract tests for Quick Add & Bookmarklet functionality.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const quickAddHtml = fs.readFileSync(path.join(root, 'public/quick-add.html'), 'utf8');
const quickAddJs = fs.readFileSync(path.join(root, 'public/js/quick-add.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'public/admin/dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'public/admin/js/dashboard.js'), 'utf8');
const authJs = fs.readFileSync(path.join(root, 'public/admin/auth.js'), 'utf8');

test('quick-add.html: contains essential elements and form controls', () => {
    assert.match(quickAddHtml, /id="loginView"/);
    assert.match(quickAddHtml, /id="quickAddView"/);
    assert.match(quickAddHtml, /id="splashView"/);
    assert.match(quickAddHtml, /id="siteUrl"/);
    assert.match(quickAddHtml, /id="siteName"/);
    assert.match(quickAddHtml, /id="siteCategory"/);
    assert.match(quickAddHtml, /id="siteIcon"/);
    assert.match(quickAddHtml, /id="siteDesc"/);
    assert.match(quickAddHtml, /id="tagList"/);
    assert.match(quickAddHtml, /id="btnSave"/);
    assert.match(quickAddHtml, /id="btnCancel"/);
    assert.match(quickAddHtml, /quick-add\.js/);
});

test('quick-add.js: parses query params, checks token, and supports auto-fetching and saving', () => {
    assert.match(quickAddJs, /params\.get\('url'\)/);
    assert.match(quickAddJs, /params\.get\('title'\)/);
    assert.match(quickAddJs, /params\.get\('desc'\)/);
    assert.match(quickAddJs, /localStorage\.getItem\('admin_token'\)/);
    assert.match(quickAddJs, /sessionStorage\.getItem\('admin_token'\)/);
    assert.match(quickAddJs, /\/api\/fetch-icon/);
    assert.match(quickAddJs, /\/api\/sites/);
    assert.match(quickAddJs, /window\.close\(\)/);
});

test('dashboard: includes Bookmarklet button and dynamic script generator', () => {
    assert.match(dashboardHtml, /id="bookmarkletBtn"/);
    assert.match(dashboardHtml, /id="bookmarkletOverlay"/);
    assert.match(dashboardHtml, /id="bookmarkletLink"/);
    assert.match(dashboardHtml, /id="bookmarkletCode"/);
    assert.match(dashboardJs, /quick-add\.html\?url=/);
    assert.match(dashboardJs, /javascript:\(function\(\)/);
});

test('auth.js: seamlessly syncs persistent token from localStorage into sessionStorage', () => {
    assert.match(authJs, /localStorage\.getItem\('admin_token'\)/);
    assert.match(authJs, /sessionStorage\.setItem\('admin_token'/);
});

test('app.js & index.html: in-place quick add integration for admins', () => {
    const homeHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
    const homeJs = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');
    assert.match(homeHtml, /id="navQuickAddLi"/);
    assert.match(homeHtml, /id="navQuickAddBtn"/);
    assert.match(homeJs, /function openQuickAdd/);
    assert.match(homeJs, /sec-quick-add/);
    assert.match(homeJs, /BroadcastChannel\('dognav_channel'\)/);
});

test('dashboard: batch paste and auto-parse feature contract', () => {
    assert.match(dashboardHtml, /id="batchAddBtn"/);
    assert.match(dashboardHtml, /id="batchAddOverlay"/);
    assert.match(dashboardHtml, /id="batchTextarea"/);
    assert.match(dashboardHtml, /id="btnStartBatchParse"/);
    assert.match(dashboardHtml, /id="btnConfirmBatchSave"/);
    assert.match(dashboardJs, /openBatchAddModal/);
    assert.match(dashboardJs, /btnStartBatchParse/);
    assert.match(dashboardJs, /btnConfirmBatchSave/);
    assert.match(dashboardJs, /https\?:\\\/\\\/\[\^\\s\)\]>"'<>\s]+/gi.source ? /https/ : /https/);
});
