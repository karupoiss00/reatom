import {
  highlightCalculator,
  parseCalculator,
  stringifyCalculator,
  type AdminReatomKind,
  type OtlpAdmin,
} from '../../otlp'
import type { FilterMode } from '../../types'
import {
  Button,
  SearchField,
  controlBase,
  focusVisible,
  tokens,
  type,
} from '../design-system'
import { formatModeLabel } from '../format'

const FILTER_MODES: Array<{ value: FilterMode; label: string }> = [
  { value: 'show', label: 'Show only' },
  { value: 'hide', label: 'Hide' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'exclude', label: 'Exclude' },
]

export interface OtlpFiltersScreenProps {
  admin: OtlpAdmin
}

function toggleKind(admin: OtlpAdmin, kind: AdminReatomKind) {
  admin.filterReatomKind.set(
    admin.filterReatomKind() === kind ? undefined : kind,
  )
}

const CALCULATOR_FIELD_CHROME = `
  ${controlBase}
  ${focusVisible}
  width: 100%;
  min-width: 0;
  padding-inline: var(--admin-space-8);
  ${type.data}
`

function syncCalculatorHighlightScroll(event: Event) {
  const input = event.currentTarget
  if (!(input instanceof HTMLInputElement)) return
  const overlay = input.previousElementSibling
  if (overlay instanceof HTMLElement) overlay.scrollLeft = input.scrollLeft
}

