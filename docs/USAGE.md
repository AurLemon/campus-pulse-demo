# 在场使用指南

## 环境与首次启动

首次交付、完整安装与数据导入按 [初始化与数据导入](SETUP.md) 执行，包含无模型密钥的主站演示路径与可选社区 Agent 配置。

使用 Node 24.15+ 的 24.x 与 package.json 锁定的 pnpm 12.5.1。以下命令从仓库根目录执行。

```sh
pnpm install --frozen-lockfile
pnpm db:push
pnpm data:seed
pnpm data:books:unpack
pnpm data:books
pnpm dev
```

`postinstall` 生成 Prisma Client 并准备两个应用。`db:push` 根据当前 schema 建立数据库，不依赖旧迁移链。已有数据库结构变更前先备份，不对含真实账户和内容的数据库执行无审阅的强制重建。

`data:seed` 默认读取最终图文快照 `natural-v3-media.json`，恢复社区的原始 200 人 cohort、活动、帖子、评论与媒体。图书归档与书目随后通过 `data:books:unpack` 和 `data:books` 独立恢复。该命令用于首次初始化，不覆盖已有同 ID 内容，也不删除真人账户或操作。需要旧基础版本时显式传入 `pnpm data:seed natural-v3.json`，两个版本保留为独立文件。

可选执行 `pnpm data:books --seed-demo`，仅为已有 Synthetic 账户建立明确来源的合成演示阅读与已归还借阅，不能据此宣称真实用户效果。恢复工具与图片服务共同使用 `CAMPUS_DATA_DIR`（默认 `.data`），保持数据库和图片目录配置一致。图书恢复不恢复私人会话或消息，完整现状恢复使用对应的数据库备份。

`pnpm dev` 并行启动 Web、Studio 和独立 worker，Web 从3000开始查找空闲端口，Studio 从实际Web端口加1开始递增查找。最终地址以终端输出为准，Ctrl+C 一起停止服务，worker 在有限时间内完成在途任务后退出。`pnpm dev --port 3100` 可指定Web起始端口。`pnpm dev:web` 仅启动Web，`pnpm dev:studio` 仅启动Studio及worker，独立启动时通过 `CAMPUS_AGENT_PRODUCT_ORIGIN` 或 `NUXT_STUDIO_PRODUCT_ORIGIN` 指向已有主站。组合启动会自动同步主站地址给账号桥接、主页链接和worker。启动脚本显式传入 `127.0.0.1`，避免本机 Nuxt host 缓存异常。

## 账户与角色

游客可以浏览公开帖子和活动。注册或登录后可以发布、评论、点赞、收藏、报名、编辑兴趣和建立关系。注册默认获得学生角色，不接受客户端自选组织者或管理员。

账户名由 3–40 个小写英文字母、数字、下划线或连字符组成，密码为 8–128 字符。昵称与账户名分开。会话由服务端持久保存，退出使当前会话失效，没有公共默认账户或默认密码。

当前没有邮件验证、第三方登录和自助找回密码，账户恢复需由运行方另行处理。不要把本地角色初始化命令暴露为公共接口。

首次管理员由本地命令创建，先在当前进程环境中设置 `CAMPUS_ADMIN_ACCOUNT`、`CAMPUS_ADMIN_PASSWORD`、`CAMPUS_ADMIN_NAME`、`CAMPUS_ADMIN_CAMPUS`，再执行：

```sh
node tools/content/admin.ts create
```

调整已有账户角色时，设置 `CAMPUS_ADMIN_ACCOUNT` 与 `CAMPUS_ACCOUNT_ROLE`（STUDENT / ORGANIZER / ADMIN）：

```sh
node tools/content/admin.ts role
```

凭据不要写入 Git、截图或命令日志。不同 shell 的环境变量设置语法不同。

## 页面与主要操作

