# DogNav API 契约（双端唯一事实来源）

本文档描述 DogNav 两个后端的 HTTP API 契约：

- **Express 后端**：`server.js`（sql.js + 本地 SQLite 文件，行号记作 `E:行号`）
- **Cloudflare Worker 后端**：`cloudflare/src/index.js`（Hono + D1，行号记作 `W:行号`）

两端**应当**对外表现一致；不一致之处汇总在文末「双端差异清单」。后续契约测试以本文档为准。

## 通用约定

| 项目 | 约定 | Express | Worker |
|---|---|---|---|
| 鉴权方式 | 请求头 `Authorization: Bearer <token>`，token 存于 `sessions` 表，含过期时间（`SESSION_TTL_MS`） | E:357-373 | W:149-161 |
| `requireAuth` | 无有效会话 → `401 {"error":"Unauthorized"}`；`must_change_password=1` 的会话访问除 `PUT /api/auth/password` 与 `GET /api/auth/me` 外的任何受保护接口 → `403 {"error":"password_change_required"}` | E:375-388 | W:163-176 |
| `requireAdmin` | 先过 `requireAuth`；非 admin 角色 → `403 {"error":"Admin role required"}` | E:390-395 | W:178-183 |
| 安全响应头 | 每个响应（含静态资源）都带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: SAMEORIGIN`、`Referrer-Policy: strict-origin-when-cross-origin`、`Content-Security-Policy`（`default-src 'self'; script-src 'self' https://cdn.quilljs.com; ...`） | E:75-81（中间件统一加） | W:118-128（中间件）+ W:132-137（`fetchAsset` 包装 ASSETS 响应，见 D21） |
| 请求体 | JSON；Express 上限 50MB | E:46-47 | —（Worker 无显式上限） |
| CORS | 默认同源（不发 CORS 头）；`CORS_ORIGIN` 环境变量（逗号分隔）显式放行 | E:44-45 | W:106-111 |
| 通用错误格式 | `{"error": "<message>"}`；Express 未捕获异常统一 `500 {"error": err.message}`；Worker 仅个别路由 try/catch，其余异常由运行时兜底 | E 各路由 | W 各路由 |
| 未匹配的 `/api/*` 路由 | Express：落到默认 404 HTML 页（`Cannot ...`）；Worker：`404 {"error":"Not found"}` | — | W:1038-1041 |
| 日志 | 多数写操作向 `logs` 表写入 `logAction`（`user_id, action, detail, created_at`） | E:70-73 | W:150-153 |

**限流总览**：全系统仅登录接口有限流（内存滑动窗口：每 IP 5 次失败锁定 15 分钟）。Worker 的限流是 per-isolate 内存状态，多实例下不共享，实际强度弱于 Express 单进程。其余接口（含公开的提交/举报/点击/抓取类接口）均无速率限制。

---

## 1. Auth

### POST /api/auth/login — 登录

`E:403-447` / `W:197-234`

| 项 | 内容 |
|---|---|
| 鉴权 | 公开 |
| 请求体 | `username`（必填）、`password`（必填） |
| 成功 | `200 {"success":true,"token":"<token>","mustChangePassword":<bool>,"user":{"id":<int>,"username":"<str>","role":"<str>"}}` |
| 错误 | `401 {"error":"Invalid credentials"}`（用户不存在/未激活/密码错误）；`429 {"error":"Too many login attempts, try again in <N>s"}` 并带 `Retry-After: <N>` 头 |
| 限流 | 每 IP 5 次失败后锁 15 分钟；成功登录重置计数（`E:401` / `W:195`） |
| 副作用 | 写 `sessions`；明文遗留密码惰性改写为哈希；清理过期 session；记日志 `login` |

### POST /api/auth/logout — 登出

`E:449-457` / `W:236-239`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth（受 must_change_password 限制） |
| 成功 | `200 {"message":"Logged out"}` |
| 错误 | `401`/`403`（见通用约定） |
| 副作用 | 删除当前 session |

### GET /api/auth/me — 当前会话用户

`E:461-472` / `W:242-252`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth；**与 `PUT /api/auth/password` 一样豁免 must_change_password 门禁**，`must_change_password=1` 的会话也可访问 |
| 成功 | `200 {"id":<int>,"username":"<str>","role":"<str>","mustChangePassword":<bool>}` |
| 错误 | `401 {"error":"Unauthorized"}`（无 token）；Express 在用户被删后返回 `404 {"error":"User not found"}`，Worker 返回 `401` |

### PUT /api/auth/password — 修改密码

`E:474-500` / `W:254-278`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth；must_change_password 会话仅允许访问本接口与 `GET /api/auth/me` |
| 请求体 | `oldPassword`（必填）、`newPassword`（必填，≥8 位） |
| 成功 | `200 {"message":"Password changed"}` |
| 错误 | `400 {"error":"New password must be at least 8 characters"}`；`401 {"error":"Old password incorrect"}` |
| 副作用 | 清除 `must_change_password`；删除该用户除当前外的全部 session；记日志 `change_password` |

---

## 2. Sites

站点对象字段（两端表结构一致）：`id, name, url, description, icon, screenshot, category, sort_order, is_featured, click_count, nofollow, seo_title, seo_description, status, last_status, last_check_at, created_at, updated_at`。此外 `GET /api/sites` 的每个站点**追加** `tags` 字段（非数据库列）：数组，元素 `{id, name, color}`，来自 `site_tags JOIN tags`、按 tag `name` 排序，无标签为 `[]`（纯追加，向后兼容）。

### GET /api/sites — 站点列表

`E:506-527` / `W:284-296`

