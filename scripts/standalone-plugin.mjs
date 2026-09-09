#!/usr/bin/env node
/**
 * standalone-plugin.mjs — 把一个内置插件包从桌面 monorepo 抠成独立仓库。
 *
 * 单一真相源 = `packages/<pkg>`。独立仓库 = 只读镜像 + 脚手架覆盖层：
 *
 *   同步区（脚本复制，随 monorepo 走）：src/ test/ README.md
 *                                      purge-workspace.mjs cordis.patch.yml
 *   覆盖层（脚本永不覆盖，独立仓库自己维护）：package.json tsconfig.json
 *     tsdown.config.ts vitest.config.ts eslint.config.mjs pnpm-workspace.yaml
 *     compat/ .github/ LICENSE .gitignore .gitattributes dist/（构建产物）
 *
 * 为什么不能整目录复制：独立仓库没有 workspace 里的 `dsh-tauri` 与
 * `dsh-tauri-tsdown`，靠 `compat/dsh-tauri-client.ts` 垫片和自带 tsdown
 * 配置替代；覆盖层被复制会直接打断它的构建与 CI。
 *
 * 命令：
 *   verify  --pkg <dir> --dir <clone>                 只读体检（LF/末尾换行/compat 覆盖/dist 新鲜度）
 *   sync    --pkg <dir> --dir <clone> [--build] [--check]   同步代码（--check 只报告漂移，CI 用）
 *   release --dir <clone> --version <x.y.z> [--notes <file>] [--npm --otp <code>] [--yes]
 *   market  --repo <owner/name> --category <cat> [--out <file>] [--name <owner/repo#sub>]
 *
 * 退出码：0 通过；1 失败（可被 CI 直接使用）。
 */

import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

/** 随 monorepo 走的路径（目录递归同步，文件直接覆盖）。 */
const SYNCED = ['src', 'test', 'README.md', 'purge-workspace.mjs', 'cordis.patch.yml']

/** 独立仓库自己维护的路径；缺失即报错，存在则绝不改动。 */
const OVERLAY = [
  'package.json',
  'tsconfig.json',
  'tsdown.config.ts',
  'vitest.config.ts',
  'eslint.config.mjs',
  'pnpm-workspace.yaml',
  'compat',
  '.github',
  'LICENSE',
]

/** 复制时跳过的目录名（构建产物与依赖不属于同步区）。 */
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.turbo', '.cache', 'coverage'])

const errors = []
const warnings = []
let step = ''

function log(message) {
  process.stdout.write(`${message}\n`)
}

function fail(message) {
  errors.push({ step, message })
  process.stderr.write(`  ✖ ${message}\n`)
}

function warn(message) {
  warnings.push(message)
  process.stdout.write(`  ! ${message}\n`)
}

function ok(message) {
  process.stdout.write(`  ✓ ${message}\n`)
}

function heading(title) {
  step = title
  process.stdout.write(`\n[${title}]\n`)
}

/**
 * Windows 上 pnpm/npm 是 .cmd，Node 不允许无 shell 直接执行（EINVAL/ENOENT），
 * 所以统一经 ComSpec 走一遍；参数按 cmd 规则加引号，避免路径含空格时被拆开。
 */
function quoteWindows(arg) {
  const text = String(arg)
  if (text === '')
    return '""'
  if (!/[\s"&|<>^%]/u.test(text))
    return text
  return `"${text.replaceAll('"', '""')}"`
}

function run(command, args, cwd) {
  const windows = process.platform === 'win32'
  const file = windows ? (process.env.ComSpec ?? 'cmd.exe') : command
  const argv = windows
    ? ['/d', '/s', '/c', `${command} ${args.map(quoteWindows).join(' ')}`]
    : args
  const result = spawnSync(file, argv, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.error)
    return { ok: false, code: -1, stdout: '', stderr: String(result.error.message ?? result.error) }
  return { ok: result.status === 0, code: result.status ?? -1, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? '') }
}

function parseArgs(argv) {
  const args = { _: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) {
      args._.push(token)
      continue
    }
    const key = token.slice(2)
    const next = argv[index + 1]
    if (next === undefined || next.startsWith('--')) {
      args[key] = true
      continue
    }
    args[key] = next
    index += 1
  }
  return args
}

