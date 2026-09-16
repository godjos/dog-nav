// 首页工作台重构的静态 UI 契约（无浏览器，仅读源码）
// 锁定：无顶栏（右上角浮动时钟）→ 问候 → 居中搜索（放大镜引擎入口 + ⌘K）→
// 常用 Dock → 轻量状态区（最近/稍后阅读/收藏/服务状态[/今日事项]）→
// 分类工作流区（标题左置 + 每类 5 个 + ›）；右下角文字按钮；
// 「全部应用」二级视图承载分类/精选/热门/最新/收藏/最近/热榜。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(projectRoot, 'public/css/style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');

test('index.html: 工作台骨架（浮动时钟/问候/搜索/Dock/状态区/分类区 + 全部应用二级视图）', () => {
    // 无顶栏：没有 navbar/navLinks/themeBtn/mobBtn，时钟为浮动元素
    assert.ok(!indexHtml.includes('class="navbar"'), '首页不应有顶栏');
    assert.ok(!indexHtml.includes('id="themeBtn"'), '主题切换移入设置弹层');
    assert.ok(!indexHtml.includes('id="mobBtn"'));
    assert.match(indexHtml, /class="top-clock" id="clock"/);
    // 问候（低权重标题 + 弱辅助文字）
    assert.match(indexHtml, /class="hero"/);
    assert.match(indexHtml, /id="greet"/);
    assert.match(indexHtml, /class="greet-sub"/);
    // 搜索：左侧放大镜（点开引擎菜单）+ ⌘K/Ctrl K 快捷键提示
    assert.match(indexHtml, /id="searchIco"/);
    assert.match(indexHtml, /id="engMenu" role="listbox"/);
    assert.ok(!indexHtml.includes('class="eng-select"'), '引擎选择器不再以文字下拉显示');
    assert.match(indexHtml, /id="searchInput"/);
    assert.match(indexHtml, /id="searchKbd"/);
    // 工作台主体
    assert.match(indexHtml, /id="dockBar"/);
    assert.match(indexHtml, /id="statusRow"/);
    assert.match(indexHtml, /id="stRecentBody"/);
    assert.match(indexHtml, /id="stRead"/);
    assert.match(indexHtml, /id="stFavNum"/);
    assert.match(indexHtml, /id="stHealthBody"/);
    assert.match(indexHtml, /id="stTasks"/);
    assert.match(indexHtml, /id="catSections"/);
    // 全部应用二级视图（默认隐藏）+ 其内的分类行/模式行/标签行/卡片区
    assert.match(indexHtml, /id="allView" hidden/);
    assert.match(indexHtml, /id="homeView"/);
    assert.match(indexHtml, /id="catPills"/);
    assert.match(indexHtml, /id="catMoreMenu"/);
    assert.match(indexHtml, /id="catDrawerBtn"/);
    assert.match(indexHtml, /id="viewBar"/);
    assert.match(indexHtml, /id="tagNav"/);
    assert.match(indexHtml, /id="cardsArea"/);
    assert.match(indexHtml, /id="catDrawer"/);
    // 右下角底部工具与设置弹层（含静态页面链接）
    assert.match(indexHtml, /id="bottomNav"/);
    assert.match(indexHtml, /id="btnAllApps"/);
    assert.match(indexHtml, /id="btnSettings"/);
    assert.match(indexHtml, /id="setPop"/);
    assert.match(indexHtml, /id="setClearData"/);
    assert.match(indexHtml, /id="setLinks"/);
    assert.match(indexHtml, /links\.html/);
    // 无大型 Footer
    assert.ok(!indexHtml.includes('class="footer"'), '首页不应再有大 Footer');
    // 已删除的旧元素
    for (const gone of ['id="weatherBtn"', 'id="hitokoto"', 'id="engRow"', 'id="homeHot"', 'id="homeFav"', 'id="pinnedBar"', 'id="engCurrent"', 'id="navLinks"']) {
        assert.ok(!indexHtml.includes(gone), `应已删除 ${gone}`);
    }
});