| 项 | 内容 |
|---|---|
| 鉴权 | 公开 |
| 查询参数 | `sort=created` → `created_at DESC, id DESC`；缺省 → `sort_order, category, name` |
| 成功 | `200 [<site>, ...]`（全字段数组，每个站点追加 `tags` 数组：元素 `{id:<int>,name:<str>,color:<str>}`，按 tag `name` 升序，无标签为 `[]`） |

示例元素（节选）：

```json
{
  "id": 1, "name": "Example", "url": "https://example.com", "category": "tools",
  "tags": [ {"id": 3, "name": "dev", "color": "#667eea"}, {"id": 1, "name": "tools", "color": "#123456"} ]
}
```

### POST /api/sites — 新建站点

`E:466-483` / `W:234-243`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 请求体 | 必填：`name, url, category`；可选：`description, icon, screenshot, sort_order, is_featured, nofollow, seo_title, seo_description`；Worker 额外接受 `status`（Express 不写入该列，用表默认 `'active'`） |
| 成功 | `200 {"id":<int>,"message":"Site added"}`（语义上应为 201，见差异清单 D1） |
| 错误 | `400 {"error":"Missing required fields"}` |
| 副作用 | 记日志 `create_site` |

### PUT /api/sites/:id — 全量更新站点

`E:485-497` / `W:245-252`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 请求体 | 全量覆盖：`name, url, description, icon, screenshot, category, sort_order, is_featured, nofollow, seo_title, seo_description, status`（缺省值同 POST；`status` 缺省 `'active'`） |
| 成功 | `200 {"message":"Site updated"}`（id 不存在也返回 200，无 404） |
| 副作用 | 记日志 `update_site` |

### DELETE /api/sites/:id — 删除站点

`E:499-508` / `W:254-258`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 成功 | `200 {"message":"Site deleted"}`（id 不存在也 200） |
| 副作用 | 记日志 `delete_site` |

### POST /api/sites/batch — 批量操作

`E:566-601` / `W:310-340`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 请求体 | `ids`（必填，非空数组）、`action`（`'delete'` 或 `'update'`）、`data`（action=update 时的字段键值对） |
| 成功 | `200 {"message":"Batch <action> completed","count":<ids.length>}` |
| 错误 | `400 {"error":"No IDs provided"}`；`400 {"error":"Invalid field: <f>"}`（`data` 含白名单外键名，两端一致）；`400 {"error":"Invalid action"}`（未知 action，两端一致） |
| 备注 | `action='update'` 时 `data` 键名须在白名单内（`name, url, description, icon, screenshot, category, sort_order, is_featured, nofollow, seo_title, seo_description, status`，`E:566-569` / `W:310-313`），原 SQL 注入缺口 S4 已修复；Express 用单条 `IN (...)` 语句，Worker 逐 id 循环执行 |

### POST /api/sites/:id/click — 点击统计

`E:538-551` / `W:282-290`

| 项 | 内容 |
|---|---|
| 鉴权 | 公开，无限流 |
| 成功 | `200 {"success":true}`（id 不存在也 200） |
| 副作用 | `click_count+1`；向 `stats` 表写入 `site_id, ip_address, user_agent, referrer`（Express 取 `req.ip`，Worker 取 `cf-connecting-ip`/`x-forwarded-for`） |

---

## 3. Categories

分类对象：`id(text), name, icon, sort_order, is_active`。

### GET /api/categories — 分类列表

`E:557-568` / `W:296-299`：公开；`200 [<category>, ...]`，按 `sort_order` 排序。

### POST /api/categories — 新建分类

`E:570-581` / `W:301-308`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 请求体 | 必填：`id, name`；可选：`icon, sort_order` |
| 成功 | `200 {"message":"Category created"}` |
| 错误 | `400 {"error":"Missing required fields"}`；id 重复时 SQLite 主键冲突 → Express `500`，Worker 运行时 500（均无明确 409） |

### PUT /api/categories/:id — 更新分类

`E:583-593` / `W:310-316`

- requireAuth；请求体 `name, icon, sort_order, is_active`（`is_active` 未传默认 1）
- 成功 `200 {"message":"Category updated"}`

### DELETE /api/categories/all — 清空全部分类与站点

`E:595-605` / `W:318-323`

- **requireAdmin**；删除 `sites` 与 `categories` 两表全部数据
- 成功 `200 {"message":"All categories and sites deleted"}`；记日志 `delete_all_categories`
- 注意路由顺序：`/all` 必须先于 `/:id` 注册（两端均如此）

### DELETE /api/categories/:id — 删除分类

`E:607-616` / `W:325-329`：requireAuth；`200 {"message":"Category deleted"}`（不级联删除该分类下的站点）。

---

## 4. Tags

标签对象：`id, name(唯一), color(默认 '#667eea')`；站点-标签关联表 `site_tags(site_id, tag_id)`。

### GET /api/tags — 标签列表

`E:696-707` / `W:411-414`：公开；`200 [<tag>, ...]`，按 `name` 排序。

### POST /api/tags — 新建标签

`E:709-720` / `W:416-422`

- requireAuth；请求体 `name`（必填）、`color`（可选，默认 `#667eea`）
- 成功 `200 {"message":"Tag created"}`；错误 `400 {"error":"Name required"}`；name 重复 → 500

### POST /api/sites/:id/tags — 重置站点标签

`E:722-736` / `W:424-433`

- requireAuth；请求体 `tag_ids`（数组，可选；先全删再逐个插入）
- 成功 `200 {"message":"Tags updated"}`

---

## 5. Pages

页面对象：`id(text), title, content, updated_at`。

