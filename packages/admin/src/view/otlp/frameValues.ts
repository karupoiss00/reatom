import type { AdminRecord } from '../../otlp'
import { isStateWrite, recordValuePreview, recordValues } from '../../otlp'
import { isExpandableValue } from '../inspector/model'

export type FrameValueTitle =
  'Payload' | 'New state' | 'Previous state' | 'Params'

export type OverviewDataTitle = 'State' | 'Payload'

export type FrameValueKind = 'inspector' | 'text' | 'empty'

export function frameValueView(value: unknown): FrameValueKind {
  if (value === undefined) return 'empty'
  return isExpandableValue(value) ? 'inspector' : 'text'
}

function stateValue(record: AdminRecord): unknown {
  const values = recordValues(record)
  if (values.source === 'local' && values.state !== undefined) {
    return values.state
  }
  if (record.body !== undefined) return record.body
  return recordValuePreview(record)
}

export function recordFieldValue(record: AdminRecord): unknown {
  if (isStateWrite(record)) return stateValue(record)
  const payload = recordValues(record).payload
  return payload !== undefined ? payload : recordValuePreview(record)
}

/** State for a write, payload otherwise. Overview shows this above params. */
export function overviewDataTitle(record: AdminRecord): OverviewDataTitle {
  return isStateWrite(record) ? 'State' : 'Payload'
}

/**
 * Value shown first on Overview. State writes use the live state or the
 * recorded body. Other records use the live payload or `reatom.payload`. Params
 * render underneath.
 */
export function overviewDataValue(record: AdminRecord): unknown {
  if (isStateWrite(record)) return stateValue(record)
  return recordValues(record).payload
}

/**
 * Live call arguments, else `reatom.params`. `undefined` when the record has
 * none.
 */
export function overviewParamsValue(record: AdminRecord): unknown {
  return recordValues(record).params
}
