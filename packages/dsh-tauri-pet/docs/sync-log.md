# dsh-tauri-pet 上游同步日志

> 用途：追踪 `source/dsh-pet` 与 `source/dsh-dafeiyu` 上游变更的采纳进度，
> 供后续轮次直接续接，避免重复调研。
>
> 约定：完成一次上游同步后，更新「同步记录」一节并刷新「同步基线」版本表；
> 未采纳的上游改动在「审查结论与未采纳项」记录原因，防止重复评估。

## 同步基线（固定版本）

| 上游仓库 | 子模块 HEAD | 版本 | 用途 |
| --- | --- | --- | --- |
| `source/dsh-pet` | `e1ff8c1` | v0.2.6 | 预设资产与工作状态语义来源 |
| `source/dsh-dafeiyu` | `f4f4482` | v0.1.9 | 气泡文案/优先级逻辑参考（不下载资产） |

- 预设下载清单 `src-tauri/resources/preset-pets.json` 的 `ref` 当前为
  `e1ff8c1e4001878cbb80441262d530e16541f138`（须与 dsh-pet 已采纳 HEAD 保持一致，
  新 WebM 资产在 `903dfde` 才入库，低于此的 ref 会下载不到 6 个工作状态动画）。
- 旧研究参考固定 `docs/plugins/expired/pet.todo.md:96` 指向 `899150e`，仅历史参考。

## 同步记录

### 2025 —— PR #414（已合并 main，分支 `dsh/pet-work-status`）

预设 ref 升级 + 工作状态 6 档 + 动画/气泡接线：

- `preset-pets.json`：ref 与 image URL 同步升级 `f0f772e` → `e1ff8c1`。
- host reducer（`packages/dsh-tauri-pet/src/host/reducer.ts`）：
  - 新增 `PetWorkStatus='thinking'|'working'|'result'|'waiting'|'success'|'error'`、
    `PET_WORK_STATUS_INDEX`、`PetToolActivity`、`toolActivityOf(name)`、
    `currentTaskFromTodo(data)`。
  - `reduceSessionEvent` 映射：turn/start→thinking（并清 task 与 lastAgentError）；
    step/start、assistant/chunk(reasoning-delta)、assistant/message→thinking；
    tool/call→working（`ask_user_question` 例外→waiting）；tool/result→
    **不写 lastAgentError**（工具级错误不污染回合级终态），openTools 剩→working、
    无→(waitingKind?waiting:result)；approval/asked→waiting、decided→
    (openTools 剩?working:thinking)；todo/write→task 变化即转发；turn/end：
    blocked→waiting、completed→success、error/max-tokens/timeout→error、
    其余(aborted)→undefined 清回空闲。
- 动画/气泡接线：`src/pet/pet-config.ts` `PRESET_SESSION_ANIMATIONS` 指向 6 个新
  webm 名；新增 `isLoopingAnimation` / `spriteStatusFallback`；
  `src/pet/hooks/bubble-copy.ts` 新增（对齐 dsh-dafeiyu 的 `seedNumber` /
  `statusCopy` / `activityCopy` / `taskCopy` / `toolActivityGroup`，
  `taskCopy` 句式：`正在${value}呢`）；`use-bubble.ts` `STATUS_PRIORITY` 对齐
  dsh-dafeiyu 档位（waiting=60>error=50>failed=45>review=40>working=30>result=25>
  thinking=20>running=12>success=10>idle 族=0），`sessionStatus` 优先 `workStatus`，
  并修复用户 bug：`session.running===true` 时 lastAgentError/粗 error 不判 failed
  （会话还在跑 toast 不能消失）；`app.tsx` loop 判定改 `isLoopingAnimation`。
- 测试：reducer.test.ts 19 条、pet-config.test.ts、bubble-copy.test.ts 新增。

### 2025 —— PR #415（未合并，分支 `dsh/pet-update`，12 files +408/-31）

宠物更新功能（检测到 dsh-pet hash 有更新时，已下载用户在「已选」按钮左侧点
「更新」，走同一下载/解压进度条；点击更新时若宠物正在使用则强制停用，
完成后重新启用）：

- Rust `src-tauri/src/bridge/preset_pet.rs`：
  - 新常量 `PRESET_REF_FILE='.preset-ref'`（安装目录根隐藏文件记录已安装版本）；
    `PresetPetListItem` 增 `update_available: bool`。
  - 新函数 `preset_reference(spec)`（ref 过滤空后 unwrap_or "main"）、
    `read_installed_ref(dir)`（空/空白→None）、`write_installed_ref(dir, reference)`、
    `preset_update_available(installed, catalog_ref, installed_ref)`（未安装→false；
    catalog ref 空→false；installed_ref≠catalog ref→true；老安装无记录→true）。
  - `install_staging(root,id,nonce,staging,target,replace)`：target 不存在→rename；
    存在且 !replace→`PET_PRESET_ALREADY_INSTALLED`；replace→两步 rename
    （target→`root/.preset-backup-{id}-{nonce}`，staging→target），失败回滚。
  - 新 `#[tauri::command] update_preset_pet(app, id)`：校验在 catalog+已安装+非 busy；
    快照 `get_pet_status` 得 `was_enabled`；若在用先 `set_pet_enabled(false)` 强制停用；
    `run_preset_download(replace=true)`；done 后 `reload_pet_window(app)`；
    `was_enabled` 时 `set_pet_enabled(true)` 重新启用。
  - `run_preset_download` 增 `replace: bool`；成功路径写 `.preset-ref`；
    `list_preset_pets` 计算 `update_available`；`download_preset_pet` 传 replace=false。