/** 递归列出目录下的文件（相对路径，正斜杠），跳过 SKIP_DIRS。 */
function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name))
          continue
        walk(join(dir, entry.name))
        continue
      }
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
    }
  }
  if (existsSync(root))
    walk(root)
  return out.sort()
}

function isTextFile(path) {
  return /\.(?:ts|tsx|js|mjs|cjs|json|yml|yaml|md|txt)$/u.test(path)
}

/** 覆盖层体检：独立仓库必须有这些文件，否则它的构建/CI 不成立。 */
function checkOverlay(standaloneDir) {
  heading('overlay')
  for (const entry of OVERLAY) {
    if (!existsSync(join(standaloneDir, entry)))
      fail(`独立仓库缺少覆盖层文件：${entry}（不应被同步覆盖，但必须存在）`)
  }
  if (errors.length === 0)
    ok(`覆盖层齐全（${OVERLAY.length} 项）`)
}

/**
 * LF 体检：工作区源码若为 CRLF，tsdown 会把 \r\n 写进 sourcemap 的
 * sourcesContent，于是本地构建出的 dist 与 CI（LF 检出）不一致，
 * `git diff --exit-code -- dist` 会假失败。
 */
function checkLineEndings(dir) {
  heading('line endings')
  let crlf = 0
  let noFinalNewline = 0
  for (const file of listFiles(dir)) {
    if (file.startsWith('dist/') || !isTextFile(file))
      continue
    const text = readFileSync(join(dir, file), 'utf8')
    if (text.includes('\r\n')) {
      crlf += 1
      fail(`${file} 含 CRLF（sourcemap 会污染 sourcesContent）`)
    }
    if (text.length > 0 && !text.endsWith('\n')) {
      noFinalNewline += 1
      fail(`${file} 缺少文件末尾换行（eslint style/eol-last）`)
    }
  }
  if (crlf === 0 && noFinalNewline === 0)
    ok('全部文本文件为 LF 且以换行结尾')
  if (crlf > 0)
    log('    修复：git -C <clone> config core.autocrlf false && git -C <clone> checkout --force -- .')
}

/** 解析 `import ... from 'dsh-tauri/client'` 里用到的名字。 */
function importedClientNames(source) {
  const names = new Set()
  const pattern = /import\s+(?:type\s+)?(?:(\w+)\s*,\s*)?(?:\{([^}]*)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]dsh-tauri\/client['"]/gu
  for (const match of source.matchAll(pattern)) {
    if (match[2]) {
      for (const part of match[2].split(',')) {
        const name = part.trim().split(/\s+as\s+/u)[0].trim()
        if (name)
          names.add(name)
      }
    }
    if (match[3])
      names.add('default')
    if (match[4])
      names.add('*')
  }
  return names
}

/** 解析垫片导出的名字。 */
function shimExports(source) {
  const names = new Set()
  const patterns = [
    /export\s+(?:declare\s+)?(?:async\s+)?function\s+(\w+)/gu,
    /export\s+(?:declare\s+)?(?:const|let|var|class|interface|type|enum)\s+(\w+)/gu,
    /export\s*\{([^}]*)\}/gu,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const body = match[1] ?? ''
      if (body.includes(' as ')) {
        for (const part of body.split(',')) {
          const alias = part.trim().split(/\s+as\s+/u).pop().trim()
          if (alias)
            names.add(alias)
        }
        continue
      }
      if (body)
        names.add(body.trim())
      else if (match[2])
        names.add(match[2])
    }
  }
  return names
}

/**
 * compat 覆盖体检：独立仓库用 compat/dsh-tauri-client.ts 替代 workspace 的
 * `dsh-tauri/client`。client 代码一旦用到垫片没有的导出，独立仓库 typecheck
 * 必然失败——这是抠出来后唯一需要人工补的漂移点，必须在同步时先报出来。
 */
