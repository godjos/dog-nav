# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-26
- Primary product surfaces: 首页（单页 Start Page：搜索/常用/状态/筛选 + 全部分类站点连续展开）、管理后台、静态内容页
- Direction: 直接参考 Homepage 的紧凑顶部信息栏、sky 蓝/浅色主题、横向服务卡、窄书签行和弹性分组；Mirza（参考 DogNav 改版）仍使用自己的站点数据与单页操作。
- Evidence reviewed: `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/settings-loader.js`, `public/js/utils.js`, `README.md`；Homepage 官方仓库 `images/2.png`、`images/3.png`、`src/pages/index.jsx`、`src/components/services/{group,item}.jsx`、`src/components/bookmarks/{group,item}.jsx`、`src/styles/theme.css`；1440×900 / 1024×768 / 390×844 / 360×800 深浅色截图和浏览器几何检查

## Brand
- Personality: 像每天打开的工具台，不像宣传页；导航是绝对主角，工作台信息只作轻量补充
- Trust signals: 清楚的站点名称、稳定的分类层级、可预期的搜索反馈、可见的选中/焦点状态、诚实的服务状态聚合
- Avoid（保留并扩展）: 大标题 Hero（宣传式）、宣传标签、每日一言、大面积渐变光斑、紫色/粉色品牌渐变、无层级的一页到底卡片墙、营销式问候浮层、大 Footer、顶栏式门户导航、Dashboard 式监控图表（CPU/内存/曲线图）、小组件市场；站点说明只是顶栏一行小字，可整体隐藏

## Product goals
- Goals: 首屏完成「紧凑顶栏与搜索 → 真实数据状态栏 → 常用服务卡 → 第一分类」；手机首屏露出完整的第一张分类卡片；筛选栏（全部/精选/收藏/最近/热门/最新）和分类跳转保持单页可达
- Non-goals: 不做壁纸/登录/AI 搜索/小组件市场/伪造的监控指标；不引入前端框架、组件库或后端数据模型；不复制参考站商标
- Success signals: 桌面内容宽度上限 1280px、360–390px 无横向溢出；默认 8 个常用入口与 3 张状态卡时桌面首屏能看到第一分类，360–390px 手机首屏在底栏上方看见第一张完整分类卡片；全部分类在首页连续展开；首屏外部请求仅 Google Fonts；常用区首访自动预填不留白

## Personas and jobs
- Primary personas: 把导航页设为浏览器首页、每天多次打开的日常用户；按主题发现站点的探索型用户
- User jobs: 搜索（站内/网址直达/外部引擎）、打开常用 Dock 站点、扫一眼最近使用/稍后阅读/收藏数/服务状态、向下浏览全部分类站点、用筛选栏切换精选/收藏/最近/热门/最新、点分类跳转到对应分组、管理收藏/最近/固定常用、切换主题与清除本地数据
- Key contexts of use: 桌面浏览器为主（1440 基准），平板（1024）与手机（390/360）用于快速查找和打开链接

## Information architecture
- Primary navigation: 顶部信息栏（品牌 + 可选站点说明 + 日期时间 + 可选天气/组件，≤768px 隐去时钟）、右下角文字按钮组；手机将 ⊞ 全部站点/◷ 最近使用/⚙ 设置放进有实体背景的固定底栏并预留安全区与页面底部空间；设置弹层提供主题分段切换、清除本地数据和页面链接；无 Footer
- Core routes/screens: 单页首页（唯一主屏，无视图切换）、友链、关于、提交、自定义页、管理后台
- Content hierarchy（单页首页，`#homeView`）: 顶栏（品牌、可选站点说明、时钟、可选组件）→ 居中搜索 → 最近/收藏/服务状态紧凑信息栏 → 常用服务卡组（图标、站名、说明或域名、真实状态）→ 浏览区 `#browse`（简化的筛选与分类跳转 → 全宽/半宽/三分之一宽服务卡或书签行分组，顺序与样式由后台分组排布决定，未配置分类自动补默认布局；分类标题仍是页内锚点）→ 页面工具
- 分类角色：只用于分组与页内跳转，不决定用户能看到哪些站点；首次打开即完整展开全部站点，筛选默认且始终是「全部」