- Rust 其他：`src-tauri/src/desktop/pet.rs` 新增 `reload_pet_window(app)`
  （窗口存在时 `eval("location.reload()")` 刷新 WebView webm 缓存）；
  `desktop/builder.rs` 注册 `update_preset_pet`。
- 插件前端：`constants/index.ts` 增 `CMD_UPDATE_PRESET_PET='update_preset_pet'`；
  `types/index.ts` `PresetPetItem.update_available?`、`LocaleKey 'update'|'updateFailed'`；
  `service/pet.ts` 增 `updatePresetPet(id)`；`utils/preset-card.ts` 新增
  `resolvePresetCardUpdate(item, progress)`（installed && update_available && 非
  downloading/extracting）；`components/pet-settings.tsx`：`PetCard` 增
  `updateDisabled/updateLabel/onUpdate`，动作区包 `<span class="dshp-pet__card-actions">`
  （更新按钮在主动作左侧 `dshp-pet__card-actionUpdate`），`startUpdate(id)` 走
  `updatePresetPet`→`pollPresetDownload` 同一进度轮询，busy 恢复轮询；
  cssr 增 actions（flex gap 6px）与 actionUpdate（次级色）；locales 增
  `update:'更新'/'Update'`、`updateFailed:'更新预设宠物失败'/'Failed to update preset pet'`。
- 宿主壳：`src/hooks/use-iframe-invoke.ts` `ALLOWED_INVOKE_CMDS` 增
  `'update_preset_pet'`，与 service/pet.ts 一一对应注释仍成立。
- 测试：Rust 4 条（`installed_ref_round_trips_and_handles_missing`、
  `update_available_requires_installed_and_differs_from_catalog_ref`、
  `install_staging_replaces_existing_with_backup_and_rolls_back_on_failure`、
  `install_staging_first_install_and_non_replace_reject`）；`preset-card.test.ts`
  新增 `resolvePresetCardUpdate` 5 用例。
- 验证：cargo check --lib / cargo test --lib 493 passed / pnpm typecheck（含 filter）/
  eslint 零警告 / pnpm test 109 passed / pnpm --filter dsh-tauri-pet build 全过。

## 审查结论与未采纳项（防重复评估）

- dsh-pet 的 `workStatusTick` 1s 轮询 `/dsh-pet-7340/work-status`（`ea0ca7e`）：
  **不需要**——本仓库已有事件驱动 host reducer，避免额外轮询。
- dsh-pet 其余提交（`33ca8f2` renderer 拆分、`12d9f44` 气泡样式、`26d8017` 透明窗黑框、
  `e1ff8c1` maxTokens、`a8c2cd0` reasoning-off）属其 Electron helper 或 host LLM 侧，
  与本仓库无关。
- dsh-dafeiyu：气泡文案/优先级逻辑已采纳（见 PR #414）；其 TASK 消息（todo/write →
  `taskCopy(task)` + 已完成 a/b 步）与 multi-session `#select()` 为多会话渲染方案，
  本仓库会话 Toast 一对一定位，未采纳。

## 后续同步流程

1. 检查上游新提交：
   `git -C source/dsh-pet fetch origin && git -C source/dsh-pet log --oneline e1ff8c1..origin/main`
   （dsh-dafeiyu 同理）。
2. 若 dsh-pet 有新版本：评估影响面（shared/work-status、host 事件映射、client 轮询、
   资产入库 commit），确认新 WebM/config 字段后把 `preset-pets.json` ref 升到新 HEAD。
3. 若预设 ref 升级：Rust `validate_preset_pet_config` 对未知字段自动放行，一般无需改
   Rust；按需补动画/气泡映射与测试。
4. 验证四件套：
   `pnpm --filter dsh-tauri-pet typecheck`、`pnpm typecheck`、
   `pnpm exec eslint src/pet packages/dsh-tauri-pet/src/client packages/dsh-tauri-pet/src/host --max-warnings=0`、
   `pnpm test -- --run`、`pnpm --filter dsh-tauri-pet build`、
   `cargo check --manifest-path src-tauri/Cargo.toml --lib`、
   `cargo test --manifest-path src-tauri/Cargo.toml --lib`、`git diff --check`。
5. 完成后续回填本日志「同步记录」，并刷新「同步基线」。