function checkCompatCoverage(pkgDir, standaloneDir) {
  heading('compat coverage')
  const shimPath = join(standaloneDir, 'compat', 'dsh-tauri-client.ts')
  if (!existsSync(shimPath)) {
    fail('缺少 compat/dsh-tauri-client.ts')
    return
  }
  const provided = shimExports(readFileSync(shimPath, 'utf8'))
  const used = new Map()
  const clientRoot = join(pkgDir, 'src', 'client')
  for (const file of listFiles(clientRoot)) {
    if (!/\.(?:ts|tsx)$/u.test(file))
      continue
    for (const name of importedClientNames(readFileSync(join(clientRoot, file), 'utf8'))) {
      if (!used.has(name))
        used.set(name, file)
    }
  }
  const missing = [...used.entries()].filter(([name]) => name !== 'default' && name !== '*' && !provided.has(name))
  if (missing.length === 0) {
    ok(`client 用到的 ${used.size} 个 dsh-tauri/client 导出都在垫片里`)
    return
  }
  for (const [name, file] of missing)
    fail(`compat 垫片缺少导出 \`${name}\`（${file} 在用）— 请在 compat/dsh-tauri-client.ts 补上`)
}

/** dist 新鲜度：重新构建后仓库内 dist 必须无 diff（CI 的同一条断言）。 */
function checkDist(standaloneDir, { build }) {
  heading('dist freshness')
  if (!existsSync(join(standaloneDir, 'node_modules'))) {
    fail('独立仓库未安装依赖（先 pnpm install --frozen-lockfile）')
    return
  }
  if (build) {
    const result = run('pnpm', ['build'], standaloneDir)
    if (!result.ok) {
      fail(`pnpm build 失败：${result.stderr.trim().split('\n').slice(-3).join(' | ')}`)
      return
    }
    ok('pnpm build 完成')
  }
  const diff = run('git', ['-C', standaloneDir, 'diff', '--exit-code', '--stat', '--', 'dist'], process.cwd())
  if (!diff.ok && diff.code !== 1) {
    fail(`git diff 无法执行：${diff.stderr.trim()}`)
    return
  }
  if (diff.stdout.trim() === '' && diff.code === 0) {
    ok('提交进仓库的 dist 与源码一致')
    return
  }
  fail(`dist 与源码不一致（CI 会拒绝），需要把重建后的 dist 一起提交：\n${diff.stdout.trim()}`)
}

function syncFiles(pkgDir, standaloneDir, { check }) {
  heading('sync')
  let changed = 0
  for (const entry of SYNCED) {
    const source = join(pkgDir, entry)
    const target = join(standaloneDir, entry)
    if (!existsSync(source)) {
      warn(`monorepo 缺少 ${entry}，跳过`)
      continue
    }
    if (statSync(source).isDirectory()) {
      const wanted = new Set(listFiles(source))
      for (const file of wanted) {
        const from = join(source, file)
        const to = join(target, file)
        const before = existsSync(to) ? readFileSync(to, 'utf8') : undefined
        const after = readFileSync(from, 'utf8')
        if (before === after)
          continue
        changed += 1
        if (!check) {
          mkdirSync(dirname(to), { recursive: true })
          copyFileSync(from, to)
        }
      }
      // 删除 monorepo 已移除的文件，避免独立仓库留旧文件
      for (const file of listFiles(target)) {
        if (wanted.has(file))
          continue
        changed += 1
        if (!check)
          rmSync(join(target, file), { force: true })
      }
      continue
    }
    const before = existsSync(target) ? readFileSync(target, 'utf8') : undefined
    const after = readFileSync(source, 'utf8')
    if (before === after)
      continue
    changed += 1
    if (!check)
      copyFileSync(source, target)
  }
  if (changed === 0) {
    ok('同步区与 monorepo 一致')
    return 0
  }
  const verb = check ? '需要同步' : '已同步'
  process.stdout.write(`  ${verb} ${changed} 个文件\n`)
  if (check) {
    fail(`独立仓库落后 ${changed} 个文件（跑不带 --check 的 sync）`)
    return 1
  }
  return 0
}

