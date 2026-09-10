# 项目进展与交接备忘

> 更新于 2026-09-10。用途：换设备/换会话时快速接续 turn-rewind 插件开发。
> 详细设计见 `docs/TURN_REWIND.md`，用户文档见 `packages/dsh-tauri-turnrewind-ts/README.md`。
> 审查与待办的唯一真相源：`docs/TURN_REWIND_REVIEW_2026-09-03.md`（§1.1/§1.2）+ `docs/TURN_REWIND_OPTIMIZATION_SECURITY_AUDIT.md`（§7 统一待办）+ 本文「下一步待办」。

## 一句话状态

turn-rewind TS 重写（`packages/dsh-tauri-turnrewind-ts`，Git 目录模式）已闭环 **09-03 审查全部 P0/P1/P2**、**09-05 安全审计高/中优先级**、**09-06 生产化加固批次**、**09-08/09 的发布化批次**（CodeRabbit 12 项审查修复、路径身份 `realpathSync.native`、三平台 CI 修复、独立仓库 + npm `0.3.1` + 市场收录 PR），以及 **09-10 的消息旁 Undo 按钮**（真机验证：每个完成的 turn 都在动作条里出按钮，点击走 `/undo <sessionId>:<turn>` 预览卡链路）。当前 **27 个测试文件 / 144 个测试全绿**；typecheck / eslint（0 problems）/ build 全绿。回溯锚点：tag `turnrewind-pre-production-hardening`（加固批次前）。

## 仓库拓扑

| 仓库 | 位置/远程 | 用途 | 当前位置 |
| --- | --- | --- | --- |
| 桌面开发仓库（TS 分支） | 本机 `Desktop/dsh-git-rewind-ts` ↔ `origin`（我的 fork） | 插件开发 + 真机验证 | `dsh/turnrewind-ts` @ `25b444a`（按钮改动） |
| 桌面仓库 fork | github.com/yingtianlan/deepseek-harness-desktop-undo | 备份/PR | `main` @ `53f2adb`（已追平 upstream v0.11.0）；PR 分支即上表 |
| **独立插件仓库** | github.com/yingtianlan/dsh-tauri-turnrewind | 对外发布（npm 包 + Release 页） | `main` @ `759ef2c`，tag `v0.3.1`，npm `0.3.1`（**待同步 09-10 按钮改动**） |
| 干净验证副本（dev 实例） | 本机 `Desktop/dsh-git-rewind-ts-fresh` | dev 桌面端真机验证（`~/.dsh.dev`，端口 3081） | 与开发仓库同源，仅本地调试改动 |
| 上游 PR | dsh-tauri-desk/deepseek-harness-desktop#431 | 合并进桌面内置插件 | 8 项检查全绿，等评审 |
| 市场收录 PR | awesome-dsh-plugin/awesome-dsh-plugin#4673 | dshmarket 收录 | `Submission gate` 绿；`PR check` 受上游 `#2662` 全仓故障影响 |
| 官方插件参考源码 | 本机 `Desktop/dsh/source/dsh-tauri-plugins` | 只读参考（packages 插件规范） | 本地 clone |
| 旧 JS 实验分支 | 同 fork `dsh/turnrewind-git-dir-undo` | 历史存档（JS 版 Git 模式原型） | 不再演进 |

## 当前形态（Git 目录模式 + TS）

