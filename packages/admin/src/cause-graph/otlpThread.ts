import {
  selectedCauseThread,
  type CauseThread,
} from '../otlp/causeThread.ts'
import type { AdminRecord } from '../otlp/ingest.ts'

export function selectedCauseThreadModel(
  records: readonly AdminRecord[],
  selected: AdminRecord | null,
): CauseThread {
  return selectedCauseThread(records, selected)
}

export function selectedAncestorFrameIds(
  records: readonly AdminRecord[],
  selected: AdminRecord | null,
): readonly string[] {
  return selectedCauseThread(records, selected).ancestorFrameIds
}
