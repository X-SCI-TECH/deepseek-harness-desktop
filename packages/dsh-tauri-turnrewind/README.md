# dsh-tauri-turnrewind

DSH 桌面端的 **turn 级工作区撤销**：每一轮对话结束时，在对话尾部显示一张变更卡片
（「已编辑 N 个文件 / +N -M / 文件清单」），点「撤销」把这一轮对工作区做的文件改动
整体回退。

- **宿主半区**：每个 Agent turn 在**私有 Git 快照仓**里记录 before / after 两个快照，
  算出逐文件 `+N -M`，写进每会话 JSON 账本；
- **客户端半区**：接管会话视图的 `conversation.chat.turnTail` 槽位（chain，`priority: -1`），
  渲染变更卡片；
- 对用户仓库**全程只读**：不碰 HEAD / 分支 / index / stash / 提交历史。

设计与决策记录：[`docs/plugins/11.优化计划.turnrewind实现.md`](../../docs/plugins/11.优化计划.turnrewind实现.md)
（含调研结论、与归档 demo 的差异、双内核适配矩阵）。

## 交互

```text
单文件                                    多文件
┌───────────────────────────────────┐    ┌───────────────────────────────────┐
│ [＋]  已编辑 test-note.md          │    │ [＋]  已编辑 5 个文件             │
│      +6 -0          撤销 ↶  审核  │    │      +26 -0        撤销 ↶  审核  │
└───────────────────────────────────┘    ├───────────────────────────────────┤
  hover ↓（副行换成「查看更改」）           │ README.md                 +11 -0  │
┌───────────────────────────────────┐    │ config.json                +6 -0  │
│ [＋]  已编辑 test-note.md          │    │ data/sample.txt            +3 -0  │
│      查看更改 ↗     撤销 ↶  审核  │    ├───────────────────────────────────┤
└───────────────────────────────────┘    │ 再显示 2 个文件 ⌄                 │
                                         └───────────────────────────────────┘
```

**运行中**（`conversation.input.dock`，输入框上方居中的胶囊；turn 结束后消失）：

```text
              1 个文件已更改 +1 -0
┌────────────────────────────────────────────────────────────────────┐
│ [会话输入框]                                                        │
└────────────────────────────────────────────────────────────────────┘
```

| 元素 | 行为 |
|---|---|
| `撤销 ↶` | **真功能**：撤销该轮的文件改动；**撤销成功后按钮消失**，只留「已撤销」徽标 |
| 「再显示 N 个文件 ⌄」/「收起文件 ⌃」 | 真功能：展开 / 收起（清单默认 3 行，展开后底部仍有「收起文件」可回到 3 行） |
| `＋` 图标块（文件） | **占位**（无点击处理，`data-placeholder` 标注） |
| 单文件 / 多文件标题 hover 的「查看更改 ↗」 | **暂时整体停用**（源码 `TODO(view-changes-hover)` 保留实现；恢复时单文件与多文件的 `__head` 都要生效） |
| 单文件标题 / 清单行点击打开文件 | **暂时停用**（源码 `TODO(open-file)` 保留实现；当前卡片只显示 `+xx -x`） |
| `审核` | **暂时整体隐藏**（源码 `TODO(review-action)` 保留按钮实现） |

- 单文件：标题即文件名、不渲染清单；多文件：标题是文件数、副行是总计（绿 `+N` / 红 `-M`）。
- 文件清单最多三行，其余折叠；行 hover 高亮；本轮删除（D）的文件整行弱化。
- **已撤销的 turn**：只剩「已撤销」徽标与文件名/清单行，不再有撤销按钮与审核。
- 该轮没有任何文件变化 → 不出现卡片。
- 撤销成功后同一 turn 不能重复撤销。
- 撤销前若发现文件在 turn 结束后又被改动过 → **拒绝执行并列出冲突文件**，不覆盖任何文件。
- 工作区不是 Git 仓库 → 点「撤销」弹出说明弹窗：

```text
撤销需要使用 Git 代码仓库
此操作仅在 Git 代码仓库中运行时有效。
[ 关闭 ]
```

## 快照与撤销语义

```text
$DSH_HOME/dsh-tauri-turnrewind/
├─ workspaces/<sha256(worktree 根)[0:24]>.git/   # 每个 worktree 一个私有快照仓（bare + core.worktree）
│     └─ refs/turnrewind/<sessionId>/<turn>/<before|after>
└─ sessions/<sessionId>.json                     # 每会话账本（原子写）
```

- **快照域 = Git worktree 根**：会话 cwd 是子目录时归并到根，同一仓库共享一个快照域。
- **捕获**：`git add --all` → `write-tree` → `commit-tree` → `update-ref`（全部落在私有仓）。
  before 在 `agent/pre-step`（step 1）的 **await 屏障**里完成，必然早于任何文件改动；
  after 在 `turn/end` 之后**后台结算**（`agent/status → idle` 兜底中断的 turn）。
