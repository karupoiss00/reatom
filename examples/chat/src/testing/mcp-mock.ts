import {
  fusionMcpPort,
  fusionMcpTools,
  fusionServerName,
  fusionToolNames,
  type FusionMcpToolName,
} from './fixtures/mcp'
import { interceptExternalFetch } from './openrouter-mock'

export type McpJsonRpcId = string | number | null

export type CapturedMcpRequest = {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export type FusionDocument = {
  open: boolean
  title: string
  cubeMm: number | null
  params: Record<string, number>
  lastExport: string | null
}

type JsonRpcRequest = {
  jsonrpc?: string
  id?: McpJsonRpcId
  method?: string
  params?: unknown
}

type McpBehavior = {
  cors: boolean
  offline: boolean
  emptyTools: boolean
  hangInitialize: boolean
  htmlError: boolean
  rpcError: string | null
  quitMidTool: boolean
  delayCallMs: number
  listenPort: number
}

const failedFetch = () => new TypeError('Failed to fetch')

const abortError = () =>
  new DOMException('The operation was aborted.', 'AbortError')

const defaultDocument = (): FusionDocument => ({
  open: true,
  title: 'Untitled',
  cubeMm: null,
  params: {},
  lastExport: null,
})

const defaultBehavior = (): McpBehavior => ({
  cors: false,
  offline: false,
  emptyTools: false,
  hangInitialize: false,
  htmlError: false,
  rpcError: null,
  quitMidTool: false,
  delayCallMs: 0,
  listenPort: fusionMcpPort,
})

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'content-type, accept, mcp-session-id, mcp-protocol-version',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
}

let installed = false
let sessionId = 'fusion-session-1'
let captures: CapturedMcpRequest[] = []
let executeCalls: unknown[] = []
let documentState = defaultDocument()
let behavior = defaultBehavior()

const headerRecord = (headers: Headers): Record<string, string> => {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    record[key] = value
  })
  return record
}

export const isFusionMcpUrl = (url: URL) => {
  if (url.protocol !== 'http:') return false
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return false
  return url.pathname === '/mcp' || url.pathname === '/mcp/'
}

const portOf = (url: URL) => {
  if (url.port) return Number(url.port)
  return url.protocol === 'https:' ? 443 : 80
}

const wait = (delayMs: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', fail)
      if (signal.aborted) reject(abortError())
      else resolve()
    }, delayMs)
    const fail = () => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', fail, { once: true })
  })

const hangUntilAbort = (signal: AbortSignal) =>
  new Promise<Response>((_, reject) => {
    if (signal.aborted) {
      reject(abortError())
      return
    }
    signal.addEventListener('abort', () => reject(abortError()), { once: true })
  })

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'mcp-session-id': sessionId,
      ...corsHeaders,
    },
  })

