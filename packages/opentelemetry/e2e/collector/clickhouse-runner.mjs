/* global process, console, URL, fetch */

import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const artifacts = resolve(process.env.COLLECTOR_ARTIFACTS ?? '/artifacts')
const apps = resolve(process.env.COLLECTOR_APPS ?? join(here, 'prepared/apps'))
const clickhouseUrl = process.env.CLICKHOUSE_URL ?? 'http://clickhouse:8123'
const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default'
const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? 'e2e'
const clickhouseDatabase = process.env.CLICKHOUSE_DATABASE ?? 'otel'
const collectorSignals = /^http:\/\/collector:4318\/v1\/(?:traces|logs)$/
const json = (file, value) =>
  writeFile(file, JSON.stringify(value, null, 2) + '\n')

const poll = async (callback, label, timeout = 20000) => {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    try {
      const result = await callback()
      if (result) return result
    } catch (error) {
      last = error
    }
    await delay(100)
  }
  throw new Error(`Timed out: ${label}`, { cause: last })
}

const verifyBuild = async () => {
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const manifest = JSON.parse(
    await readFile(join(apps, 'manifest.json'), 'utf8'),
  )
  assert.equal(
    digest(await readFile(join(here, 'build-apps.mjs'))),
    manifest.buildConfigHash,
    'stale app build configuration',
  )
  for (const [name, expected] of Object.entries(manifest.outputs)) {
    const file = resolve(apps, name)
    assert(file.startsWith(apps + sep), 'invalid build manifest path')
    assert.equal(
      digest(await readFile(file)),
      expected,
      `app build changed: ${name}`,
    )
  }
  return manifest
}

const serve = async (port) => {
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://runner').pathname
      const file = resolve(
        apps,
        '.' + path,
        path.endsWith('/') ? 'index.html' : '',
      )
      assert(file.startsWith(apps + sep), 'outside app root')
      response.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.json': 'application/json',
          '.svg': 'image/svg+xml',
        }[extname(file)] ?? 'application/octet-stream',
      )
      response.end(await readFile(file))
    } catch {
      response.statusCode = 404
      response.end('Not found')
    }
  })
  await new Promise((resolve, reject) =>
    server.once('error', reject).listen(port, '0.0.0.0', resolve),
  )
  return server
}

const clickhouseQuery = async (sql, queryParams = {}) => {
  const url = new URL(clickhouseUrl)
  url.searchParams.set('database', clickhouseDatabase)
  for (const [key, value] of Object.entries(queryParams)) {
    url.searchParams.set(`param_${key}`, value)
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': clickhouseUser,
      'X-ClickHouse-Key': clickhousePassword,
      'X-ClickHouse-Format': 'JSON',
    },
    body: sql,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(`ClickHouse ${response.status}: ${text.slice(0, 2000)}`)
  return JSON.parse(text)
}

const nonempty = (rows, label) => {
  assert(Array.isArray(rows), `${label}: expected JSON data array`)
  assert(rows.length > 0, `${label}: empty ClickHouse result`)
  return rows
}

const SENTINEL_FRAME_ID = 'clickhouse-e2e'
const RUN_SCOPE = `ResourceAttributes['test.run_id'] = {runId:String}`
const CAUSE_JSON = `if(cause_ids IN ('', '[]') OR NOT isValidJSON(cause_ids), '[]', cause_ids)`

const resolveRunId = async () => {
  try {
    const recorded = JSON.parse(
      await readFile(join(artifacts, 'clickhouse-run.json'), 'utf8'),
    )
    if (typeof recorded.runId === 'string' && recorded.runId)
      return recorded.runId
  } catch {}
  const fromEnv = process.env.COLLECTOR_RUN_ID
  if (typeof fromEnv === 'string' && fromEnv) return fromEnv
  throw new Error('test.run_id missing (clickhouse-run.json / COLLECTOR_RUN_ID)')
}

