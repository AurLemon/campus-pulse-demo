# 在场 / Campus Pulse（Agent 入口）

适用于本工作区。先读 [使用指南](docs/USAGE.md)、[协作规范](docs/COLLABORATION.md) 与 [开发规范](docs/DEVELOPMENT.md)，再按任务查看相关源码和 Git 状态。保留已有成果，不能把历史文档、旧截图或旧数据库当成当前实现。

## 工作区

- `apps/web`：产品、业务管理和 HTTP API，前台 Nuxt UI，业务后台 TDesign。
- `apps/studio`：独立算法观察、参数实验和内容滚动预览，以独立只读连接实时读取主站数据库，不写业务数据、不回退离线快照。
- `packages/contracts`：公共 Interface、DTO、三校区枚举和导入契约。
- `packages/recommendation`：纯 TS 画像、评分、最小堆和可选追踪。
- `packages/domain`：服务端身份、查询、事务、媒体与导入扩展，不允许客户端引用。
- `tools/content`、`tools/agents`：内容维护和全局 Pi SDK 任务，不进入产品运行依赖。
- `prisma/schema.prisma`：当前结构，生成 Client 在 `generated/prisma`。

使用 pnpm、Node 24.15+ 的 24.x，依赖版本见根 package.json。项目允许按任务直接重构目录、接口、模块和模型，不要求旧兼容层或数据库迁移链。开发数据库可重建，前提是保存可恢复现状，不删除无关源码成果、原始内容和累计账本。重构授权不包含提交、推送或部署。

## 产品和数据边界

产品名在场，英文 Campus Pulse。Activity 保存活动时间地点、容量和报名，Post 可选关联活动，评论属于具体帖子。保留一级评论与一层回复、点赞收藏、报名撤销、需接受的好友和单向关注，不擅自扩展私信/群聊。

产品采用真实服务端会话，不能默认选择第一个用户，不信任 Cookie 或请求体中的用户 ID。游客可公开浏览，写入和对象管理校验身份/角色/归属。完整算法 Snapshot 只在服务端使用，bootstrap 只给公开 DTO。

默认产品数据库 `.data/pulse.db`，旧 `.data/campus.db` 保留。Studio 默认只读共享主站 `.data/pulse.db`，使用 readonly/fileMustExist 驱动连接，旧 `.data/studio/snapshot.json` 不再作为运行数据源。媒体在 `.data/media` 或显式持久目录，不能放构建输出。新建开发库使用 db:push，不沿用旧迁移链。

内容来源和模型记录留在数据与独立工具文档，公共产品页面、README 和业务 DTO 不展示内部生成标记、课程任务或基准时间说明。不得删除来源记录，也不得宣称内部内容证明真实用户效果。

未来内容生产者通过 append 批次、摘要回执与事务提交后的 onPublished hook 交付，产品不挂载生成、模拟身份、重置或任意导入 HTTP 路由。hook 失败不等于已提交内容回滚。

## UI 与交互

先读 [UI 规范](docs/UI_GUIDELINES.md)，不要沿用被替代的视觉习惯。

- 灰白主色、少量蓝色点缀，不用大面积深色 primary 实心块，侧栏发布按钮按当前设计使用主题蓝底白字。浅色/深色/系统三模式均用图标入口。
- SVG 品牌为无背景的单线字母 P，“在场”置于图标下方，无 tagline。首页无 hero 大卡片和“为你发现”两行，活动页无装饰英文/大标题/副标题。
- 桌面三栏，PC 个人主页三列，手机独立导航和可读降列。
- 每张卡片都有封面，场景素材与标题大字报都保留。无图或失败用实际标题封面，不交付纯文字卡片。
- 帖子卡片无 border/hover 描边/阴影，hover 仅整体 brightness(.95) 与 pointer，禁止卡片文字下划线，活动卡片同样式，浅色卡片使用轻灰。
- 校区统一为铜盘校区、鼓山校区、旗山校区，选择器、API、导入和存量数据同时一致。
- 帖子、查看活动、新建活动与发布采用 route query modal，canonical 直链仍可访问。登录/注册使用 auth query modal，保留下层内容，不跳转登录页面。详情 modal 外层无 border/ring，多图使用真实媒体数组支持左右滑动。PC 图片铺满媒体区、右侧正文独立滚动并隐藏条，手机连续滚动。
- 首页不用 KeepAlive，显式有界 feed cache 保存筛选/内容/游标/位置，按身份隔离与清理。异步取消、浏览器返回和 modal busy 状态必须正确收尾。
- 表单与弹层沿用可靠组件，检查必填/边界、首错焦点、重复提交、失败保留、未保存离开、成功刷新和权限，不用短暂 Toast 独自承载错误。

文案不用中点分隔，中文非必要不用分号、省略号。UI 走 i18n，用户内容保留原文。字体、图片、主题与焦点一并验收。

## 内容与 DS

新增、批量生成和实质润色内容默认通过 DS，工程 Agent 负责最小上下文、审样、校验和集成，机械错别字/标点修正可直接处理。调用方式见 [Agent 工具](docs/AGENT_TOOLS.md)，内容规则见 [生成规范](docs/DATA_GENERATION.md) 与 [内部数据说明](docs/DATASET.md)。

归档维护必须遵循以下规则：

