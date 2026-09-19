# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-19
- Primary product surfaces: 首页（个人工作台 Start Page，home 视图 + all 二级视图）、管理后台、静态内容页
- Direction: 极简、克制、现代的个人数字工作台 / Start Page；80% 导航 + 20% 轻量工作台；dark-first、低饱和，靠字体/间距/对齐建立层级；参考 Mafl/Bento 式极简导航与 Raycast/Linear 式的克制，无渐变/玻璃拟态/霓虹/大阴影/背景图（仅搜索区一层极弱蓝色环境光）
- Evidence reviewed: `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/settings-loader.js`, `public/js/utils.js`, `README.md`，以及 2026-09-16 按目标效果图对齐后在 1440×900 / 390×844 × 浅色/深色下的首页截图

## Brand
- Personality: 像每天打开的工具台，不像宣传页；导航是绝对主角，工作台信息只作轻量补充
- Trust signals: 清楚的站点名称、稳定的分类层级、可预期的搜索反馈、可见的选中/焦点状态、诚实的服务状态聚合
- Avoid（保留并扩展）: 大标题 Hero（宣传式）、宣传标签、每日一言、大面积渐变光斑、紫色/粉色品牌渐变、无层级的一页到底卡片墙、天气组件/浮层、大 Footer、顶栏式门户导航、Dashboard 式监控图表（CPU/内存/曲线图）；首页问候语刻意保持小字、低视觉权重，不做营销式大标题

## Product goals
- Goals: 首屏完成「问候 → 搜索 → 常用 Dock → 轻量状态 → 分类工作流区」的任务路径；默认视图只有导航与轻量状态，浏览型内容（分类卡片墙/热榜）收进「全部应用」二级视图；搜索、Dock、状态、分类区均首屏可达
- Non-goals: 不做壁纸/登录/AI 搜索/小组件市场/监控图表；不引入前端框架、组件库、新字体或后端数据模型；不复制参考站的商标与个性功能
- Success signals: 桌面 1120px 内容宽、360–390px 无横向溢出；热榜接口仅在进入热榜模式后调用；首屏外部请求仅 Google Fonts；常用 Dock 首访自动预填不留白

## Personas and jobs
- Primary personas: 把导航页设为浏览器首页、每天多次打开的日常用户；按主题发现站点的探索型用户
- User jobs: 搜索（站内/网址直达/外部引擎）、打开常用 Dock 站点、按分类工作流区找站点、扫一眼最近使用/稍后阅读/收藏数/服务状态、进入「全部应用」浏览与看热榜、管理收藏/最近/固定常用、切换主题与清除本地数据
- Key contexts of use: 桌面浏览器为主（1440 基准），平板（1024）与手机（390/360）用于快速查找和打开链接

## Information architecture
- Primary navigation: 无顶栏——右上角浮动日期时间；右下角文字按钮组（⊞ 全部应用/◷ 最近使用/⚙ 设置）+ 设置弹层（主题分段切换、清除本地数据、友链/关于/提交与自定义页链接）；无 Footer
- Core routes/screens: 首页 home 视图（默认工作台）、首页 all 视图（全部应用，由「全部应用」按钮进入，进入后该按钮读「返回首页」）、友链、关于、提交、自定义页、管理后台
- Content hierarchy（home，`#homeView`）: 留白 → 问候（`#greet`，按小时：夜深了/早上好/中午好/下午好/晚上好）+ 弱副标题「专注当下，探索更大的可能」（`.greet-sub`）→ 居中搜索（780px/56px，左侧放大镜点开引擎菜单，右侧 ⌘K/Ctrl K kbd）→ 常用 Dock（8–10 个固定站点）→ 轻量状态行（最近使用 4 项内联 / 稍后阅读（CMS 收录 Karakeep 时自动出现）/ 收藏计数 / 服务状态 ● x/y 正常；今日事项为预留隐藏位）→ 分类工作流区（标题左置纵向居中，每分类最多 5 个紧凑条目，「›」跳到 all 视图该分类）→ 右下角 全部应用/最近使用/设置
- Content hierarchy（all，`#allView`）: 沿用旧浏览界面——分类行（全部 + 分类 pill + 更多菜单/移动端抽屉）→ 模式行（精选/收藏/最近/热门/最新/热榜，热榜仍懒加载）→ 可选标签筛选行 → 带描述的站点卡片网格（📌 固定 / ☆ 收藏 / ⚑ 举报）