function commandVerify(args) {
  const pkgDir = resolve(String(args.pkg ?? ''))
  const dir = resolve(String(args.dir ?? ''))
  if (!pkgDir || !existsSync(pkgDir)) {
    fail(`--pkg 指向的包不存在：${pkgDir}`)
    return 1
  }
  if (!dir || !existsSync(dir)) {
    fail(`--dir 指向的独立仓库不存在：${dir}`)
    return 1
  }
  checkOverlay(dir)
  checkLineEndings(dir)
  checkCompatCoverage(pkgDir, dir)
  checkDist(dir, { build: args.build !== false })
  return errors.length === 0 ? 0 : 1
}

function commandSync(args) {
  const pkgDir = resolve(String(args.pkg ?? ''))
  const dir = resolve(String(args.dir ?? ''))
  if (!pkgDir || !existsSync(pkgDir) || !dir || !existsSync(dir)) {
    fail('需要同时给出存在的 --pkg 与 --dir')
    return 1
  }
  const check = args.check === true
  syncFiles(pkgDir, dir, { check })
  if (check)
    return errors.length === 0 ? 0 : 1
  checkOverlay(dir)
  checkLineEndings(dir)
  checkCompatCoverage(pkgDir, dir)
  checkDist(dir, { build: args.build !== false })
  return errors.length === 0 ? 0 : 1
}

function githubToken() {
  const result = spawnSync('git', ['credential', 'fill'], {
    input: 'protocol=https\nhost=github.com\n\n',
    encoding: 'utf8',
  })
  const match = /^password=(.*)$/mu.exec(String(result.stdout ?? ''))
  return match?.[1]?.trim()
}

function previousTag(dir) {
  const result = run('git', ['-C', dir, 'describe', '--tags', '--abbrev=0'], process.cwd())
  return result.ok ? result.stdout.trim() : undefined
}

function commandRelease(args) {
  const dir = resolve(String(args.dir ?? ''))
  const version = String(args.version ?? '')
  if (!existsSync(dir)) {
    fail(`--dir 指向的独立仓库不存在：${dir}`)
    return 1
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Z.-]+)?$/iu.test(version)) {
    fail('--version 需要是 semver，例如 0.3.2')
    return 1
  }
  heading('release plan')
  const pkgPath = join(dir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const tag = `${args['tag-prefix'] ?? 'v'}${version}`
  const prev = previousTag(dir)
  const notesFile = args.notes ? resolve(String(args.notes)) : undefined
  const notes = notesFile && existsSync(notesFile)
    ? readFileSync(notesFile, 'utf8')
    : run('git', ['-C', dir, 'log', '--no-merges', '--pretty=- %s', prev ? `${prev}..HEAD` : '-20'], process.cwd()).stdout.trim()
  log(`  ${pkg.name} ${pkg.version} -> ${version}（tag ${tag}）`)
  log(`  上一次 tag：${prev ?? '(无)'}`)
  log(`  release notes 来源：${notesFile || 'git log'}`)
  if (!args.yes) {
    log('\n  这是预演。加 --yes 才会真正改版本、提交、打 tag、推送并创建 GitHub Release。')
    if (args.npm)
      log('  另外会执行 npm publish --access public（需要 --otp）。')
    return 0
  }
  pkg.version = version
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
  const steps = [
    ['git', ['-C', dir, 'add', 'package.json']],
    ['git', ['-C', dir, 'commit', '-m', `chore(release): v${version}`]],
    ['git', ['-C', dir, 'tag', '-a', tag, '-m', `${pkg.name} ${tag}`]],
    ['git', ['-C', dir, 'push', 'origin', 'HEAD']],
    ['git', ['-C', dir, 'push', 'origin', tag]],
  ]
  for (const [command, commandArgs] of steps) {
    const result = run(command, commandArgs, process.cwd())
    if (!result.ok) {
      fail(`${command} ${commandArgs.join(' ')} 失败：${result.stderr.trim()}`)
      return 1
    }
  }
  ok(`已推送 ${tag}`)
  const token = githubToken()
  const repo = String(args.repo ?? '')
  if (!repo || !token) {
    warn('缺少 --repo 或 GitHub 凭据，跳过 Release 创建（可稍后手动补）')
    return errors.length === 0 ? 0 : 1
  }
  const payload = JSON.stringify({ tag_name: tag, name: tag, body: notes, draft: false, prerelease: false })
  const result = spawnSync('curl', ['-sS', '-X', 'POST', '-H', `Authorization: Bearer ${token}`, '-H', 'Accept: application/vnd.github+json', '-H', 'User-Agent: standalone-plugin-script', '--data-binary', payload, `https://api.github.com/repos/${repo}/releases`], { encoding: 'utf8' })
  if (result.status !== 0 || !/"html_url"/u.test(String(result.stdout ?? '')))
    fail(`创建 Release 失败：${String(result.stdout ?? result.stderr).slice(0, 300)}`)
  else
    ok(`Release 已创建：${/"html_url":\s*"([^"]+)"/u.exec(String(result.stdout))?.[1]}`)
  if (args.npm) {
    const npmArgs = ['publish', '--access', 'public']
    if (args.otp)
      npmArgs.push('--otp', String(args.otp))
    const publish = run('npm', npmArgs, dir)
    if (publish.ok)
      ok(`npm 已发布 ${pkg.name}@${version}`)
    else
      fail(`npm publish 失败：${publish.stderr.trim().split('\n').slice(-3).join(' | ')}`)
  }
  return errors.length === 0 ? 0 : 1
}