- **TS 重写**：包位于 `packages/dsh-tauri-turnrewind-ts`，遵循 `packages/*` 插件规范（tsdown 构建、exports 指向 `dist/`、workspace catalog 依赖）；host half（`src/host/`）/ client half（`src/client/`）/ shared 常量三层目录。
- **Git-only**：会话 cwd 必须位于 Git worktree（子目录归并到根）；非 Git 目录 turn 记 `skipped`（`TURNREWIND_GIT_REQUIRED`），`/undo` 明确提示。系统目录（家目录/祖先/盘根）硬拒。
- **快照模型（OpenCode 式）**：每个 worktree 一个私有 snapshot repo（`$DSH_HOME/snapshots/<hash>.git`），经 alternates 借用源对象（gc/prune 自愈）；ignore 语义委托源仓库；自定义敏感文件名单已全部移除。
- **原子恢复**：bak-swap（target→bak→temp→target→删 bak），崩溃窗口由启动清扫复活；绝不触碰用户 HEAD/branch/index/stash（git-state.test 钉死）。
- **安全加固**：workspace 跨进程锁、plan 预览绑定漂移校验、symlink/junction 拒绝、mode/可执行位恢复、写点全链重验（TOCTOU 缓解）、needs-recovery 实时围栏、SQLite busy_timeout/BEGIN IMMEDIATE、计划构建有界并发、HTTP 路由一次性响应/超时/nosniff/格式校验。
- **容量治理（P2-4）**：`TURNREWIND_RETAIN_TURNS`（默认 50，超出标记过期）+ `TURNREWIND_MAX_SNAPSHOT_MB`（默认 1024，超限整仓重建自愈基线）。
- **留档可查**：过期/取消/被替换的 plan 转 `expired` 永久保留；unsupported 提示**单会话只报一次**。
- **redo 已冻结**：入口拒绝，底层加固保留（一行重开）。
- **消息旁 Undo 按钮（09-10）**：每个**完成的 turn** 在其动作条（`conversation.chat.assistant-actions`）里出现「撤销本轮」；点击经 `remote.commands.execute` 提 `/undo <sessionId>:<turn>`，完全复用命令链路（预览卡 → ✓执行/✕取消）。槽位 owner 只给 `messageId`，turn 号由组件用标准 kit 的 `useSession` 从会话快照反查（`chat.order` + keyed reader，`chat.legacy.nodes` 兜底）。
- **恢复面板**：needs-recovery 围栏可在 UI 内闭环（acknowledge / purge），路由 `/api/turnrewind/recovery[/resolve]`。
- **账本保险**：`PRAGMA quick_check`（损坏拒载）+ 每日 `VACUUM INTO` 滚动备份。
- **`/undo --doctor`**：只读诊断（git/工作区/账本/围栏/快照仓库/备份新旧）。
- **隐私提醒**：会话首触工作区时扫描未 ignore 的疑似秘密文件，一次性提示（`git check-ignore` 过滤）。

## 发布形态（09-08 起）

- **单一真相源 = monorepo 的 `packages/dsh-tauri-turnrewind-ts`**；独立仓库 = 只读镜像 + 脚手架覆盖层。
  - 同步区：`src/` `test/` `README.md` `purge-workspace.mjs` `cordis.patch.yml`（脚本复制）
  - 覆盖层：`package.json` `tsconfig.json` `tsdown.config.ts` `vitest.config.ts` `eslint.config.mjs` `pnpm-workspace.yaml` `compat/` `.github/` `LICENSE` `.gitattributes` `dist/`（脚本永不覆盖）
- **工具**：`scripts/standalone-plugin.mjs`（`verify` / `sync` / `release` / `market`），配套 skill `~/.dsh/skills/standalone-plugin-release/SKILL.md`（注意：skill 必须有 YAML frontmatter 的 `name`+`description`，否则被加载器忽略）。
- **发布流程**：`sync` → `verify` → 独立仓库提交推送 → 等 CI（含 `git diff --exit-code -- dist`）→ `release --version x.y.z --yes` → npm 发布（要 OTP）→ 市场条目 YAML 提 PR。

## 本轮已完成（09-10）

- **消息旁 Undo 按钮落地并真机验证**（见上「当前形态」）：真机点 turn 3 的按钮 → 生成 `Undo preflight: turn <session>:3; 4 file(s)…` 预览卡，✕取消闭环；turn 1（被中断、无 closing 助手消息）按设计不出按钮。
- **槽位选型纠错（重要）**：首版注册在 `conversation.chat.turnTail`，但那是 **chain（选择器路由）槽位——框架每处只渲染第一个 select 命中的注册**，而核心 `ui-deliverables` 已占用且「该 turn 产出过文件」就命中，导致按钮只在没产出文件的 turn 上出现（最需要撤销的场景反而没有）。改用 list 槽位 `conversation.chat.assistant-actions` 才是有追加语义的正规座位。
- **inject 补齐**：`remote` 之外还必须列 `remote.commands`（只 inject `remote` 而读 `ctx.remote.commands` 同样抛），漏声明会让按钮整块静默降级；另把「当前会话 id 还是 undefined」的加载时序做兜底，槽位注册失败降级为「没有按钮」而不是让 apply 抛。
- 回归护栏：测试钉死槽位名/注册形态（含「不得出现 chain 的 `select` 字段」）、messageId→turn 反查的四种载荷与形状不符的 null 路径。

