import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { brotliCompressSync, gzipSync } from 'node:zlib'

// Reuse the project's existing Vitest -> Vite build dependency.
const require = createRequire(import.meta.url)
const viteRequire = createRequire(require.resolve('vitest/package.json'))
const esbuildRequire = createRequire(viteRequire.resolve('vite'))
const { build } = esbuildRequire('esbuild')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const names = {
  otlp: 'withOTLP, otlpTransport',
  'web-analytics': 'withWebAnalytics',
  gdpr: 'withGDPR, reatomGDPR',
  attributes: 'withAttributes',
  'browser-network': 'withBrowserNetworkMonkeypatch',
  'browser-console': 'withBrowserConsoleMonkeypatch',
  'web-vitals': 'withWebVitals',
  'browser-performance': 'withBrowserPerformance',
  faro: 'faroTransport, logMeasurement',
}
const plugins = Object.keys(names)
const cases = {
  root: {
    imports: `export { reatomOpentelemetry } from './src/index.ts'`,
    allowed: [],
  },
}
for (const [plugin, exported] of Object.entries(names)) {
  const label = plugin === 'web-analytics' ? 'analytics' : plugin
  const imports = `export { ${exported} } from './src/${plugin}/index.ts'`
  cases[label] = { imports, allowed: [plugin] }
  cases[`root+${label}`] = {
    imports: `${cases.root.imports}; ${imports}`,
    allowed: [plugin],
  }
}
cases['root+all'] = {
  imports: [
    cases.root.imports,
    ...plugins.map(
      (plugin) => `export { ${names[plugin]} } from './src/${plugin}/index.ts'`,
    ),
  ].join('; '),
  allowed: plugins,
}
const reports = []
const outputDir = process.argv[2] && resolve(process.argv[2])
if (outputDir) await mkdir(outputDir, { recursive: true })
for (const mode of ['source', 'package']) {
  for (const [name, { imports, allowed }] of Object.entries(cases)) {
    const contents =
      mode === 'source'
        ? imports
        : imports.replaceAll('./src/', './dist/').replaceAll(".ts'", ".js'")
    const result = await build({
      absWorkingDir: root,
      stdin: {
        contents,
        resolveDir: root,
        sourcefile: 'bundle-check.ts',
        loader: 'ts',
      },
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
      external: ['@reatom/core'],
      write: false,
      metafile: true,
    })
    // Check modules that contributed bytes after tree shaking, rather than mere
    // graph traversal: a shared build chunk may contain unused connector code.
    const contributed = Object.entries(result.metafile.outputs).flatMap(
      ([, output]) =>
        Object.entries(output.inputs)
          .filter(([, input]) => input.bytesInOutput > 0)
          .map(([file]) => file),
    )
    for (const plugin of plugins) {
      const present = contributed.some((file) =>
        file.includes(`${mode === 'source' ? 'src' : 'dist'}/${plugin}/`),
      )
      assert.equal(
        present,
        allowed.includes(plugin),
        `${name}: ${plugin} isolation`,
      )
    }
    if (mode === 'source' && !allowed.includes('otlp')) {
      const exportRuntime =
        /src\/(?:buildSpan|buildLogRecord|buildExportPayload|toOtlpValue|retryWithBackoff|createBatchQueue|createExportWorker|sendTraces|parseExportResponse|flushWithBeacon|selectUnloadBatch|unloadBudget)\.ts$/
      assert.deepEqual(
        contributed.filter((file) => exportRuntime.test(file)),
        [],
        `${name}: capture graph excludes wire/export runtime`,
      )
    }
    const includesVitals = contributed.some((file) =>
      /node_modules\/.*web-vitals\//.test(file),
    )
    assert.equal(
      includesVitals,
      allowed.includes('web-vitals'),
      `${name}: optional upstream web-vitals runtime`,
    )
    const code = result.outputFiles[0].contents
    if (name === 'root') {
      const bundled = new TextDecoder().decode(code)
      for (const wireField of [
        'resourceSpans',
        'resourceLogs',
        'startTimeUnixNano',
        'timeUnixNano',
        'sendBeacon',
        'Retry-After',
      ])
        assert.equal(
          bundled.includes(wireField),
          false,
          `${mode}: base excludes ${wireField}`,
        )
    }
    reports.push({
      entry: `${mode}:${name}`,
      bytes: code.length,
      gzipBytes: gzipSync(code).length,
      brotliBytes: brotliCompressSync(code).length,
      webVitalsRuntime: includesVitals,
    })
    if (outputDir)
      await writeFile(
        resolve(outputDir, `${mode}-${name.replaceAll('+', '-')}.json`),
        JSON.stringify(result.metafile, null, 2),
      )
  }
}
console.table(reports)
if (outputDir)
  await writeFile(
    resolve(outputDir, 'sizes.json'),
    JSON.stringify(reports, null, 2),
  )