## Design principles
- Principle 1: 导航优先（80/20）——首屏只服务「找到并打开站点」，工作台信息退居次要行
- Principle 2: 克制即风格——不用渐变/玻璃/霓虹/大图/大阴影，层级只靠字体字号、字重、间距、对齐与低对比边框；装饰上限 = 搜索区一层极弱蓝色环境光
- Principle 3: Dock 图标为主体——56px 图标盒 + 下方站名，无描述/URL；hover 仅 -3px 微抬起（150–200ms）
- Principle 4: 状态只做轻量聚合——最近使用/稍后阅读/收藏数/服务状态小卡，不做 Dashboard 式图表；无数据源的功能不伪造数字（今日事项预留隐藏）
- Principle 5: 功能边界保留——搜索（scoreSite 别名/模糊匹配）、收藏、最近、热榜、举报、点击上报逻辑不变，只改 DOM 结构与视图状态
- Tradeoffs: all 视图保留旧卡片墙换取功能完整；Dock 上限 12、展示前 10；首页分类区每类只放前 5 个（HOME_CAT_MAX），其余经「›」进入 all 视图；问候语刻意小字低权重，避免滑向宣传式 Hero

## Visual language
- Color tokens（深色默认，`[data-theme="dark"]`）: 背景 `--bg-base: #0d1420`；面板 `--bg-surface: #111a28`；卡片 `--bg-card: rgba(255,255,255,0.03)`（hover 0.06）；边框 `--border: rgba(255,255,255,0.08)`（hover 0.16）；文字 `--text-1: rgba(255,255,255,0.9)` / `--text-2: 0.55` / `--text-3: 0.38`；强调 `--accent: #4c8dff`（soft/glow 为其 rgba 派生）；body 叠加 `radial-gradient(1100px 520px at 50% -12%, rgba(76,141,255,0.07), transparent 62%)` 环境光
- Color tokens（浅色，`[data-theme="light"]`）: 镜像为 dark-on-light——背景 `#f2f5f9`、面板 `#fff`、卡片 `#fff`（hover `#f5f8fc`）、边框 `rgba(15,23,42,0.09)`、文字 `0.92/0.58/0.4`、强调 `#2f6fed`（无径向环境光）
- Typography: Sora + Noto Sans SC（Google Fonts 为唯一首屏外部请求）；正文基准 `--text-base`（clamp 至 1rem）、站名/标题 `--text-sm`–`--text-base`/500–650、弱提示 `--text-xs`–`--text-sm`；问候 26–32px/600
- Spacing/layout rhythm: 首页内容最大宽 1120px；顶部留白 clamp(64px,13vh,124px)；区块间距 22–40px；卡片/行间距 8–14px；间距用 clamp token（--space-xs…--space-xl）
- Shape/radius/elevation: 圆角 8（小组件）/12（卡片、输入）/16（区块）/999（胶囊）；Dock 图标盒 16px 圆角、深色无描边（浅色 1px 边框）；阴影近扁平（`0 1px 2px`），hover 仅轻微加深；不用渐变与大投影
- Motion: CSS-first，悬停/焦点 150–200ms（`--ease: cubic-bezier(0.4,0,0.2,1)`）；弹出层 160ms pop-in；抽屉 250ms 滑入；`prefers-reduced-motion` 下关闭装饰动画（保留功能性 spin）
- Imagery/iconography: 站点 favicon 走 `<img loading="lazy">`，加载失败回退首字母色块 SVG（按站名 hash 取柔和底色）；非 URL 图标（emoji/字母）直接文本渲染；logo 用本地 favicon；无装饰性图形与背景图

