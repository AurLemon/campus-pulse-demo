# 开发规范

## 工作区与工具链

项目为 pnpm workspace。应用在 `apps/web` 与 `apps/studio`，共享包在 `packages`，离线工具在 `tools`。使用 Node 24.15+ 的 24.x、pnpm 12.5.1，依赖精确版本见根 package.json 和锁文件，不主动升级无关依赖。

Web 使用 Nuxt 4、Vue 3、TypeScript、Nuxt UI、TailwindCSS，业务后台使用隔离的 TDesign。Studio 独立加载 Nuxt UI 与 I18n，以独立只读连接读取主站数据库。Prisma 7 与 SQLite 管理产品数据，sharp 处理图片。不要为了图形观察引入第三套完整 UI 库。

## 模块边界

- `packages/contracts`：纯数据 Interface，不能引入 Vue、数据库、Node 文件 API 或凭据。
- `packages/recommendation`：纯计算，输入显式包含时刻，默认不追踪，不操作网络、数据库或 UI。
- `packages/domain`：仅服务端引用，承担事务、权限所需的数据访问、查询与导入扩展。
- `apps/web/server`：HTTP 参数、身份、错误映射与领域调用，不能挂载模拟身份、数据库恢复或生成接口。
- `apps/web/app`：面向 DTO 渲染，不依赖全站快照，不把 Studio 组件混入产品。
- `apps/studio`：主站数据库只读观察界面，不写业务库，不回退离线快照，运行控制只修改独立 Agent 运行库与预算账本。
- `apps/agents`：独立进程与运行数据库，通过受限服务 API 执行 Synthetic 角色动作，不能冒用真实账户或读取无关私信。
- `tools/content` 与 `tools/agents`：独立工具，运行结果与费用文件不进入客户端或产品部署。

本项目允许按当前任务直接重构，不要求旧目录、接口或数据库的兼容层。结构调整前保留可恢复数据与原始内容，不清理无关源码成果、费用账本或凭据。

## 数据与副作用

Service 聚焦本领域。普通查询和同步计算允许直接调用，不把所有函数强行事件化。导入在事务提交后才执行 `onPublished` hook，hook 失败不会回滚已经提交的内容，返回值需明确记录 hookError。

领域对象保持明确职责：Activity 保存活动与报名容量，Post 保存传播和讨论，可选关联一个活动。好友请求需接受，关注单向立即生效。内部主键不作为昵称展示。

密码与会话只能存在服务端。数据库生成的完整算法输入不直接返回浏览器。上传文件校验实际格式与尺寸，媒体持久目录与构建输出分离。

## 代码与文档

Interface 优先，非必要不使用 any。根 Prettier 约定单引号、无分号、尾随逗号、Tab、LF。Vue 事件处理需要多个语句时提取具名函数，避免内联多语句被无分号格式化破坏。

首页不使用 KeepAlive，NuxtPage 显式关闭 keepalive。内容恢复使用 `apps/web/app/composables/useCampus.ts` 导出的有界 feed cache，保留内容/游标完整检查点并按身份清理，不能只记录滚动位置。

UI 文本使用各应用的 i18n 文件。文案不用中点分隔信息，中文非必要不用分号或省略号。文档使用英文文件名与中文正文，公共 README 按真实产品介绍，工具来源和费用说明放内部工具文档。

## 内容资料与版本控制

生成中间 JSON 通过 `tools/content/generated-content.tar.gz` 提交到 Git，`.data/content-cache` 只是自动解包的本地副本，不能把忽略展开目录理解为不保存生成成果。最终 snapshots 通过 `tools/content/snapshots.tar.gz` 提交，自动恢复到 `.data/snapshots-cache`，图片与来源清单通过 `tools/content/assets.tar.gz` 提交，自动恢复到 `.data/assets-cache`，预算账本/凭据/任务日志不进包。缓存文件发布必须使用统一 writeContentCacheFile，与 pack 遵循同一锁和提交边界，不直接绕过原子发布。tools 与 `.data` 继续排除代码统计，归档完整性与冲突规则见[中间资料说明](DATASET.md#中间资料归档与恢复)。

## 检查与运行

```sh
pnpm format
pnpm lint
pnpm typecheck
pnpm build
```

根 lint 覆盖 Web、Studio、packages、tools 和 scripts。类型和构建脚本覆盖两个应用。不新增测试文件，使用现有命令、必要的临时对照与实际交互核验。Build 不代替业务和浏览器验收。

只为明确的预览/核验开启临时服务，结束关闭。不残留 Debug 输出，必要的服务端错误日志继续保留。未明确授权不提交、推送或部署。

## 本地 Studio 身份跳转

仅开发构建提供 Studio 选择真实主站账户的入口。身份跳转通过受限 HTTP 接口取得短期单次票据，不使用 Studio 的只读数据库连接写入。主站消费票据建立真实会话，不修改密码或角色。所有桥接接口同时校验回环 socket、Host、Origin 与专用请求头，生产构建固定返回 404，配置不能重新开启。票据通过 URL fragment 传递，消费前立即从地址栏清除。该开发例外不扩展为产品的模拟身份、生成或重置接口。