## 本轮已完成（09-08 → 09-09）

- CodeRabbit 12 条审查意见全部修复（账本 ROLLBACK 保护、Buffer 请求体、retention 回滚、锁 token 归属、ENOENT 不缓存、焦点恢复、CLI 参数校验、HTTP 失败计数、恢复面板重试、APFS 大小写探测）；
- 补一个真实缺陷：目标选择抛错会永久卡住 `runtime.undoing`（后续 /undo 全拒 + 新 turn 静默跳过快照），已加 try/catch 释放 + 回归测试；
- **路径身份统一**：`realpathSync.native` 展开 Windows 8.3 短名（CI 的 `RUNNER~1`）与 macOS `/var → /private/var`，修掉跨平台 gitDir/账本键/快照 hash 分裂；
- 三平台 CI 修复：client CJS 在 CI 下被 tsdown 升级为错误（钉 `client.target`）、根 vitest 缺 `dsh-tauri/client` alias（`window is not defined`）、dist sourcemap 的 CRLF 污染（`.gitattributes` 钉 LF）；
- 发布化：独立仓库 `v0.3.1` + npm 发布 + Release 页 + 市场 PR；新增 `standalone-plugin.mjs` 与 skill。

## 换设备环境搭建

1. clone fork + 检出 `dsh/turnrewind-ts`；
2. `pnpm install`；
3. `pnpm --filter dsh-tauri-turnrewind build`（产出 `dist/`，Host 导入必需）；
4. 测试：`pnpm --filter dsh-tauri-turnrewind test`；
5. debug 桌面端启动时自动以 `link:` 安装全部内部插件（含本插件）；dev 数据目录 `~/.dsh.dev`，日志在 `%APPDATA%\io.github.hairyf.deepseek-harness-desktop\logs\dsh-web.dev.log`；
6. 独立仓库操作：clone `yingtianlan/dsh-tauri-turnrewind`，然后 `node scripts/standalone-plugin.mjs verify --pkg packages/dsh-tauri-turnrewind-ts --dir <clone>`。

## 下一步待办（优先级序）

插件侧：

1. **版本 + 文档收口**：monorepo 包版本已对齐 `0.3.1`（`d2cc74a`）；把 09-10 的按钮改动下发布线（独立仓库 sync → `0.3.2` + npm + Release）；
2. **设置面**：retention / TTL / 逐 workspace 开关；槽位 `settings.section` + `settings.trigger` 已确认，需先调研宿主 settings API 形态；
3. **子树 undo**：`parent_turn_id` 列与 planner 聚合已就位，**差 turn tree 契约调研**（先读核心 turn/session 数据结构，产出设计再实现）；
4. **redo 重开**：一行闸门，需产品拍板（是否恢复、恢复后语义）。

平台级（依赖桌面壳，插件侧无法独立完成）：受控 sandbox/Tauri bridge（审计 P0-1）、真实 DSH lifecycle 集成测试。CI 已具备三平台矩阵 job。

## 踩坑备忘（血泪浓缩）