| 端点 | 鉴权 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|
| GET /api/pages | 公开 | `200 [<page>,...]` 按 id 排序 | — | E:1128-1139 | W:506-509 |
| GET /api/pages/:id | 公开 | `200 <page>` | `404 {"error":"Page not found"}` | E:1141-1153 | W:511-515 |
| PUT /api/pages/:id | requireAuth | `200 {"message":"Page updated"}`（不存在也 200） | — | E:1155-1165 | W:517-523 |
| POST /api/pages | requireAuth | `201 {"message":"Page created","id":"<id>"}` | `400 {"error":"Missing required fields (id, title)"}`；`400 {"error":"Invalid page ID (a-z, 0-9, hyphens only)"}`；`400 {"error":"Invalid status"}`；`409 {"error":"Page ID exists"}` | E:1654-1674 | W:893-907 |
| DELETE /api/pages/:id | requireAuth | `200 {"message":"Page deleted"}` | `404 {"error":"Page not found"}` | **不存在** | W:538-544 |

另：Worker 有公开路由 `GET /p/:slug`（页面存在 → 302 重定向到 `/page.html?slug=<slug>`，不存在 → 404 静态兜底，`W:1027-1032`）；Express 无此路由。

---

## 6. Links

友链对象：`id, name, url, description, icon, sort_order, created_at`。

| 端点 | 鉴权 | 请求体 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|---|
| GET /api/links | 公开 | — | `200 [<link>,...]` 按 `sort_order, name` | — | E:1171-1182 | W:550-553 |
| POST /api/links | requireAuth | 必填 `name,url`；可选 `description,icon,sort_order` | `200 {"message":"Link added"}` | `400 {"error":"Missing required fields"}` | E:1184-1196 | W:555-562 |
| PUT /api/links/:id | requireAuth | 全量 `name,url,description,icon,sort_order` | `200 {"message":"Link updated"}` | — | E:1198-1209 | W:564-570 |
| DELETE /api/links/:id | requireAuth | — | `200 {"message":"Link deleted"}` | — | E:1211-1220 | W:572-576 |

---

## 7. Submissions（用户提交）

提交对象：`id, name, url, description, category, submitter_email, status('pending' 默认), tracking_token, review_note, normalized_url, created_at, reviewed_at, reviewed_by`（阶段 4 迁移新增 `tracking_token/review_note/normalized_url` 三列）。

| 端点 | 鉴权 | 请求体 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|---|
| GET /api/submissions | requireAuth | — | `200 [<submission>,...]` 按 `created_at DESC` | — | E:997-1008 | W:497-500 |
| POST /api/submissions | **公开，IP 限流 5 次/小时**（限流器在字段校验**之前**，400 也消耗额度；蜜罐路径在限流器之前返回，不消耗） | 必填 `name,url`；可选 `description,category,submitter_email`；蜜罐隐藏字段 `website` | `200 {"message":"Submission received","trackingToken":"<32 hex>"}` | `400 Missing required fields`（缺 name/url）；`400 Invalid name`（>50）；`400 Invalid URL`（非 http(s) 或私网主机/IP 字面量，同步检查无 DNS）；`400 Invalid description`（>200）；`400 Invalid email`（>100 或格式非法）；`400 Invalid category`（category 提供但不存在）；`409 {"error":"Duplicate submission"}`（`normalized_url` 已有 pending/approved 记录）；`429 {"error":"Too many submissions"}` | E:1054-1090 | W:502-532 |
| GET /api/submissions/status/:token | **公开** | — | `200 {"name","url","status","review_note","created_at","reviewed_at"}`（**绝不含 `submitter_email`**） | `404 {"error":"Not found"}` | E:1093-1106 | W:535-541 |
| PUT /api/submissions/:id | requireAuth | `status`；可选 `review_note,name,description,icon,category`（未提供的字段沿用库存值） | `200 {"message":"Submission updated"}` | `status='approved'` 时重校验：`400 {"error":"Invalid URL"}`（库存 url 非公网 http(s)）、`400 {"error":"Invalid category"}`（最终 category 为空或不存在，**不再默认 'tools'**） | E:1108-1149 | W:543-572 |

蜜罐：请求体带非空 `website` 字段时直接返回 `200 {"message":"Submission received","trackingToken":"<随机>"}` 假成功，**不入库**（该 token 查状态返回 404）。

PUT 副作用：`status='approved'` 时按最终 name/description/category（+`icon`）把提交转为站点插入 `sites`；写 `reviewed_at/reviewed_by`；记日志 `review_submission`。

限流实现：`createHourlyLimiter` 固定窗口内存限流（`E:1010-1031` / `W:450-469`），重启即清零；Worker 为 per-isolate（同 S9 警告）。

---

## 8. Reports（举报）

举报对象：`id, site_id, reason, reporter_email, detail, reporter_ip, status, created_at, resolved_at, resolved_by`（阶段 4 迁移新增 `detail/reporter_ip` 两列）。

| 端点 | 鉴权 | 请求体 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|---|
| GET /api/reports | requireAuth | — | `200 [...]`（LEFT JOIN sites，附带 `site_name, site_url`，按 `created_at DESC`） | — | E:1155-1166 | W:578-583 |
| POST /api/reports | **公开，IP 限流 10 次/小时**（限流器在 reason/detail 校验**之后**，400 不消耗额度） | 必填 `site_id,reason`（枚举 `link_dead\|wrong_info\|spam\|inappropriate\|other`）；可选 `reporter_email,detail`（≤200） | `200 {"message":"Report received"}` | `400 Missing required fields`；`400 {"error":"Invalid reason"}`；`400 {"error":"Invalid detail"}`（>200）；`429 {"error":"Too many reports"}` | E:1168-1191 | W:585-601 |
| PUT /api/reports/:id | requireAuth | `status`；可选 `remove_site` | `200 {"message":"Report updated"}` | — | E:1193-1213 | W:603-616 |

