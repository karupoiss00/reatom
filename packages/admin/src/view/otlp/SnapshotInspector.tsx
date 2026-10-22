import { atom } from '@reatom/core'

import { Inspector } from '../inspector'

let snapshotSerial = 0

export const SnapshotInspector = ({ value }: { value: unknown }) => {
  snapshotSerial += 1
  const source = atom(value, `_Admin.snapshot.${snapshotSerial}`)
  return <Inspector value={source} defaultExpanded />
}