- **release 与 dev 桌面端不能同时跑**：两者共用同一 app identifier / `%APPDATA%` 配置目录（release = 打包 exe + `~/.dsh` + 端口 3080；dev = `target/debug/*.exe` + `~/.dsh.dev` + 端口 3081），同时运行会互相抢 harness 并把它打崩（`Owned Harness process exited with code 3221225477`）。要真机验证 dev 侧就先关掉 release 端。
- **client 插件的 dist 会实时重载**：`pnpm --filter dsh-tauri-turnrewind dev`（tsdown --watch）重建 `dist/client.cjs` 后，宿主按 `?rev=<hash>` 提供新 bundle —— 在 web 端硬刷新页面即可看到新代码，不需要重启 harness（但改了 `inject` 这类装配期声明，最好整页刷新而不要指望 HMR）。
- **chain 槽位是「单选」的**：`kind: 'chain'`（如 `conversation.chat.turnTail`、`conversation.composer`）由框架按 `select` **选一个**渲染（`ui-renderer` 命中即 `break`），不是「都渲染」。往 chain 里塞第二个命中项＝自己的 UI 被永久挤掉；要「追加」必须找 `kind: 'list'` 的座位（消息旁动作条 `conversation.chat.assistant-actions`）。
- **消息动作条只给 `messageId`**：`conversation.chat.assistant-actions` 的 owner 是 `{ messageId }`，turn 号得自己从会话快照反查（`useSession(s => …)` 读 `chat.order` + `chat.nodes.get(key)`，turn-tail 节点用 `data.closing.finalNode.messageId` + `data.turn`，`chat.legacy.nodes` 里的扁平节点用顶层 `messageId`/`turn` 兜底）。
- **`useSession` 必须无条件调用**：它来自框架标准 kit，宿主老版本可能是 undefined；用「缺失时替换为恒返回 null 的占位函数」而不是条件调用（否则 HMR/时序变化会打乱 Hook 顺序，eslint 也会报 rules-of-hooks）。
- **inject 要列到服务子键**：`ctx.remote.commands` 需要 inject 同时声明 `'remote'` 和 `'remote.commands'`；只声明 `'remote'` 时读子键照样抛（表现为按钮静默消失、甚至 `Failed to load plugins`）。
- **client 模块 id 必须归一化为包名**：模块系统剥 `/client` 后缀；启动清单只 import 包名。
- **keyed slot 必须带 `key`**：`conversation.chat.commandview` 注册时漏 `key` 会直接 fail apply（报 `requires options.key`）。
- **`dsh.client.inject` 必须列出 `dsh-tauri`**：client bundle 里 `require('dsh-tauri/client')` 依赖 ModuleLoader 注入该模块，漏了报 `missed the module table`；同时 `dsh.client.external` 也要声明 `dsh-tauri/client`。
- **client bundle 是浏览器脚本**：`dist/client.cjs` 第一行就引用 `window`；Node 单测要通过 vitest alias 指到 TS 源码（见 `vitest.config.ts`）；根仓库 `vitest.config.ts` 也要加同样的 alias。
- **包名 ≠ 目录名**：包名 `dsh-tauri-turnrewind`，目录 `packages/dsh-tauri-turnrewind-ts`；`pnpm --filter` 按包名。
- **Host 导入零容忍**：改导出/接口后必跑 `node --input-type=module -e "await import('.../dist/index.js')"` 冒烟；改后必 `pnpm --filter dsh-tauri-turnrewind build`。
- **pnpm store 版本冲突**：debug profile 的 `node_modules` 若由不同大版本 pnpm 安装，重装会报 `ERR_PNPM_UNEXPECTED_STORE`——删 profile 的 `node_modules` 重来即可。
- **`git rev-parse --verify <裸sha>` 不检查对象存在性**：快照链校验必须用 ref 名比较。
- **dsh Host 对插件 import 失败零容忍**：整个进程退出。
- **push 网络抽风**：`git -c http.proxy= -c https.proxy= push ...` 直连重试；本机 github.com 的 git 走本地代理 7890，代理没开时 push/fetch 失败但 `api.github.com` 仍可用（可临时走 Contents API）。
- **独立仓库 dist 是提交进仓库的**：改 `src/` 必须一起提交重建后的 `dist/`，CI 会 `git diff --exit-code -- dist`；Windows CRLF 工作区会把 `\r\n` 写进 sourcemap 的 `sourcesContent` 造成假失败（`.gitattributes` 已钉 `eol=lf`）。
- **skill 必须有 frontmatter**：`$DSH_HOME/skills/<name>/SKILL.md` 缺 `name`/`description` 会被加载器静默忽略（日志 `ignored: missing YAML frontmatter`）。
