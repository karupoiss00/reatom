import { atom } from '@reatom/core'

import type { Admin } from '../../index'
import { formatSessionDuration } from '../../timeline'
import { TimelineBars } from '../components/TimelineBars'
import { TimelineControls } from '../components/TimelineControls'
import { TimelineEventList } from '../components/TimelineEventList'
import {
  formatTimelineSelectionTime,
  TimelineSelectionPanel,
} from '../components/TimelineSelectionPanel'
import { EmptyState, SplitPane, tokens, type } from '../design-system'
import { formatTimestamp } from '../format'

export interface TimelineScreenProps {
  admin: Admin
}

type TimelineViewMode = 'chart' | 'events'

export const TimelineScreen = ({ admin }: TimelineScreenProps) => {
  const selectedBucketIndex = atom<number | null>(
    null,
    '_Admin.view.timeline.bucketIndex',
  )
  const selectedTimestamp = atom<number | null>(
    null,
    '_Admin.view.timeline.eventTimestamp',
  )
  const viewMode = atom<TimelineViewMode | null>(
    null,
    '_Admin.view.timeline.viewMode',
  )

  const resolvedViewMode = (): TimelineViewMode => {
    const manualMode = viewMode()
    if (manualMode !== null) return manualMode
    return admin.timeline.prefersEventList() ? 'events' : 'chart'
  }

  const effectiveBucketIndex = (): number | null => {
    if (resolvedViewMode() !== 'chart') return null
    const manualIndex = selectedBucketIndex()
    if (manualIndex !== null) return manualIndex
    return admin.timeline.busiestChartBucketIndex()
  }

  const selectedBucket = () => {
    const index = effectiveBucketIndex()
    if (index === null) return null
    return admin.timeline.chartBuckets()[index] ?? null
  }

  const effectiveTimestamp = (): number | null => {
    if (resolvedViewMode() !== 'events') return null
    const manualTimestamp = selectedTimestamp()
    if (manualTimestamp !== null) return manualTimestamp
    const groups = admin.timeline.frameGroups()
    if (groups.length === 0) return null
    let busiestTimestamp = groups[0]!.timestamp
    let busiestCount = groups[0]!.frames.length
    for (const group of groups) {
      if (group.frames.length > busiestCount) {
        busiestCount = group.frames.length
        busiestTimestamp = group.timestamp
      }
    }
    return busiestTimestamp
  }

  const selectedGroup = () => {
    const timestamp = effectiveTimestamp()
    if (timestamp === null) return null
    return (
      admin.timeline
        .frameGroups()
        .find((group) => group.timestamp === timestamp) ?? null
    )
  }

  const selectionFrames = () => {
    const bucket = selectedBucket()
    if (bucket) return bucket.entries
    const group = selectedGroup()
    if (group) return group.frames
    return []
  }

  const selectionTitle = () => {
    if (selectedBucket()) return 'Bucket focus'
    if (selectedGroup()) return 'Burst focus'
    return 'Timeline focus'
  }

  const selectionTimeLabel = () => {
    const bucket = selectedBucket()
    if (bucket) return formatTimelineSelectionTime(bucket.start, bucket.end)
    const group = selectedGroup()
    if (group) return formatTimestamp(group.timestamp)
    return null
  }

  const summary = () => admin.timeline.sessionSummary()

  const workspace = (
    <section
      css={`
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
        background: ${tokens.canvas};
      `}
    >
      <div
        css={`
          display: flex;
          justify-content: space-between;
          align-items: center;
          min-height: 28px;
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
          gap: var(--admin-space-8);
          flex-wrap: wrap;
        `}
      >
        <h2
          css={`
            ${type.title}
            margin: 0;
            white-space: nowrap;
          `}
        >
          Session activity
        </h2>
        {() => {
          const currentSummary = summary()
          if (currentSummary.frameCount === 0) return null
          return (
            <span
              css={`
                ${type.meta}
                color: ${tokens.text3};
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              `}
            >
              {currentSummary.frameCount} frames ·{' '}
              {formatSessionDuration(currentSummary.durationMs)} ·{' '}
              {currentSummary.burstCount} bursts
            </span>
          )
        }}
      </div>
      <div
        css={`
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <TimelineControls admin={admin} />
      </div>
      <div
        css={`
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          min-height: 0;
        `}
      >
        <div
          css={`
            display: flex;
            gap: var(--admin-space-4);
            padding: var(--admin-space-8);
          `}
        >
          {(
            [
              { id: 'events' as const, label: 'Event list' },
              { id: 'chart' as const, label: 'Histogram' },
            ] as const
          ).map((tab) => (
            <button
              type="button"
              aria-pressed={() => resolvedViewMode() === tab.id}
              css={`
                ${type.ui}
                appearance: none;
                border: 1px solid ${tokens.border1};
                background: transparent;
                color: ${tokens.text2};
                min-height: 28px;
                padding-inline: var(--admin-space-8);
                cursor: pointer;
                &[aria-pressed='true'] {
                  background: ${tokens.surface3};
                  color: ${tokens.text1};
                }
              `}
              on:click={() => viewMode.set(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div
          css={`
            display: grid;
            grid-template-rows: minmax(0, 1fr);
            min-height: 0;
            padding-inline: var(--admin-space-8);
            padding-bottom: var(--admin-space-8);
          `}
        >
          {() => {
            const currentSummary = summary()
            if (currentSummary.frameCount === 0) {
              return (
                <EmptyState
                  title="No timeline yet"
                  description="Interact with your app to capture frames, then return here to inspect when state changes clustered during the session."
                />
              )
            }
            if (admin.timeline.isPannedOutsideRange()) {
              return (
                <EmptyState
                  title="Timeline panned outside captured range"
                  description="The pan offset moved the chart away from your session data. Reset the timeline or use Auto-fit session to recover."
                />
              )
            }
            if (resolvedViewMode() === 'events') {
              return (
                <TimelineEventList
                  admin={admin}
                  selectedTimestamp={effectiveTimestamp()}
                  onSelectTimestamp={(timestamp) => {
                    selectedTimestamp.set(timestamp)
                    selectedBucketIndex.set(null)
                  }}
                />
              )
            }
            if (admin.timeline.chartBuckets().length === 0) {
              return (
                <EmptyState
                  title="No bursts in the current window"
                  description="Try Auto-fit session or switch to Event list for a frame-by-frame view of short debugging sessions."
                />
              )
            }
            return (
              <TimelineBars
                admin={admin}
                selectedBucketIndex={effectiveBucketIndex()}
                onSelectBucket={(_, index) => {
                  selectedBucketIndex.set(index)
                  selectedTimestamp.set(null)
                }}
              />
            )
          }}
        </div>
      </div>
    </section>
  )

  return (
    <div
      data-reatom-name="TimelineScreen"
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <SplitPane
        ratio={admin.view.timelineSplitRatio}
        left={workspace}
        right={
          <aside
            css={`
              height: 100%;
              min-height: 0;
              overflow: auto;
              padding: var(--admin-space-8);
              background: ${tokens.surface1};
            `}
          >
            {() => (
              <TimelineSelectionPanel
                admin={admin}
                frames={selectionFrames()}
                title={selectionTitle()}
                timeLabel={selectionTimeLabel()}
              />
            )}
          </aside>
        }
        minLeft={280}
        minRight={260}
        defaultRatio={0.58}
      />
    </div>
  )
}
