import { frameRecordKey, framedByFrameId, recordLabel } from './bind.ts'
import type { AdminRecord } from './ingest.ts'

export type CauseChipModel = {
  id: string
  name: string
  kind: string
  record: AdminRecord | undefined
}

function directCauseIds(record: AdminRecord): string[] {
  const ids = [...record.causeIds]
  for (const link of record.links) {
    if (link.reason === 'computed.dependency' && link.frameId) {
      ids.push(link.frameId)
    }
  }
  const seen = new Set<string>()
  const unique: string[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    unique.push(id)
  }
  return unique
}

export function resolveCauseChips(
  record: AdminRecord,
  records: readonly AdminRecord[],
): CauseChipModel[] {
  const byFrame = framedByFrameId(records)
  return directCauseIds(record).map((id) => {
    const match = byFrame.get(frameRecordKey(record.traceId, id))
    if (match === undefined) {
      return { id, name: id, kind: 'other', record: undefined }
    }
    return {
      id,
      name: recordLabel(match),
      kind: match.reatomKind ?? 'other',
      record: match,
    }
  })
}
