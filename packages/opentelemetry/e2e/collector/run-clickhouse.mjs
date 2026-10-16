/* global process, console */

import { createHash, randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { parseArgs } from 'node:util'

import {
  buildInputs,
  commandRunner,
  freshArtifacts,
  suiteDir,
} from './prepare-images.mjs'

const evidencePathFor = (artifacts) =>
  resolve(process.env.CLICKHOUSE_EVIDENCE_FILE ?? join(artifacts, 'evidence.txt'))

const { values } = parseArgs({
  options: {
    artifacts: { type: 'string' },
    apps: { type: 'string' },
    help: { type: 'boolean' },
  },
})
if (values.help) {
  console.log(
    'node run-clickhouse.mjs [--artifacts <new-directory>] [--apps <prepared-apps>]\nRequires prepare-images.mjs first. Tree scenario -> graceful Collector stop -> ClickHouse HTTP queries.\nThe evidence summary is <artifacts>/evidence.txt; CLICKHOUSE_EVIDENCE_FILE overrides the path.',
  )
} else {
  await main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}

async function writeEvidence(artifacts, extra) {
  let commands = []
  let query = null
  let host = null
  try {
    commands = JSON.parse(await readFile(join(artifacts, 'commands.json'), 'utf8'))
  } catch {}
  try {
    query = JSON.parse(
      await readFile(join(artifacts, 'output', 'clickhouse-query.json'), 'utf8'),
    )
  } catch {}
  try {
    host = JSON.parse(await readFile(join(artifacts, 'host-result.json'), 'utf8'))
  } catch {}
  const lines = [
    'ClickHouse e2e',
    `artifacts: ${artifacts}`,
    `success: ${host?.success ?? false}`,
    host?.error ? `error: ${host.error}` : '',
    extra ? `note: ${extra}` : '',
    '',
    '## Commands',
    ...commands.map(
      (item) =>
        `${item.label}: code=${item.code} signal=${item.signal ?? ''} timedOut=${item.timedOut} argv=${item.argv.join(' ')}`,
    ),
    '',
    '## ClickHouse queries',
  ]
  if (query) {
    lines.push(
      `runId: ${query.runId}`,
      `ping: ${query.ping}`,
      `spanSql: ${query.spanSql.replaceAll('\n', ' ')}`,
      `logSql: ${query.logSql.replaceAll('\n', ' ')}`,
      `causeSql: ${query.causeSql.replaceAll('\n', ' ')}`,
      `causeJoinSql: ${query.causeJoinSql?.replaceAll('\n', ' ') ?? ''}`,
      `spans.rows: ${query.spans.rows}`,
      `logs.rows: ${query.logs.rows}`,
      `causes.rows: ${query.causes.rows}`,
      `causeJoins.rows: ${query.causeJoins?.rows ?? query.joined?.length ?? 0}`,
      '',
      'spans:',
      JSON.stringify(query.spans.data, null, 2),
      '',
      'logs:',
      JSON.stringify(query.logs.data, null, 2),
      '',
      'causes (nonempty lists first):',
      JSON.stringify(query.causes.data.slice(0, 20), null, 2),
      '',
      'cause joins (cause id ↔ frame id):',
      JSON.stringify(query.causeJoins?.data ?? query.joined ?? [], null, 2),
    )
  } else {
    lines.push('no clickhouse-query.json')
  }
  const evidencePath = evidencePathFor(artifacts)
  await mkdir(dirname(evidencePath), { recursive: true })
  await writeFile(evidencePath, `${lines.filter((line) => line !== '').join('\n')}\n`)
}

async function main() {
  const inputs = await buildInputs()
  const apps = resolve(
    values.apps ??
      process.env.COLLECTOR_APPS ??
      join(suiteDir, 'prepared/apps'),
  )
  if (!(await stat(join(suiteDir, 'clickhouse-runner.mjs'))).isFile())
    throw new Error('Missing clickhouse-runner.mjs')
  if (!(await stat(apps)).isDirectory())
    throw new Error(`Missing prepared apps: ${apps}`)
  const root = resolve(suiteDir, '../../../..')
  const manifest = JSON.parse(await readFile(join(apps, 'manifest.json'), 'utf8'))
  const check = async (file, expected) => {
    const actual = createHash('sha256')
      .update(await readFile(file))
      .digest('hex')
    if (actual !== expected) throw new Error(`Stale app build input: ${file}`)
  }
  for (const [name, hash] of Object.entries(manifest.inputs)) {
    const file = resolve(root, name)
    if (!file.startsWith(root + sep)) throw new Error('Invalid build input path')
    await check(file, hash)
  }
  await check(join(root, 'pnpm-lock.yaml'), manifest.workspaceLockHash)
  await check(join(root, 'packages/core/dist/index.js'), manifest.coreHash)
  await check(manifest.adapterInput, manifest.adapterHash)
  await check(join(suiteDir, 'build-apps.mjs'), manifest.buildConfigHash)
  const artifacts = await freshArtifacts(
    values.artifacts ?? process.env.COLLECTOR_ARTIFACTS,
    'reatom-clickhouse-run',
  )
  const project = `reatom-otel-ch-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
  const output = join(artifacts, 'output')
  await mkdir(output, { mode: 0o777 })
  await chmod(output, 0o777)
  console.log(`ClickHouse artifacts: ${artifacts}\nCompose project: ${project}`)
  const environment = {
    COLLECTOR_IMAGE: inputs.images.collector.image,
    COLLECTOR_RUNNER_IMAGE: inputs.runnerTag,
    CLICKHOUSE_IMAGE: inputs.images.clickhouse.image,
    COLLECTOR_ARTIFACTS: output,
    COLLECTOR_APPS: apps,
    COLLECTOR_RUN_ID: process.env.COLLECTOR_RUN_ID ?? project,
  }
  const execute = commandRunner(artifacts, environment)
  const compose = [
    'docker',
    'compose',
    '--ansi',
    'never',
    '--env-file',
    '/dev/null',
    '--project-directory',
    suiteDir,
    '-f',
    join(suiteDir, 'compose.clickhouse.yaml'),
    '-p',
    project,
  ]
  const c = (label, args, options) =>
    execute(label, [...compose, ...args], options)
  let interrupted
  const interrupt = (signal) => {
    interrupted = signal
    execute.interrupt()
  }
  const onInt = () => interrupt('SIGINT')
  const onTerm = () => interrupt('SIGTERM')
  process.on('SIGINT', onInt)
  process.on('SIGTERM', onTerm)
  let collectorId
  let collectorStopped = false
  let projectTouched = false
  let failure
  const status = {
    project,
    artifacts,
    apps,
    runId: environment.COLLECTOR_RUN_ID,
    startedAt: new Date().toISOString(),
  }
  const assertUninterrupted = () => {
    if (interrupted) throw new Error(`Interrupted by ${interrupted}`)
  }
  const save = async (name, value) =>
    writeFile(join(artifacts, name), `${JSON.stringify(value, null, 2)}\n`)
  async function stopCollector() {
    if (!collectorId || collectorStopped) return
    await c('stop-collector', ['stop', '--timeout', '30', 'collector'], {
      timeout: 45_000,
    })
    const inspection = await execute('inspect-stopped-collector', [
      'docker',
      'inspect',
      collectorId,
    ])
    const stopped = JSON.parse(inspection.stdout)[0]
    await save('collector-state.json', stopped.State)
    collectorStopped = true
    if (
      stopped.State.Running ||
      stopped.State.OOMKilled ||
      stopped.State.ExitCode !== 0
    )
      throw new Error(
        `Collector did not exit gracefully: ${JSON.stringify(stopped.State)}`,
      )
  }
  try {
    const inspected = await execute('inspect-preloaded-images', [
      'docker',
      'image',
      'inspect',
      inputs.images.collector.image,
      inputs.runnerTag,
      inputs.images.clickhouse.image,
    ])
    const [collector, runner, clickhouse] = JSON.parse(inspected.stdout)
    for (const image of [collector, runner, clickhouse])
      if (`${image.Os}/${image.Architecture}` !== inputs.images.platform)
        throw new Error('Wrong image platform')
    if (collector.Config.User !== inputs.images.collector.user)
      throw new Error('Wrong Collector UID')
    if (runner.Config.Labels?.['org.reatom.collector.inputs'] !== inputs.hash)
      throw new Error(
        'Prepared runner is stale; explicitly rerun prepare-images.mjs',
      )
    environment.COLLECTOR_IMAGE = collector.Id
    environment.COLLECTOR_RUNNER_IMAGE = runner.Id
    environment.CLICKHOUSE_IMAGE = clickhouse.Id
    const configHash = createHash('sha256')
      .update(await readFile(join(suiteDir, 'collector.clickhouse.yaml')))
      .digest('hex')
    await save('host-inputs.json', {
      ...status,
      images: inputs.images,
      runnerImageId: runner.Id,
      runnerInputSha256: inputs.hash,
      collectorImageId: collector.Id,
      clickhouseImageId: clickhouse.Id,
      collectorConfigSha256: configHash,
    })
    const config = JSON.parse(
      (await c('compose-config', ['config', '--format', 'json'])).stdout,
    )
    if (
      Object.keys(config.services).sort().join(',') !==
      'clickhouse,collector,runner'
    )
      throw new Error('Unexpected Compose services')
    for (const service of Object.values(config.services)) {
      if (
        service.ports?.length ||
        service.network_mode ||
        service.privileged ||
        service.build
      )
        throw new Error(
          'Compose must not publish ports, build, or use host/privileged mode',
        )
      if (
        service.platform !== inputs.images.platform ||
        service.pull_policy !== 'never'
      )
        throw new Error('Compose must pin platform and forbid pulls')
    }
    if (!Object.values(config.networks).every((network) => network.internal))
      throw new Error('All Compose networks must be internal')
    assertUninterrupted()
    projectTouched = true
    await c(
      'start-clickhouse',
      ['up', '-d', '--wait', '--wait-timeout', '120', '--pull', 'never', '--no-build', 'clickhouse'],
      { timeout: 150_000 },
    )
    await c('validate-collector', [
      'run',
      '--rm',
      '--no-deps',
      '--pull',
      'never',
      'collector',
      'validate',
      '--config=/etc/otelcol-contrib/config.yaml',
    ])
    assertUninterrupted()
    await c('start-collector', [
      'up',
      '-d',
      '--pull',
      'never',
      '--no-build',
      'collector',
    ])
    collectorId = (
      await c('collector-id', ['ps', '-q', 'collector'])
    ).stdout.trim()
    if (!/^[a-f0-9]{12,64}$/.test(collectorId))
      throw new Error('Collector container ID missing')
    const health = `const deadline=Date.now()+20000; let ready=false; while(Date.now()<deadline){try{const r=await fetch('http://collector:13133/',{signal:AbortSignal.timeout(1000)}); await r.arrayBuffer(); if(r.ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100))} if(!ready)throw new Error('Collector health deadline'); console.log('Collector ready')`
    await c(
      'collector-health',
      [
        'run',
        '--rm',
        '--no-deps',
        '--use-aliases',
        '--pull',
        'never',
        'runner',
        'node',
        '--input-type=module',
        '-e',
        health,
      ],
      { timeout: 45_000 },
    )
    assertUninterrupted()
    await c(
      'scenarios',
      [
        'run',
        '--rm',
        '--no-deps',
        '--use-aliases',
        '--pull',
        'never',
        'runner',
        'node',
        '/suite/clickhouse-runner.mjs',
        'run',
      ],
      { timeout: 180_000 },
    )
    assertUninterrupted()
    await stopCollector()
    await c(
      'query',
      [
        'run',
        '--rm',
        '--no-deps',
        '--use-aliases',
        '--pull',
        'never',
        'runner',
        'node',
        '/suite/clickhouse-runner.mjs',
        'query',
      ],
      { timeout: 90_000 },
    )
    assertUninterrupted()
  } catch (error) {
    failure = error
  } finally {
    if (projectTouched) {
      if (!collectorId) {
        const found = await c(
          'cleanup-collector-id',
          ['ps', '-a', '-q', 'collector'],
          { allowFailure: true },
        )
        const id = found.stdout.trim()
        if (/^[a-f0-9]{12,64}$/.test(id)) collectorId = id
      }
      try {
        await stopCollector()
      } catch (error) {
        failure ??= error
      }
      const logs = await c(
        'compose-logs',
        ['logs', '--no-color', '--timestamps'],
        { allowFailure: true },
      )
      if (logs.code !== 0)
        failure ??= new Error('Could not preserve Compose logs')
      const down = await c(
        'cleanup',
        ['down', '--remove-orphans', '--timeout', '30'],
        { timeout: 60_000, allowFailure: true },
      )
      if (down.code !== 0) failure ??= new Error('Compose cleanup failed')
      const remaining = await execute(
        'cleanup-containers',
        [
          'docker',
          'ps',
          '-aq',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ],
        { allowFailure: true },
      )
      const networks = await execute(
        'cleanup-networks',
        [
          'docker',
          'network',
          'ls',
          '-q',
          '--filter',
          `label=com.docker.compose.project=${project}`,
        ],
        { allowFailure: true },
      )
      if (
        remaining.code !== 0 ||
        networks.code !== 0 ||
        remaining.stdout.trim() ||
        networks.stdout.trim()
      )
        failure ??= new Error('Own-project cleanup is incomplete')
    }
    process.off('SIGINT', onInt)
    process.off('SIGTERM', onTerm)
    if (interrupted) failure ??= new Error(`Interrupted by ${interrupted}`)
    await save('host-result.json', {
      ...status,
      finishedAt: new Date().toISOString(),
      collectorStopped,
      success: !failure,
      error: failure?.message,
      evidence: evidencePathFor(artifacts),
    })
    try {
      await writeEvidence(artifacts, failure?.message)
    } catch (error) {
      failure ??= error
    }
  }
  if (failure) throw failure
  console.log(
    `ClickHouse scenario and HTTP queries passed; evidence: ${evidencePathFor(artifacts)}`,
  )
}
