// Tests for drag-and-drop reordering and duplicate detection features.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const serverJs = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'public/admin/dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(root, 'public/admin/js/dashboard.js'), 'utf8');
const quickAddHtml = fs.readFileSync(path.join(root, 'public/quick-add.html'), 'utf8');
const quickAddJs = fs.readFileSync(path.join(root, 'public/js/quick-add.js'), 'utf8');

test('server.js: defines POST /api/sites/reorder endpoint', () => {
    assert.match(serverJs, /app\.post\('\/api\/sites\/reorder', requireAuth/);
    assert.match(serverJs, /UPDATE sites SET sort_order =/);
    assert.match(serverJs, /reorder_sites/);
});

test('dashboard: includes drag handles, health dots, and status filter', () => {
    assert.match(dashboardHtml, /id="statusFilter"/);
    assert.match(dashboardHtml, /id="siteUrlDupNotice"/);
    assert.match(dashboardHtml, /<th[^>]*>排序<\/th>/);
    assert.match(dashboardJs, /class="drag-cell"/);
    assert.match(dashboardJs, /class="health-dot/);
    assert.match(dashboardJs, /function initTableDragAndDrop/);
    assert.match(dashboardJs, /\/api\/sites\/reorder/);
    assert.match(dashboardJs, /function checkSiteUrlDuplicate/);
});

test('quick-add: includes duplicate and same-domain warning notice', () => {
    assert.match(quickAddHtml, /id="urlDupNotice"/);
    assert.match(quickAddJs, /function checkDuplicateUrl/);
    assert.match(quickAddJs, /该网址已存在/);
    assert.match(quickAddJs, /同域名已有收录/);
});