POST 去重：同 `site_id` + 同 IP 24 小时内重复举报 → 仍返回 `200 {"message":"Report received"}` 但**不新增行**（去重检查在限流器之后，重复举报也消耗额度）。

PUT 副作用：`status='resolved' && remove_site` 时将关联站点置为 `status='inactive'`；记日志 `resolve_report`。

---

## 9. Stats

| 端点 | 鉴权 | 成功 | Express | Worker |
|---|---|---|---|---|
| GET /api/stats/overview | requireAuth | `200 {"totalSites":<int>,"totalClicks":<int>,"pendingSubmissions":<int>,"pendingReports":<int>,"activeSites":<int>,"pending_submissions":<int>,"pending_reports":<int>}`（阶段 4 起追加 snake_case 的 `pending_submissions`/`pending_reports`，与 camelCase 同值镜像） | E:1219-1239 | W:622-630 |
| GET /api/stats/popular | requireAuth | `200 [{"id","name","url","click_count"},...]` Top 10 | E:1026-1037 | W:439-442 |
| GET /api/stats/category-distribution | requireAuth | `200 [{"name","count"},...]` 按 count DESC | E:1039-1050 | W:444-449 |

---

## 10. Logs

### GET /api/logs — 操作日志

`E:1130-1141` / `W:516-521`

- **requireAdmin**（原 requireAuth，已收紧）；`200 [...]`（`logs` LEFT JOIN `users` 附 `username`，`created_at DESC LIMIT 100`）

---

## 11. Settings

公开白名单键（两端一致，恰好 10 个）：`site_name, site_description, site_icon, footer_text, footer_blog_url, footer_github_url, theme_primary_color, theme_secondary_color, submission_enabled, weather_enabled`（`PUBLIC_SETTING_KEYS`，`E:1149-1154` / `W:537-542`）。`auto_nofollow` 已从白名单与播种中移除；`weather_api_key` 永不公开（真实天气 key 来自 `WEATHER_API_KEY` 环境变量，不入库）。

可写白名单键（两端一致，同样 10 个，`WRITABLE_SETTING_KEYS`，`E:1159-1164` / `W:547-552`）：与公开白名单相同。`weather_enabled`/`submission_enabled` 为布尔键，接受 `true/false` 布尔或字符串，统一归一化为字符串 `'true'/'false'`（`E:1168-1175` / `W:556-563`）。

| 端点 | 鉴权 | 请求体 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|---|
| GET /api/settings | 公开 | — | `200 {<10 个白名单键>:<值>}`（恰好 10 键，无 `weather_api_key`、无 `auto_nofollow`） | — | E:1201-1212 | W:582-589 |
| GET /api/admin/settings | **requireAdmin** | — | `200 {<全部键>:<值>,...}`（含 `weather_api_key` 等敏感键） | `401`/`403` | E:1215-1221 | W:592-597 |
| PUT /api/admin/settings | **requireAdmin** | `{key:value,...}`，键须全部在可写白名单内 | `200 {"message":"Settings updated"}` | `400 {"error":"Invalid setting key: <key>"}`（含 `weather_api_key` 在内的白名单外键）；`401`/`403` | E:1223-1231 | W:599-604 |
| PUT /api/settings（**已废弃**，PUT /api/admin/settings 的兼容别名） | **requireAdmin** | 同上 | `200 {"message":"Settings updated","deprecated":true}`，响应头带 `Deprecation: true` 与 `Sunset: Sat, 01 Jan 2028 00:00:00 GMT` | 同上（400 校验先于废弃标记，400 响应不带 Deprecation/Sunset 头） | E:1234-1244 | W:607-614 |

两个 PUT 共用一个校验/写入实现（`applySettingsUpdate`，`E:1179-1190` / `W:567-580`）：先校验全部键名再写入，任一非法键整体拒绝；记日志 `update_settings`。

---

## 12. Weather（天气代理）

### POST /api/weather — 实时天气（和风天气代理）

`E:1298-1335` / `W:668-703`

| 项 | 内容 |
|---|---|
| 鉴权 | 公开，无限流 |
| 请求体 | `lat`、`lon`（必填，数字；有限且 `-90≤lat≤90`、`-180≤lon≤180`） |
| 成功 | `200 {"temp":<num>,"feelsLike":<num>,"text":"<str>","icon":"<str>","humidity":<num>,"windDir":"<str>","windScale":<num>,"updateTime":"<str>","city":"<str>"\|null}` |
| 错误 | `400 {"error":"Invalid coordinates"}`（坐标缺失/非有限数字/越界，最先校验）；`404 {"error":"Weather disabled"}`（`weather_enabled!=='true'`，默认播种 `'false'`）；`503 {"error":"Weather not configured"}`（`WEATHER_API_KEY` 环境变量未配置）；`502 {"error":"Weather upstream error"}`（上游请求失败/非 200/业务码非 `'200'`，8s 超时） |
| 缓存 | 成功响应按 0.1° 网格（`lat.toFixed(1),lon.toFixed(1)`）内存缓存 10 分钟；失败不缓存；Worker 缓存为 per-isolate（同登录限流，见 S9） |
| 上游 | `devapi.qweather.com/v7/weather/now`；城市名为 best-effort 附加查询（`geoapi.qweather.com/v2/city/lookup`），失败时 `city` 为 `null` 不影响主响应 |

---

## 13. Users

用户对象（列表返回）：`id, username, role, is_active, created_at`（不返回密码哈希）。