const parseCauseIds = (value) => {
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed || trimmed === '[]') return []
  try {
    const parsed = JSON.parse(trimmed)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => (item == null ? '' : String(item)))
      .filter((id) => id.length > 0)
  } catch {
    return []
  }
}

const usableCauseIds = (ids) =>
  ids.filter((id) => id !== SENTINEL_FRAME_ID)

const findCauseJoins = (rows) => {
  const frameIds = new Set(
    rows
      .map((row) => row.frame_id)
      .filter(
        (id) => typeof id === 'string' && id && id !== SENTINEL_FRAME_ID,
      ),
  )
  const matches = []
  for (const row of rows) {
    if (typeof row.frame_id !== 'string' || row.frame_id === SENTINEL_FRAME_ID)
      continue
    const causes = usableCauseIds(parseCauseIds(row.cause_ids))
    for (const causeId of causes) {
      if (frameIds.has(causeId) && causeId !== row.frame_id) {
        matches.push({ ...row, matched_frame_id: causeId })
        break
      }
    }
  }
  return matches
}

const queryClickhouse = async () => {
  const runId = await resolveRunId()
  const ping = await fetch(`${clickhouseUrl}/ping`, {
    signal: AbortSignal.timeout(5_000),
  })
  const pingBody = await ping.text()
  assert(ping.ok, `ClickHouse ping ${ping.status}`)
  const params = { runId }
  const spanSql = `SELECT TraceId, SpanName, SpanAttributes['reatom.frame.id'] AS frame_id, SpanAttributes['reatom.cause.ids'] AS cause_ids
FROM otel_traces
WHERE TraceId != '' AND ${RUN_SCOPE}
ORDER BY Timestamp, TraceId, SpanId
LIMIT 50`
  const logSqlWithEvent = `SELECT EventName, Body, LogAttributes['event.name'] AS event_name_attr, LogAttributes['reatom.frame.id'] AS frame_id, LogAttributes['reatom.cause.ids'] AS cause_ids
FROM otel_logs
WHERE (EventName != '' OR length(Body) > 0 OR LogAttributes['event.name'] != '') AND ${RUN_SCOPE}
ORDER BY if(EventName IN ('reatom.atom.update', 'reatom.computed.update') OR LogAttributes['event.name'] IN ('reatom.atom.update', 'reatom.computed.update'), 0, 1), Timestamp, TraceId, SpanId
LIMIT 50`
  const logSqlBodyOnly = `SELECT Body, LogAttributes['event.name'] AS event_name_attr, LogAttributes['reatom.frame.id'] AS frame_id, LogAttributes['reatom.cause.ids'] AS cause_ids
FROM otel_logs
WHERE (length(Body) > 0 OR LogAttributes['event.name'] != '') AND ${RUN_SCOPE}
ORDER BY if(LogAttributes['event.name'] IN ('reatom.atom.update', 'reatom.computed.update'), 0, 1), Timestamp, TraceId, SpanId
LIMIT 50`
  const causeSql = `SELECT source, Timestamp, frame_id, cause_ids, length(JSONExtractArrayRaw(${CAUSE_JSON})) AS cause_len FROM (
  SELECT 'span' AS source, Timestamp, SpanAttributes['reatom.frame.id'] AS frame_id, SpanAttributes['reatom.cause.ids'] AS cause_ids
  FROM otel_traces
  WHERE ${RUN_SCOPE}
  UNION ALL
  SELECT 'log' AS source, Timestamp, LogAttributes['reatom.frame.id'] AS frame_id, LogAttributes['reatom.cause.ids'] AS cause_ids
  FROM otel_logs
  WHERE ${RUN_SCOPE}
) AS records
ORDER BY cause_len DESC, Timestamp, source, frame_id
LIMIT 2000`
  const causeJoinSql = `SELECT
  child.source,
  child.TraceId,
  child.SpanId,
  child.event_or_span_name,
  child.frame_id,
  child.cause_ids,
  child.cause_len,
  parent.source AS parent_source,
  parent.TraceId AS parent_TraceId,
  parent.SpanId AS parent_SpanId,
  parent.event_or_span_name AS parent_event_or_span_name,
  parent.frame_id AS matched_frame_id
FROM (
  SELECT source, Timestamp, TraceId, SpanId, event_or_span_name, frame_id, cause_ids, length(JSONExtractArrayRaw(${CAUSE_JSON})) AS cause_len FROM (
    SELECT 'span' AS source, Timestamp, TraceId, SpanId, SpanName AS event_or_span_name, SpanAttributes['reatom.frame.id'] AS frame_id, SpanAttributes['reatom.cause.ids'] AS cause_ids
    FROM otel_traces
    WHERE ${RUN_SCOPE}
    UNION ALL
    SELECT 'log' AS source, Timestamp, TraceId, SpanId, if(EventName != '', EventName, LogAttributes['event.name']) AS event_or_span_name, LogAttributes['reatom.frame.id'] AS frame_id, LogAttributes['reatom.cause.ids'] AS cause_ids
    FROM otel_logs
    WHERE ${RUN_SCOPE}
  )
) AS child
ARRAY JOIN JSONExtract(if(child.cause_ids IN ('', '[]') OR NOT isValidJSON(child.cause_ids), '[]', child.cause_ids), 'Array(String)') AS cause_id
INNER JOIN (
  SELECT source, TraceId, SpanId, event_or_span_name, frame_id FROM (
    SELECT 'span' AS source, TraceId, SpanId, SpanName AS event_or_span_name, SpanAttributes['reatom.frame.id'] AS frame_id
    FROM otel_traces
    WHERE ${RUN_SCOPE}
    UNION ALL
    SELECT 'log' AS source, TraceId, SpanId, if(EventName != '', EventName, LogAttributes['event.name']) AS event_or_span_name, LogAttributes['reatom.frame.id'] AS frame_id
    FROM otel_logs
    WHERE ${RUN_SCOPE}
  )
  WHERE frame_id != '' AND frame_id != '${SENTINEL_FRAME_ID}'
) AS parent ON parent.frame_id = cause_id
WHERE child.cause_len > 0
  AND child.frame_id != ''
  AND child.frame_id != '${SENTINEL_FRAME_ID}'
  AND cause_id != ''
  AND cause_id != '${SENTINEL_FRAME_ID}'
  AND cause_id != child.frame_id
ORDER BY child.cause_len DESC, child.Timestamp, child.source, child.frame_id
LIMIT 100`
  const spans = await poll(
    async () => {
      const result = await clickhouseQuery(spanSql, params)
      return result.data?.length ? result : undefined
    },
    'ClickHouse span TraceId',
    30_000,
  )
  nonempty(spans.data, 'spans')
  assert(
    spans.data.some((row) => typeof row.TraceId === 'string' && row.TraceId),
    'span TraceId missing',
  )
  let logs
  let logSql = logSqlWithEvent
  try {
    logs = await poll(
      async () => {
        const result = await clickhouseQuery(logSqlWithEvent, params)
        return result.data?.length ? result : undefined
      },
      'ClickHouse log EventName/Body',
      30_000,
    )
  } catch (error) {
    logSql = logSqlBodyOnly
    logs = await poll(
      async () => {
        const result = await clickhouseQuery(logSqlBodyOnly, params)
        return result.data?.length ? result : undefined
      },
      'ClickHouse log Body',
      30_000,
    )
    logs.fallback = String(error)
  }
  nonempty(logs.data, 'logs')
  assert(
    logs.data.some(
      (row) =>
        (typeof row.EventName === 'string' && row.EventName) ||
        (typeof row.event_name_attr === 'string' && row.event_name_attr) ||
        (typeof row.Body === 'string' && row.Body.length > 0),
    ),
    'log eventName/body missing',
  )
  assert(
    logs.data.some((row) => {
      const name = row.EventName || row.event_name_attr
      return (
        name === 'reatom.atom.update' || name === 'reatom.computed.update'
      )
    }),
    'missing library atom/computed update log',
  )
  const causes = await poll(
    async () => {
      const result = await clickhouseQuery(causeSql, params)
      return result.data?.length ? result : undefined
    },
    'ClickHouse cause ids',
    30_000,
  )
  nonempty(causes.data, 'cause ids')
  const joined = findCauseJoins(causes.data)
  assert(
    joined.length > 0,
    'no library-generated cause id joined to another frame.id in this run',
  )
  assert(
    joined.every(
      (row) =>
        parseCauseIds(row.cause_ids).length > 0 &&
        row.frame_id !== SENTINEL_FRAME_ID &&
        row.matched_frame_id !== SENTINEL_FRAME_ID &&
        row.cause_ids !== '[]' &&
        row.cause_ids !== '',
    ),
    'cause join matched empty or sentinel ids',
  )
  let causeJoins
  try {
    causeJoins = await clickhouseQuery(causeJoinSql, params)
  } catch (error) {
    causeJoins = { data: [], error: String(error) }
  }
  assert(
    Array.isArray(causeJoins.data) && causeJoins.data.length > 0,
    `ClickHouse cause join empty${causeJoins.error ? `: ${causeJoins.error}` : ''}`,
  )
  assert(
    causeJoins.data.every(
      (row) =>
        parseCauseIds(row.cause_ids).length > 0 &&
        row.frame_id !== SENTINEL_FRAME_ID &&
        row.matched_frame_id !== SENTINEL_FRAME_ID &&
        row.cause_ids !== '[]' &&
        row.cause_ids !== '',
    ),
    'ClickHouse cause join matched empty or sentinel ids',
  )
  const isLibraryUpdateName = (name) =>
    name === 'reatom.atom.update' || name === 'reatom.computed.update'
  const isActionSpanParent = (name) =>
    typeof name === 'string' && /\.(toggle|add|del)$/.test(name)
  const goldJoins = causeJoins.data.filter(
    (row) =>
      row.source === 'log' &&
      isLibraryUpdateName(row.event_or_span_name) &&
      row.parent_source === 'span' &&
      isActionSpanParent(row.parent_event_or_span_name),
  )
  assert(
    goldJoins.length > 0,
    'no atom/computed update log joined to a parent span',
  )
  assert(
    goldJoins.every((row) => row.TraceId === row.parent_TraceId),
    'update log TraceId must match parent span TraceId',
  )
  return {
    ping: pingBody.trim(),
    runId,
    spanSql,
    logSql,
    causeSql,
    causeJoinSql,
    spans,
    logs,
    causes,
    causeJoins,
    joined,
  }
}

