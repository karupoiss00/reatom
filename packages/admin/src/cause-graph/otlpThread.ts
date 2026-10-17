import {
  selectedCauseThread,
  type CauseThread,
} from '../otlp/causeThread.ts'
import type { AdminRecord } from '../otlp/ingest.ts'

/**
 * Ancestor frame ids and diamond/error marks for the selected record.
 * Same walk as calculator `cause>`. The Gantt gutter should stroke a 1.5px
 * accent (error to `errorAncestorFrameId`) from the selected row to each
 * visible ancestor, with a 6px hollow diamond on `diamondFrameIds`.
 */
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