| 端点 | 鉴权 | 请求体 | 成功 | 错误 | Express | Worker |
|---|---|---|---|---|---|---|
| GET /api/users | requireAdmin | — | `200 [<user>,...]` 按 id | — | E:1407-1418 | W:713-716 |
| POST /api/users | requireAdmin | 必填 `username,password`（≥8 位）；可选 `role`（默认 `'editor'`） | `200 {"message":"User created"}` | `400 {"error":"Missing required fields"}`；`400 {"error":"Password must be at least 8 characters"}`；用户名重复 → 500 | E:1420-1432 | W:718-726 |
| PUT /api/users/:id | requireAdmin | `role, is_active` | `200 {"message":"User updated"}` | — | E:1434-1444 | W:728-734 |
| DELETE /api/users/:id | requireAdmin | — | `200 {"message":"User deleted"}` | `403 {"error":"Cannot delete the last active admin"}` | E:1446-1462 | W:736-747 |

---

## 14. Upload

### POST /api/upload — 文件上传

`E:949-965` / `W:1027-1031`

| 项 | Express | Worker |
|---|---|---|
| 鉴权 | requireAuth（受 must_change_password 限制） | requireAuth（同） |
| 请求 | `multipart/form-data`，字段名 `file`，≤5MB；扩展名白名单 `.png/.jpg/.jpeg/.webp/.ico`（multer `fileFilter`，`E:31,40-50`），落盘后校验魔数（`E:53-69`），随机文件名落盘 `UPLOAD_DIR` | — |
| 成功 | `200 {"url":"/uploads/<filename>","filename":"<filename>"}`，记日志 `upload` | **占位 stub**：恒返回 `200 {"url":"","filename":"","message":"Upload not available on CF. Use external image hosting."}`，不落盘、不校验 |
| 错误 | `400 {"error":"No file uploaded"}`；`400 {"error":"Invalid file type"}`（扩展名白名单外）；`400 {"error":"Invalid file content"}`（魔数不匹配，文件随即删除）；multer 错误（含超限）统一 `400 {"error":<message>}` JSON（原为 500 HTML） | 无 |

---

## 15. Import / Export

### GET /api/export — 导出数据

`E:734-768` / `W:814-826`

| 项 | 内容 |
|---|---|
| 鉴权 | **requireAdmin**（原 requireAuth，editor 已不可导出，S6 已修复） |
| 成功 | `200 {"sites":[...],"categories":[...],"tags":[...],"links":[...],"settings":{...},"exportDate":"<ISO>"}`；**Worker 额外包含 `pages` 数组**（Express 不含） |
| 备注 | `settings` 为全量键值，含敏感键（仅 admin 可见） |

### POST /api/import — 导入数据

`E:704-749` / `W:767-811`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAdmin |
| 请求体 | `{sites?, categories?, tags?, links?, pages?, settings?}`；**Express 忽略 `pages`**，Worker 支持 |
| 行为 | 每个出现的数组：先 `DELETE FROM <表>` 再逐条插入（sites 仅导入 `id,name,url,description,icon,category,sort_order,is_featured,click_count` 九列）；`settings` 逐键 upsert |
| 成功 | `200 {"message":"Import successful"}`，记日志 `import` |

### POST /api/import/bookmarks — 浏览器书签导入

`E:751-877` / `W:813-960`

| 项 | 内容 |
|---|---|
| 鉴权 | requireAdmin |
| 请求体 | 浏览器书签 JSON（数组 / 含 `roots` 的对象 / 单节点），递归解析文件夹为分类 |
| 成功 | `200 {"message":"Imported <N> bookmarks","categories":<int>,"sites":<N>}` |
| 错误 | `400 {"error":"No bookmarks found"}` |
| 行为 | 分类 `INSERT OR IGNORE`；按 `url|category` 去重（含与现有站点比对）；无图标站点先填 Google favicon 服务 URL，再后台并发（5/批）抓真实 favicon——Express 下载为本地文件 `/uploads/icons/...`，Worker 转为 data URI 并经 `executionCtx.waitUntil` 异步执行；记日志 `import_bookmarks` |

---

## 16. Health（站点健康检测）

### POST /api/health-check — 批量健康检测

`E:1892-1950`（探测实现 `E:1822-1890`）/ `W:1372-1421`（探测实现 `W:1303-1370`）

| 项 | 内容 |
|---|---|
| 鉴权 | requireAuth |
| 请求体 | `siteIds`（数组，≤50；仅检测 DB 中存在的站点，未知/非整数 id 被忽略）。缺失/空数组/旧格式 `{urls:[...]}` 一律为 no-op |
| 成功 | `200 {"results":[{"id","url","status","latency","time","statusCode"?,"error"?,"consecutive_failures"},...]}`；`status ∈ online/slow/offline`（HTTP≥400 → offline；全链路延迟>3000ms → slow）；`time` 为 `zh-CN` 本地化时间串；`latency` 失败时为 `'-'` |
| 错误 | `400 {"error":"Too many site IDs"}`（>50）；空/缺/旧格式请求体不报错，返回 `200 {"results":[]}` |
| 私网拦截 | 主机为私网/保留地址时拒绝探测，返回 `offline + error:"Blocked private host"`（每个重定向跳都重查）。Express 做 DNS 解析 + 地址段判断（解析出的 IP 也拦截）；Worker 无法 DNS，只做主机名黑名单 + IP 字面量判断（见 D16） |
| 探测参数 | 并发 5、单请求 8s 超时、手动跟随重定向 ≤3 跳、UA `DogNav-HealthCheck/1.0` |
| 写库副作用 | online/slow → `last_status=<status>, last_check_at=now, consecutive_failures=0`；offline → `consecutive_failures+1` 且 `last_check_at=now`，**仅当连续失败 ≥3 才把 `last_status` 置为 `'offline'`**（之前保留原值）。迁移列：`sites.consecutive_failures INTEGER DEFAULT 0` |

---

## 17. Icons（图标抓取）

### GET /api/fetch-icon?url=... — 抓取页面元信息

