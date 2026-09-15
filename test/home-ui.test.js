// 首页 Kaka 式重构的静态 UI 契约（无浏览器，仅读源码）
// 锁定：轻顶栏 + 宽搜索（引擎内嵌）+ 分类行/模式行 + 单面板骨架；
// 默认单分类；热榜懒加载；桌面四列/平板三列/手机两列。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(projectRoot, 'public/css/style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');

test('index.html: 轻顶栏 + 搜索区 + 单一面板骨架（无 Hero/每日一言/独立引擎行）', () => {
    // 顶栏：logo / 页面入口 / 天气入口 / 主题切换 / 移动端菜单
    assert.match(indexHtml, /class="navbar"/);
    assert.match(indexHtml, /id="weatherBtn"/);
    assert.match(indexHtml, /id="themeBtn"/);
    assert.match(indexHtml, /id="mobBtn"/);
    // 搜索区：引擎选择器内嵌输入框左侧
    assert.match(indexHtml, /class="eng-select"/);
    assert.match(indexHtml, /id="engMenu" role="listbox"/);
    assert.match(indexHtml, /id="searchInput"/);
    // 面板：分类行（全部+更多+抽屉按钮）、模式行、标签行、卡片区
    assert.match(indexHtml, /class="panel"/);
    assert.match(indexHtml, /id="catPills"/);
    assert.match(indexHtml, /id="catMoreMenu"/);
    assert.match(indexHtml, /id="catDrawerBtn"/);
    assert.match(indexHtml, /id="viewBar"/);
    assert.match(indexHtml, /id="tagNav"/);
    assert.match(indexHtml, /id="cardsArea"/);
    assert.match(indexHtml, /id="catDrawer"/);
    // 已删除的旧元素
    for (const gone of ['class="hero"', 'id="hitokoto"', 'id="engRow"', 'id="homeHot"', 'id="homeFav"']) {
        assert.ok(!indexHtml.includes(gone), `应已删除 ${gone}`);
    }
});

test('app.js: 分类/模式互斥、默认推荐分类、热榜仅模式内加载', () => {
    assert.match(appJs, /function selectCategory\(id\)/);
    assert.match(appJs, /function selectView\(view\)/);
    assert.match(appJs, /function defaultCategory\(\)/);
    assert.match(appJs, /C\['recommend'\][^;\n]*'recommend'/);
    // 热榜请求只发生在 renderTrending 分支（render 中 trending 才调用 renderTrending）
    assert.match(appJs, /if \(curView === 'trending'\) \{ renderTrending\(a\)/);
    const loadHotCalls = appJs.match(/loadHot\(/g) || [];
    assert.ok(loadHotCalls.length <= 2, `loadHot 定义+调用应只在热榜链路（≤2 处），实际 ${loadHotCalls.length}`);
    assert.ok(!/renderHomeHot|renderHomeExtras|renderHomeFav|fetchRealIcon/.test(appJs), '首页默认热榜/收藏附加区应已移除');
    // localStorage 兼容键
    for (const key of ['dognav-favorites', 'dognav-recent', 'dognav-theme', 'dognav-hot-source']) {
        assert.ok(appJs.includes(key), `缺少 localStorage 键 ${key}`);
    }
});

test('style.css: 蓝白/灰蓝主题、4/3/2 列响应式、紧凑卡片', () => {
    // 主题基调
    assert.match(styleCss, /--accent:\s*#2f6fed/);
    assert.match(styleCss, /--bg-base:\s*#edf1f7/);
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--accent:\s*#5b93f5/);
    assert.ok(!/linear-gradient\(135deg, var\(--accent\), #a286ff\)/.test(styleCss), '紫色渐变应已移除');
    // 断点：桌面四列 / 平板(≤1024)三列 / 手机(≤480)两列
    assert.match(styleCss, /repeat\(4, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 1024px\)[\s\S]*?repeat\(3, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 480px\)[\s\S]*?repeat\(2, 1fr\)/);
    // 面板与紧凑卡片
    assert.match(styleCss, /--content-width:\s*1280px/);
    assert.match(styleCss, /\.panel-head \{[\s\S]*?position: sticky/);
    assert.match(styleCss, /\.card \{[\s\S]*?border-radius: var\(--r-md\)/);
    assert.match(styleCss, /\.cat-drawer-btn \{ display: none; \}/);
    assert.match(styleCss, /@media \(max-width: 768px\)[\s\S]*?\.cat-drawer-btn \{/);
});
