<div align="center">

<img src="https://raw.githubusercontent.com/BYGD/dog-nav/main/ico.ico" width="100" style="border-radius:50%" alt="DogNav Logo">

# 🐕 DogNav

### ✨ 发现互联网的无限精彩 ✨

**一个精心策划的网址导航站，自带完整 CMS 后台 — 支持本地部署或一键部署到 Cloudflare。**

[![在线演示](https://img.shields.io/badge/在线演示-nav.cangdog.com-FF6B6B?style=flat-square)](https://nav.cangdog.com)
[![Cloudflare](https://img.shields.io/badge/Cloudflare-dognav.ccgg.workers.dev-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://dognav.ccgg.workers.dev)
[![版本](https://img.shields.io/badge/版本-3.0-4ECDC4?style=flat-square)]()
[![收录站点](https://img.shields.io/badge/收录站点-150+-45B7D1?style=flat-square)]()
[![分类](https://img.shields.io/badge/分类-10-96CEB4?style=flat-square)]()
[![开源协议](https://img.shields.io/badge/开源协议-未指定-FFEAA7?style=flat-square)]()

<br>

**🚀 推荐：Cloudflare 原生 Git 集成（推送即更新）**

1. 在 [Cloudflare 控制台](https://dash.cloudflare.com) 创建 D1 数据库，名称必须是 **`dognav`**。
2. 进入 **Workers & Pages** → 点击 **Create** → 选择 **Connect to Git**。
3. 授权并选择 `godjos/dog-nav` 仓库，分支选 `main`。
4. 部署完成后，在 Worker 设置里确认已有 D1 binding：`DB` → `dognav`。

之后每次 push 到 `main`，Cloudflare 会自动拉取最新代码并重新部署。

<details>
<summary>或用 Cloudflare 一键部署按钮</summary>

1. 先确保 Cloudflare 账号中已存在名为 `dognav` 的 D1 数据库。
2. 点击下方按钮部署 Worker：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/godjos/dog-nav)

3. 部署完成后，在 Worker 的 D1 Bindings 里把 `DB` 绑定到 `dognav` 数据库。

</details>

<details>
<summary>或用命令行部署</summary>

```bash
git clone https://github.com/godjos/dog-nav.git
cd dog-nav && npm install
npm run deploy:cf
```

</details>

</div>

---

## 📋 目录

```
dog-nav/
├── 📖 简介
├── 🌟 功能特性
├── 🏗️ 架构设计
├── 🚀 快速开始
│   ├── 本地开发
│   └── Cloudflare 一键部署
├── 🔧 后台管理
├── 📁 项目结构
├── 🛠️ 技术栈
├── 📸 截图预览
└── 📄 开源协议
```

---

## 📖 简介

DogNav 是一个精心策划的网址导航站，帮助你发现互联网上最优质的网站。采用**扁平化现代 UI** 设计（紧凑瓷贴卡片、吸顶分类栏），支持深色/浅色主题切换，收录了 **150+ 精选站点**，涵盖 10 个分类，并配备**完整的 CMS 后台**，方便管理内容。

最初作为纯静态前端构建，DogNav 已发展为一个全栈应用，提供两种部署方式：本地 Node.js CMS 和无服务器 Cloudflare Workers 版本。

---

## 🌟 功能特性

| 功能 | 说明 |
|:-----|:-----|
| 🎨 **扁平化现代 UI** | 简洁扁平设计，紧凑瓷贴卡片与流畅动画 |
| 🌓 **深色 / 浅色模式** | 一键切换主题，自动记住用户偏好 |
| 🔍 **多引擎搜索** | 谷歌、必应、百度、DuckDuckGo — 导航栏内直接搜索 |
| 📂 **10 大分类** | 推荐、视频、动漫、软件、工具、资讯、社区、AI、开发、设计 |
| 📱 **全端响应式** | 针对桌面、平板和移动端全面适配 |
| 🇨🇳 **国内可达** | 所有收录站点从大陆均可访问，CDN 使用国内友好服务商 |
| 🗄️ **完整 CMS 后台** | 通过管理面板管理站点、分类、页面、友链、用户和设置 |
| 📄 **自定义页面** | 后台随意创建、编辑、删除页面，首页导航栏自动展示 |
| 🩺 **站点健康监控** | 批量检测所有站点可用性 — 按在线 / 缓慢 / 离线筛选 |
| 🔄 **自动获取元信息** | 输入网址一键获取图标、站名和描述 |
| 🖼️ **自定义 Favicon** | 在系统设置中上传自己的站点图标 |
| 📊 **点击统计** | 内置点击计数，追踪站点热度 |
| 📝 **用户提交** | 访客可提交网站，由管理员审核收录 |
| ☁️ **Cloudflare 部署** | 一键部署到 Cloudflare Workers + D1，首次访问自动初始化数据库 |
| 🔐 **后台鉴权** | Bearer Token 认证，操作日志全程记录 |
| 📦 **开箱即用** | 预置 150+ 站点、10 个分类和默认设置 |

---

## 🏗️ 架构设计

DogNav 提供**两种部署模式**，前端和 API 完全一致：

```
┌─────────────────────────────────────────────────────┐
│                  前端 (HTML/CSS/JS)                   │
│   index.html · about.html · links.html · contribute  │
│   page.html · + 13 个后台管理页面                     │
└────────────────────┬────────────────────────────────┘
                     │ fetch('/api/...')
        ┌────────────┴────────────┐
        ▼                         ▼
┌───────────────┐       ┌──────────────────┐
│   本地模式     │       │  Cloudflare 模式  │
│               │       │                   │
│  Express.js   │       │  Hono 框架        │
│  + sql.js     │       │  + D1 (SQLite)    │
│  + multer     │       │  + Workers Assets │
│  端口 3000    │       │  边缘运行时       │
└───────────────┘       └──────────────────┘
```

| | 本地模式 | Cloudflare 模式 |
|:--|:---------|:---------------|
| **运行时** | Node.js (Express) | Cloudflare Workers (Hono) |
| **数据库** | sql.js（文件型 SQLite） | D1（无服务器 SQLite） |
| **部署方式** | `node server.js` | 点击部署按钮或 `wrangler deploy` |
| **数据库初始化** | `node seed.js` | 首次访问自动完成 |
| **费用** | 免费（自备服务器） | 免费额度充裕 |

---

## 🚀 快速开始

### 本地开发

```bash
# 克隆仓库
git clone https://github.com/godjos/dog-nav.git
cd dog-nav

# 安装依赖
npm install

# 初始化数据库（首次运行）
node seed.js

# 启动服务
npm start
# → http://localhost:3000
```

**管理员账号：** 用户名 `admin`。**仅当设置了环境变量 `INITIAL_ADMIN_PASSWORD` 时**，首次启动才会创建初始管理员（以该变量值为初始密码，首次登录后必须修改）。未设置时不会创建任何管理员，日志会打印提示，设置该变量后重启即可创建。

### Cloudflare 自动部署（推荐）

使用 Cloudflare 原生 Git 集成，无需 GitHub Actions：

1. **创建 D1 数据库**
   - 进入 [Cloudflare 控制台](https://dash.cloudflare.com) → **Workers & Pages** → **D1**
   - 创建数据库，名称必须为 **`dognav`**

2. **连接 GitHub 仓库**
   - 进入 **Workers & Pages** → **Create**
   - 选择 **Connect to Git**
   - 选择 `godjos/dog-nav` 仓库和 `main` 分支
   - 部署配置保持默认即可

3. **确认 D1 Binding**
   - 部署完成后，进入 Worker 设置 → **Settings → Variables → D1 Database Bindings**
   - 确认存在 `DB` → `dognav` 的绑定
   - 如果没有，手动添加一条：Variable name 填 `DB`，选择 `dognav` 数据库

之后每次 push 到 `main`，Cloudflare 会自动拉取代码并重新部署。

### 本地命令行部署

```bash
# 克隆仓库
git clone https://github.com/godjos/dog-nav.git
cd dog-nav

# 安装依赖
npm install

# 一键部署（自动创建 D1、部署 Worker）
npm run deploy:cf
```

部署脚本会自动完成：检查认证 → 创建 D1 数据库 → 更新配置 → 部署上线。

**首次访问站点时，Worker 会自动创建所有数据库表并写入默认数据**（管理员账号、10 个分类、默认页面等），无需手动执行 SQL。

**你的站点将上线于：** `https://dognav.<你的子域名>.workers.dev`

> **提示**：首次运行 `npm run deploy:cf` 会引导你登录 Cloudflare。如果你还没有账号，会引导你免费注册（Worker 免费额度足够个人使用）。

> **导入完整数据**：默认只初始化基础数据（管理员、分类、页面）。如需导入完整的 150+ 站点数据，部署后运行：
> ```bash
> npm run db:seed
> ```

### 手动部署到 Cloudflare

```bash
# 登录 Cloudflare
npx wrangler login

# 创建 D1 数据库
npx wrangler d1 create dognav
# → 将 database_id 复制到根目录 wrangler.toml

# 部署
npx wrangler deploy
```

> 部署后首次访问站点时，Worker 会自动创建所有数据库表并写入默认数据（管理员、分类、页面等），无需手动执行 SQL。如需导入完整的 150+ 站点数据，可额外执行：
>
> ```bash
> npx wrangler d1 execute dognav --remote --file=./cloudflare/schema.sql
> npx wrangler d1 execute dognav --remote --file=./cloudflare/seed.sql
> ```

---

## 🔧 后台管理

访问 `/admin` 进入后台 — 一个完整的 CMS，管理导航站的方方面面。

| 模块 | 说明 |
|:-----|:-----|
| 📋 **站点管理** | 增删改查导航站点，支持一键获取图标和描述 |
| 📂 **分类管理** | 管理站点分类，自定义图标和排序 |
| 📄 **页面管理** | 创建、编辑、删除自定义页面，首页导航栏自动展示 |
| 🔗 **友链管理** | 管理友情链接，支持自动获取站点元信息 |
| 📮 **提交审核** | 审核访客提交的站点，一键通过或拒绝 |
| 🩺 **站点检测** | 批量可用性监控 — 按在线 / 缓慢 / 离线筛选 |
| 📊 **统计看板** | 点击量分析，逐站追踪 |
| 📝 **操作日志** | 管理员操作审计记录 |
| 👥 **用户管理** | 管理管理员账号和权限 |
| 💾 **备份恢复** | 导出和导入数据库备份 |
| ⚙️ **系统设置** | 站点名称、描述、自定义图标、天气组件 |

---

## 📁 项目结构

```
dog-nav/
├── public/                 # 前端静态资源（唯一副本，Express 与 Workers 共用）
│   ├── index.html          # 主页导航
│   ├── about.html          # 关于页面（CMS 驱动）
│   ├── links.html          # 友链页面（CMS 驱动）
│   ├── contribute.html     # 投稿页面（CMS 驱动）
│   ├── page.html           # 自定义页面模板（CMS 驱动）
│   ├── css/                # style.css（扁平化主题）· font-awesome.css
│   ├── js/                 # app.js 等前端逻辑（渲染、搜索、主题）
│   ├── ico/                # 站点图标
│   ├── admin/              # 后台管理（13 个页面）
│   │   ├── index.html      # 登录页
│   │   ├── dashboard.html  # 站点管理
│   │   ├── categories.html # 分类管理
│   │   ├── pages.html      # 页面管理（增删改查）
│   │   ├── health.html     # 站点检测
│   │   ├── ...             # （见后台管理章节）
│   │   └── backup.html     # 备份恢复
│   ├── robots.txt          # 搜索引擎规则
│   └── sitemap.xml         # XML 站点地图
│
├── server.js               # 本地 CMS 服务（Express + sql.js）
├── lib/                    # Express 端共享模块（auth.js · netutils.js）
├── seed.js                 # 业务数据播种脚本
├── deploy.js               # Cloudflare 一键部署脚本
├── package.json            # Node.js 依赖（CF 端依赖见 cloudflare/package.json）
├── wrangler.toml           # Cloudflare Workers 配置（一键部署用）
├── uploads/icons/          # 上传/抓取的图标（不入库）
│
├── test/                   # 测试：api · auth · contract（双运行时契约）
├── docs/
│   └── API_CONTRACT.md     # 双端 API 契约文档
│
├── cloudflare/             # Cloudflare Workers 部署
│   ├── src/
│   │   ├── index.js        # Hono API 后端 + 自动初始化
│   │   ├── auth.mjs        # 鉴权模块
│   │   └── netutils.mjs    # 网络工具
│   ├── schema.sql          # D1 数据库结构（13 张表）
│   ├── seed.sql            # 种子数据（150+ 站点）
│   ├── deploy.js           # 一键部署脚本
│   ├── wrangler.toml       # Cloudflare 配置（手动部署用）
│   └── package.json        # CF 依赖（hono, wrangler）
│
└── README.md               # 本文件
```

---

## 🛠️ 技术栈

**前端**

![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![Font Awesome](https://img.shields.io/badge/Font_Awesome-528DD7?style=flat-square&logo=font-awesome&logoColor=white)

**本地后端**

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=flat-square&logo=sqlite&logoColor=white)

**Cloudflare 后端**

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare_Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)
![Hono](https://img.shields.io/badge/Hono-E36002?style=flat-square)
![D1](https://img.shields.io/badge/D1_SQLite-004B85?style=flat-square)

---

## 📸 截图预览

<div align="center">

**深色主题**

![深色模式](https://raw.githubusercontent.com/BYGD/dog-nav/main/screenshot.png)

**浅色主题**

![浅色模式](https://raw.githubusercontent.com/BYGD/dog-nav/main/screenshot-light.png)

</div>

---

## 🌍 在线地址

| 平台 | 地址 | 说明 |
|:-----|:-----|:-----|
| Cloudflare Workers | [dognav.ccgg.workers.dev](https://dognav.ccgg.workers.dev) | 全栈 CMS 版本 |
| 自定义域名 | [nav.cangdog.com](https://nav.cangdog.com) | 前端演示 |
| 本地部署 | `localhost:3000` | 自备 Node.js 环境 |

---

## 📄 开源协议

仓库暂未提供 LICENSE 文件（许可证未指定）；在补充许可证文件之前，默认保留所有权利。

---

<div align="center">

**⭐ 如果觉得这个项目对你有帮助，欢迎点个 Star！⭐**

[在线演示](https://nav.cangdog.com) · [Cloudflare 版](https://dognav.ccgg.workers.dev) · [反馈问题](https://github.com/godjos/dog-nav/issues) · [提出建议](https://github.com/godjos/dog-nav/issues)

</div>