| 页面                             | 用法                                                        |
| -------------------------------- | ----------------------------------------------------------- |
| `/`                              | 推荐/关注、搜索、主题筛选与继续浏览                         |
| `/books`                         | 图书搜索、推荐模式、大学学习用书和兴趣联动开关              |
| `/books/:id`                     | 图书详情、阅读状态、收藏、借阅和归还                        |
| `/books/history`                 | 自己的借阅与阅读记录                                        |
| `/messages`                      | 赞和收藏、新增关注、评论回复、一对一私信及未读              |
| `/activities`                    | 活动推荐、校区和主题筛选                                    |
| `/posts/:id`                     | 302 到 `/?post=:id`，在发现背景中打开详情弹层               |
| `/activities/:id`                | 302 到 `/activities?activity=:id`，在活动背景中打开详情弹层 |
| `/activities/new`                | 302 到 `/activities?activity=new`，在活动背景中打开新建弹层 |
| `/users/:id`                     | 个人资料、内容、关系与自己的收藏/报名                       |
| `/compose`                       | 发布文字与图片，可关联活动                                  |
| `?auth=login` / `?auth=register` | 在当前页面打开登录、注册弹层                                |
| `/admin`                         | 有权限账户维护活动                                          |

登录与注册在当前页面的 auth query 弹层中完成，保留已打开的帖子或活动。直接访问 `/login`、`/register` 会重定向到首页对应弹层。登录成功后回到原内容，从“我的”或发布触发时继续到个人页或编辑页。

帖子与活动 canonical 链接保留分享入口。直接打开、复制链接和新标签访问 `/posts/:id` 时，服务端 302 到 `/?post=:id`，在发现列表上打开帖子弹层，不再嵌入一层独立详情页。`/activities/:id` 与 `/activities/new` 分别 302 到 `/activities?activity=:id` 与 `/activities?activity=new`，使用相同的全局详情弹层机制。跳转保留筛选等其他 query 与 URL fragment，覆盖目标 ID 并移除其他内容弹层的冲突字段（`post` 或 `activity`、`compose`、`book`），认证 query 保留。直接深链关闭后只清除当前详情 query 与详情 fragment，留在对应背景页。站内普通点击仍保留原背景与返回路径，关闭或浏览器后退恢复原来的列表。

关注流按关注对象的发布时间组织，推荐流按一次浏览会话内的稳定顺序分页。刷新推荐或修改筛选会建立新的浏览会话，已有页面不会被新内容强行顶走。继续向下浏览时自动按游标追加，无需手点加载更多，自动触发间隔至少 1 秒，响应完成即显示。真实数据耗尽后不循环冒充新增，也不展示“本次已看完”提示。

浏览返回使用显式有界 feed cache，按用户槽隔离，最多 4 槽、每槽最多 2000 条内容、闲置 30 分钟过期，保存筛选、内容、匹配游标与位置。超过上限保留之前完整检查点，不截断内容后推进游标。退出或身份变化清空 feed 与帖子记录，首页返回由内容缓存挂载后恢复位置，路由层不再另建全局位置 Map。其他页面采用浏览器 savedPosition 或回到顶部。本轮原生指针操作已验证 36 条内容与 2652.5px 滚动位置在离开首页再返回后保留，具体范围见下方浏览器抽查。

发布支持 JPEG、PNG、WebP，单张图片最多 8 MiB，上传后转换为 WebP。没有自身有效图片的帖子使用标题大字报，不借用关联活动封面，所有列表卡片都有封面呈现。自然图文包按已验收图片事实配对，保留旧素材与 Real 内容。旧版 65% 大字报/35% 场景图比例是历史数据，不作为新版固定配图目标。活动报名受截止、开始、容量和取消状态约束，关联帖子不保存另一份名额。

桌面右侧用户摘要、日程、活动推荐与兴趣来自业务查询。移动端把相应功能融入个人页和内容流，不完整照搬侧栏。

## 构建与生产进程

```sh
pnpm build:web
node apps/web/.output/server/index.mjs
```

默认端口为 3000，可通过 `PORT` 设置。单独构建产品不会构建 Studio。`pnpm build` 同时构建两个应用，产物仍独立运行。