const readBody = async (request: Request): Promise<unknown> => {
  const text = await request.clone().text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

const toolList = () => {
  if (behavior.emptyTools) return []
  return fusionMcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}

const scriptFromArgs = (args: Record<string, unknown>) => {
  const code = args.code
  if (typeof code === 'string') return code
  const script = args.script
  return typeof script === 'string' ? script : ''
}

const applyExecute = (args: Record<string, unknown>) => {
  executeCalls.push(args)
  if (!documentState.open) {
    return {
      content: [
        {
          type: 'text',
          text: 'Open a design in Fusion before running execute.',
        },
      ],
      isError: true,
    }
  }
  const script = scriptFromArgs(args)
  const cubeMatch = script.match(/cube\s*\(\s*(\d+(?:\.\d+)?)/i)
  if (cubeMatch) {
    documentState = {
      ...documentState,
      cubeMm: Number(cubeMatch[1]),
    }
    return {
      content: [
        {
          type: 'text',
          text: `Created a ${documentState.cubeMm} mm cube in ${documentState.title}.`,
        },
      ],
    }
  }
  if (/export|\.step/i.test(script)) {
    const location = '/Users/maya/Desktop/design.step'
    documentState = { ...documentState, lastExport: location }
    return {
      content: [{ type: 'text', text: `Exported STEP to ${location}.` }],
    }
  }
  return {
    content: [{ type: 'text', text: 'Fusion execute finished.' }],
  }
}

const applyUpdate = (args: Record<string, unknown>) => {
  if (!documentState.open) {
    return {
      content: [
        {
          type: 'text',
          text: 'Open a design in Fusion before updating a parameter.',
        },
      ],
      isError: true,
    }
  }
  const name = typeof args.name === 'string' ? args.name : ''
  const raw =
    typeof args.value === 'string' ? args.value : String(args.value ?? '')
  const amount = Number.parseFloat(raw)
  if (!name || Number.isNaN(amount)) {
    return {
      content: [
        { type: 'text', text: 'Need a parameter name and numeric value.' },
      ],
      isError: true,
    }
  }
  documentState = {
    ...documentState,
    params: { ...documentState.params, [name]: amount },
  }
  return {
    content: [{ type: 'text', text: `Set ${name} to ${amount} mm.` }],
  }
}

const applyRead = () => ({
  content: [
    {
      type: 'text',
      text: JSON.stringify({
        server: fusionServerName,
        document: documentState,
      }),
    },
  ],
})

const callTool = async (params: unknown, signal: AbortSignal) => {
  const record = asRecord(params)
  const name = String(record.name ?? '') as FusionMcpToolName
  const args = asRecord(record.arguments)
  if (behavior.delayCallMs > 0) await wait(behavior.delayCallMs, signal)
  if (behavior.quitMidTool) {
    behavior.quitMidTool = false
    behavior.offline = true
    throw failedFetch()
  }
  if (name === fusionToolNames.execute) return applyExecute(args)
  if (name === fusionToolNames.update) return applyUpdate(args)
  if (name === fusionToolNames.read) return applyRead()
  return {
    content: [{ type: 'text', text: `Unknown Fusion tool ${name}.` }],
    isError: true,
  }
}

const fulfillRpc = async (
  message: JsonRpcRequest,
  signal: AbortSignal,
): Promise<unknown> => {
  const id = message.id ?? null
  if (message.method === 'initialize') {
    if (behavior.rpcError) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32000, message: behavior.rpcError },
      }
    }
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'MCP Server', version: 'mock' },
      },
    }
  }
  if (
    message.method === 'tools/list' ||
    message.method === 'tools/listChanged'
  ) {
    return { jsonrpc: '2.0', id, result: { tools: toolList() } }
  }
  if (message.method === 'tools/call') {
    const result = await callTool(message.params, signal)
    return { jsonrpc: '2.0', id, result }
  }
  if (message.method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }
  if (message.id === undefined) return undefined
  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not found: ${message.method}` },
  }
}

const guardReachable = (url: URL) => {
  if (behavior.cors || behavior.offline) throw failedFetch()
  if (portOf(url) !== behavior.listenPort) throw failedFetch()
}

const tryMcpFetch = async (request: Request): Promise<Response | null> => {
  const url = new URL(request.url)
  if (!isFusionMcpUrl(url)) return null
  const body = await readBody(request)
  captures.push({
    url: request.url,
    method: request.method,
    headers: headerRecord(request.headers),
    body,
  })
  if (behavior.hangInitialize) return hangUntilAbort(request.signal)
  guardReachable(url)
  if (behavior.htmlError) {
    return new Response(
      '<!doctype html><html><body>Bad Gateway</body></html>',
      {
        status: 502,
        headers: { 'content-type': 'text/html' },
      },
    )
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method === 'DELETE') {
    sessionId = `fusion-session-${captures.length + 1}`
    return new Response(null, { status: 204, headers: corsHeaders })
  }
  if (request.method === 'GET') {
    return jsonResponse({ ok: true, server: fusionServerName })
  }
  if (Array.isArray(body)) {
    const replies = []
    for (const entry of body) {
      const reply = await fulfillRpc(
        asRecord(entry) as JsonRpcRequest,
        request.signal,
      )
      if (reply !== undefined) replies.push(reply)
    }
    return jsonResponse(replies)
  }
  const message = asRecord(body) as JsonRpcRequest
  if (
    message.method === 'notifications/initialized' ||
    message.id === undefined
  ) {
    if (message.method === 'initialize') {
      const reply = await fulfillRpc(message, request.signal)
      return jsonResponse(reply)
    }
    return new Response(null, { status: 202, headers: corsHeaders })
  }
  const reply = await fulfillRpc(message, request.signal)
  if (reply instanceof Response) return reply
  return jsonResponse(reply)
}

export const installMcpMock = () => {
  interceptExternalFetch(tryMcpFetch)
  installed = true
}

export const resetMcpMock = () => {
  captures = []
  executeCalls = []
  documentState = defaultDocument()
  behavior = defaultBehavior()
  sessionId = 'fusion-session-1'
  if (installed) interceptExternalFetch(tryMcpFetch)
}

export const simulateMcpCorsFail = () => {
  behavior = { ...behavior, cors: true }
}

export const simulateMcpWrongPort = (port = 27183) => {
  behavior = {
    ...behavior,
    cors: false,
    offline: false,
    hangInitialize: false,
    listenPort: port === fusionMcpPort ? port + 1 : fusionMcpPort,
  }
}

export const simulateMcpQuit = () => {
  behavior = { ...behavior, offline: true }
}

export const simulateMcpEmptyTools = () => {
  behavior = { ...behavior, emptyTools: true }
}

export const simulateMcpQuitMidTool = () => {
  behavior = { ...behavior, quitMidTool: true, delayCallMs: 40 }
}

export const simulateMcpHangConnect = () => {
  behavior = { ...behavior, hangInitialize: true, cors: false, offline: false }
}

export const simulateMcpHtmlFail = () => {
  behavior = { ...behavior, htmlError: true, cors: false, offline: false }
}

export const simulateMcpRpcError = (
  message = 'json-rpc internal: stack dump',
) => {
  behavior = { ...behavior, rpcError: message, cors: false, offline: false }
}

export const simulateMcpCallDelay = (delayMs: number) => {
  behavior = { ...behavior, delayCallMs: delayMs }
}

export const setMcpDocumentOpen = (open: boolean) => {
  documentState = { ...documentState, open, title: open ? 'Untitled' : '' }
}

export const fusionDocument = (): FusionDocument => ({
  ...documentState,
  params: { ...documentState.params },
})

export const mcpRequests = (): readonly CapturedMcpRequest[] => captures

export const mcpExecuteCalls = (): readonly unknown[] => executeCalls

export const mcpMethods = (): readonly string[] =>
  captures.flatMap((entry) => {
    if (Array.isArray(entry.body)) {
      return entry.body.flatMap((item) => {
        const method = asRecord(item).method
        return typeof method === 'string' ? [method] : []
      })
    }
    const method = asRecord(entry.body).method
    return typeof method === 'string' ? [method] : []
  })
