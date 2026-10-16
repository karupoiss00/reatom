import { atom } from '@reatom/core'

import type { Admin } from '../../index'
import type { FilterMode } from '../../types'
import {
  Button,
  EmptyState,
  SplitPane,
  scrollable,
  tokens,
  type,
} from '../design-system'
import { ExpressionGroupEditor } from './ExpressionGroupEditor'
import { FilterConfigCard } from './FilterConfigCard'
import { PredicateBuilder } from './PredicateBuilder'

export interface FilterEditorProps {
  admin: Admin
}

const MODES: Array<{ value: FilterMode; label: string }> = [
  { value: 'show', label: 'Show only' },
  { value: 'hide', label: 'Hide' },
  { value: 'highlight', label: 'Highlight' },
  { value: 'exclude', label: 'Exclude' },
]

const confirmClear = atom(false, '_Admin.view.filterEditor.confirmClear')

let confirmTimer: ReturnType<typeof setTimeout> | null = null

const scheduleConfirmRevert = () => {
  if (confirmTimer !== null) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    confirmClear.set(false)
    confirmTimer = null
  }, 3000)
}

export const FilterEditor = ({ admin }: FilterEditorProps) => {
  const engine = admin.filters.engine
  const tags = admin.filters.tags
  const configs = () => engine.configs()
  const draftExpression = () => admin.filters.expression.expression()
  const draftNodeCount = () => draftExpression().children.length

  const appendTagReference = (tagId: string) => {
    const expression = draftExpression()
    admin.filters.expression.setExpression({
      ...expression,
      children: [...expression.children, { tagId, negated: false }],
    })
  }

  const savedRules = (
    <section
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      `}
    >
      <div
        css={`
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <h3
          css={`
            ${type.title}
            margin: 0;
          `}
        >
          Saved rules
        </h3>
      </div>
      <div
        css={`
          ${scrollable}
          padding: var(--admin-space-8);
        `}
      >
        {() =>
          configs().length === 0 ? (
            <EmptyState
              title="No saved rules yet"
              description="Build a draft expression and save it as a show, hide, highlight, or exclude rule."
            />
          ) : (
            configs().map((config) => (
              <FilterConfigCard admin={admin} config={config} />
            ))
          )
        }
      </div>
    </section>
  )

  const studio = (
    <div
      css={`
        ${scrollable}
        display: grid;
        gap: var(--admin-space-16);
        align-content: start;
        padding: var(--admin-space-8);
      `}
    >
      <section
        css={`
          display: grid;
          gap: var(--admin-space-8);
        `}
      >
        <div
          css={`
            display: flex;
            justify-content: space-between;
            gap: var(--admin-space-8);
            align-items: center;
          `}
        >
          <h3
            css={`
              ${type.ui}
              margin: 0;
            `}
          >
            Save draft as rule
          </h3>
          <span
            css={`
              ${type.meta}
              color: ${tokens.text3};
            `}
          >
            {() => `Draft nodes: ${draftNodeCount()}`}
          </span>
        </div>
        <div
          css={`
            display: flex;
            flex-wrap: wrap;
            gap: var(--admin-space-6);
          `}
        >
          {MODES.map((mode) => (
            <Button
              variant="ghost"
              label={`Save as ${mode.label}`}
              disabled={() => draftNodeCount() === 0}
              onClick={() => {
                if (draftNodeCount() === 0) return
                admin.filters.engine.addDraftConfig(
                  `${mode.label} rule`,
                  mode.value,
                )
              }}
            />
          ))}
          <Button
            variant="ghost"
            label="Reset draft expression"
            onClick={() =>
              admin.filters.expression.setExpression({
                operator: 'AND',
                children: [],
              })
            }
          />
        </div>
      </section>

      <ExpressionGroupEditor admin={admin} />

      <section
        css={`
          display: grid;
          gap: var(--admin-space-8);
        `}
      >
        <h3
          css={`
            ${type.ui}
            margin: 0;
          `}
        >
          Available tags
        </h3>
        <div
          css={`
            display: flex;
            flex-wrap: wrap;
            gap: var(--admin-space-6);
          `}
        >
          {() =>
            tags.tags().map((tag) => (
              <Button
                variant="ghost"
                label={`Add ${tag.name} tag to draft expression`}
                onClick={() => appendTagReference(tag.id)}
              >
                {tag.name}
              </Button>
            ))
          }
        </div>
      </section>

      <PredicateBuilder admin={admin} />
    </div>
  )

  return (
    <div
      data-reatom-name="FilterWorkbench"
      css={`
        display: grid;
        grid-template-rows: auto minmax(0, 1fr);
        height: 100%;
        min-height: 0;
      `}
    >
      <section
        data-reatom-name="FilterEditor"
        css={`
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--admin-space-8);
          padding: var(--admin-space-8);
          border-bottom: 1px solid ${tokens.border1};
        `}
      >
        <h3
          css={`
            ${type.title}
            margin: 0;
          `}
        >
          Filter studio
        </h3>
        <Button
          variant="danger"
          label="Clear saved rules"
          onClick={() => {
            if (confirmClear()) {
              if (confirmTimer !== null) clearTimeout(confirmTimer)
              confirmClear.set(false)
              engine.clearConfigs()
              return
            }
            confirmClear.set(true)
            scheduleConfirmRevert()
          }}
        >
          {() => (confirmClear() ? 'Confirm clear' : 'Clear saved rules')}
        </Button>
      </section>
      <SplitPane
        ratio={admin.view.filtersSplitRatio}
        left={savedRules}
        right={studio}
        minLeft={220}
        minRight={280}
        defaultRatio={0.34}
      />
    </div>
  )
}
