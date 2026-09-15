# Design

## Source of truth
- Status: Active
- Last refreshed: 2026-09-15
- Primary product surfaces: 首页网址导航（顶栏 + 搜索 + 分类导航 + 单一内容面板）、管理后台、静态内容页
- Evidence reviewed: `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/settings-loader.js`, `public/js/utils.js`, `README.md`, 设计基准站 `https://kaka770.cn/`（仅骨架/比例/密度参照），以及 2026-09-15 在 1440×1000 / 1024×768 / 390×844 × 浅色/深色下的首页基线截图

## Brand
- Personality: 轻量、可信、每天会打开的入口页；像工具而不是宣传页
- Trust signals: 清楚的站点名称与单行说明、稳定的分类层级、可预期的搜索反馈、可见的选中/焦点状态
- Avoid: 大标题 Hero、宣传标签、每日一言、大面积渐变光斑、紫色/粉色品牌渐变、无层级的一页到底卡片墙

## Product goals
- Goals: 首屏 900px 内完成「顶栏 → 搜索 → 分类 → 至少两行站点卡片」的任务路径；默认只渲染一个分类，保持页面短而可扫描；热榜/收藏/最近成为与分类平级的模式而非默认内容
- Non-goals: 不复制 Kaka 的商标、个性壁纸、编辑排序、登录、AI 搜索、游戏/工具产品功能；不引入前端框架、组件库、新字体或后端数据模型
- Success signals: 桌面四列 / 平板三列 / 手机两列无横向溢出；360–390px 可用；热榜接口仅在进入热榜模式后调用

## Personas and jobs
- Primary personas: 把导航页设为首页、每天多次打开的日常用户；按主题发现站点的探索型用户
- User jobs: 搜索（站内/网址直达/外部引擎）、打开常用分类、查看热榜、管理收藏与最近访问、切换主题与获取天气
- Key contexts of use: 桌面浏览器为主（1440 基准），平板（1024）与手机（390/360）用于快速查找和打开链接

## Information architecture
- Primary navigation: 轻量顶栏 = 品牌 logo、页面入口（首页/友链/关于/提交/更多）、天气入口、主题切换、移动端菜单
- Core routes/screens: 首页（唯一内容面板）、友链、关于、提交、自定义页、管理后台
- Content hierarchy: 顶栏 → 宽搜索框（引擎选择内嵌）→ 分类导航行 → 内容模式行 → （可选）标签筛选行 → 站点卡片分组
- 首页信息层级（Kaka 式重构）：单一 1280px 面板；第一行只放「全部 + 分类 + 更多」；精选/热门/最新/收藏/最近/热榜是独立模式行；默认展示一个分类，「全部」模式按分类分组

## Design principles
- Principle 1: 首屏先服务任务——搜索和分类在首屏，装饰全部移除
- Principle 2: 默认简洁——默认单分类渲染；额外内容（热榜六源、收藏区）不做默认展开
- Principle 3: 密度与扫描节奏——紧凑横向卡片（图标 32–36px + 名称 + 单行简介），用分组标题和分隔线而不是大留白
- Principle 4: 保留功能边界——搜索、收藏、最近、主题、天气逻辑不变，仅调整 DOM 与视图状态
- Tradeoffs: 视觉风格整体切换为蓝白/灰蓝体系，放弃原紫色调；分类默认单选展示而不是全部铺开

## Visual language
- Color（浅色）：背景 `#edf1f7`（浅灰蓝）；面板纯白 `#ffffff`；强调蓝 `#2f6fed`；正文 `#1a2230`；次要文字 `#5d6b7f`；弱提示 `#93a1b3`；边框 `#e6ecf4`
- Color（深色）：背景 `#10141b`（深灰）；面板 `#161b24`；卡片 `#1c232e`；强调蓝 `#5b93f5`；正文 `#e8edf5`；次要文字 `#9aa7b8`；边框 `rgba(255,255,255,0.07)`
- Typography: 沿用 Sora + Noto Sans SC；正文 14px 基准、卡片名称 13–14px/600、说明 12px、分组标题 15px/600
- Spacing/layout rhythm: 内容最大宽度 1280px（原 1400 收窄）；面板内边距 16–24px；区块间距 20–28px；卡片间距 10–12px
- Shape/radius/elevation: 圆角分级 8（小组件）/12（卡片、输入框）/16（面板）/999（胶囊）；卡片无边框、用低强度阴影分层，悬停边框加深 + 上移 2px；分类 pill 选中为实心强调蓝，模式 pill 为无边框幽灵按钮（选中为强调色文字 + soft 底）
- Motion: 悬停/焦点过渡 150–250ms；弹出层（搜索建议/引擎菜单/更多菜单/天气浮层）统一 160ms 淡入+微下移；移动端抽屉 250ms 滑入、遮罩淡入；卡片图标盒随悬停轻染色；遵守 `prefers-reduced-motion`（全部关闭）
- Imagery/iconography: 站点 favicon（32–36px，圆角 8px，加载失败回退首字母色块 SVG）；品牌 logo 用本地 favicon；无装饰性图形