test('app.js: 视图调度、工作台渲染（Karakeep 检测/每类 5 个）、全部应用承载旧模式、localStorage 兼容键', () => {
    // 视图调度与切换
    assert.match(appJs, /let pageView = 'home'/);
    assert.match(appJs, /function openAllView\(target\)/);
    assert.match(appJs, /function goHome\(\)/);
    // 工作台渲染
    assert.match(appJs, /function renderDock\(\)/);
    assert.match(appJs, /function renderStatusRow\(\)/);
    assert.match(appJs, /function renderHomeCats\(\)/);
    assert.match(appJs, /function tickClock\(\)/);
    assert.match(appJs, /const HOME_CAT_MAX = 5/);
    assert.match(appJs, /karakeep\/i\.test/);
    assert.match(appJs, /getElementById\('searchIco'\)/);
    assert.ok(!/themeBtn|mobBtn|navbar|engCurrent/.test(appJs), '顶栏与旧引擎下拉的引用应已移除');
    // 搜索打分与热榜懒加载
    assert.match(appJs, /function scoreSite\(s, ql\)/);
    assert.match(appJs, /if \(curView === 'trending'\) \{ renderTrending\(a\)/);
    const loadHotCalls = appJs.match(/loadHot\(/g) || [];
    assert.ok(loadHotCalls.length <= 2, `loadHot 定义+调用应只在热榜链路（≤2 处），实际 ${loadHotCalls.length}`);
    assert.ok(!/renderPinnedBar|renderHomeHot|renderHomeExtras|renderHomeFav|fetchRealIcon/.test(appJs), '旧的首页附加区应已移除');
    // localStorage 兼容键
    for (const key of ['dognav-favorites', 'dognav-recent', 'dognav-theme', 'dognav-hot-source', 'dognav-pinned']) {
        assert.ok(appJs.includes(key), `缺少 localStorage 键 ${key}`);
    }
    // 模式优先级：收藏/最近排在热门/最新之前（全部应用视图内）
    assert.ok(appJs.indexOf("fav: { i: '❤️'") < appJs.indexOf("hot: { i: '🔥'"), 'VIEW_META 中收藏应排在热门前');
});

test('style.css: 深色优先令牌、浮动时钟、放大镜搜索、5 列工作流网格', () => {
    // 深色优先（index.html 默认 data-theme="dark"）
    assert.match(indexHtml, /<html lang="zh-CN" data-theme="dark">/);
    // 深色令牌：低饱和背景 + 半透明卡片 + 极弱边框
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--bg-base: #0d1420/);
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--bg-card: rgba\(255, 255, 255, 0\.03\)/);
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--border: rgba\(255, 255, 255, 0\.08\)/);
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--text-1: rgba\(255, 255, 255, 0\.9\)/);
    assert.match(styleCss, /\[data-theme="dark"\][\s\S]*--accent: #4c8dff/);
    // 深色径向环境光（克制）
    assert.match(styleCss, /radial-gradient\(1100px 520px at 50% -12%, rgba\(76, 141, 255, 0\.07\)/);
    // 浮动时钟 + 搜索放大镜入口
    assert.match(styleCss, /\.top-clock \{[\s\S]*?position: fixed/);
    assert.match(styleCss, /\.search-ico \{[\s\S]*?position: absolute/);
    // 工作流区：标题左置三列布局，条目 5 列
    assert.match(styleCss, /\.wf-sec \{[\s\S]*?grid-template-columns: 76px minmax\(0, 1fr\) 30px/);
    assert.match(styleCss, /\.wf-grid \{ display: grid; grid-template-columns: repeat\(5, minmax\(0, 1fr\)\);/);
    assert.match(styleCss, /@media \(max-width: 1024px\)[\s\S]*?\.wf-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
    assert.match(styleCss, /@media \(max-width: 768px\)[\s\S]*?\.wf-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
    // Dock 图标 56px、状态区 flex
    assert.match(styleCss, /\.dock-ic \{[\s\S]*?width: 56px; height: 56px/);
    assert.match(styleCss, /\.status-row \{[\s\S]*?display: flex/);
    // 浏览视图卡片网格保持 4/3/2
    assert.match(styleCss, /repeat\(4, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 1024px\)[\s\S]*?repeat\(3, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 480px\)[\s\S]*?repeat\(2, 1fr\)/);
});
