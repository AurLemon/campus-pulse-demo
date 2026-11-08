# 测试与验证

使用项目现有 Node 24 内置测试运行器、Vue 编译器与 TypeScript，不新增测试框架依赖。测试代码集中在 `tests/`，业务实现与运行参数保持原有行为。

## 快速回归

```sh
pnpm test
pnpm test:coverage
```

`pnpm test` 可以在没有业务数据库、模型密钥和开发服务器的环境运行，已接入现有 CI。

- `core.test.ts` 对照全量排序检查 Top-K 的边界、重复分数、最小堆、追踪和快照隔离，检查前端 mention 的中文与 UTF-16 偏移及端口边界。
- `frontend.test.ts` 编译实际 ReactionIcon.vue，验证两种图标与激活状态的 Vue 渲染。
- `dry-run.test.ts` 调用四个已有工具的显式 `--dry-run` 路径，验证返回的演练计划和临时目录保持为空。
- `test:coverage` 使用 Node 的实验性覆盖率统计，仅统计 `packages/recommendation/heap.ts`。输出不代表全项目覆盖率。

纯函数边界使用明确的测试输入，业务集成使用现有业务数据库的副本。

## 现有数据集成回归

先准备已有业务数据库并构建主站，再执行集成测试。

```sh
pnpm build
pnpm test:integration
```

默认只读打开 `.data/pulse.db`，也可通过 `CAMPUS_TEST_DATABASE` 指定已有 SQLite 数据文件。文件缺失或结构不兼容时测试报错，不创建空库或导入演示数据代替。

每个集成测试文件使用 SQLite backup API 生成独立一致性副本。测试副本放在系统临时目录，所有测试借阅、阅读状态、注册及会话变更发生在副本中。HTTP 测试启动的是主站生产构建，数据库、数据目录和 Agent 令牌路径均明确指向临时目录。测试结束会关闭子进程、数据库连接并删除副本，同时检查临时测试账户未进入来源库。现有主站、Studio 和 worker 进程保持独立。

- `data-backed.test.ts` 使用实际书目、人物和行为，检查帖子与活动 Top-3、探索种子重放、追踪上限、活动过滤、四种图书推荐模式、矩阵归一化及输入快照不变性。
- `http.test.ts` 检查首页、图书、活动页面的 SSR 与导航，检查列表分页、详情一致性、直链重定向、输入边界、游客权限、生产身份桥接关闭、Agent 令牌、注册权限、会话、重复借还、阅读状态幂等和跨源写入拒绝。

HTTP 与 SSR 检查覆盖接口和服务器渲染。交互点击、键盘焦点、移动端布局、媒体播放和实际演示电脑兼容性另做浏览器或 PowerPoint 验收。

## 工程检查

```sh
pnpm format
pnpm lint
pnpm exec eslint tests
pnpm typecheck
pnpm test
pnpm build
pnpm test:integration
```

报告应保留实际执行命令、通过数、失败数和运行时间。测试通过数与覆盖率分别描述，新增失败应保留断言与失败信息，再决定业务修改范围。