## Components
- Home 组件: `.top-clock`（右上角浮动日期时间，≤768px 隐藏）；`.hero`（`#greet` + `.greet-sub`）；`.search-wrap`（`.search-ico` 放大镜按钮点开 `.eng-menu` 引擎菜单、⌘K/Ctrl K kbd 提示、深色极弱蓝边 + 柔光、focus accent ring）；`.dock`（`.dock-item` = 56px 图标盒 + 站名，空态显示 `.dock-hint` 引导）；`.status-row`（flex，最近使用 1.6 倍宽，4–5 张 `.st-card`）；`.cat-sections`（`.wf-sec` = 76px 标题列 + 5 列 `.wf-grid` 48px 紧凑行 + 纵向居中「›」）；`.bottom-nav`（右下角带小图标的文字按钮）；`.set-pop`（主题分段控件/清除本地数据/页面链接）
- All 视图复用组件: `.cat-pill` + 更多菜单 `.cat-more-menu`、移动端 `.cat-drawer`、`.mode-nav` 幽灵模式 pill、`.tag-filter-chip`/`.tag-chip`、`.card`（图标 36px + 名称 + 单行描述 + 状态点）、`.hot-src-bar`/`.hot-item`（热榜）、`.report-panel`、`.toast`、`.skel-card`、`.loader`、`.btt`
- Variants and states: light/dark；搜索 focus-within（accent 边框 + glow）；Dock item hover -3px / focus-visible；状态卡 hover（`.st-click`）；wf-item hover 加深底/边框；pill 的 on/hover/focus-visible；卡片 📌/☆/⚑ 的 on/hover（⚑ 桌面 hover 显现）；设置弹层 open
- Token/component ownership: 首页视觉 token 全部在 `public/css/style.css` 的 `:root` / `[data-theme]`；`settings-loader.js` 仍可通过 `--accent`/`--accent-2` 覆盖主题色（保留后台主题色设置能力）

## Accessibility
- Target standard: WCAG 2.1 AA 基本可读性与键盘可操作性
- Keyboard/focus behavior: `/` 与 ⌘K/Ctrl K 聚焦搜索并全选；搜索面板 ↑↓/Enter/Esc；引擎菜单 Esc 关闭且可 Tab；分类/模式 pill、设置分段控件均为原生 button，有可见 focus 环（3px accent glow）
- Contrast/readability: 正文/背景、次要文字/背景对比度 ≥ 4.5:1；选中态同时用颜色与形状（边框/字重）表达
- Screen-reader semantics: 保留 landmark、combobox/listbox、aria-expanded/aria-pressed/aria-activedescendant；服务状态卡 `role="status"`；抽屉与浮层带 aria-label
- Reduced motion and sensory considerations: `prefers-reduced-motion` 下关闭骨架脉冲与弹出/抽屉位移动画

## Responsive behavior
- Supported breakpoints/devices: 桌面 ≥1025px（内容 1120px，工作流 5 列 / 卡片 4 列）；平板 ≤1024px（工作流 3 列 / 卡片 3 列）；手机 ≤768px（时钟隐藏、Dock 4 列网格、状态卡换行最近使用通栏其余两两均分、工作流 2 列、搜索占满减边距、kbd 提示隐藏、分类标题列收窄至 58px 且隐藏图标盒、分类行改抽屉）；≤480px（卡片 2 列、搜索 48px、Dock 图标 52px）
- Layout adaptations: 分类 pill 桌面溢出收进「更多」菜单（按容器宽度实测搬入，跳过「全部」）；≤768px 由右侧抽屉接管（抽屉内同时列出分类与模式）
- Touch/hover differences: 卡片「报告失效」随 hover 显现，触屏不依赖 hover（卡片点击仍是跳转）；收藏星标始终可见

