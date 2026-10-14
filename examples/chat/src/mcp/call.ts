import { isAbort, wrap } from '@reatom/core'

import { mcpServers } from '../storage/prefs'
import { exampleMcpUrl } from './url'

export const mcpCallTimeoutMs = 30_000

export const mcpCallStoppedCopy =
  'The MCP server stopped. Reconnect and check the server is running.'

type JsonRpcId = string | number

type JsonRpcResponse = {
  result?: {
    content?: unknown
    isError?: boolean
  }
  error?: { message?: string }
}

const asRecord = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null

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

const mcpUnreachable = () => new Error(mcpCallStoppedCopy)

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

const imageDataUrl = (record: Record<string, unknown>) => {
  const mime =
    typeof record.mimeType === 'string'
      ? record.mimeType
      : typeof record.mime === 'string'
        ? record.mime
        : ''
  const data =
    typeof record.data === 'string'
      ? record.data
      : typeof record.blob === 'string'
        ? record.blob
        : ''
  if (data.length === 0) return null
  if (data.startsWith('data:')) return data
  if (mime.startsWith('image/') || record.type === 'image') {
    return `data:${mime || 'image/png'};base64,${data}`
  }
  return null
}

const contentFromResult = (result: JsonRpcResponse['result']) => {
  const content = result?.content
  if (!Array.isArray(content)) {
    return {
      text: result ? JSON.stringify(result) : mcpCallStoppedCopy,
      images: [] as string[],
    }
  }
  const texts: string[] = []
  const images: string[] = []
  for (const entry of content) {
    const record = asRecord(entry)
    if (!record) continue
    if (typeof record.text === 'string' && record.text.length > 0) {
      texts.push(record.text)
    }
    const image = imageDataUrl(record)
    if (image) images.push(image)
  }
  return {
    text:
      texts.length > 0
        ? texts.join('\n')
        : result?.isError
          ? mcpCallStoppedCopy
          : 'The tool finished.',
    images,
  }
}

const parseArguments = (raw: string): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(raw) as unknown
    const record = asRecord(parsed)
    return record ?? { value: parsed }
  } catch {
    return { code: raw }
  }
}

export const mcpCallUrl = () => mcpServers()[0]?.url ?? exampleMcpUrl

export type McpToolCallResult = {
  text: string
  images: string[]
  isError: boolean
}

export const callMcpTool = async (
  name: string,
  rawArguments: string,
  signal: AbortSignal,
): Promise<McpToolCallResult> => {
  const url = mcpCallUrl()
  const timed = AbortSignal.timeout(mcpCallTimeoutMs)
  const combined = AbortSignal.any([signal, timed])
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
    let response: Response
    try {
      response = await wrap(
        fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method,
            params,
          }),
          signal: combined,
        }),
      )
    } catch (error) {
      if (isAbort(error) || signal.aborted || combined.aborted) {
        throw isAbort(error)
          ? error
          : new DOMException('The operation was aborted.', 'AbortError')
      }
      throw mcpUnreachable()
    }
    const headerSession = response.headers.get('mcp-session-id')
    if (headerSession) sessionId = headerSession
    if (!response.ok) throw mcpUnreachable()
    const payload = await readRpc(response)
    if (!payload || payload.error) throw mcpUnreachable()
    return payload.result
  }

  await rpc('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'Atelier', version: '0.0.0' },
  })
  const result = await rpc('tools/call', {
    name,
    arguments: parseArguments(rawArguments),
  })
  const content = contentFromResult(result)
  return {
    text: content.text,
    images: content.images,
    isError: result?.isError === true,
  }
}
