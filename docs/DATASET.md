# 内容资产与内部来源记录

本文用于内容维护工具，公共产品界面不展示内部生成标记。当前来源字段区分 Real、Synthetic 和 Generated，不能删除原始来源、费用证据或把生成内容当成真实用户效果统计。

## 文件与状态

- `.data/snapshots-cache/small.json`：20 用户、6 活动、12 帖子及完整讨论的小规模基线，用于确定性核验。
- `.data/snapshots-cache/full.json`：保留的旧完整基线（1200 帖/3600 评论），未为新目标伪改原始数据。
- `tools/content/generated-content.tar.gz`：Git 中保存的生成中间资料归档，包含原有批次、人物、逐帖检查点、进度和接受记录。
- `.data/content-cache/pulse-v1`、`.data/content-cache/pulse-v2`：归档自动还原后的本地工作副本，不单独提交展开文件。
- `.data/snapshots-cache/pulse-sample.json`：小样输出。`pulse-full.json` 为当前完整内容包，版本 `campus-synthetic-pulse-v2-1000`，200 用户、120 活动、1000 帖、3000 评论（2250 一级评论、750 回复）、601 好友记录（600 已接受）、1000 关注、4216 当前状态、24550 逻辑行为、15753 阅读会话。
- `tools/content/assets.tar.gz` / `.data/assets-cache/manifest.json`：实际场景素材、主题、作者、来源页、使用条件和本地 WebP 路径。

本轮 1000 帖及对应 3000 评论已完成并通过独立结构/引用/校区/时间/错误泄漏检查，已导入主库。内容覆盖证据还原后位于 `.data/content-cache/pulse-v2/acceptance-1000.json`，实际主库/公开 DTO/推荐与媒体核验为 `.data/final-pulse-seed-verification.json`。不能把这些检查扩展为真实推荐收益或尚未执行的浏览器验收。

## 中间资料归档与恢复

生成中间资料仍需进入版本控制，只是由数千份零散文件改为提交 `tools/content/generated-content.tar.gz`。不是丢弃 JSON 或仅保存于 `.data`。原 `tools/content/content` 的人物、批次、逐帖内容、检查点与原 README 保留原字节，包内相对路径以旧内容目录为根。

最终快照、摘要和文案补丁统一通过 `tools/content/snapshots.tar.gz` 提交，恢复到 `.data/snapshots-cache`，图片与来源清单单独打包为 `tools/content/assets.tar.gz`。费用账本、模型凭据、任务请求日志不进入此包，保留在各自受保护的运行目录。代码统计继续排除 tools 与 `.data`，不把归档或展开 JSON 计作业务代码。

```sh
pnpm data:unpack
pnpm data:pack
```

解包目标固定为 `.data/content-cache`，其中 `.bundle-state.json` 只作本地状态记录，不进入归档。包根 `manifest.json` 使用 `format: campus-content-cache`、`formatVersion: 1`，`dataVersion` 为当前 pulse-full 的版本或 unversioned。`files` 按相对路径排序，每项记录 path、bytes 和 sha256，按原字节长度与 SHA-256 检查，JSON 文件还需可解析。统一使用上述命令生成 tar.gz，不另换 ZIP 或手工改包，打包固定排序并去除时间戳，确保重复打包结果一致。

需要中间资料的工具在入口调用 `ensureContentCache()` 自动恢复，不要求手动先解包。已有相同包的本地副本允许增量修改以便续跑，只补回缺失的基线文件，保留已存在文件的修改。遇到大小写别名冲突会停止，避免覆盖。默认保留旧条目，新增以追加为主，必要更新不得裁减无关内容。仅当用户明确要求删除对应数据时，才可删除本地文件后直接执行 `data:pack`，pack 不自动补回缺失文件。不能把手动删除入口当作清理旧数据的默认授权。包已变化且本地内容不等于新包时返回 `CONTENT_BUNDLE_CONFLICT`，不能静默覆盖、合并或清空本地工作，需要先核对差异并保留副本。

`data:refresh` 与 `data:generate` 只有成功并通过快照校验后才自动 pack。生成或快照校验失败保留本地中间文件，不进入归档发布，也不为恢复缺失缓存自动发起付费请求。

缓存文件发布与 pack 通过 proper-lockfile 4.1.2 使用统一锁。8 个内容工具已将缓存文件发布接入 `writeContentCacheFile`，以临时文件和 rename 原子写入，不能另用直接写文件绕过锁。DS 网络请求在锁外执行，pack 持有同一把锁读取、验证与发布，避免二次扫描之后仍有写入窗口。

pack 验证或归档发布前失败保留旧包。archive rename 是完整新包的提交点，之后如果仅本地状态文件写入失败，返回 `cacheStateUpdated: false` 和 `cacheStateError`，新包已经提交，不能声称归档没变。生成入口此时以失败状态退出，停止后续缓存修改，执行 `pnpm data:unpack` 可在内容相同的情况下恢复本地状态。归档内内容与本地状态文件的提交结果必须分别报告。