const runTree = async ({ browser, origin, runId }) => {
  const errors = []
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const wire = { traces: [], logs: [] }
  const session = await context.newCDPSession(page)
  await session.send('Network.enable')
  const pending = []
  session.on('Network.requestWillBeSent', ({ requestId, request }) => {
    if (!collectorSignals.test(request.url) || request.method !== 'POST') return
    const kind = request.url.endsWith('/v1/logs') ? 'logs' : 'traces'
    const index = wire[kind].length
    wire[kind].push('')
    const read = (async () => {
      const body =
        request.postData ??
        (await session.send('Network.getRequestPostData', { requestId }))
          .postData
      assert(body, 'Collector request payload must be observable')
      wire[kind][index] = body
    })()
    read.catch(() => {})
    pending.push(read)
  })
  page.on('request', (request) => {
    const url = request.url()
    if (
      collectorSignals.test(url) ||
      url.startsWith(`${origin}/`) ||
      /^(data|blob):/.test(url)
    )
      return
    errors.push(`unexpected request: ${url}`)
  })
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error')
      errors.push(`console: ${message.text()} @ ${message.location().url}`)
  })
  const caseId = 'CH-tree7-traced'
  try {
    const treeUrl = `${origin}/tree/?mode=traced&case=${encodeURIComponent(caseId)}&run=${encodeURIComponent(runId)}&atoms=true`
    const preview = await fetch(treeUrl, { signal: AbortSignal.timeout(5_000) })
    assert(preview.ok, `tree fixture HTTP ${preview.status}`)
    await page.goto(treeUrl, { waitUntil: 'domcontentloaded' })
    try {
      await page.waitForFunction(() => window.collectorTest?.ready === true)
    } catch (error) {
      const html = await page.content()
      throw new Error(
        `tree fixture did not become ready: ${error}\n${errors.join('\n')}\n${html.slice(0, 2000)}`,
      )
    }
    const boxes = page.locator('main input[type="checkbox"]')
    assert.equal(await boxes.count(), 16, 'default tree must start with 16 nodes')
    await page.locator('input[type="number"]').fill('7')
    await page.getByRole('button', { name: 'Build', exact: true }).click()
    await page.waitForFunction(
      () => document.querySelectorAll('main input[type="checkbox"]').length === 7,
    )
    await boxes.first().click()
    await page.waitForFunction(
      () => !document.querySelector('main input[type="checkbox"]')?.checked,
    )
    const stats = await page.evaluate(() => window.collectorTest.flush())
    await Promise.all(pending)
    assert.equal(stats?.dropped, 0, 'loss-free case dropped')
    assert.equal(stats?.queued, 0, 'queued records must settle after flush')
    assert(wire.traces.length > 0, 'missing native traces POST')
    assert(wire.logs.length > 0, 'missing native logs POST')
    assert.deepEqual(errors, [], `unexpected browser diagnostics: ${errors.join('\n')}`)
    return { caseId, stats, wire, errors }
  } finally {
    await page.evaluate(() => window.collectorTest?.dispose()).catch(() => {})
    await context.close()
  }
}

