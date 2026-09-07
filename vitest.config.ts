import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

/**
 * 根测试配置：只跑内置插件（packages/**）的测试，限制并发 worker 数与放宽超时。
 *
 * 仓库根还 vendored 了 dsh 核心源码（src/、source/、test/），其测试依赖 dsh 核心
 * 的 `@/` paths 解析（在插件 workspace 的 vitest 下不可用），故 exclude 出本范围。
 *
 * dsh-tauri-worktree 的 operation.test 会创建真实 git 仓库（clone/checkout/
 * discard），全量并行（默认 cpu-1 个 worker）时与其他文件的 git 操作竞争系统
 * 资源，偶发 5s 超时 flake；限制 maxWorkers 后单独复跑稳定通过。
 *
 * `dsh-tauri/client` 必须 alias 到其 TS 源码（与 dsh-tauri-turnrewind-ts 的
 * vitest.config.ts 同一口径）：构建产物 dist/client.cjs 首行就是
 * `window.__ModuleLoader__.load(...)`——浏览器专用 classic script，在 vitest
 * 默认的 node 环境下 import 会先抛 `window is not defined`。turnrewind 的
 * client-view/styles 测试（及其 src/client 导入链）都走这个 specifier。
 */
export default defineConfig({
  resolve: {
    alias: {
      'dsh-tauri/client': resolve(import.meta.dirname, 'packages/dsh-tauri/src/client/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.{test,spec}.{ts,tsx,js,mjs,cjs}'],
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
