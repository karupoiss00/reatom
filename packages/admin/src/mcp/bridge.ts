export const ADMIN_MCP_TOOL_NAMES = [
  'summary',
  'listTraces',
  'getTrace',
  'search',
  'analyticsSummary',
  'paths',
  'getRecord',
  'getState',
  'clear',
  'connectRemote',
] as const

export type AdminMcpToolName = (typeof ADMIN_MCP_TOOL_NAMES)[number]

export interface AdminMcpBridge {
  snippet: string
  configPath?: string
}

let registeredBridge: AdminMcpBridge | null = null

export function registerMcpBridge(bridge: AdminMcpBridge): () => void {
  registeredBridge = bridge
  return () => {
    if (registeredBridge === bridge) registeredBridge = null
  }
}

export function registeredMcpBridge(): AdminMcpBridge | null {
  return registeredBridge
}

export const IN_PROCESS_MCP_SNIPPET = `import { reatomOtlpMcp } from '@reatom/admin'

const mcp = reatomOtlpMcp(admin)
const summary = mcp.summary()`
