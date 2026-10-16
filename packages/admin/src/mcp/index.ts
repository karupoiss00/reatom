import { ADMIN_FRAME } from '../root'
import type { OtlpAdmin } from '../otlp/chrome.ts'
import {
  clearTool,
  connectRemoteTool,
  getRecordTool,
  getStateTool,
  getTraceTool,
  listTracesTool,
  searchTool,
  summaryTool,
} from './tools.ts'
import type {
  AdminMcpConnectRemoteInput,
  AdminMcpGetRecordInput,
  AdminMcpGetStateInput,
  AdminMcpGetTraceInput,
  AdminMcpListTracesInput,
  AdminMcpSearchInput,
} from './types.ts'

export { ADMIN_MCP_MAX_BYTES } from './types.ts'
export type {
  AdminMcpCause,
  AdminMcpConnectRemoteInput,
  AdminMcpFilter,
  AdminMcpGetRecordInput,
  AdminMcpGetStateInput,
  AdminMcpGetTraceInput,
  AdminMcpHeader,
  AdminMcpListTracesInput,
  AdminMcpMiss,
  AdminMcpOk,
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

/**
 * Typed admin tools over an OTLP chrome model. An agent calls these functions
 * against `OtlpAdmin`; this is not a WebMCP registry and does not add `withMCP`.
 * Each JSON body is capped at 20 KB. `header.truncated` means more pages exist;
 * `header.valuesTruncated` means a shrink step ran.
 */
export function reatomOtlpMcp(admin: OtlpAdmin) {
  const run = <T>(read: () => T): T => ADMIN_FRAME.run(read)

  return {
    summary: () => run(() => summaryTool(admin)),
    listTraces: (input: AdminMcpListTracesInput = {}) =>
      run(() => listTracesTool(admin, input)),
    getTrace: (input: AdminMcpGetTraceInput = {}) =>
      run(() => getTraceTool(admin, input)),
    search: (input: AdminMcpSearchInput = {}) =>
      run(() => searchTool(admin, input)),
    getRecord: (input: AdminMcpGetRecordInput = {}) =>
      run(() => getRecordTool(admin, input)),
    getState: (input: AdminMcpGetStateInput = {}) =>
      run(() => getStateTool(admin, input)),
    clear: () => run(() => clearTool(admin)),
    connectRemote: (input: AdminMcpConnectRemoteInput = {}) =>
      run(() => connectRemoteTool(admin, input)),
  }
}

export type OtlpMcp = ReturnType<typeof reatomOtlpMcp>
