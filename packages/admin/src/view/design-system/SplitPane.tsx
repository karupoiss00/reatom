import type { Atom } from '@reatom/core'

import { focusVisible } from './mixins'
import { splitPanePointerMove } from './splitPointer'
import { size, tokens } from './tokens'

export interface SplitPaneProps {
  ratio: Atom<number>
  left: Element
  right: Element
  minLeft: number
  minRight: number
  defaultRatio: number
}

export const SplitPane = ({
  ratio,
  left,
  right,
  minLeft,
  minRight,
  defaultRatio,
}: SplitPaneProps) => {
  const columns = () =>
    `minmax(${minLeft}px, ${ratio() * 100}%) ${size.splitterHit} minmax(${minRight}px, 1fr)`

  return (
    <div
      data-reatom-name="SplitPane"
      css:split={columns}
      css={`
        display: grid;
        grid-template-columns: var(--split);
        min-height: 0;
        min-width: 0;
        height: 100%;
      `}
      ref={(element) => {
        const onPointerMove = splitPanePointerMove(
          element,
          ratio,
          minLeft,
          minRight,
        )
        element.addEventListener('pointermove', onPointerMove)
        return () => element.removeEventListener('pointermove', onPointerMove)
      }}
    >
      <div
        data-pane="left"
        css={`
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        `}
      >
        {left}
      </div>
      <button
        type="button"
        role="separator"
        aria-label="Resize panes"
        aria-orientation="vertical"
        aria-valuemin="20"
        aria-valuemax="80"
        aria-valuenow={() => String(Math.round(ratio() * 100))}
        css={`
          ${focusVisible}
          appearance: none;
          border: 0;
          padding: 0;
          width: 100%;
          background: transparent;
          cursor: col-resize;
          touch-action: none;
          position: relative;
          &::before {
            content: '';
            position: absolute;
            inset-block: 0;
            inset-inline-start: 50%;
            width: 1px;
            background: ${tokens.border1};
          }
          &::after {
            content: '';
            position: absolute;
            inset-block-start: 50%;
            inset-inline-start: 50%;
            width: 4px;
            height: 18px;
            transform: translate(-50%, -50%);
            border-radius: 999px;
            background: ${tokens.border2};
          }
        `}
        on:pointerdown={(event: Event) => {
          const pointerEvent = event instanceof PointerEvent ? event : null
          if (!pointerEvent) return
          const pane = event.currentTarget
          if (pane instanceof Element && pane.parentElement) {
            pane.parentElement.setPointerCapture(pointerEvent.pointerId)
          }
        }}
        on:dblclick={() => ratio.set(defaultRatio)}
        on:keydown={(event: KeyboardEvent) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            ratio.set(Math.max(0.2, ratio() - 0.04))
            return
          }
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            ratio.set(Math.min(0.8, ratio() + 0.04))
          }
        }}
      />
      <div
        data-pane="right"
        css={`
          min-width: 0;
          min-height: 0;
          overflow: hidden;
        `}
      >
        {right}
      </div>
    </div>
  )
}
