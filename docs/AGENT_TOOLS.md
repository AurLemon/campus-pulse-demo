# 内容任务与全局 Pi

## 边界

新增、批量生成和实质润色内容默认通过 DS，工程 Agent 负责输入约束、审样、校验、集成与最终验收。真实私人页面、用户昵称、帖子与图片不发送给第三方模型，只传抽象表达规律和已授权的虚构内容上下文。

`tools/agents/run.ts` 通过全局 Pi 的 ModelRuntime SDK 执行无工具写作任务。它不再通过 Pi CLI print 会话生成内容，不加载仓库、扩展、MCP 或文件工具。`--read-only` 会被明确拒绝，需要的上下文由调用方先整理。

Pi 与模型配置只存在于用户目录，不安装到产品运行依赖。配置在 `~/.pi/agent/`，provider 为 campus-hub，默认模型 deepseek-v4.1-flash-1017。SDK 按显式目录、PATH shim 或 `pnpm root -g` 定位，不修改全局 provider。

## 调用

```sh
pnpm agent:run path/to/task.txt --run
pnpm agent:probe
```

`agent:run` 无 `--run` 时只打印用法。probe 无 `--run` 时只做计划，实际探测需另行明确。上述运行器本身没有累计费用封顶，付费写作必须通过 `tools/content/budget.ts` 的 `runWritingBatch` 预留与记账，不直接批量调用 runner 绕开账本。

| 环境变量                  | 作用                                      |
| ------------------------- | ----------------------------------------- |
| `CAMPUS_AGENT_CWD`        | 唯一任务目录，并发任务不得复用            |
| `CAMPUS_AGENT_MODEL`      | 已配置的目标模型，计价必须匹配            |
| `CAMPUS_AGENT_API`        | openai-completions 或 openai-responses    |
| `CAMPUS_AGENT_MAX_TOKENS` | 请求级上限，默认 16384，限制在 1024–32768 |
| `CAMPUS_AGENT_TIMEOUT_MS` | 默认 180000，限制在 10000–300000          |
| `PI_CODING_AGENT_DIR`     | 已授权的全局配置目录                      |
| `CAMPUS_PI_SDK_ROOT`      | 显式指定全局 SDK 的 node_modules 根       |

runner 默认协议为 Chat/openai-completions，当前 refresh-community 的写作首尝试显式选 Responses，后备尝试 Chat。不能据此说所有请求默认 Responses。runner 在单次请求内复制模型配置并提高 maxTokens，不回写 models.json。Chat 请求设置 thinking.disabled 与 JSON response_format，Responses 设置 reasoning.effort=none 与 JSON text.format。上游可能忽略这些要求，实际仍可能产生 thinking，不能仅凭选项声称思考已关闭，也不能把 token 参数当作费用硬上限。

## 产物与成功条件

每个任务在 `.data` 下的独立 job 目录保存 task.txt、events.jsonl、stderr.log、result.json 与 request-meta.json。请求元数据只记录模型、限制、协议相关字段与状态，不保存凭据或整段消息。事件日志对密钥做脱敏，输出超过约 4MB 中止。

成功要求已结束、stopReason=stop、有非空正文且最终 usage 完整，不把 HTTP 200、进程退出或存在 result.json 当成内容已通过。result.json 还记录 usageComplete、stopReason、metadata 与错误，调用方仍需校验 JSON、ID、评论覆盖、事实关联和自然度。

任务原始日志、费用账本和凭据不进入 `tools/content/generated-content.tar.gz`。该包只保存内容生成中间资料，工具恢复到 `.data/content-cache`，解包与读取检查点本身不调用模型。网络调用在内容缓存锁外，缓存发布使用统一写入 API，不能用请求成功代替归档/本地状态提交结果。归档/恢复及本地增量冲突规则统一见[中间资料说明](DATASET.md#中间资料归档与恢复)。

## 预算与失败

累计账本为 `.data/data-generation/ledger.json`，当前授权上限 10 美元，旧批次不清零。每个请求先保留 0.02 美元，实际 usage 明确后按已知渠道价格计算。未知 usage 的失败保留完整 0.02，不伪造为零，也不释放成可重复消费的额度。

账本更新使用独占文件锁与原子替换，锁只覆盖预留/结算，不锁住整个网络请求。内容生成有有限并发，不能擅自绕开预留增大并发或预算。已知计价异常和超出预留会停止新请求；未知用量失败按完整预留计账，保留原始证据后按已有授权继续。

`reconcileWritingJobs()` 对照已有任务结果结算被中断的 running 批次，不发送新请求。恢复任务前先核对 running、已有逐帖缓存与失败预留，避免同一上下文重复付费。

计价与服务商名是当前渠道配置，不代表模型官方价格或底层模型真实性已被独立证明。HTTP/协议正常不代表上游遵守 JSON、thinking 或 token 限制。

## 凭据与运行位置

模型凭据不进入 Git、浏览器、工单正文、公开日志或产品部署。环境引用只解析变量，不执行配置中的 shell 命令。生成任务从仓库根运行，始终指向同一 `.data` 账本。

网络需要代理时仅在任务进程使用已有设置，不改系统配置。Node 原生 fetch 不会仅因存在 HTTP_PROXY/HTTPS_PROXY 就自动使用代理。当前 runner 检测到这些变量且尚未 bootstrap 时，仅将本工具子进程以 `--use-env-proxy` 重新启动一次，通过 CAMPUS_AGENT_PROXY_BOOTSTRAPPED 防止递归，继承既有环境，不硬编码代理端口。无需修改父 CLI、NODE_OPTIONS、全局 Pi 或系统代理。SDK 最终使用 Node 原生 fetch，request-meta 的 processProxyEnabled 记录启动标记或 NODE_USE_ENV_PROXY=1。链路改善不能证明所有上游流中断都由本地代理引起。目标机器需要自行安装全局 Pi，macOS 之外的 SDK 定位与原生依赖仍需实际核验。
