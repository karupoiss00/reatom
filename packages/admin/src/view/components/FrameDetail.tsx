import { atom, urlAtom } from '@reatom/core'

import type { Admin } from '../../index'
import type { AdminFrame } from '../../types'
import {
  Button,
  Icon,
  InspectorTabs,
  RailGraph,
  type RailInputNode,
  scrollable,
  tokens,
  type,
  visuallyHidden,
} from '../design-system'
import { formatDateTime, formatJson } from '../format'
import { getFrameExportPayload, isActionFrame } from '../frame-inspector'
import { Inspector, ParamList } from '../inspector'
import { HistoryPanel } from './HistoryPanel'

export interface FrameDetailProps {
  admin: Admin
  frame: AdminFrame
  atomName: string
  onClose: () => void
}

function buildRailNodes(admin: Admin, frame: AdminFrame): Array<RailInputNode> {
  const graph = admin.causeGraph.graph()
  const atoms = admin.store.getAtoms()
  const frameIndex = admin.store.frameIndex()
  if (!graph) {
    return [
      {
        id: frame.id,
        label: atomNameFor(admin, frame),
        kind: isActionFrame(frame) ? 'action' : 'state',
        timestamp: frame.timestamp,
        parentIds: frame.pubIds,
        hasError: frame.error !== null,
      },
    ]
  }

  return graph.nodes.map((node) => {
    const nodeFrame = frameIndex.get(node.frameId)
    return {
      id: node.frameId,
      label: atoms.get(node.atomId)?.name ?? node.atomId,
      kind: nodeFrame && isActionFrame(nodeFrame) ? 'action' : 'state',
      timestamp: nodeFrame?.timestamp ?? node.frameId,
      parentIds: nodeFrame?.pubIds ?? [],
      hasError: nodeFrame?.error != null,
    }
  })
}

function atomNameFor(admin: Admin, frame: AdminFrame): string {
  return admin.store.getAtoms().get(frame.atomId)?.name ?? frame.atomId
}

const expandedValueHooks = {
  initiallyExpanded: () => true,
}

let frameDetailSerial = 0

