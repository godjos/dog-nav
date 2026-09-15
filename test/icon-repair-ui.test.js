// Static UI contract for the bookmark-import feedback (backup page) and the
// batch icon-repair flow (dashboard page). These tests only read the HTML/JS
// sources — no browser needed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const backupHtml = fs.readFileSync(path.join(projectRoot, 'public/admin/backup.html'), 'utf8');
const backupJs = fs.readFileSync(path.join(projectRoot, 'public/admin/js/backup.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(projectRoot, 'public/admin/dashboard.html'), 'utf8');
const dashboardJs = fs.readFileSync(path.join(projectRoot, 'public/admin/js/dashboard.js'), 'utf8');

test('backup.html: bookmark import card has progress bar, file info and aria-live status', () => {
    assert.match(backupHtml, /id="bookmarkFileInfo"/);
    assert.match(backupHtml, /id="bookmarkProgressWrap"/);
    assert.match(backupHtml, /id="bookmarkProgressFill"/);
    assert.match(backupHtml, /id="bookmarkProgressText"/);
    assert.match(backupHtml, /id="bookmarkImportStatus"[^>]*role="status"[^>]*aria-live="polite"/);
    assert.match(backupHtml, /class="progress-fill"/);
});

test('backup.js: FileReader progress, staged states, input lock/restore and error recovery', () => {
    // 文件读取进度来自 FileReader 的 progress 事件
    assert.match(backupJs, /FileReader/);
    assert.match(backupJs, /readAsText/);
    // 读取 → 解析 → 导入 → 完成 各阶段文案
    assert.match(backupJs, /正在读取文件/);
    assert.match(backupJs, /正在解析书签/);
    assert.match(backupJs, /正在写入分类和站点/);
    assert.match(backupJs, /图标可在「站点管理」页批量修复/);
    // 无效 JSON / 无书签 / 网络错误分别提示
    assert.match(backupJs, /不是有效的 JSON/);
    assert.match(backupJs, /没有可导入的书签/);
    assert.match(backupJs, /网络错误/);
    // 导入期间禁用文件选择，完成或失败后恢复并可重新选择同一文件
    assert.match(backupJs, /input\.disabled = true/);
    assert.match(backupJs, /input\.disabled = false/);
    assert.match(backupJs, /input\.value = ''/);
    // toast 复用 auth.js 全局实现，页面内不再有重复的 toast 定义
    assert.ok(!/function showToast/.test(backupJs), 'page-local showToast must be removed');
    assert.match(backupJs, /showToast\(/);
});

test('dashboard.html: admin-only repair button with progress and status area', () => {
    assert.match(dashboardHtml, /id="repairIconsBtn"[^>]*data-role="admin"/);
    assert.match(dashboardHtml, /修复网站图标/);
    assert.match(dashboardHtml, /id="repairProgressFill"/);
    assert.match(dashboardHtml, /id="repairStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('dashboard.js: batched repair calls (5/batch), re-entry guard, summary and list refresh', () => {
    assert.match(dashboardJs, /\/api\/admin\/repair-icons/);
    // 每批最多 5 个站点
    assert.match(dashboardJs, /slice\(i, i \+ 5\)/);
    // 执行期间禁止重复启动（按钮禁用 + 守卫）
    assert.match(dashboardJs, /if \(btn\.disabled\) return/);
    assert.match(dashboardJs, /setBtnLoading\(btn, true/);
    // 完成后汇总四种状态并刷新列表
    assert.match(dashboardJs, /修复完成：修复 \$\{summary\.repaired\} 个，未变化 \$\{summary\.unchanged\} 个，跳过 \$\{summary\.skipped\} 个，失败 \$\{summary\.failed\} 个/);
    assert.match(dashboardJs, /loadSites\(\)/);
    // 进度按已完成数量计算真实百分比
    assert.match(dashboardJs, /done \/ total \* 100/);
});
