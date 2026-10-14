import {
  abortVar,
  action,
  atom,
  isAbort,
  withAbort,
  withAsync,
  wrap,
} from '@reatom/core'

import { activeChat } from '../chat/chatModel'
import {
  mcpCorsSentence,
  mcpEmptyToolsSentence,
  mcpPortSentence,
  mcpTimeoutSentence,
  mcpUnreachableSentence,
} from '../errors/copy'
import { mcpServers } from '../storage/prefs'
import { listMcpTools, type McpListedInputSchema } from './client'
import {
  defaultServerDisplayName,
  humanToolName,
  serverDisplayName,
} from './names'
import {
  copyForMcpUrlProblem,
  inspectMcpUrl,
  isLoopbackFailedFetch,
  isWrongFusionPort,
  mcpServerId,
} from './url'

export { mcpServers }
export {
  defaultServerDisplayName,
  humanToolName,
  serverDisplayName,
} from './names'
export {
  exampleMcpPort,
  exampleMcpUrl,
  fusionMcpPort,
  fusionMcpUrl,
  fusionServerId,
  inspectMcpUrl,
  isMcpUrlFieldError,
  mcpServerId,
  mcpUrlMaxLength,
  rewriteMcpLoopbackUrl,
} from './url'

export type McpTool = {
  name: string
  humanName: string
  description?: string
  inputSchema?: McpListedInputSchema
}

export const mcpConnectTimeoutMs = 4000

export const mcpUrlDraft = atom('', 'mcp.urlDraft')
export const mcpError = atom<string | null>(null, 'mcp.error')
export const mcpReady = atom(false, 'mcp.ready')
export const mcpTools = atom<McpTool[]>([], 'mcp.tools')

const timedOut = (error: unknown, timed: AbortSignal) => {
  if (timed.aborted) return true
  if (isAbort(error)) return true
  return error instanceof Error && error.name === 'TimeoutError'
}

const rememberServer = (url: string, name = defaultServerDisplayName) => {
  mcpServers.set([
    {
      id: mcpServerId,
      url,
      name,
    },
  ])
}

const failConnect = (message: string) => {
  mcpReady.set(false)
  mcpError.set(message)
  activeChat().updateSettings({ mcpEnabled: false })
}

export const connectMcp = action(async (typedUrl?: string) => {
  const parent = abortVar.require().signal
  const typed = (typedUrl ?? mcpUrlDraft()).trim()
  mcpUrlDraft.set(typed)
  const inspected = inspectMcpUrl(typed)
  if (!inspected.ok) {
    failConnect(copyForMcpUrlProblem(inspected.problem))
    return
  }
  const url = inspected.url
  mcpUrlDraft.set(url)
  mcpError.set(null)
  rememberServer(url)

  const timed = AbortSignal.timeout(mcpConnectTimeoutMs)
  const signal = AbortSignal.any([parent, timed])
  try {
    const listed = await wrap(listMcpTools(url, signal))
    if (parent.aborted) return
    if (listed.tools.length === 0) {
      mcpTools.set([])
      failConnect(mcpEmptyToolsSentence)
      return
    }
    rememberServer(url, serverDisplayName(listed.serverName))
    mcpTools.set(
      listed.tools.map((tool) => {
        const mapped: McpTool = {
          name: tool.name,
          humanName: humanToolName(tool.name),
        }
        if (tool.description) mapped.description = tool.description
        if (tool.inputSchema) mapped.inputSchema = tool.inputSchema
        return mapped
      }),
    )
    mcpReady.set(true)
    mcpError.set(null)
  } catch (error) {
    if (parent.aborted && !timed.aborted) throw error
    failConnect(
      isWrongFusionPort(url)
        ? mcpPortSentence
        : timedOut(error, timed)
          ? mcpTimeoutSentence
          : isLoopbackFailedFetch(url, error)
            ? mcpCorsSentence
            : mcpUnreachableSentence,
    )
  }
}, 'mcp.connect').extend(withAsync(), withAbort())

export const removeMcpServer = action(() => {
  mcpServers.set([])
  mcpTools.set([])
  mcpReady.set(false)
  mcpError.set(null)
  mcpUrlDraft.set('')
  activeChat().updateSettings({ mcpEnabled: false })
}, 'mcp.remove')