`E:1229-1245`（实现 `E:1247-1309`）/ `W:582-644`

| 项 | 内容 |
|---|---|
| 鉴权 | **公开，无限流**（SSRF，见安全缺口 S2） |
| 查询参数 | `url`（必填） |
| 成功 | `200 {"icon":"<url|data:|本地路径>","title":"<str>","description":"<str>"}`；任何异常 → `200 {"icon":"","title":"","description":""}` |
| 错误 | `400 {"error":"Missing url parameter"}` |
| 差异 | Express：HTML 限读 50KB、8s 超时、http/https 均可、跟随重定向，图标下载为本地文件 `/uploads/icons/<md5>.<ext>`（≤500KB）；Worker：整页读入内存、http/https 均可，图标转 data URI（≤32KB） |

### POST /api/admin/localize-icons — 存量外链图标本地化

`E:1378-1401` / `W:687-707`

- requireAdmin；无请求体
- 成功 `200 {"message":"Done","sites":{"ok":<int>,"fail":<int>},"links":{"ok":<int>,"fail":<int>}}`
- 行为：遍历 `sites`/`links` 中 `icon LIKE 'http%'` 的记录逐一本地化（Express 存文件，Worker 转 data URI）；记日志 `localize_icons`

---

## 18. Admin Pages（管理后台页面，非 API）

| 项 | Express | Worker |
|---|---|---|
| 路由 | 13 条显式路由（`/admin` + `/admin/{dashboard,settings,pages,links,categories,submissions,reports,health,stats,logs,users,backup}`）sendFile 对应 HTML，`E:1530-1543` | `GET /admin` → `/admin/index.html`；`GET /admin/:page` → `/admin/<page>.html`（page 经 `[^a-z0-9-]` 过滤，空 → 404），`W:1013-1021` |
| 鉴权 | **无服务端鉴权**，仅靠前端 JS 守卫 | 同左 |

---

## 19. 其他（静态资源与杂项）

| 项 | Express | Worker |
|---|---|---|
| 静态站点 | `express.static(public/)`（`E:48`）；`/uploads` 映射上传目录（`E:49`）；历史上曾暴露项目根目录，已修复为仅 `public/` | 未匹配的非 `/api/*` 请求一律回退 `c.env.ASSETS.fetch`（`W:1038-1043`） |
| 动态页路由 | 无 | `GET /p/:slug` → 302 到 `/page.html?slug=...`（`W:1027-1032`） |
| 天气 | 两端均有公开代理接口 `POST /api/weather`（见 §12）；真实 key 来自 `WEATHER_API_KEY` 环境变量，不可经 API 写入；库中播种的 `weather_api_key=''`（`E:322` / `W:99`）为遗留空值，永不公开；`weather_enabled` 默认 `'false'`（`E:323` / `W:100`） | 同左 |
| 数据库初始化 | 启动时建表+播种（10 分类、settings 11 键、3 页面）；初始管理员**仅在设置 `INITIAL_ADMIN_PASSWORD` 时创建**（`must_change_password=1`），不再生成/打印随机密码（`E:276-289`）；settings 播种 `E:318-330`，页面播种 `E:341-345` | 每请求惰性 `ensureDB`（建表+播种 10 分类、settings 11 键与 Express 一致（`W:96-106`）、4 页面含 `guide`（`W:110-113`））；初始管理员同样仅由 `INITIAL_ADMIN_PASSWORD` 创建（`W:70-76`） |

---

## 双端差异清单