function commandMarket(args) {
  const repo = String(args.repo ?? '')
  const category = String(args.category ?? '')
  const name = String(args.name ?? repo)
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repo) || !category) {
    fail('需要 --repo <owner/name> 与 --category <cat>')
    return 1
  }
  const url = String(args.url ?? `https://github.com/${repo}`)
  const en = String(args.en ?? 'One-line description ending with a period.')
  const zh = String(args.zh ?? '')
  const quote = text => (text.includes(': ') || text.includes('#') ? `'${text.replaceAll('\'', '\'\'')}'` : text)
  const lines = [
    `url: ${url}`,
    `name: ${name}`,
    `category: ${category}`,
    'description:',
    `  en: ${quote(en)}`,
  ]
  if (zh)
    lines.push(`  zh: ${quote(zh)}`)
  const yaml = `${lines.join('\n')}\n`
  const out = args.out ? resolve(String(args.out)) : undefined
  if (out) {
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, yaml)
    ok(`已写入 ${out}`)
  }
  else {
    process.stdout.write(`\n${yaml}`)
  }
  log('  提交规则：只加 data/plugins/<owner>__<repo>.yml 一个文件；不要手改 README；描述含 ": " 必须加引号。')
  return 0
}

function usage() {
  process.stdout.write(`用法：
  node scripts/standalone-plugin.mjs verify  --pkg <monorepo 包目录> --dir <独立仓库克隆>
  node scripts/standalone-plugin.mjs sync    --pkg <monorepo 包目录> --dir <独立仓库克隆> [--check] [--no-build]
  node scripts/standalone-plugin.mjs release --dir <独立仓库克隆> --version <x.y.z> [--repo <owner/name>] [--notes <file>] [--npm --otp <code>] [--yes]
  node scripts/standalone-plugin.mjs market  --repo <owner/name> --category <cat> [--en <text>] [--zh <text>] [--out <file>]
`)
}

const args = parseArgs(process.argv.slice(2))
const command = args._[0]
const table = { verify: commandVerify, sync: commandSync, release: commandRelease, market: commandMarket }
if (!command || !table[command]) {
  usage()
  process.exit(command ? 1 : 0)
}
const exitCode = table[command](args)
if (errors.length > 0) {
  process.stdout.write(`\n结果：${errors.length} 项失败${warnings.length ? `，${warnings.length} 项警告` : ''}\n`)
  for (const { step: failedStep, message } of errors)
    process.stdout.write(`  ✖ [${failedStep}] ${message}\n`)
}
else {
  process.stdout.write(`\n结果：通过${warnings.length ? `（${warnings.length} 项警告）` : ''}\n`)
}
process.exit(exitCode)