## Design principles
- Principle 1: 导航优先（80/20）——首屏只服务「找到并打开站点」，工作台信息退居次要行
- Principle 2: 分类决定阅读密度——8 个及以上站点全宽服务卡，4–7 个站点半宽服务卡，1–3 个站点较窄书签行；同一行分组弹性填满可用宽度，手机各组单列
- Principle 3: 常用站点也是服务组——横向图标、站名、说明或域名及真实状态；手机压缩为两列短卡
- Principle 4: 状态只做轻量聚合——最近使用/稍后阅读/收藏数/服务状态小卡，不做 Dashboard 式图表；无数据源的功能不伪造数字（今日事项预留隐藏）
- Principle 5: 功能边界保留——搜索（scoreSite 别名/模糊匹配）、收藏、最近、举报、点击上报逻辑不变，只改 DOM 结构与视图状态
- Tradeoffs: 单页连续展开换来「无需进入二级视图即可浏览全部」；桌面用吸顶筛选/跳转头部补偿长页面定位，手机头部随页面滚动以免占用站点空间；分类跳转行的激活态跟随滚动位置（scrollspy），而非用户点选；Dock 上限 12，全部可见；站点说明为顶栏一行小字、留空即隐藏，避免滑向宣传式 Hero

## Visual language
- Color tokens（深色默认，`[data-theme="dark"]`）: 深藏青底 `--bg-base: #0a1424`（body 叠加固定蓝青径向渐变，取代早期 Homepage sky 式饱和蓝 `#075985` 平铺）；面板 `#12233c`；卡片为白色 0.055 透明层（hover 0.1）；文字 `0.95/0.78/0.6`；强调保持 sky `#7dd3fc`
- Color tokens（浅色，`[data-theme="light"]`）: 背景 `#f8fafc`、卡片 `#fff`、强调 `#0369a1`，以轻阴影和细边区分卡片
- Typography: Manrope + Noto Sans SC（Google Fonts 为唯一首屏外部请求）；组标题 `--text-lg`，站名 `--text-sm`，说明、域名与站点说明 `--text-xs`
- Spacing/layout rhythm: 首页内容最大宽 1280px；桌面顶部 26px、手机顶部 18px；顶部状态行紧凑、组间距约 18–24px、卡片间距 8px
- Shape/radius/elevation: 站点卡与书签行 6px 圆角；服务卡 32–34px 图标，书签行左侧 44px 缩写块；低对比描边与轻阴影，hover 只改变表面亮度
- Motion: CSS-first，悬停/焦点 150–200ms（`--ease: cubic-bezier(0.4,0,0.2,1)`）；弹出层 160ms pop-in；抽屉 250ms 滑入；`prefers-reduced-motion` 下关闭装饰动画（保留功能性 spin）
- Imagery/iconography: 站点 favicon 走 `<img loading="lazy">`，加载失败回退首字母色块 SVG（按站名 hash 取柔和底色）；非 URL 图标（emoji/字母）直接文本渲染；logo 用本地 favicon；无装饰性图形与背景图

## Components
- Home 组件: `.home-topbar`（`.home-brand` + `.top-desc` 站点说明（留空隐藏、超出省略）+ `.top-clock`（≤768px 隐藏）+ `.header-widgets` 顶栏组件）；`.search-wrap`；`.status-row` 为紧凑信息栏；`.dock` 为四列常用服务卡；`.browse` 提供筛选与分类跳转；`.cards-area` 内 `.site-groups` 以 flex wrap 弹性排列分类，`.sec-head` 保留跳转锚点，`.card-grid-service` 与 `.card-grid-bookmark` 对应服务卡和书签行；卡片内 `.widget-fields`/`.widget-panel`/`.widget-field` 展示组件指标（stale 降透明度）
- 浏览区复用组件: `.cat-pill`（筛选与跳转）、`.tag-chip`/`.tag-chip-x`、`.card-service`（图标 + 站名 + 一行说明，缺省说明时显示域名 + 状态点）、`.card-bookmark`（双字缩写 + 站名）、`.card-tags`（最多两个可点标签，超出用「+N」展开）、`.report-panel`、`.toast`、`.skel-card`、`.loader`、`.btt`；卡片按钮与站点链接为兄弟元素
- Variants and states: light/dark；搜索 focus-within；常用卡 hover/focus-visible；状态卡 hover；跳转与筛选的 on/hover/focus-visible；卡片 📌/☆/⚑ 的 on/hover；设置弹层 open
- Token/component ownership: 首页视觉 token 全部在 `public/css/style.css` 的 `:root` / `[data-theme]`；`settings-loader.js` 仍可通过 `--accent`/`--accent-2` 覆盖主题色，并为实心强调色按钮选择 `--accent-on` 文字色

