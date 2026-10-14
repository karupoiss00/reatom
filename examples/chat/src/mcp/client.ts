import { wrap } from '@reatom/core'

export type McpListedInputSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type McpListedTool = {
  name: string
  description?: string
  inputSchema?: McpListedInputSchema
}

export type McpListResult = {
  serverName?: string
  tools: McpListedTool[]
}

type JsonRpcId = string | number

type JsonRpcResponse = {
  result?: {
    serverInfo?: { name?: string }
    tools?: unknown
  }
  error?: { message?: string }
}

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

const listedInputSchema = (value: unknown): McpListedInputSchema | undefined => {
  const record = asRecord(value)
  if (!record) return undefined
  const properties = asRecord(record.properties) ?? {}
  const required = Array.isArray(record.required)
    ? record.required.filter((item): item is string => typeof item === 'string')
    : undefined
  const schema: McpListedInputSchema = {
    ...record,
    type: 'object',
    properties,
  }
  if (required && required.length > 0) schema.required = required
  else delete schema.required
  return schema
}

const listedTools = (value: unknown): McpListedTool[] => {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    const record = asRecord(entry)
    if (!record) return []
    const name = record.name
    if (typeof name !== 'string' || name.length === 0) return []
    const description = record.description
    const tool: McpListedTool = { name }
    if (typeof description === 'string') tool.description = description
    const inputSchema = listedInputSchema(record.inputSchema)
    if (inputSchema) tool.inputSchema = inputSchema
    return [tool]
  })
}

const parseSsePayload = (text: string) => {
  const blocks = text.split('\n\n')
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const data = blocks[index]
      ?.split('\n')
      .flatMap((line) =>
        line.startsWith('data:') ? [line.slice(5).trim()] : [],
      )
      .join('\n')
    if (!data) continue
    try {
      return JSON.parse(data) as JsonRpcResponse
    } catch {
      continue
    }
  }
  return null
}

const mcpUnreachable = () => new Error('mcp-unreachable')

const readRpc = async (response: Response): Promise<JsonRpcResponse | null> => {
  const type = response.headers.get('content-type') ?? ''
  if (response.status === 202) return null
  const text = await wrap(response.text())
  if (!text) return null
  if (type.includes('text/event-stream')) return parseSsePayload(text)
  try {
    return JSON.parse(text) as JsonRpcResponse
  } catch {
    return null
  }
}

export const listMcpTools = async (
  url: string,
  signal: AbortSignal,
): Promise<McpListResult> => {
  let sessionId: string | null = null
  let nextId = 1

  const rpc = async (method: string, params?: object) => {
    const id: JsonRpcId = nextId
    nextId += 1
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-03-26',
    }
    if (sessionId) headers['mcp-session-id'] = sessionId
    const response = await wrap(
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method,
          params,
        }),
        signal,
      }),
    )
    const headerSession = response.headers.get('mcp-session-id')
    if (headerSession) sessionId = headerSession
    if (!response.ok) throw mcpUnreachable()
    const payload = await readRpc(response)
    if (payload?.error || !payload) throw mcpUnreachable()
    return payload.result
  }

  const notify = async () => {
    const headers: Record<string, string> = {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-03-26',
    }
    if (sessionId) headers['mcp-session-id'] = sessionId
    await wrap(
      fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'notifications/initialized',
        }),
        signal,
      }),
    )
  }

  const initialized = await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Atelier', version: '0.0.0' },
  })
  await notify()
  const listed = await rpc('tools/list', {})
  return {
    serverName: initialized?.serverInfo?.name,
    tools: listedTools(listed?.tools),
  }
}
