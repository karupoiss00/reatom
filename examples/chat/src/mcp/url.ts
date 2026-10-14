import {
  mcpInvalidUrlSentence,
  mcpRequiredUrlSentence,
  mcpSchemeSentence,
  mcpUrlTooLongSentence,
} from '../errors/copy'
import { rewriteMcpLoopbackUrl } from '../storage/prefs'

export { rewriteMcpLoopbackUrl }

export const exampleMcpPort = 27182
export const exampleMcpUrl = `http://127.0.0.1:${exampleMcpPort}/mcp`
export const mcpServerId = 'mcp'
export const mcpUrlMaxLength = 2048

export const fusionMcpPort = exampleMcpPort
export const fusionMcpUrl = exampleMcpUrl
export const fusionServerId = mcpServerId

export type McpUrlProblem = 'required' | 'invalid' | 'scheme' | 'too-long'

export const mcpUrlProblemCopy: Record<McpUrlProblem, string> = {
  required: mcpRequiredUrlSentence,
  invalid: mcpInvalidUrlSentence,
  scheme: mcpSchemeSentence,
  'too-long': mcpUrlTooLongSentence,
}

export const copyForMcpUrlProblem = (problem: McpUrlProblem) =>
  mcpUrlProblemCopy[problem]

export const isMcpUrlFieldError = (message: string) =>
  (Object.values(mcpUrlProblemCopy) as string[]).includes(message)

export const parseMcpUrl = (value: string) => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const portOf = (parsed: URL) => {
  if (parsed.port) return Number(parsed.port)
  return parsed.protocol === 'https:' ? 443 : 80
}

export const isLoopbackHost = (hostname: string) =>
  hostname === '127.0.0.1' || hostname === 'localhost'

export const isWrongFusionPort = (url: string) => {
  const parsed = parseMcpUrl(url)
  if (!parsed || !isLoopbackHost(parsed.hostname)) return false
  return portOf(parsed) !== exampleMcpPort
}

export const isLoopbackFailedFetch = (url: string, error: unknown) => {
  if (!(error instanceof TypeError)) return false
  if (!/failed to fetch/i.test(error.message)) return false
  const parsed = parseMcpUrl(url)
  return Boolean(parsed && isLoopbackHost(parsed.hostname))
}

export const inspectMcpUrl = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return { ok: false as const, problem: 'required' as const }
  if (trimmed.length > mcpUrlMaxLength) {
    return { ok: false as const, problem: 'too-long' as const }
  }
  const parsed = parseMcpUrl(trimmed)
  if (!parsed) return { ok: false as const, problem: 'invalid' as const }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false as const, problem: 'scheme' as const }
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false as const, problem: 'invalid' as const }
  }
  return { ok: true as const, url: rewriteMcpLoopbackUrl(parsed.href) }
}
