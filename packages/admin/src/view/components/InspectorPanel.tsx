import type { Admin } from '../../index'
import type { AdminFrame } from '../../types'
import { EmptyState } from '../design-system'
import { FrameDetail } from './FrameDetail'

export interface InspectorPanelProps {
  admin: Admin
  frame?: AdminFrame | null
}

export const InspectorPanel = ({ admin, frame }: InspectorPanelProps) => {
  return (
    <div
      data-reatom-name="InspectorPanel"
      css={`
        height: 100%;
        min-height: 0;
      `}
    >
      {() => {
        const selected = frame ?? admin.store.selectedFrame()
        if (!selected) {
          return (
            <EmptyState
              title="Inspect any frame"
              description="Select an item in the activity feed to inspect structured state, causal links, and the recent history for that atom."
            />
          )
        }

        const atomName =
          admin.store.getAtoms().get(selected.atomId)?.name ?? selected.atomId

        return (
          <FrameDetail
            admin={admin}
            frame={selected}
            atomName={atomName}
            onClose={() => admin.store.selectFrame(null)}
          />
        )
      }}
    </div>
  )
}