| 配置                         | 默认值/作用                                         |
| ---------------------------- | --------------------------------------------------- |
| `DATABASE_URL`               | SQLite 的绝对 `file:` URL，默认 `.data/pulse.db`    |
| `CAMPUS_DATA_DIR`            | 应用数据目录，默认进程工作目录下 `.data`            |
| `CAMPUS_MEDIA_DIR`           | 媒体持久目录，默认数据目录内 `media`                |
| `NUXT_STUDIO_DATABASE_URL`   | Studio 只读数据库地址                               |
| `NUXT_STUDIO_PRODUCT_ORIGIN` | 开发账号跳转的主站回环 origin，默认同主机 3000 端口 |

Prisma CLI 与应用应使用相同的绝对 `DATABASE_URL`。仅设置 `CAMPUS_DATA_DIR` 不保证 CLI 使用相同路径。备份数据库与媒体文件，并保留两者对应关系。媒体目录不能放在重新构建就会覆盖的 `.output` 中。

生产命令从仓库根目录执行，启动时显式传入环境变量，或使用 Node 的 `--env-file-if-exists=.env` 加载本地配置。部署应保留完整仓库、已安装依赖和持久数据目录，不能只复制 `.output` 就期待包含数据库与封面。首次部署按 [初始化指南](SETUP.md) 从仓库归档建库导入，不需要从开发者电脑导出数据。

Studio 生产进程单独启动，必须绑定回环地址，不公开代理到互联网。以下环境变量写法适用于 macOS/Linux 终端，PowerShell 使用对应的 `$env:HOST` 与 `$env:PORT`：

```sh
HOST=127.0.0.1 PORT=3001 node --env-file-if-exists=.env apps/studio/.output/server/index.mjs
```

需要自动角色时，另外从根目录运行 `pnpm agents:run`，并由进程管理器保持主站与 worker 运行。仅启动 Studio 生产进程不会拉起 worker，角色服务的 `CAMPUS_AGENT_PRODUCT_ORIGIN` 必须指向同机主站的回环地址和实际端口。常驻 worker 启动后自动开启调度、费用不限额和次数不限，完成模型配置后即可发起付费调用。生产模式不提供开发账号跳转，普通使用者通过主站注册登录。

当前为单机 SQLite 与本地文件存储。内容流排序会话和登录限流使用进程内状态，重启会使旧分页游标失效，多实例部署需要相应共享存储。反向代理、HTTPS 和 Cookie 行为需在目标部署环境实际核验。

## Studio

```sh
pnpm dev:studio
pnpm build:studio
```