export const FrameDetail = ({
  admin,
  frame,
  atomName,
  onClose,
}: FrameDetailProps) => {
  frameDetailSerial += 1
  const slot = `_Admin.frameDetail.${frameDetailSerial}`
  const exportPayload = getFrameExportPayload(frame)
  const exportValue = atom(exportPayload, `${slot}.export`)
  const isAction = isActionFrame(frame)
  const overviewData = isAction ? frame.payload : frame.state
  const overviewDataValue = atom(overviewData, `${slot}.data`)
  const overviewParamsValue = atom(frame.params, `${slot}.params`)
  const tab = admin.view.inspectorTab

  return (
    <div
      data-reatom-name="FrameDetail"
      css={`
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
        background: ${tokens.surface1};
      `}
    >
      <div
        css={`
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--admin-space-8);
          min-height: 36px;
          width: 100%;
          min-width: 0;
          box-sizing: border-box;
          padding-inline: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
          overflow: hidden;
        `}
      >
        <div
          css={`
            display: flex;
            align-items: baseline;
            gap: var(--admin-space-6);
            min-width: 0;
            flex: 1 1 0;
            overflow: hidden;
          `}
        >
          <span
            css={`
              ${type.meta}
              color: ${tokens.text2};
              white-space: nowrap;
            `}
          >
            {frame.error !== null ? 'Error' : isAction ? 'Action' : 'State'} #
            {frame.id}
          </span>
          <h3
            css={`
              ${type.ui}
              margin: 0;
              font-weight: 650;
              white-space: nowrap;
            `}
          >
            {atomName}
          </h3>
          <span
            data-testid="frame-detail-meta"
            css={`
              ${type.meta}
              color: ${tokens.text3};
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              min-width: 0;
            `}
          >
            {formatDateTime(frame.timestamp)} · Session {frame.sessionId}
          </span>
        </div>
        <div
          css={`
            display: flex;
            gap: var(--admin-space-4);
            align-items: start;
            flex: 0 0 auto;
          `}
        >
          <Button
            variant="icon"
            label="Copy JSON"
            onClick={() => {
              void navigator.clipboard.writeText(formatJson(exportPayload))
            }}
          >
            <Icon name="copy" />
          </Button>
          <Button
            variant="icon"
            label="Download"
            onClick={() => {
              const blob = new Blob([formatJson(exportPayload)], {
                type: 'application/json',
              })
              const url = URL.createObjectURL(blob)
              const anchor = document.createElement('a')
              anchor.href = url
              anchor.download = `frame-${frame.id}.json`
              document.body.append(anchor)
              anchor.click()
              anchor.remove()
              URL.revokeObjectURL(url)
            }}
          >
            <Icon name="download" />
          </Button>
          <Button variant="icon" label="Close" onClick={onClose}>
            <Icon name="close" />
          </Button>
        </div>
      </div>
      <InspectorTabs value={tab} />
      <div
        css={`
          display: grid;
          height: 100%;
          min-height: 0;
          overflow: hidden;
        `}
      >
        <div
          prop:hidden={() => tab() !== 'overview'}
          css={`
            ${scrollable}
            padding: var(--admin-space-8);
          `}
        >
          <div
            css={`
              display: grid;
              gap: var(--admin-space-12);
            `}
          >
            {frame.error !== null && (
              <div
                data-testid="frame-error-panel"
                css={`
                  ${type.data}
                  padding: var(--admin-space-8);
                  border: 1px solid ${tokens.error};
                  color: ${tokens.error};
                  white-space: pre-wrap;
                `}
              >
                <strong>Captured error</strong>
                <div>{formatJson(frame.error)}</div>
              </div>
            )}
            {overviewData !== undefined ? (
              <Inspector
                value={overviewDataValue}
                defaultExpanded
                hooks={expandedValueHooks}
              />
            ) : null}
            <ParamList value={overviewParamsValue} />
            <Button
              variant="secondary"
              label="Open in cause graph"
              onClick={() => urlAtom.go('/graph')}
            />
          </div>
        </div>
        <div
          prop:hidden={() => tab() !== 'causes'}
          css={`
            ${scrollable}
            padding: var(--admin-space-8);
            height: 100%;
            box-sizing: border-box;
            display: grid;
            grid-template-rows: minmax(0, 1fr) auto;
            gap: var(--admin-space-8);
          `}
        >
          <section
            css={`
              display: grid;
              min-height: 0;
              height: 100%;
            `}
          >
            <h4 css={visuallyHidden}>Cause chain</h4>
            {() => (
              <RailGraph
                nodes={buildRailNodes(admin, frame)}
                selectedId={frame.id}
                pathIds={admin.causeGraph.path() ?? undefined}
                onSelect={(frameId) => {
                  admin.store.selectFrame(frameId)
                  admin.causeGraph.selectedRootId.set(frameId)
                }}
                onReroot={(frameId) => {
                  admin.store.selectFrame(frameId)
                  admin.causeGraph.selectedRootId.set(frameId)
                }}
              />
            )}
          </section>
          <Button
            variant="secondary"
            label="Open in cause graph"
            onClick={() => urlAtom.go('/graph')}
          />
        </div>
        <div
          prop:hidden={() => tab() !== 'history'}
          css={`
            ${scrollable}
            padding: var(--admin-space-8);
          `}
        >
          <HistoryPanel admin={admin} frame={frame} />
        </div>
        <div
          prop:hidden={() => tab() !== 'json'}
          css={`
            ${scrollable}
            padding: var(--admin-space-8);
          `}
        >
          <Inspector value={exportValue} defaultExpanded />
        </div>
      </div>
    </div>
  )
}
