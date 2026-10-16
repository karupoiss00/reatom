import { wrap } from '@reatom/core'

import { ADMIN_FRAME } from '../root'
import type { OtlpAdmin } from '../otlp/chrome.ts'
import {
  mcpCallLog,
  recordIdsFromResult,
  redactMcpArgs,
} from './callLog.ts'
import {
  analyticsSummaryTool,
  clearTool,
  connectRemoteTool,
  getRecordTool,
  getStateTool,
  getTraceTool,
  listTracesTool,
  pathsTool,
  searchTool,
  summaryTool,
} from './tools.ts'
import type {
  AdminMcpAnalyticsSummaryInput,
  AdminMcpConnectRemoteInput,
  AdminMcpFilter,
  AdminMcpGetRecordInput,
  AdminMcpGetStateInput,
  AdminMcpGetTraceInput,
  AdminMcpListTracesInput,
  AdminMcpMiss,
  AdminMcpOk,
  AdminMcpPathsInput,
  AdminMcpSearchInput,
} from './types.ts'

export { ADMIN_MCP_MAX_BYTES } from './types.ts'
export { ADMIN_MCP_TOOL_NAMES, registerMcpBridge, registeredMcpBridge } from './bridge.ts'
export type { AdminMcpBridge, AdminMcpToolName } from './bridge.ts'
export {
  ADMIN_MCP_CALL_LOG_LIMIT,
  mcpCallLog,
  mcpFilterToCalculatorDraft,
  resetMcpCallLog,
} from './callLog.ts'
export type { AdminMcpCallEntry, AdminMcpCallLog } from './callLog.ts'
export type {
  AdminMcpAnalyticsSummaryData,
  AdminMcpAnalyticsSummaryInput,
  AdminMcpAnalyticsTotals,
  AdminMcpBreakdownRow,
  AdminMcpCause,
  AdminMcpConnectRemoteInput,
  AdminMcpErrorGroup,
  AdminMcpFilter,
  AdminMcpGetRecordInput,
  AdminMcpGetStateInput,
  AdminMcpGetTraceInput,
  AdminMcpHeader,
  AdminMcpListTracesInput,
  AdminMcpMiss,
  AdminMcpOk,
  AdminMcpPathNode,
  AdminMcpPathsData,
  AdminMcpPathsInput,
  AdminMcpRecordData,
  AdminMcpRecordSummary,
  AdminMcpResult,
  AdminMcpSearchInput,
  AdminMcpStateData,
  AdminMcpStateNode,
  AdminMcpSummaryData,
  AdminMcpTraceData,
  AdminMcpTraceNode,
  AdminMcpTraceRow,
  AdminMcpTruncatedValue,
} from './types.ts'

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function logCall<T extends AdminMcpOk<unknown> | AdminMcpMiss>(
  tool: string,
  args: unknown,
  started: number,
  result: T,
  filter?: AdminMcpFilter,
): T {
  const headline = result.headline
  mcpCallLog().push({
    tool,
    args: redactMcpArgs(tool, args),
    ms: Math.max(0, Math.round(nowMs() - started)),
    headline,
    ok: result.ok,
    recordIds: recordIdsFromResult(tool, result),
    ...(filter !== undefined ? { filter } : {}),
  })
  return result
}

function runLogged<T extends AdminMcpOk<unknown> | AdminMcpMiss>(
  tool: string,
  args: unknown,
  read: () => T,
  filter?: AdminMcpFilter,
): T {
  return ADMIN_FRAME.run(() => {
    const started = nowMs()
    const result = read()
    return logCall(tool, args, started, result, filter)
  })
}

function runLoggedAsync<T extends AdminMcpOk<unknown> | AdminMcpMiss>(
  tool: string,
  args: unknown,
  read: () => Promise<T>,
): Promise<T> {
  return ADMIN_FRAME.run(() => {
    const started = nowMs()
    return wrap(read()).then((result) => logCall(tool, args, started, result))
  })
}

/**
 * Typed admin tools over an OTLP chrome model. An agent calls these functions
 * against `OtlpAdmin`; this is not a WebMCP registry and does not add
 * `withMCP`. Each JSON body is capped at 20 KB. `header.truncated` means more
 * pages exist; `header.valuesTruncated` means a shrink step ran.
 */
export function reatomOtlpMcp(admin: OtlpAdmin) {
  return {
    summary: () => runLogged('summary', {}, () => summaryTool(admin)),
    listTraces: (input: AdminMcpListTracesInput = {}) =>
      runLogged('listTraces', input, () => listTracesTool(admin, input), input.filter),
    getTrace: (input: AdminMcpGetTraceInput = {}) =>
      runLogged('getTrace', input, () => getTraceTool(admin, input)),
    search: (input: AdminMcpSearchInput = {}) =>
      runLogged('search', input, () => searchTool(admin, input), input.filter),
    analyticsSummary: (input: AdminMcpAnalyticsSummaryInput = {}) =>
      runLogged(
        'analyticsSummary',
        input,
        () => analyticsSummaryTool(admin, input),
        input.filter,
      ),
    paths: (input: AdminMcpPathsInput = {}) =>
      runLogged('paths', input, () => pathsTool(admin, input), input.filter),
    getRecord: (input: AdminMcpGetRecordInput = {}) =>
      runLogged('getRecord', input, () => getRecordTool(admin, input)),
    getState: (input: AdminMcpGetStateInput = {}) =>
      runLogged('getState', input, () => getStateTool(admin, input)),
    clear: () => runLogged('clear', {}, () => clearTool(admin)),
    connectRemote: (input: AdminMcpConnectRemoteInput = {}) =>
      runLoggedAsync('connectRemote', input, () => connectRemoteTool(admin, input)),
  }
}

export type OtlpMcp = ReturnType<typeof reatomOtlpMcp>
