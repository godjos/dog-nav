// 单页首页改版的静态 UI 契约（无浏览器，仅读源码）
// 锁定：无顶栏（右上角浮动时钟）→ 问候 → 居中搜索（放大镜引擎入口 + ⌘K）→
// 常用 Dock → 轻量状态区（最近/稍后阅读/收藏/服务状态[/今日事项]）→
// 浏览区（筛选栏 全部/精选/收藏/最近/热门/最新 + 分类页内跳转行 + 完整分组卡片，
// 卡片为 24px 小图标 + 站名的紧凑行式，无描述/标签行）；
// 无 home/all 视图切换、无每类 5 个限制。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'public/index.html'), 'utf8');
const styleCss = fs.readFileSync(path.join(projectRoot, 'public/css/style.css'), 'utf8');
const appJs = fs.readFileSync(path.join(projectRoot, 'public/js/app.js'), 'utf8');

test('index.html: 单页骨架（浮动时钟/问候/搜索/Dock/状态区 + 浏览区筛选/跳转/卡片）', () => {
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
    // 浏览区：筛选栏（全部 + 精选/收藏/最近/热门/最新）+ 分类跳转行 + 卡片区
    assert.match(indexHtml, /class="browse" id="browse"/);
    assert.match(indexHtml, /class="browse-head" id="browseHead"/);
    assert.match(indexHtml, /id="filterBar"/);
    for (const view of ['all', 'featured', 'fav', 'recent', 'hot', 'new']) {
        assert.ok(indexHtml.includes(`data-view="${view}"`), `筛选栏缺少 ${view}`);
    }
    assert.match(indexHtml, /id="catNav" aria-label="分类跳转"/);
    assert.match(indexHtml, /id="catPills"/);
    assert.match(indexHtml, /id="catMoreMenu"/);
    assert.match(indexHtml, /id="catDrawerBtn"/);
    assert.match(indexHtml, /id="tagFilterChip"/);
    assert.match(indexHtml, /id="cardsArea"/);
    assert.match(indexHtml, /id="catDrawer"/);
    // 单页：不再有 all 二级视图/分类工作流区
    assert.ok(!indexHtml.includes('id="allView"'), '应已合并 all 二级视图');
    assert.ok(!indexHtml.includes('id="catSections"'), '分类工作流区应已移除');
    assert.ok(!indexHtml.includes('id="tagNav"'), '分类标签行应已移除');
    // 右下角底部工具与设置弹层（含静态页面链接）
    assert.match(indexHtml, /id="bottomNav"/);
    assert.match(indexHtml, /id="btnAllSites"/);
    assert.match(indexHtml, /id="btnRecentView"/);
    assert.match(indexHtml, /id="btnSettings"/);
    assert.match(indexHtml, /id="setPop"/);
    assert.match(indexHtml, /id="setClearData"/);
    assert.match(indexHtml, /id="setLinks"/);
    assert.match(indexHtml, /links\.html/);
    // 无大型 Footer
    assert.ok(!indexHtml.includes('class="footer"'), '首页不应再有大 Footer');
    // 已删除的旧元素
    for (const gone of ['id="weatherBtn"', 'id="hitokoto"', 'id="engRow"', 'id="homeHot"',
        'id="homeFav"', 'id="pinnedBar"', 'id="engCurrent"', 'id="navLinks"', 'id="btnAllApps"', 'id="viewBar"']) {
        assert.ok(!indexHtml.includes(gone), `应已删除 ${gone}`);
    }
});