export const OtlpFiltersScreen = ({ admin }: OtlpFiltersScreenProps) => {
  return (
    <div
      data-reatom-name="OtlpFiltersScreen"
      data-testid="otlp-filters-screen"
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
          align-items: center;
          flex-wrap: wrap;
          gap: var(--admin-space-8);
          padding: var(--admin-space-8) var(--admin-space-12);
          border-bottom: 1px solid ${tokens.border1};
          background: ${tokens.surface1};
        `}
      >
        <SearchField
          value={admin.filterName}
          label="Filter by name"
          placeholder="Name or glob"
          testId="otlp-filter-name"
          shortcut=""
        />
        <SearchField
          value={admin.filterQuery}
          label="Filter payload, params, and state"
          placeholder="Payload / params / state"
          testId="otlp-filter-query"
          shortcut=""
        />
        <Button
          variant="ghost"
          label="Errors"
          testId="otlp-filter-errors"
          pressed={() => admin.filterHasError() === true}
          onClick={() =>
            admin.filterHasError.set(
              admin.filterHasError() === true ? undefined : true,
            )
          }
        />
        <Button
          variant="ghost"
          label="Actions"
          testId="otlp-filter-actions"
          pressed={() => admin.filterReatomKind() === 'action'}
          onClick={() => toggleKind(admin, 'action')}
        />
        <Button
          variant="ghost"
          label="Routes"
          testId="otlp-filter-routes"
          pressed={() => admin.filterReatomKind() === 'route'}
          onClick={() => toggleKind(admin, 'route')}
        />
        <Button
          variant="secondary"
          label="Reset filters"
          testId="otlp-filter-reset"
          onClick={() => admin.resetFilter()}
        >
          Reset
        </Button>
      </div>
      <details
        data-testid="otlp-filter-calculator-panel"
        css={`
          padding: var(--admin-space-8) var(--admin-space-12);
          border-bottom: 1px solid ${tokens.border1};
          background: ${tokens.surface1};
        `}
      >
        <summary
          data-testid="otlp-filter-calculator-toggle"
          css={`
            ${type.ui}
            cursor: pointer;
            color: ${tokens.text1};
            list-style: none;
            &::-webkit-details-marker {
              display: none;
            }
          `}
        >
          Calculator
        </summary>
        <label
          css={`
            display: grid;
            gap: var(--admin-space-4);
            margin-top: var(--admin-space-8);
            ${type.meta}
            color: ${tokens.text2};
          `}
        >
          Expression
          <div
            css={`
              position: relative;
              width: 100%;
              min-width: 0;
              background: ${tokens.surface2};
              border-radius: inherit;
            `}
          >
            <div
              data-testid="otlp-filter-calculator-highlight"
              aria-hidden="true"
              css={`
                ${CALCULATOR_FIELD_CHROME}
                position: absolute;
                inset: 0;
                z-index: 0;
                overflow: hidden;
                white-space: nowrap;
                pointer-events: none;
                border-color: transparent;
                color: ${tokens.text1};
                [data-kind='keyword'] {
                  color: ${tokens.accent};
                }
                [data-kind='field'] {
                  color: ${tokens.info};
                }
                [data-kind='op'] {
                  color: ${tokens.warning};
                }
                [data-kind='value'] {
                  color: ${tokens.text1};
                }
                [data-kind='string'] {
                  color: ${tokens.success};
                }
                [data-kind='paren'] {
                  color: ${tokens.text2};
                }
                [data-kind='error'] {
                  color: ${tokens.error};
                }
              `}
            >
              {() =>
                highlightCalculator(admin.filterCalculator()).map((span) => (
                  <span
                    data-testid="otlp-filter-calculator-token"
                    data-kind={span.kind}
                  >
                    {span.text}
                  </span>
                ))
              }
            </div>
            <input
              type="text"
              model:value={admin.filterCalculator}
              data-testid="otlp-filter-calculator"
              aria-label="Calculator filter"
              placeholder="name:explode AND kind:action"
              on:scroll={syncCalculatorHighlightScroll}
              css={`
                ${CALCULATOR_FIELD_CHROME}
                position: relative;
                z-index: 1;
                background: transparent;
                color: transparent;
                caret-color: ${tokens.text1};
                &::placeholder {
                  color: ${tokens.text3};
                  opacity: 1;
                }
              `}
            />
          </div>
        </label>
        <div
          data-testid="otlp-filter-modes"
          css={`
            display: flex;
            flex-wrap: wrap;
            gap: var(--admin-space-8);
            margin-top: var(--admin-space-8);
          `}
        >
          {FILTER_MODES.map((mode) => (
            <Button
              variant="ghost"
              label={mode.label}
              testId={`otlp-filter-mode-${mode.value}`}
              pressed={() => admin.filterMode() === mode.value}
              onClick={() => admin.filterMode.set(mode.value)}
            >
              {formatModeLabel(mode.value)}
            </Button>
          ))}
        </div>
        <p
          data-testid="otlp-filter-calculator-hint"
          css={`
            margin: var(--admin-space-8) 0 0;
            ${type.meta}
            color: ${tokens.text3};
          `}
        >
          {() => {
            const parsed = parseCalculator(admin.filterCalculator())
            if (!parsed.ok) return parsed.error
            if (parsed.expression.children.length === 0) {
              return 'AND / OR / NOT, parentheses. Example: name:explode AND kind:action'
            }
            return stringifyCalculator(parsed)
          }}
        </p>
        <p
          data-testid="otlp-filter-mode-hint"
          css={`
            margin: var(--admin-space-4) 0 0;
            ${type.meta}
            color: ${tokens.text3};
          `}
        >
          Hide and Exclude both drop matches from Activity. They are the same on
          this live filter.
        </p>
      </details>
      <p
        data-testid="otlp-filter-summary"
        css={`
          margin: 0;
          padding: var(--admin-space-12);
          ${type.ui}
          color: ${tokens.text2};
        `}
      >
        {() => {
          const summary = admin.summary()
          const filter = admin.filter()
          const active =
            filter.name !== undefined ||
            filter.query !== undefined ||
            filter.hasError !== undefined ||
            filter.reatomKind !== undefined ||
            filter.calculator !== undefined
          if (!active) {
            return `${summary.totalFrames} records. Name and payload searches apply to Activity. Errors, Actions, and Routes use the same filter MCP search accepts. Calculator parses to FilterGroup.`
          }
          const modeLabel =
            filter.mode !== undefined && filter.mode !== 'show'
              ? `${filter.mode} · `
              : ''
          const highlighted =
            summary.highlightedFrames > 0
              ? ` · ${summary.highlightedFrames} highlighted`
              : ''
          if (filter.calculator) {
            return `${modeLabel}${filter.calculator} · ${summary.visibleFrames} / ${summary.totalFrames} visible${highlighted}`
          }
          return `${modeLabel}${summary.visibleFrames} / ${summary.totalFrames} visible${highlighted}`
        }}
      </p>
    </div>
  )
}