| # | 位置 | Express 行为 | Worker 行为 | 建议统一方向 |
|---|---|---|---|---|
| D1 | POST /api/sites | 成功返回 `200 {"id","message"}`（E:534，**注意 Express 存在 id 恒为 0 的 quirk**，见 test/api.test.js 的 CONTRACT-PIN） | 同样 `200`（W:291） | 语义应为 `201 Created`，两端统一改 201（注意前端兼容） |
| D2 | POST /api/sites 写入列 | 不写 `status` 列，依赖表默认 `'active'`（E:472-474） | 显式写入 `status`（缺省 `'active'`，W:238-240） | 统一为都接受 `status`（与 PUT 对齐） |
| ~~D3~~ | ~~POST /api/pages~~ | **已消除**：Express 补上 `POST /api/pages`，与 Worker 语义一致（id 格式/`status` 枚举 400、重复 id `409 {"error":"Page ID exists"}`、成功 `201`，E:1654-1674） | 同左（W:893-907） | — |
| D4 | DELETE /api/pages/:id | 不存在 | 存在，不存在时 `404`（W:538-544） | 同上，补到 Express |
| D5 | PUT /api/pages/:id | id 不存在静默 200 | 同左 | 建议统一为不存在返回 404 |
| D6 | POST /api/upload | 真实上传：multer 落盘，≤5MB，返回 `/uploads/...` URL（E:883-892） | **占位 stub**：恒返回空 url/filename 和提示文案（W:966-970） | Worker 接 R2 实现真实上传；在实现前契约测试需跳过或标记该端点 |
| D7 | GET /api/fetch-icon 图标产物 | 下载为本地文件 `/uploads/icons/<md5>.<ext>`（≤500KB，E:1332-1375） | 转 data URI（≤32KB，W:661-684） | 统一返回形态；Worker 接 R2 后可与 Express 一致返回 URL |
| D8 | GET /api/fetch-icon 抓取细节 | HTML 限 50KB、8s 超时（E:1250-1265） | 整页读入、无显式超时（W:590-594） | 统一限流/限量/超时参数；并加鉴权（见 S2） |
| D9 | POST /api/import/bookmarks 图标回填 | 后台抓 favicon 存本地文件（E:849-869） | `waitUntil` 后台转 data URI（W:935-956） | 同 D7 |
| D10 | GET /api/export 字段 | 含 `sites/categories/tags/links/settings/exportDate`，**不含 pages**（E:670-696） | 额外含 `pages`（W:764） | 统一含 pages；Express 同步补上 |
| D11 | POST /api/import | 忽略 `pages`（E:704-749） | 支持 `pages` 导入（W:797-803） | 同 D10 |
| ~~D12~~ | ~~settings 默认播种~~ | **已消除**：两端播种完全一致的 11 键（10 个公开键 + `weather_api_key=''` 遗留空值），含 `weather_enabled='false'`，无 `auto_nofollow`（`E:318-330`） | 同左（`W:96-106`） | — |
| D13 | pages 默认播种 | 3 页（about/contribute/links，E:337-348） | 4 页（多 `guide`），且文案不同（W:101-106） | 统一播种内容 |
| ~~D14~~ | ~~天气 key 硬编码~~ | **已消除**：前端不再硬编码和风 key，两端 `weather_api_key` 均默认为 `''` | 同左 | — |
| D15 | 未匹配 /api/* 的 404 | Express 默认 404 HTML 页（`Cannot POST ...`） | `404 {"error":"Not found"}` JSON（W:1038-1041） | Express 加 `/api` 404 JSON 处理器，统一为 JSON |
| D16 | POST /api/health-check 私网判定深度 | DNS 解析主机名并检查解析结果 IP（域名指向内网也拦截，`E:1855` + `lib/netutils.js isPrivateHost`） | 无 DNS，仅主机名黑名单 + IP 字面量判断（`W:1335` + `cloudflare/src/netutils.mjs isPrivateHostSync`）；其余探测逻辑（8s 超时、≤3 重定向、Timeout/Connection failed 文案）两端已一致，IP 字面量用例两端行为相同 | 可保留（Worker 平台限制）；对外暴露的域名若要防 DNS rebinding 需在 Worker 前加 DoH 解析 |
| ~~D17~~ | ~~POST /api/sites/batch update SQL 注入面~~ | **已消除（S4 修复）**：`data` 键名白名单校验，白名单外 `400 Invalid field`；仍为单条 `UPDATE ... WHERE id IN (...)`（E:581-591） | 同左（白名单一致），仍逐 id 循环 UPDATE（W:323-334） | 行为等价，实现差异可保留 |
| ~~D18~~ | ~~POST /api/sites/batch 未知 action~~ | **已消除**：未知 action 返回 `400 {"error":"Invalid action"}`（E:593-595） | 同左（W:336-338） | — |
| D19 | /admin/:page | 13 条显式路由（E:1531-1543） | 通配 `:page` 经字符过滤（W:1017-1021），另多 `GET /p/:slug` 重定向（W:1027-1032） | 可保留实现差异；`/p/:slug` 如需公开短链则在 Express 补同名路由 |
| D20 | 500 错误一致性 | 每个路由 try/catch 返回 `500 {"error": err.message}`，会把内部错误细节（含 SQL）外泄 | 多数路由无 try/catch，异常由 Workers 运行时兜底（非 JSON） | 统一为 `500 {"error":"Internal server error"}`，细节只进日志 |
| D21 | 静态资源的安全响应头 | 由全局中间件统一加（`E:75-81`），`express.static` 与 API 响应一视同仁 | `wrangler.toml` 配置 `[assets] binding="ASSETS"` + `run_worker_first=true`（`cloudflare/wrangler.toml:5-11`），所有请求先过 Worker；静态响应经 `fetchAsset`（`W:132-137`）重新包装后补上安全头 | 行为已一致（静态响应两端均带 4 个安全头），实现路径不同，可保留 |

---

## 已知安全缺口

| # | 缺口 | 位置 | 说明 |
|---|---|---|---|
| S1 | 静态根目录暴露 | `E:48` | **已修复**：历史上 `express.static(__dirname)` 暴露项目根（含 `server.js`、`dognav.db`），现仅服务 `public/`；保持回归测试覆盖 |
| S2 | fetch-icon 未鉴权 SSRF | `E:1229` / `W:582` | 公开接口，后端对任意 URL 发起请求（含内网地址），无鉴权、无限流、无协议/地址段过滤；且 Express 会把响应内容写盘 |
| S3 | ~~health-check 任意 URL 探测~~ | `E:1892` / `W:1372` | **已修复（阶段 4）**：改为按 `siteIds` 检测库内站点（≤50），不再接受任意 URL；私网/保留地址拦截（Express 含 DNS 解析判断，Worker 为主机名+IP 字面量，见 D16）；并发 5、8s 超时、重定向 ≤3 且逐跳重查 |
| S4 | ~~batch update SQL 注入~~ | `E:583-586` / `W:324-327` | **已修复**：`data` 键名白名单（12 个可更新列），白名单外返回 `400 Invalid field`，契约测试已覆盖 |
| S5 | ~~PUT /api/settings 无白名单~~ | `E:1159-1164` / `W:547-552` | **已修复**：两个 settings PUT 均要求 requireAdmin 且强制可写键白名单（10 键，不含 `weather_api_key`），白名单外键 `400 Invalid setting key`；布尔键归一化为 `'true'/'false'`；旧 `PUT /api/settings` 仅作废弃别名保留（带 `Deprecation`/`Sunset` 头），契约测试已覆盖 |
| S6 | ~~导出含敏感信息~~ | `E:734` / `W:814` | **已修复**：`/api/export`、`/api/admin/settings`、`/api/logs`、`PUT /api/settings` 均收紧为 requireAdmin |
| S7 | ~~密钥硬编码入库~~ | `E:321` / `W:98` | **已修复**：两端 `weather_api_key` 默认均为 `''`，前端 `public/js/app.js` 已无硬编码 key |
| S8 | 公开写接口无防护 | `E:1054/1168/538` 等 | **部分修复（阶段 4）**：投稿加蜜罐 `website` + IP 限流 5/h + 字段/分类/URL 校验 + `normalized_url` 去重（409）；举报加 reason 枚举 + IP 限流 10/h + 同站同 IP 24h 去重；点击统计 `POST /api/sites/:id/click` 仍为公开无限流 |
| S9 | 登录限流粒度 | `W:159` | Worker 限流为 per-isolate 内存状态，多实例下不共享，限制效果不可靠 |

---

## 契约测试

`test/contract.test.js` 是双运行时契约测试：同一份「共享契约用例表」分别打向 Express 实例与本地 Wrangler dev 实例，断言两端返回兼容的状态码与字段结构（字段存在性 + JSON 类型），作为合并门禁。用例表覆盖：登录（401/200+token）、`/api/auth/me`（401/must_change_password 豁免/四字段）、强制改密流程、editor 账号创建与登录、站点 CRUD、batch 字段白名单与未知 action 的 400、分类列表、投稿（提交返回 `trackingToken`、`normalized_url` 重复 409、按 token 公开查状态且不含邮箱、未知 token 404、审核收录）、举报（枚举外 reason 400、重复举报不增行）、stats overview 的 `pending_reports/pending_submissions` 计数、settings（公开 GET 恰好 10 键精确集合、废弃 PUT 的 401/editor 403/400/200 + `Deprecation`/`Sunset` 头与 `deprecated:true`、`PUT /api/admin/settings` 的 editor 403/400/admin 200 与布尔归一化）、weather（坐标非法 400、启用但无 `WEATHER_API_KEY` 时 503、禁用 404）、tags（列表/创建）、站点标签（未鉴权 401、POST 关联、GET /api/sites 的 `tags` 字段结构 `{id,name,color}`、按 name 排序、无标签站点 `[]`）、links、pages（GET 列表、POST 创建两端一致 201，D3 已消除）、export 的 401/editor 403/admin 200 与字段、health-check（鉴权 401、空/缺/旧格式 `{urls}` 均返回 `{results:[]}`、>50 个 id 400、127.0.0.1 IP 字面量站点两端一致判定 `Blocked private host` 且 `consecutive_failures` 递增）。上传的扩展名/魔数校验与安全头断言为 Express 独有行为，由 `test/api.test.js` 覆盖（Worker 上传仍是 stub，见 D6）。两个运行时的子进程均剥离 `WEATHER_API_KEY` 环境变量，保证 weather 503 分支确定性。

两个目标都以**独立子进程**启动在随机端口上，互不干扰也不与 `test/api.test.js` 的进程内单例冲突：

- **express**：`node server.js`，env 注入临时 `DB_PATH`/`UPLOAD_DIR` 与 `INITIAL_ADMIN_PASSWORD=TestAdmin123!`。
- **worker**：`npx wrangler dev --local --port <随机>`（cwd 为 `cloudflare/`），`--var INITIAL_ADMIN_PASSWORD:TestAdmin123!`；启动前删除 `cloudflare/.wrangler/state` 保证干净 D1。wrangler 未安装或 dev server 启动失败（如无网络下载 workerd）时，该目标全部用例 **skip 并打印原因**，不会误报失败。

运行方式（`CONTRACT_TARGET` 默认 `express`，无 wrangler 的 CI 也能跑）：

```bash
npm run test:contract                            # 仅 Express（默认）
CONTRACT_TARGET=worker npm run test:contract     # 仅 Worker
CONTRACT_TARGET=both npm run test:contract       # 两端各跑一遍同一用例表
```

已知双端差异通过用例表中的 `expectStatusByRuntime` 分别断言，并在用例名/注释中标注 D 编号（当前用例表已无需分端断言的用例——pages POST 的 D3 已消除，该机制保留以备后续差异；D1、D2、D10、D16 等仅以注释标注）；其余用例两端断言完全一致。注意 D15（未匹配 /api/* 的 404 形态）仍是开放差异，但 D3 消除后不再有用例触达它。修改任一端 API 行为时，同步更新本文档、另一端实现与用例表。

---

> 维护说明：修改任一端 API 行为时，必须先更新本文档，并同步另一端与契约测试。行号基于 2026-07-26 阶段 4 后的代码版本（`server.js` 1989 行、`cloudflare/src/index.js` 1459 行）。阶段 4 变更（两端一致，本文档与用例表已同步）：① `POST /api/health-check` 改 `{siteIds:[]}` 契约（空/缺/旧格式 no-op、>50 返回 400、私网/保留地址拦截、并发 5、8s 超时、重定向 ≤3、`consecutive_failures` 计数且 ≥3 才置 `last_status='offline'`，迁移列 `sites.consecutive_failures`）；② `POST /api/submissions` 加蜜罐 `website`、IP 限流 5/h、字段校验、`normalized_url` 去重（409）、返回 `trackingToken`，新增公开 `GET /api/submissions/status/:token`（迁移列 `submissions.{tracking_token,review_note,normalized_url}`）；③ `PUT /api/submissions/:id` 接受 `review_note/name/description/icon/category`，approved 重校验 URL 与 category（不再默认 `'tools'`）；④ `POST /api/reports` 加 reason 枚举、`detail`、IP 限流 10/h、同站同 IP 24h 去重（迁移列 `reports.{detail,reporter_ip}`）；⑤ `GET /api/stats/overview` 追加 `pending_reports/pending_submissions`。本次已校正 §7/§8/§9/§16 的行号；其余章节的行号仍沿用更早的布局，存在系统性偏差（例如 §1 Auth 的行号），待后续统一重校。