## Components
- Existing components to reuse: `.navbar`（缩减）、`.cat-pill`、`.card`（改紧凑横向）、`.search-panel`/`.sr-opt`（逻辑不变）、`.hot-item`/`.hot-block`（仅热榜模式使用）、`.toast`、`.report-panel`、`.loader`
- New/changed components: 搜索框内嵌引擎选择器（自定义下拉，非独立按钮行）；分类行「更多」溢出菜单（桌面）与分类抽屉（移动端）；内容模式行（精选/热门/最新/收藏/最近/热榜）；可选标签筛选行；顶栏紧凑天气入口（按钮内显示 图标+温度+城市，点击展开详情浮层）；站点图标盒（36px 圆角方块 + 浅底，emoji 与 favicon 同尺寸对齐，悬停轻染色）；弹出层统一 pop-in 动效
- Variants and states: light/dark；pill 的 on/hover/focus-visible；卡片 hover 上移；引擎菜单 open；抽屉 open；天气 未获取/定位中/已显示/不可用
- Token/component ownership: 首页视觉 token 全部在 `public/css/style.css` 的 `:root` / `[data-theme]`；`settings-loader.js` 仍可通过 `--accent` 覆盖主题色（保留后台主题色设置能力）

## Accessibility
- Target standard: WCAG 2.1 AA 基本可读性与键盘可操作性
- Keyboard/focus behavior: `/` 聚焦搜索；搜索面板 ↑↓/Enter/Esc；引擎菜单 Esc 关闭且可 Tab；分类与模式 pill 均为原生 button，有可见 focus 环
- Contrast/readability: 正文/背景、次要文字/背景对比度 ≥ 4.5:1；选中态同时用颜色与形状（边框）表达
- Screen-reader semantics: 保留 landmark、combobox/listbox、aria-expanded/aria-live；抽屉与浮层带 aria-label
- Reduced motion and sensory considerations: `prefers-reduced-motion` 下关闭位移动画与骨架脉冲

## Responsive behavior
- Supported breakpoints/devices: 桌面 ≥1025px（四列）；平板 768–1024px（三列，含 1024×768 验收视口）；手机 ≤480px（两列）；360px 无横向溢出
- Layout adaptations: 分类行桌面用「更多」菜单收纳溢出分类，≤768px 改为抽屉（抽屉内同时列出内容模式）；顶栏导航 ≤768px 折叠进汉堡菜单；天气入口 ≤768px 只保留图标
- Touch/hover differences: 悬停才出现的「报告」按钮在触屏上不依赖 hover（卡片点击仍是跳转；报告入口降级为桌面专用可接受——见开放问题）；卡片收藏星标始终可见

## Interaction states
- Loading: 面板内骨架卡（8 张）+ 文案；热榜单源加载中/失败可单源重试
- Empty: 收藏/最近访问为空时给出引导文案；筛选无结果提供「清除筛选」
- Error: 站点数据加载失败给出重试按钮；热榜全部失败给出整块重试
- Success: 收藏、举报、清除本地数据走 toast 反馈
- Disabled: 无数据与请求中按钮有明确禁用态
- Offline/slow network: 热榜允许部分来源失败并提示；图标懒加载 + onerror 回退字母色块

## Content voice
- Tone: 简洁、直接、友好，无宣传语
- Terminology: 「站点」「分类」「全部」「精选」「热门」「最新」「收藏」「最近」「热榜」
- Microcopy rules: 先说明状态再给出动作；错误信息一句话，不堆技术细节

## Implementation constraints
- Framework/styling system: 原生 HTML/CSS/JS；Express 静态资源；双后端共享同一套公共页面
- Design-token constraints: 只改 `:root` 与 `[data-theme]` 变量与既有 class，不引入新 token 系统；管理后台 `admin.css` 独立，不受影响
- Performance constraints: 不新增字体/图片/依赖；热榜仅在进入模式后请求；默认单分类渲染减少首屏 DOM
- Compatibility constraints: localStorage 键（`dognav-theme`、`dognav-favorites`、`dognav-recent`、`dognav-hot-source`）不变；`?q=` 搜索参数、SearchAction JSON-LD、点击上报、收藏/最近格式不变；`#weatherWidget` 的 `.show` 语义保留（settings-loader 依赖）
- Test/screenshot expectations: `node --test`（默认发现，兼容本机 Node 22）；`test/icon-repair-ui.test.js`、`test/hot-status-ui.test.js` 等静态契约保持通过；截图验收 1440×1000 / 1024×768 / 390×844 × 浅色/深色

## Open questions
- [ ] 移动端触屏上「报告失效」入口目前随 hover 隐藏，是否需要改为长按或菜单内入口？/产品/影响移动端举报可用性
- [ ] 「精选」目前依赖 `is_featured` 字段，是否需要在后台提供批量设置入口？/产品/影响精选模式内容丰富度
- [ ] 分类行「更多」菜单与移动端抽屉的触发阈值（分类个数 vs 容器宽度）是否按 1280 面板实测再定稿？/设计/影响窄桌面（1024–1200）下的分类可见数
