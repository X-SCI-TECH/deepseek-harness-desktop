import { defineDshConfig } from 'dsh-tauri-tsdown'

export default defineDshConfig({
  // The client half runs inside the DSH Web ModuleLoader (Chromium webview),
  // never on Node. Without an explicit target, tsdown infers node22.15.0 from
  // this package's `engines.node`, and warnLegacyCJS then flags the intentional
  // CJS client bundle as a legacy CommonJS package — escalated to an
  // "We recommend using the ESM format" ERROR (exit 1) by tsdown's default
  // `failOnWarn: 'ci-only'` under CI=true. Pin the client bundle to its real
  // runtime floor (es2022; WebView2 is evergreen Chromium) so the CJS contract
  // stays intact and the warning is corrected at the source. The host half
  // keeps its Node target, and every other warning remains CI-fatal.
  client: { target: 'es2022' },
})