## Interaction states
- Loading: 面板内骨架卡（8 张）+ 文案；热榜单源加载中/失败可单源重试
- Empty: Dock 空态显示引导文案（「在『全部应用』中点卡片上的 📌…」）；最近使用为空提示「点击任意站点后出现在这里」；收藏/最近视图为空给引导；筛选无结果提供「清除筛选」
- Error: 站点数据加载失败给出重试按钮；分类行加载失败单列重试；热榜全部失败给出整块重试
- Success: 收藏、举报、清除本地数据、固定/取消固定走 toast 反馈；固定超过上限 12 个时 toast 提示
- Disabled: 无数据与请求中按钮有明确禁用态
- Offline/slow network: 热榜允许部分来源失败并提示（客户端 5 分钟缓存 + 服务端 10 分钟缓存）；图标懒加载 + onerror 回退字母色块

## Content voice
- Tone: 简洁、直接、友好，无宣传语
- Terminology: 「站点」「分类」「全部」「常用（Dock）」「稍后阅读」「今日事项」「精选」「收藏」「最近」「热门」「最新」「热榜」「全部应用」
- Microcopy rules: 先说明状态再给出动作；错误信息一句话，不堆技术细节

## Implementation constraints

### 首页配置与维护（2026-09-19）
- 保留当前工作台布局与组件，不引入框架或依赖。首页提供可见的加载、错误、重试反馈。
- 后台设置定义公共默认分类、每类条数、常用入口、状态模块和搜索引擎；访客的常用入口与引擎选择优先，不被后台更新覆盖。
- 首页常用区以「编辑」切换原生按钮排序、移除操作，支持键盘与触屏；最多 12 项全部可见。
- 后台预览复用真实首页并隔离访客本地偏好；未保存预览不写入服务器。
- 迁移支持书签 HTML/JSON 预览确认、个人偏好导入导出。内容备份与本地图标资源分开说明和操作，不把内容 JSON 描述为整站备份。
- Framework/styling system: 原生 HTML/CSS/JS；Express 静态资源；双后端共享同一套公共页面；首页为 `home`/`all` 双视图（`hidden` 切换，不走路由）
- Design-token constraints: 只改 `:root` 与 `[data-theme]` 变量与既有 class，不引入新 token 系统；管理后台 `admin.css` 独立，不受影响
- Performance constraints: 不新增依赖/图片；动画全部 CSS-first；首屏外部请求仅 Google Fonts；热榜仅在进入热榜模式后请求；favicon 懒加载 + 首字母回退；固定尺寸容器避免布局偏移
- Compatibility constraints: localStorage 键（`dognav-theme`、`dognav-favorites`、`dognav-recent`、`dognav-hot-source`、`dognav-pinned`）不变——favorites 为 id 数组，recent 为 `{id,t}` 数组（上限 20），pinned 为 id 数组（null = 首访未初始化按点击 Top8 预填，[] = 用户主动清空不再预填，上限 12）；`?q=` 搜索参数、SearchAction JSON-LD、点击上报、收藏/最近格式不变
- Test/screenshot expectations: `node --test`（默认发现，兼容本机 Node 22）；`test/icon-repair-ui.test.js`、`test/hot-status-ui.test.js`、`test/home-ui.test.js` 等静态契约保持通过；截图验收 1440×900 / 390×844 × 浅色/深色

## Open questions
- [ ] 移动端触屏上「报告失效」入口目前随 hover 隐藏，是否需要改为长按或菜单内入口？/产品/影响移动端举报可用性
- [ ] 「精选」目前依赖 `is_featured` 字段，是否需要在后台提供批量设置入口？/产品/影响精选模式内容丰富度
- [ ] 常用固定上限 12 而 Dock 仅展示前 10，超出部分是否需要在 UI 上可感知（提示或滚动）？/设计/影响固定第 11–12 个站点的可见性
- [ ] 今日事项（`#stTasks`）已预留隐藏位：接入真实数据源（如 CalDAV/Todoist）后再启用，计数与跳转规则届时定义？/产品/影响工作台信息完整性