## Accessibility
- Target standard: WCAG 2.1 AA 基本可读性与键盘可操作性
- Keyboard/focus behavior: `/` 与 ⌘K/Ctrl K 聚焦搜索并全选；搜索面板 ↑↓/Enter/Esc；引擎菜单 Esc 关闭且可 Tab；分类/模式 pill、设置分段控件均为原生 button，有可见 focus 环（3px accent glow）
- Contrast/readability: 正文/背景、次要文字/背景对比度 ≥ 4.5:1；实心强调色按钮的文字依背景亮度取深色或白色；选中态同时用颜色与形状（边框/字重）表达
- Screen-reader semantics: 保留 landmark、combobox/listbox、aria-expanded/aria-pressed/aria-activedescendant；服务状态卡 `role="status"`；抽屉与浮层带 aria-label
- Reduced motion and sensory considerations: `prefers-reduced-motion` 下关闭骨架脉冲与弹出/抽屉位移动画

## Responsive behavior
- Supported breakpoints/devices: 桌面 ≥1025px（内容 1280px、常用与全宽分类服务卡 4 列，半宽分类服务卡单列、小分类书签行）；平板 ≤1024px（全宽服务卡 3 列、小分类至少半宽）；手机 ≤768px（常用两列、分类全宽、服务卡两列、分类跳转改抽屉）；≤480px（分类服务卡单列、书签行单列、搜索 48px）
- Layout adaptations: 分类跳转 pill 桌面溢出收进「更多」菜单（按容器宽度实测搬入）；≤768px 由右侧抽屉接管分类跳转与筛选（抽屉内同时列出分类与模式）
- Touch/hover differences: 卡片「报告失效」随 hover 显现，触屏不依赖 hover（卡片点击仍是跳转）；收藏星标始终可见

## Interaction states
- Loading: 面板内骨架卡（8 张）+ 文案；热榜单源加载中/失败可单源重试
- Empty: Dock 空态显示引导文案（「在下方站点列表中点卡片上的 📌…」）；最近使用为空提示「点击任意站点后出现在这里」；收藏/最近视图为空给引导；筛选无结果提供「清除筛选」
- Error: 站点数据加载失败给出重试按钮；分类行加载失败单列重试；热榜全部失败给出整块重试
- Success: 收藏、举报、清除本地数据、固定/取消固定走 toast 反馈；固定超过上限 12 个时 toast 提示
- Disabled: 无数据与请求中按钮有明确禁用态
- Offline/slow network: 热榜允许部分来源失败并提示（客户端 5 分钟缓存 + 服务端 10 分钟缓存）；图标懒加载 + onerror 回退字母色块

## Content voice
- Tone: 简洁、直接、友好，无宣传语
- Terminology: 「站点」「分类」「全部」「常用（Dock）」「稍后阅读」「今日事项」「精选」「收藏」「最近」「热门」「最新」「全部站点」
- Microcopy rules: 先说明状态再给出动作；错误信息一句话，不堆技术细节

## Implementation constraints