- **差异**：`git diff --numstat` 取行数，两侧路径集合推导新增（A）/修改（M）/删除（D）。
- **撤销**：M/D 由 `git checkout <before> -- <path>` 还原，A 删除文件并清理变空的父目录。
- **冲突预检**：`git diff <afterCommit> -- <paths>`（与快照写入共用同一套换行/属性归一化，
  CRLF 工作区不会被误判）+ 删除态的存在性检查（用户重建的同名文件 git diff 看不见）。
- **忽略规则**：完全委托源仓库（`.gitignore` / global excludes），并镜像源仓库的
  `core.autocrlf` / `core.eol` / `core.symlinks` 与 `.git/info/exclude`，
  保证「比较」与「恢复」跟用户仓库语义一致。

## 边界与已知限制

- **Git 是硬前置**：非 Git 目录不建快照，只提供说明弹窗；家目录、家目录祖先、
  盘根、UNC 共享根一律拒绝（`TURNREWIND_UNSAFE_WORKSPACE`）。
- 上限：单文件 64 MB、单 turn 5000 文件、单快照 512 MB；超限该 turn 记 `unavailable`
  （卡片显示原因、撤销禁用），**不阻断** Agent turn。
- 账本保留每会话最近 200 条 turn 记录，超出丢弃最早记录。
- 私有仓自包含（不用 alternates 借源仓库对象）：首轮会把工作区内容复制进私有仓，
  受源仓库 ignore 规则约束（`node_modules/` 等天然排除）。
- **接管 `turnTail` 槽的后果**：官方 `ui-deliverables` 的 “Files changed” 行不再渲染，
  其「点文件名在右侧栏预览」的行为随之消失（需求已确认接受）。若之后要保留点击，
  把文件行接到 `TurnTailOwnerProps.openFile` 即可（一行）。
- 未做：redo、父对话递归撤销、保留策略设置面、恢复围栏、撤销后给模型的一次性提示注入。
- **运行中提示条的取数成本**：宿主在 turn 进行期间每 1.5s 跑一次 `git add --all` +
  `git diff`（`add` 借用私有 index 的 stat 缓存，通常是增量），turn 一结束立即停表；
  开销随仓库规模增长，大仓库上首轮较慢。

## 协议

```text
GET  /api/turnrewind/summary?sessionId=<id>
  → 200 { sessionId, isGit, workspaceRoot, unavailableReason,
          turns: [{ turn, fileCount, insertions, deletions, undoneAt, unavailable,
                    truncated, files: [{ path, status, insertions, deletions, binary }] }] }

GET  /api/turnrewind/live?sessionId=<id>
  → 200 { active, turn, fileCount, insertions, deletions }   # 宿主内存读数，不跑 git

POST /api/turnrewind/undo   { sessionId, turn }
  → 200 { ok: true, restored: [...], removed: [...], failed: [...] }
  → 409 { error: "TURNREWIND_CONFLICT", conflicts: [{ path, reason }] }
  → 403 / 404 / 400
```

变更路由仅接受回环调用；连接信任边界经可选的 `connection` 服务校验（缺席时降级为回环校验）。

## 内核适配（0.1.5-rc.1 / 0.1.2-rc.1）

两个内核都提供了本插件依赖的全部契约（`agent/pre-step`、`agent/turn-stopping`、
`agent/status`、`ctx.sessions` + `session.header.cwd`、`session/event` 的 `turn/end`、
`webServer.register({ kind: 'exact' })`、`conversation.chat.turnTail` chain 槽、
`conversation.input.dock` list 槽、locale 的两种 `register` 重载）。

硬约束：**client 侧不静态引用任何 `@deepseek-ai/*` 包**。client bundle 在 dsh Web
ModuleLoader 的 factory 里运行，模块表只认识当前内核实际装载的模块；引用了另一个内核代
里不存在的 specifier 会让 loader 整棵树失败（界面白屏）。宿主侧 `inject` 也只声明两个
内核都存在的 `webServer` / `sessions` / `agents`。

运行中提示条不依赖 `InputZone.session` 的字段形状：**「是否在跑」由宿主 live 路由回答**，
owner 份额里读到 `running: false` 时既提前停轮询、也立刻整条隐藏（字段缺失按「可能在跑」处理），
因此内核调整会话快照字段也不会让提示条失效。会话结束后只剩 turn 尾部的变更卡片。

## 开发

```powershell
pnpm --filter dsh-tauri-turnrewind typecheck
pnpm --filter dsh-tauri-turnrewind build
pnpm vitest run packages/dsh-tauri-turnrewind
pnpm build            # 根构建：prebuild 部署插件到 src-tauri/resources/node_modules
```

测试覆盖：工作区资格与路径守卫、快照增删改与二进制、**用户仓库零污染**、
CRLF/属性往返对称（恢复后与 before 快照树逐字节等价）、冲突预检（含「用户重建已删除文件」）、
撤销全路径、运行中实时读数（含本轮新建文件，且与最终 after 差异文件数一致）、
账本原子写与淘汰与并发串行、卡片状态机与计数/文件名纯函数、
卡片与提示条的 css-render 形态（hover 换行、配色、几何）。