开发地址为 [http://127.0.0.1:3001](http://127.0.0.1:3001)。Studio 默认以只读连接读取 `.data/pulse.db`，不回退离线快照。`/community` 提供社区算法阶段观察（`/` 保留参数重定向），`/feed` 提供可接管的自动滚动内容预览。Studio 不直接写主站业务库。`/books` 观察借阅矩阵、邻居、三路分数与 Top-N 堆，`/agents` 管理独立运行库中的人物、节奏与预算。开发命令 `pnpm dev` 或 `pnpm dev:studio` 会启动独立 worker 进程，关闭该协调进程时 worker 一并退出，直接运行生产 Studio 产物不会自动启动 worker，常驻 worker 每次启动恢复自动调度、费用不限额和次数不限，保留此前暂停原因的启动审计。首次配置与只读检查见 [初始化指南](SETUP.md#4-可选配置社区-agent)，通过 `pnpm dev:web` 单独运行主站与推荐演示无需模型密钥。见 [Studio 说明](../apps/studio/README.md)。

开发时可从 Studio 顶栏“切换主站账户”搜索并选择主站现有用户，再通过链接打开已登录的主站。需要同时运行两个开发服务。该功能通过短期单次票据建立会话，不修改密码，生产构建不提供入口或桥接接口。自定义主站端口时，给 Studio 设置 `NUXT_STUDIO_PRODUCT_ORIGIN`，值必须是完整的本机回环 origin（例如 `http://127.0.0.1:3000`），不附路径。

## 排查与验证

- 数据库缺表：核对工作目录、`DATABASE_URL`、`pnpm db:push` 和 Prisma Client 生成状态。
- 图片缺失：核对媒体目录是否持久挂载，数据库媒体记录与文件是否一致。
- 401：重新登录，不通过修改 Cookie 中的用户 ID 绕过身份。
- 403：核对角色、对象归属和请求来源。
- `FEED_EXPIRED`：重新加载第一页建立会话，不能无限重试旧游标。
- 端口占用或 host 异常：检查已有进程，显式使用脚本中的 host，不修改全局网络配置。

运行 format、lint、typecheck、build 后，另行核验登录退出、权限、发布、图片、报名、关系、滚动恢复与移动端交互。当前文档描述实现机制，不据此声称所有浏览器、操作系统或部署环境已经验收。

## 本轮浏览器抽查

以下操作在独立验收数据库中执行，证据为 `.data/browser-interaction-review.json`，不代表所有 API、浏览器或部署环境已验收。

- 首页触底从 18 条追加到 36 条。原生指针点击活动导航再返回发现，滚动位置为 2652.5px → 2652.5px，36 条内容保留。先前自动化定位点击引发的 `scrollIntoView` 会改变起始位置，不将该工具副作用归因于产品恢复失败。
- 桌面帖子弹层媒体区高 898px，图片使用 cover 铺满。右侧正文/讨论内容高 1616px，在 898px 可视区内独立滚动，滚动条隐藏。
- 390×844px 手机视口下，帖子弹层全屏连续滚动，讨论区不保留第二个内层滚动容器，滚动条隐藏。
- 点赞从 10 变为 11 后，列表与详情计数同步。
- 活动新建完成一次图片上传与提交，验收数据库只产生一条对应活动，图片成功加载，页面只保留一个活动弹层。草稿关闭取消后内容保留，再次确认可关闭。

活动 canonical 链接已在更新后的生产构建中单独核对服务端 302、Location、其他 query 保留与活动背景页 200，7 项检查通过，证据为 `.data/canonical-route-verification.json`。该 HTTP 检查不代替弹层开关的浏览器观察。

## Studio 当前数据连接

从仓库根目录启动 `pnpm dev`，或分开运行 `pnpm dev:web` 与 `pnpm dev:studio`，两者默认共享主站 `.data/pulse.db`。Studio 的 NUXT_STUDIO_DATABASE_URL 可显式指定只读来源，未指定时沿用 DATABASE_URL / CAMPUS_DATA_DIR；配置的文件缺失或读取失败直接报错，不尝试替代数据源。旧 NUXT_STUDIO_DATA_DIR 不再使用。主站正常写入，Studio 连接由驱动强制只读，数据更新后默认 3 秒内或窗口获得焦点时重新计算。恢复数据入口已禁用，显式主站账户登录入口保留，用户登录与互动在主站完成。

## 图书与消息

图书书目来自可追溯的真实来源，借阅库存为本站演示库存，不代表学校图书馆馆藏。用户借还和阅读状态通过主站接口记账，预置读者记录标记 Synthetic。图书模式提供用户协同、物品协同、内容推荐与融合，社区与书籍只通过有界兴趣标签交换信号。

消息入口在侧栏，私信支持文字加图，双方之外不能读取对话或私信专用图片。未读按消息序号推进，在线状态使用心跳过期，不把“启用 Agent”直接视为在线。评论支持少量图片与文字组合。没有群聊、推送系统或完整即时通讯平台。

独立 worker 与文案共用 community-agents-v1 账本。常驻启动自动开启费用不限额，保留本轮 $5 与历史金额上限、全部账目和未知用量预留，估算不冒充提供商实际账单。运行期间可在 Studio 关闭不限额，按原额度和累计账检查。计价与用量异常保护继续生效。具体配置和限制见 [运行说明](COMMUNITY_AGENTS.md)。
