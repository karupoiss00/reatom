import type { AdminRecord } from '../otlp/ingest'
import { orderedRoots, turnSection, type TurnSection } from './turns'

export function sourceIndexBySourceId(
  records: readonly AdminRecord[],
): Map<string, number> {
  const indexById = new Map<string, number>()
  for (const record of records) {
    if (indexById.has(record.sourceId)) continue
    indexById.set(record.sourceId, indexById.size)
  }
  return indexById
}

export function previousWriteById(
  records: readonly AdminRecord[],
): Map<string, AdminRecord> {
  const byAtom = new Map<string, AdminRecord[]>()
  for (const record of records) {
    if (record.atomName === undefined) continue
    const key = `${record.sourceId}\0${record.atomName}`
    const list = byAtom.get(key)
    if (list) list.push(record)
    else byAtom.set(key, [record])
  }
  const previous = new Map<string, AdminRecord>()
  for (const list of byAtom.values()) {
    list.sort((left, right) =>
      left.start === right.start
        ? left.id.localeCompare(right.id)
        : left.start - right.start,
    )
    for (let index = 1; index < list.length; index++) {
      previous.set(list[index]!.id, list[index - 1]!)
    }
  }
  return previous
}

export function turnSectionByRootId(
  records: readonly AdminRecord[],
): Map<string, TurnSection> {
  const roots = orderedRoots(records)
  const sections = new Map<string, TurnSection>()
  for (let index = 0; index < roots.length; index++) {
    const root = roots[index]!
    sections.set(root.id, turnSection(root, records, index + 1))
  }
  return sections
}

