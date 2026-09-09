# 项目进展与交接备忘

> 更新于 2026-09-09。用途：换设备/换会话时快速接续 turn-rewind 插件开发。
> 详细设计见 `docs/TURN_REWIND.md`，用户文档见 `packages/dsh-tauri-turnrewind-ts/README.md`。
> 审查与待办的唯一真相源：`docs/TURN_REWIND_REVIEW_2026-09-03.md`（§1.1/§1.2）+ `docs/TURN_REWIND_OPTIMIZATION_SECURITY_AUDIT.md`（§7 统一待办）+ 本文「下一步待办」。

## 一句话状态

turn-rewind TS 重写（`packages/dsh-tauri-turnrewind-ts`，Git 目录模式）已闭环 **09-03 审查全部 P0/P1/P2**、**09-05 安全审计高/中优先级**、**09-06 生产化加固批次**，以及 **09-08/09 的发布化批次**（CodeRabbit 12 项审查修复、路径身份 `realpathSync.native`、三平台 CI 修复、独立仓库 + npm `0.3.1` + 市场收录 PR）。当前 **26 个测试文件 / 134 个测试全绿**；typecheck / eslint（0 problems）/ build 全绿。回溯锚点：tag `turnrewind-pre-production-hardening`（加固批次前）。

## 仓库拓扑

| 仓库 | 位置/远程 | 用途 | 当前位置 |
| --- | --- | --- | --- |
| 桌面开发仓库（TS 分支） | 本机 `Desktop/dsh-git-rewind-ts` ↔ `origin`（我的 fork） | 插件开发 + 真机验证 | `dsh/turnrewind-ts` @ `828a6e2` |
| 桌面仓库 fork | github.com/yingtianlan/deepseek-harness-desktop-undo | 备份/PR | `main` @ `53f2adb`（已追平 upstream v0.11.0）；PR 分支即上表 |
| **独立插件仓库** | github.com/yingtianlan/dsh-tauri-turnrewind | 对外发布（npm 包 + Release 页） | `main` @ `759ef2c`，tag `v0.3.1`，npm `0.3.1` |
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

1. **版本 + 文档收口**：monorepo 包版本（现 `0.2.0-beta.1`）与已发布线（`0.3.1`）对齐，补 changelog；
2. **消息旁 Undo 按钮**：官方槽位已确认可用——`conversation.chat.turnTail`（每 turn 末尾）/ `conversation.chat.node`（每条消息）；复用现有 command-view 的 `/undo` 提交通道；
3. **设置面**：retention / TTL / 逐 workspace 开关；槽位 `settings.section` + `settings.trigger` 已确认，需先调研宿主 settings API 形态；
4. **子树 undo**：`parent_turn_id` 列与 planner 聚合已就位，**差 turn tree 契约调研**（先读核心 turn/session 数据结构，产出设计再实现）；
5. **redo 重开**：一行闸门，需产品拍板（是否恢复、恢复后语义）。

平台级（依赖桌面壳，插件侧无法独立完成）：受控 sandbox/Tauri bridge（审计 P0-1）、真实 DSH lifecycle 集成测试。CI 已具备三平台矩阵 job。

## 踩坑备忘（血泪浓缩）

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