### 首页配置与维护（2026-09-24）
- 保留当前单页布局与组件，不引入框架或依赖。首页提供可见的加载、错误、重试反馈。
- 后台设置定义公共默认常用入口、状态模块和搜索引擎；访客的常用入口与引擎选择优先，不被后台更新覆盖。
- 首页常用区以「编辑」切换原生按钮排序、移除操作，支持键盘与触屏；最多 12 项全部可见。
- 2026-09-24 单页改版：全部站点默认按分类完整展开，分类仅分组与页内跳转；后台下线「展示分类」「每类展示数量」控件，但 `home_config` 中的 `category_ids`/`category_limit` 历史字段仍可读取、保存其他设置时原值保留（两端共享 schema 不变）。
- 2026-09-26 Homepage 风格工作台：顶部为紧凑信息栏（品牌、可选站点说明、时钟、可选组件），问候区与独立大状态区移除；分组排布由 `home_config.layout` 描述（`{id,width,variant,columns,collapsed}`，上限 101 组，含 `pinned` 常用组；未配置的分类按站点数自动获得默认布局：常用或 ≥8 站点全行服务卡 4 列、4–7 半行服务卡、1–3 三分之一行书签行）；已在常用组出现的站点不在分类组重复。
- 2026-09-26 工作台组件：两端新增 `dashboard_widgets` 与 `dashboard_widget_cache` 表（D1 迁移幂等）；首批类型为 GitHub 公开仓库、公开状态页（Uptime Kuma）、通用 HTTPS JSON API 与天气（Open-Meteo，未配置位置不显示）。公开元数据（`GET /api/widgets`）不含请求地址等配置；私密组件的配置与数据仅经管理员接口提供。通用接口限定 HTTPS 公网主机、≤256KB、5s 超时、不自动跟随重定向、不收第三方 API 密钥；服务端缓存 5 分钟，失败回退 stale（附上次更新时间）或「暂不可用」，不伪造指标。
- 后台预览复用真实首页并隔离访客本地偏好；未保存预览不写入服务器。
- 迁移支持书签 HTML/JSON 预览确认、个人偏好导入导出。内容备份与本地图标资源分开说明和操作，不把内容 JSON 描述为整站备份。
- Framework/styling system: 原生 HTML/CSS/JS；Express 静态资源；双后端共享同一套公共页面；首页为单一连续页面（筛选 + 分类跳转均为页内行为，无 home/all 视图切换、无路由）
- Design-token constraints: 复用 `:root` 与 `[data-theme]` 变量；首页新增的分组/卡片 class 只负责排布和层级，不引入新 token 系统；管理后台 `admin.css` 独立，不受影响
- Performance constraints: 不新增依赖/图片；动画全部 CSS-first；首屏外部请求仅 Google Fonts；favicon 懒加载 + 首字母回退；固定尺寸容器避免布局偏移
- Compatibility constraints: localStorage 键（`dognav-theme`、`dognav-favorites`、`dognav-recent`、`dognav-hot-source`、`dognav-pinned`）不变——favorites 为 id 数组，recent 为 `{id,t}` 数组（上限 20），pinned 为 id 数组（null = 首访未初始化按点击 Top8 预填，[] = 用户主动清空不再预填，上限 12）；`?q=` 搜索参数、SearchAction JSON-LD、点击上报、收藏/最近格式不变；站点 API 不变；`home_config` 仅新增可选 `layout` 字段（旧配置无 `layout` 时前端与后台自动补默认布局，其余字段不变）
- Test/screenshot expectations: `node --test`（默认发现，兼容本机 Node 22）；`test/icon-repair-ui.test.js`、`test/home-ui.test.js` 等静态契约保持通过；浏览器几何检查与截图验收 1440×900 / 1024×768 / 390×844 / 360×800 × 浅色/深色，确认首屏站点可见、手机底栏实体背景及末尾内容可滚出

## Open questions
- [ ] 移动端触屏上「报告失效」入口目前随 hover 隐藏，是否需要改为长按或菜单内入口？/产品/影响移动端举报可用性
- [ ] 「精选」目前依赖 `is_featured` 字段，是否需要在后台提供批量设置入口？/产品/影响精选模式内容丰富度
- [ ] 常用固定上限 12 而 Dock 仅展示前 10，超出部分是否需要在 UI 上可感知（提示或滚动）？/设计/影响固定第 11–12 个站点的可见性
- [ ] 今日事项（`#stTasks`）已预留隐藏位：接入真实数据源（如 CalDAV/Todoist）后再启用，计数与跳转规则届时定义？/产品/影响工作台信息完整性