const execute = async () => {
  await mkdir(artifacts, { recursive: true })
  const manifest = await verifyBuild()
  const runId = process.env.COLLECTOR_RUN_ID ?? randomBytes(12).toString('hex')
  await poll(
    async () => (await fetch('http://collector:13133/')).ok,
    'Collector health',
  )
  await poll(async () => {
    const response = await fetch(`${clickhouseUrl}/ping`, {
      signal: AbortSignal.timeout(1000),
    })
    return response.ok
  }, 'ClickHouse ping')
  const server = await serve(4173)
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox'],
    })
    const scenario = await runTree({
      browser,
      origin: 'http://runner:4173',
      runId,
    })
    await browser.close()
    browser = undefined
    await json(join(artifacts, 'clickhouse-run.json'), {
      runId,
      manifest,
      scenario: {
        caseId: scenario.caseId,
        stats: scenario.stats,
        tracesPosts: scenario.wire.traces.length,
        logsPosts: scenario.wire.logs.length,
      },
    })
    console.log(
      JSON.stringify({
        phase: 'run',
        traces: scenario.wire.traces.length,
        logs: scenario.wire.logs.length,
      }),
    )
  } finally {
    await browser?.close()
    await new Promise((resolve) => {
      server.closeAllConnections()
      server.close(resolve)
    })
  }
}

try {
  if (process.argv[2] === 'run') await execute()
  else if (process.argv[2] === 'query') {
    const result = await queryClickhouse()
    await mkdir(artifacts, { recursive: true })
    await json(join(artifacts, 'clickhouse-query.json'), result)
    console.log(
      JSON.stringify({
        phase: 'query',
        runId: result.runId,
        spans: result.spans.rows,
        logs: result.logs.rows,
        causes: result.causes.rows,
        causeJoins: result.causeJoins.rows ?? result.joined.length,
      }),
    )
  } else throw new Error('Usage: clickhouse-runner.mjs run|query')
} catch (error) {
  await mkdir(artifacts, { recursive: true })
  await json(join(artifacts, `failure-${process.argv[2] ?? 'unknown'}.json`), {
    error: String(error),
    stack: error.stack,
  })
  throw error
}
