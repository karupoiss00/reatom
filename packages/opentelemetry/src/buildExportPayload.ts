import type { OtlpSpan } from './buildSpan.ts'
import type { OtlpAttrValue } from './toOtlpValue.ts'
import { toOtlpAttributes } from './toOtlpValue.ts'

export const buildResource = (attributes: Record<string, OtlpAttrValue>) => ({
  attributes: toOtlpAttributes(attributes),
})

export interface ExportPayloadInput {
  groups: {
    resourceAttributes: Record<string, OtlpAttrValue>
    version: string
    spans: OtlpSpan[]
  }[]
}

export const buildExportPayload = (input: ExportPayloadInput) => ({
  resourceSpans: input.groups.map((group) => ({
    resource: buildResource(group.resourceAttributes),
    scopeSpans: [
      {
        scope: { name: '@reatom/opentelemetry', version: group.version },
        // Own the array: a later clear of the caller's batch must not rewrite
        // a payload already handed to retry.
        spans: [...group.spans],
      },
    ],
  })),
})