- 中间批次、人物与检查点只提交 `tools/content/generated-content.tar.gz`，自动解压存入 `.data/content-cache`。最终快照、摘要与文案补丁提交 `tools/content/snapshots.tar.gz`，自动解压存入 `.data/snapshots-cache`。图片和来源清单提交 `tools/content/assets.tar.gz`，自动解压存入 `.data/assets-cache`。统一使用 tar.gz，不恢复为源码目录中的散文件提交。
- `pnpm data:unpack` 恢复三个包，`pnpm data:pack` 更新三个包。读取入口自动恢复，内容更新后通过统一写入 API 原子保存，生成与校验成功后更新对应归档。仅处理快照或图片分别使用 data:snapshots:pack/unpack、data:assets:pack/unpack，不手工改包。
- 数据默认保留既有条目，新增内容以追加为主，必要更新保留无关内容。未经用户明确说明，不删除已有文件、人物、帖子、图片、历史快照、来源记录或归档条目，不因重新生成、精简、打包或清理而裁减数据。打包迁移只有在逐文件校验可恢复且已获授权时才能移除原散文件副本。
- 保留本地已有修改，仅从同包补回丢失的基线文件。包变化且本地不一致时停止，不自动覆盖或跨版本合并，不通过重新付费生成来补缓存。费用账本、凭据与任务日志不进包，累计账本不清零。
- 生成、校验或归档发布前失败保留旧包。归档 rename 已提交但本地状态失败时分别报告，不声称归档回滚，停止后续缓存修改。缓存发布统一走 writeContentCacheFile / writeSnapshotFile / writeAssetCacheFile，不绕过锁。格式、manifest、更新和冲突细则统一见 [内部数据说明](docs/DATASET.md#中间资料归档与恢复)。

全局 Pi 的 ModelRuntime SDK 从 `~/.pi/agent` 读取 campus-hub 配置，默认模型 deepseek-v4.1-flash-1017。项目不安装 Pi 或保存凭据。runner 无工具，单次复制模型配置提高 maxTokens，不修改全局配置。Chat 请求 thinking.disabled、Responses 请求 reasoning.none，但上游可能忽略，实际 wire 与最终 usage 才是证据。

所有付费批次经 `tools/content/budget.ts` 预留与结算，累计上限 10 美元，旧账不清零。未知 usage 保留完整 0.02 美元，不编造实际成本，按已有授权在完整预留下继续。异常计价/超额停止新请求，不擅自充值或扩额。每个任务唯一目录，有限并发，先恢复检查点再发新请求。

人物先于正文，普通昵称/食物/拼音英文数字/少量表情自然分布，不用圈子加流水号。同一人保持口吻，允许短问、补充、犹豫、不同意见和长评，不全员运营腔，也不循环“蹲/救命”装口语。人物提示词不能出现在简介或正文。逐帖校验全部评论 ID 和上下文，小样通过再扩量。

真实产品只参考抽象表达和交互，不把私人页面、真实用户内容或凭据传给模型。素材保留出处和使用条件，不冒充校园实拍。当前完整包为 `campus-synthetic-pulse-v2-1000`（200 用户/120 活动/1000 帖/3000 评论），已通过校验并导入；旧 1200 帖基线保留。后续内容变更仍以逐帖通过、最终校验和实际导入证据为准，不能把旧快照或脚本存在当作新任务完成。

## 协作、检查和交付

使用内置多 Agent 时先明确文件负责人，共享契约/schema/根锁集中维护。未明确采用 Seedmux 不自动创建真实 pane。详见 [协作实施](docs/AGENT_WORKFLOW.md)。

不新增测试文件。完成执行 pnpm format，按范围运行 lint/typecheck，代码变更执行 Build，并区分实际 API、浏览器和内容抽审。不要把静态通过说成产品交互已验收。临时核验服务用完关闭，不残留 Debug 输出，必要的服务端错误日志保留。

开发文档集中在 docs，并与当前实现保持一致。过时文档直接移除，不再建立归档副本。报告/截图等非代码资料留在上一级已有资料目录，不混入产品模块。未明确授权不提交、推送、部署，不伪造作者、时间、贡献或验收。

## 本地 Studio 身份跳转

仅开发构建提供 Studio 选择真实主站账户的入口。身份跳转通过受限 HTTP 接口取得短期单次票据，不使用 Studio 的只读数据库连接写入。主站消费票据建立真实会话，不修改密码或角色。所有桥接接口同时校验回环 socket、Host、Origin 与专用请求头，生产构建固定返回 404，配置不能重新开启。票据通过 URL fragment 传递，消费前立即从地址栏清除。该开发例外不扩展为产品的模拟身份、生成或重置接口。

## Studio 实时只读观察

根目录 `pnpm dev` 与 `pnpm dev:studio` 默认指向同一主站数据库，Studio 通过独立 readonly/fileMustExist SQLite 连接与短事务读取，不导入主站写客户端，不创建或恢复数据库。主站写连接使用 WAL，Studio 不执行写入。数据缺失、数据库故障直接报错，禁止 seed/离线快照 fallback。旧离线资料保留但不作为运行依赖，恢复数据写入口禁用，保留显式主站账户登录入口。默认实时计算时间，3 秒检查变化并在窗口获得焦点时检查，固定历史时间须显式切换。Studio 仅允许本机访问，密码与认证会话不得暴露。详见 apps/studio/README.md。