归档内原 README 是历史原始资料，保持原字节，其中旧路径不自动成为当前运行入口。归档生成、完整性和恢复验收与内容语义验收分别记录，不因为包存在就宣称全部校验通过。

本次已迁移 1549 个文件，原字节总量 3,640,130，归档 1,214,954 字节（约 1.2MB）。逐文件原字节 SHA-256 往返全部一致，跨进程重复 pack 的归档 digest 一致。旧散文件目录已移除，最终快照与图片在后续独立归档时保持原字节一致。已另外验证并发写入与打包互斥、锁持有进程中止后的恢复、损坏包拒绝、版本冲突保护、缺失文件补回和显式删除。没有运行 DS 或改业务数据库。

## 最终快照归档与恢复

`tools/content/snapshots.tar.gz` 保存原 snapshots 目录的全部 7 份 JSON：small、full、pulse-full、pulse-sample、两个 summary 和 community-natural-v2，不丢弃旧基线。恢复目录为 `.data/snapshots-cache`，本地修改保护、路径检查、哈希校验与原子发布规则复用正文归档。包根 manifest.json 使用 format: campus-snapshots-cache、formatVersion: 1，快照单文件上限为 32MiB。

`pnpm data:pack` / `pnpm data:unpack` 默认包含此包。仅处理快照可用 `pnpm data:snapshots:pack` / `pnpm data:snapshots:unpack`。validate、seed 和生成工具通过统一 resolveSnapshotFile 自动恢复，命令可直接传 small.json 或 pulse-full.json，旧 tools/content/snapshots 文件参数继续映射到新缓存，外部显式路径仍可读。生成和润色成功后通过 writeSnapshotFile 原子写入并 publishSnapshots 打包，不再向源码目录输出散 JSON，不绕过统一锁。正文、快照、图片各自独立发布，不保证跨包事务。

## 图片归档与恢复

图片与来源清单以 `tools/content/assets.tar.gz` 提交，展开目录为 `.data/assets-cache`，不再保留 `tools/content/assets` 散文件。`manifest.json` 保存作者、来源页、使用条件和媒体信息，原有清单原字节保留，其中旧 file 路径仅作历史记录，当前工具按 id 在缓存中定位图片，新获取清单使用相对文件名。

`pnpm data:pack` / `pnpm data:unpack` 依次处理快照、正文和图片三个独立包，每个包独立发布，不提供跨包事务。仅处理图片使用 `pnpm data:assets:pack` / `pnpm data:assets:unpack`。`pnpm data:assets` 先自动恢复已有图片，新增素材成功并校验后自动打包，解包不会请求网络。`data:seed` 在复制媒体前自动恢复图片，之后复制到 `CAMPUS_MEDIA_DIR` 或 `.data/media`，现有运行目录和 URL 不变。仅解包不写数据库，也不把运行目录中的用户上传收进素材包。

图片复用相同的哈希、路径校验、原子发布、本地修改保护和锁机制，但使用独立缓存和锁。包内完整性清单为 `bundle-manifest.json`，format 为 `campus-assets-cache`，formatVersion 为 1，避免与来源清单重名。只允许 WebP、JSON 和 README，额外校验每张图片可解码、尺寸与来源清单一致，未登记图片或缺失引用会阻止打包。WebP 已压缩，单包主要减少 Git 文件数。

## 内部维护命令

```sh
pnpm data:validate small.json
pnpm data:validate full.json
node tools/content/refresh-community.ts --sample
node tools/content/refresh-community.ts
```

后两项是实际付费写作调用，必须处于既有授权和预算内。脚本默认目标 1000 帖，显式 `--posts=N` 可在旧基线范围内选择数量，输出版本携带目标数。`--sample`/`--offset=N` 仅限制生成批次，不负责裁成 Studio 子集。不要用旧 generate.ts 或统一标点工具覆盖当前已通过文案。当前重写默认并发 4，可通过 CAMPUS_CONTENT_CONCURRENCY 调整，脚本封顶 6，不能绕开累计预留机制。

重写先自动恢复归档并核对本地副本、恢复未结算任务，再读取有效逐帖缓存，只有授权生成任务才生成缺失项。普通批次每组 6 帖，失败可递减拆分，每帖校验 ID、标题正文、用途及全部评论 ID，失败或上游错误文本不进入有效缓存。具体完成数以 progress.json 和最终校验为准。

## 素材与导入

本轮帖子封面分配目标为标题大字报 65%、场景图 35%，落在 60–70% 大字报的产品要求内。当前 1000 帖已更新为 650 帖大字报、350 帖场景图。全部 1000 个公开 PostView 投影逐项核验通过，205 个存在活动封面的帖子仍按大字报呈现，没有借图回退，证据为 `.data/final-poster-ratio-review.json`。配额作用于整个可自动分配内容包，推荐分页保持原有排序。

