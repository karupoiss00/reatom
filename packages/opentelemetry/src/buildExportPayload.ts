import type { OtlpSpan } from './buildSpan.ts'
import type { OtlpAttrValue } from './toOtlpValue.ts'
import { toOtlpAttributes } from './toOtlpValue.ts'

const INSTRUMENTATION_SCOPE_NAME = '@reatom/opentelemetry'

export const buildResource = (attributes: Record<string, OtlpAttrValue>) => ({
  attributes: toOtlpAttributes(attributes),
})

const buildInstrumentationScope = (version: string) => ({
  name: INSTRUMENTATION_SCOPE_NAME,
  version,
})

export interface ExportPayloadInput {
  groups: {
    resourceAttributes: Record<string, OtlpAttrValue>
    version: string
    spans: OtlpSpan[]
  }[]
}

export interface LogsPayloadInput<T = unknown> {
  groups: {
    resourceAttributes: Record<string, OtlpAttrValue>
    version: string
    logs: T[]
  }[]
}

export const buildExportPayload = (input: ExportPayloadInput) => ({
  resourceSpans: input.groups.map((group) => ({
    resource: buildResource(group.resourceAttributes),
    scopeSpans: [
      {
        scope: buildInstrumentationScope(group.version),
        // Own the array: a later clear of the caller's batch must not rewrite
        // a payload already handed to retry.
        spans: [...group.spans],
      },
    ],
  })),
})

export const buildLogsPayload = <T>(input: LogsPayloadInput<T>) => ({
  resourceLogs: input.groups.map((group) => ({
    resource: buildResource(group.resourceAttributes),
    scopeLogs: [
      {
        scope: buildInstrumentationScope(group.version),
        logRecords: [...group.logs],
      },
    ],
  })),
})
