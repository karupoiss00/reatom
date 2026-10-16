import type { OtlpAdmin } from '../../otlp'
import { Button, EmptyState, RailGraph, scrollable } from '../design-system'
import { StateInspector } from './StateInspector'

const directions = ['ancestors', 'descendants', 'full'] as const

export const OtlpStateView = ({ admin }: { admin: OtlpAdmin }) => {
  return (
    <div
      css={`
        display: grid;
        height: 100%;
        min-height: 0;
      `}
    >
      <h2 css={visuallyTitle}>State</h2>
      <StateInspector admin={admin} />
    </div>
  )
}

export const OtlpGraphView = ({ admin }: { admin: OtlpAdmin }) => {
  return (
    <div
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      `}
    >
      <h2 css={visuallyTitle}>Graph</h2>
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          gap: var(--admin-space-6);
          padding: var(--admin-space-8);
        `}
      >
        {directions.map((direction) => (
          <Button
            variant="ghost"
            label={direction}
            pressed={() => admin.graphDirection() === direction}
            onClick={() => admin.graphDirection.set(direction)}
          >
            {direction}
          </Button>
        ))}
      </div>
      <div
        css={`
          ${scrollable}
          min-height: 0;
          padding: var(--admin-space-8);
        `}
      >
        {() => {
          const nodes = admin.railNodes()
          if (nodes.length === 0) {
            return (
              <EmptyState
                title="No cause graph"
                description="Select a record, then open it in the graph to see causes and effects."
              />
            )
          }
          const selected = Number(admin.selectedRootFrameId())
          return (
            <RailGraph
              nodes={nodes}
              selectedId={Number.isFinite(selected) ? selected : nodes[0]!.id}
              onSelect={(nodeId) => {
                admin.selectFrame(nodeId)
                admin.cardOpen.setTrue()
              }}
              onReroot={(nodeId) => admin.selectFrame(nodeId)}
            />
          )
        }}
      </div>
    </div>
  )
}

const visuallyTitle = `
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
`