保留 Real 内容及未知/上传媒体，不为达到比例覆盖用户自有图片。帖子自身没有有效媒体时明确渲染标题大字报，不回退使用关联 Activity 的封面。Activity 仍可保留自己的活动封面，其图片不计入帖子场景图配额。

统计区分分配结果与页面呈现：通过公开 DTO 的 `PostView.media` 判断正常渲染分支，空数组进入大字报，非空数组进入帖子场景图。不能只数数据库 `mediaIds` 空值就宣称实际渲染达到 65%，也不能把关联活动封面算作帖图。图片加载失败导致的额外大字报回退单独记录，不混入预设配额的完成数。Studio 的独立全标题封面子集不计入产品内容包配额。

本轮只调整已有素材的分配和渲染规则，不扩大素材搜索或生成。后续新增图片由独立素材流程接入，仍保留来源与使用条件。

场景图和标题大字报同时使用。素材当前从已列明的 Pexels 资源整理成 WebP，出处和使用条件保存在 manifest。按具体主题匹配，不给羽毛球帖子随便套篮球图。不能把场景图当成真实校园现场照片。

```sh
node tools/content/seed.ts pulse-full.json
```

执行前要求完整快照实际存在且通过校验。seed 自动恢复图片归档后复制媒体到持久目录，通过 `tools/content/media.ts` 的纯函数 `attachMedia(snapshot, assets)` 按主题安排场景图与模板封面，再通过 `importContentBatch` 导入。函数返回新 Snapshot，不修改输入，不执行文件或数据库操作，并保留 Real 内容及未知/上传媒体，调用方必须使用返回值。批次使用内容摘要和回执实现幂等，不覆盖真实账户或已发布内容。重复 ID 对应不同内容应报冲突，不能把 append 当全量重置。

旧 `data:import` / `data:reset` 用于受限制的旧快照维护，不能作为生产追加入口。reset 必须显式确认并拒绝真实数据。产品没有重置 HTTP 路由。

## 时间、人物与来源

重写使用稳定人物设定和作者口吻，保留活动关联与评论链。结构时间统一平移并检查先后关系，正文不让模型自由编造日期、星期、地点、证书或学校背书。校区归一化为铜盘校区、鼓山校区、旗山校区。

费用账本 `.data/data-generation/ledger.json` 累计上限 10 美元，旧记录保留。最终已知 usage 估算约 0.586682 美元，77 个未知用量批次保留 1.54 美元，保守累计约 2.126682 美元，在途任务为 0。未知 usage 失败完整保留 0.02 美元预留，这不是实际账单精确值。不要从快照内容数量推算真实用户活跃度、点击率或推荐收益。

验收分别记录结构约束、自然度抽审、素材主题、真实导入与浏览器结果，不以其中一项替代其他项。

## Studio 独立内容

`apps/studio/server/assets/seed.json` 来自当前完整包的独立中等子集：200 用户、120 活动、240 帖、720 评论，关系、2552 状态、12489 行为和 8185 会话按引用保留，校验无悬空。清空媒体 ID，使用本地标题封面。该旧子集仅保留为历史资料，当前 Studio 不加载或恢复它，运行时只读主站数据库。

## 封面模板元数据

活动与帖子在快照和导入时保留 `posterTemplate`（`orbit` / `quote`）、`posterAspect`（`portrait` / `square` / `landscape`）与 `posterHighlight`。导入旧条目缺省为 `orbit`、`portrait`、空字符串，显式选择保持不变。高亮最多 40 字，必须是标题中实际存在的连续子串，不改写标题以制造高亮。

内容工具 `poster.ts` 为新生成条目按 ID 的 FNV-1a 哈希奇偶确定模板，约各占一半，默认统一使用竖版。自动高亮只匹配条目现有标签在标题中的原文子串，找不到则留空。已有明确选择保持不变，正文重写后不再属于标题的旧高亮会重新按现有标签匹配。

已有快照可先运行 `node tools/content/assign-posters.ts` 检查，确认后添加 `--run` 更新默认的 `pulse-full.json`，也可通过 `--file=文件名.json` 明确指定包内文件。此工具仅补封面元数据，不调用模型、不接数据库、不改变条目或正文，校验后通过 `writeSnapshotFile` 与 `publishSnapshots` 的统一锁和原子归档流程发布 `snapshots.tar.gz`。其他快照、摘要和补丁保留，并核对原字节 SHA256。数据库与 Studio 需由各自导入流程读取这些持久字段，不在视图中临时重新随机分配。

## Studio 运行来源更新

此前的 240 帖 seed 与 `.data/studio/snapshot.json` 作为既有资料保留，当前 Studio 不再读取它们。运行时以只读连接读取主站完整数据库，数据缺失或故障直接报错，无离线回退，无恢复写入接口。