test('app.js: 单页渲染、筛选/跳转调度、完整分组列表、localStorage 兼容键', () => {
    // 单页：无视图切换
    assert.ok(!/let pageView =/.test(appJs), '应已无 home/all 视图状态');
    assert.ok(!/function openAllView\(/.test(appJs), '应已无 openAllView');
    assert.ok(!/function goHome\(/.test(appJs), '应已无 goHome');
    // 工作台渲染
    assert.match(appJs, /function renderDock\(\)/);
    assert.match(appJs, /function renderStatusRow\(\)/);
    assert.match(appJs, /function renderBrowse\(\)/);
    assert.match(appJs, /function tickClock\(\)/);
    assert.match(appJs, /karakeep\/i\.test/);
    assert.match(appJs, /getElementById\('searchIco'\)/);
    assert.ok(!/themeBtn|mobBtn|navbar|engCurrent/.test(appJs), '顶栏与旧引擎下拉的引用应已移除');
    // 筛选与分类跳转：分类只滚动不筛选，全部站点完整分组展开
    assert.match(appJs, /function selectView\(view\)/);
    assert.match(appJs, /function jumpToCategory\(id\)/);
    assert.match(appJs, /function initCatSpy\(\)/);
    assert.match(appJs, /secHead\.id = 'sec-' \+ catId/);
    assert.match(appJs, /getElementById\('filterBar'\)/);
    assert.match(appJs, /getElementById\('btnAllSites'\)/);
    assert.ok(!/const HOME_CAT_MAX/.test(appJs), '每类 5 个的限制应已移除');
    assert.ok(!/renderHomeCats/.test(appJs), '分类工作流区渲染应已移除');
    // 卡片恢复旧首页的 24px 小图标紧凑行式：不渲染描述与标签行
    assert.match(appJs, /buildFavIcon\(s, 24\)/);
    assert.ok(!/card-desc|card-tags|buildTagChip/.test(appJs), '卡片应保持小图标紧凑样式，不渲染描述/标签行');
    assert.ok(!/selectCategory|defaultCategory|initialCatResolved|curC\b/.test(appJs), '分类筛选状态应已移除');
    assert.ok(!/buildTagNav|tagNav/.test(appJs), '分类标签行应已移除');
    // 搜索打分；热榜链路已整体移除（前端视图 + 后端 /api/hot/*）
    assert.match(appJs, /function scoreSite\(s, ql\)/);
    assert.ok(!/renderTrending|loadHot|dognav-hot-source|\/api\/hot/.test(appJs), '热榜相关代码应已移除');
    assert.ok(!/renderPinnedBar|renderHomeHot|renderHomeExtras|renderHomeFav|fetchRealIcon/.test(appJs), '旧的首页附加区应已移除');
    // localStorage 兼容键
    for (const key of ['dognav-favorites', 'dognav-recent', 'dognav-theme', 'dognav-pinned']) {
        assert.ok(appJs.includes(key), `缺少 localStorage 键 ${key}`);
    }
    // 模式优先级：收藏/最近排在热门/最新之前（筛选栏顺序）
    assert.ok(appJs.indexOf("fav: { i: '❤️'") < appJs.indexOf("hot: { i: '🔥'"), 'VIEW_META 中收藏应排在热门前');
});

test('style.css: 深色优先令牌、浮动时钟、放大镜搜索、吸顶浏览头部、卡片网格 4/3/2', () => {
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
    // 浏览区：筛选行 + 分类跳转行（幽灵 pill）+ 吸顶头部 + 锚点偏移
    assert.match(styleCss, /\.filter-nav \{[\s\S]*?display: flex/);
    assert.match(styleCss, /\.browse-head \{[\s\S]*?position: sticky/);
    assert.match(styleCss, /\.cat-nav \.cat-pill \{[\s\S]*?background: transparent/);
    assert.match(styleCss, /\.sec-head \{[\s\S]*?scroll-margin-top/);
    // 旧工作流区/二级面板样式应已移除
    assert.ok(!/\.wf-grid|\.wf-item|\.cat-sections/.test(styleCss), '工作流区样式应已移除');
    assert.ok(!/\.panel-head/.test(styleCss), '二级面板头部样式应已移除');
    // Dock 图标 56px、状态区 flex
    assert.match(styleCss, /\.dock-ic \{[\s\S]*?width: 56px; height: 56px/);
    assert.match(styleCss, /\.status-row \{[\s\S]*?display: flex/);
    // 浏览区卡片：24px 小图标 + 48px 紧凑行高，无描述/标签行样式
    assert.match(styleCss, /\.card-fav \{[\s\S]*?width: 24px; height: 24px/);
    assert.match(styleCss, /\.card \{[\s\S]*?min-height: 48px/);
    assert.ok(!/\.card-desc|\.card-tags|\.card-tag \{/.test(styleCss), '卡片描述/标签行样式应已移除');
    // 浏览视图卡片网格保持 4/3/2
    assert.match(styleCss, /repeat\(4, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 1024px\)[\s\S]*?repeat\(3, 1fr\)/);
    assert.match(styleCss, /@media \(max-width: 480px\)[\s\S]*?repeat\(2, 1fr\)/);
});
