# 内容任务与 Pi ModelRuntime

## 边界

新增、批量生成和实质润色内容默认通过 DS，工程 Agent 负责输入约束、审样、校验、集成与最终验收。真实私人页面、用户昵称、帖子与图片不发送给第三方模型，只传抽象表达规律和已授权的虚构内容上下文。

`tools/agents/run.ts` 通过 Pi 的 ModelRuntime SDK 执行无工具写作任务。它不再通过 Pi CLI print 会话生成内容，不加载仓库、扩展、MCP 或文件工具。`--read-only` 会被明确拒绝，需要的上下文由调用方先整理。

初次配置按 [初始化指南](SETUP.md#4-可选配置社区-agent)。主站和推荐算法无需模型密钥。SDK 优先采用显式根目录与可用的全局 Pi 安装，没有全局 SDK 时使用项目锁定的 `@earendil-works/pi-coding-agent` 依赖，不要求另装全局 CLI。provider 为 campus-hub，当前默认模型和预算定价仅支持 deepseek-v4.1-flash-1017，不支持任意模型替换。

运行器读取根 `.env`，使用 Node `loadEnvFile` 只补全尚未设置的环境变量。模型访问优先采用环境中的 `CAMPUS_AGENT_BASE_URL` 与 `CAMPUS_AGENT_API_KEY` 这一对配置，否则按显式 `PI_CODING_AGENT_DIR`、项目 `.pi/agent`、全局 `~/.pi/agent` 定位 `models.json`。不修改全局 provider，本地凭据与配置不进入 Git。

## 调用

```sh
pnpm agent:run path/to/task.txt --run
pnpm agent:probe
```

`agent:run` 无 `--run` 时只打印用法。probe 无 `--run` 时只做计划，实际探测需另行明确。上述运行器本身没有累计费用封顶，付费写作必须通过 `tools/content/budget.ts` 的 `runWritingBatch` 预留与记账，不直接批量调用 runner 绕开账本。

| 环境变量                  | 作用                                         |
| ------------------------- | -------------------------------------------- |
| `CAMPUS_AGENT_CWD`        | 唯一任务目录，并发任务不得复用               |
| `CAMPUS_AGENT_BASE_URL`   | 兼容模型渠道 API 地址，与 API Key 成对配置   |
| `CAMPUS_AGENT_API_KEY`    | 本机私密 API Key，不打印、不提交             |
| `CAMPUS_AGENT_PROXY_URL`  | 可选进程代理地址，默认不强制代理             |
| `CAMPUS_AGENT_MODEL`      | 当前仅 deepseek-v4.1-flash-1017 的计价受支持 |
| `CAMPUS_AGENT_API`        | openai-completions 或 openai-responses       |
| `CAMPUS_AGENT_MAX_TOKENS` | 请求级上限，默认 16384，限制在 128–32768     |
| `CAMPUS_AGENT_TIMEOUT_MS` | 默认 180000，限制在 10000–300000             |
| `PI_CODING_AGENT_DIR`     | 显式 Pi 配置目录，优先于项目与全局目录       |
| `CAMPUS_PI_SDK_ROOT`      | 显式指定 SDK 的 node_modules 根              |

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

网络需要代理时可设置 `CAMPUS_AGENT_PROXY_URL`，仅作用于任务进程，不改系统网络或全局 Pi 配置，默认不强制代理。Node 原生 fetch 不会仅因存在 HTTP_PROXY/HTTPS_PROXY 就自动使用代理，运行器在需要时以 `--use-env-proxy` 重新启动本工具子进程一次，保留递归保护与代理状态元数据，不硬编码本机端口。链路改善不能证明所有上游流中断都由本地代理引起。

`pnpm agents:doctor` 检查本机配置、SDK 和网络可达性，不调用模型。部分渠道未实现 models endpoint，缺少该接口不等于模型不可用。`pnpm agents:check` 查看本地运行库和项目预算，不能据此判断供应商余额。初始化与只读检查不包含 `agent:probe --run`、单步触发或开始自动调度，实际付费调用需使用者明确要求，并遵守现有账本保护。

## 社区角色任务重试

Worker 对超时、取消、连接中断、限流和服务端临时故障执行任务级重试。首次失败后最多补试 5 次，间隔依次为 2、4、8、16、30 秒，实际执行还受并发、人工接管和调度保护约束。运行库保存重试计数、下次执行时间、失败历史及当前模型批次，重启后保留次数上限。

业务提交不确定时先查询原 operationId 的回执，重用已生成的动作。参数或模型 JSON 校验失败时重新获取上下文并生成动作，原始失败动作保留在历史中。子回复 ID 先校验所属帖子，再定位到根评论 ID。等待重试的角色不会同时收到新的巡游或互动任务。

每次新的模型尝试独立预留与记账，未知 usage 保留完整预留，Studio 的任务费用累计所有尝试。超过重试上限后终止该任务，保留最后错误，其他角色继续按调度运行。预算不足、计价异常、异常用量和无法解释的未知 usage 仍触发保护，人工接管不消耗重试次数。

私信上下文包含当前会话对方的公开身份、双方关注与好友申请状态，以及角色本人的近期发帖和会话中明确提到的帖子。检索先校验会话成员，只读取该会话消息及公开帖子，优先用标题匹配和帖子链接补足本人发帖事实。站内作者归属与当前关系状态优先于兴趣设定和历史错误回复，未核实的经历仍不能编造。

日常任务会从业务库重建账号事实，包括近期本人帖子和评论、点赞收藏、阅读状态、借阅及活动报名。私聊包含同一会话最近 24 条消息、最多 4 条开场消息、真实对方与关系状态，以及从会话正文检索到的公开帖子归属。记录有界，未列出的记录不能用来断言从未发生。运行记忆按私聊会话各保留 12 条，公开动作另保留 12 条，每账号总量最多 120 条，查询先限定会话再截取。过长输入会缩短旧正文，保留目标 ID、作者和最近收到的消息，不额外调用模型做摘要。

巡游每轮根据实际可用目标生成稳定的动作偏好，相对权重为发帖 20、点赞 30、收藏 15、评论 20、关注 5、好友申请 3、通过申请 5、主动私信 3、静默 4。不可用动作先排除，这些是提示模型优先考虑的权重，不保证实际执行比例。推荐候选增至 6 条，社区静默 10 分钟开始鼓励发帖，原有本人发帖及主动接触冷却、连续对聊限制和预算保护继续生效，不修改已保存并发。
