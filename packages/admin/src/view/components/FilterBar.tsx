import { urlAtom } from '@reatom/core'

import type { Admin } from '../../index'
import {
  Button,
  Icon,
  SearchField,
  SelectField,
  size,
  tokens,
  type,
  visuallyHidden,
} from '../design-system'

export interface FilterBarProps {
  admin: Admin
}

const TARGETS: Array<{
  value: 'name' | 'state' | 'params' | 'payload' | 'all'
  label: string
}> = [
  { value: 'all', label: 'All scopes' },
  { value: 'name', label: 'Name' },
  { value: 'state', label: 'State' },
  { value: 'params', label: 'Params' },
  { value: 'payload', label: 'Payload' },
]

export const FilterBar = ({ admin }: FilterBarProps) => {
  const search = admin.filters.search
  const builtInTagId = (name: string) =>
    admin.filters.tags.tags().find((tag) => tag.builtIn && tag.name === name)
      ?.id

  const toggleQuickRule = (tagName: string, mode: 'show' | 'hide') => {
    const tagId = builtInTagId(tagName)
    if (!tagId) return

    const existing = admin.filters.engine.configs().find((config) => {
      if (config.name !== `Quick ${tagName}`) return false
      return config.expression.children.some(
        (child) => 'tagId' in child && child.tagId === tagId,
      )
    })

    if (existing) {
      admin.filters.engine.removeConfig(existing.id)
      return
    }

    admin.filters.engine.addConfig({
      id: `quick-${tagName}-${Date.now()}`,
      name: `Quick ${tagName}`,
      expression: {
        operator: 'AND',
        children: [{ tagId, negated: false }],
      },
      mode,
    })
  }

  const hasQuickRule = (tagName: string): boolean => {
    const tagId = builtInTagId(tagName)
    if (!tagId) return false

    return admin.filters.engine.configs().some((config) => {
      if (config.name !== `Quick ${tagName}`) return false
      return config.expression.children.some(
        (child) => 'tagId' in child && child.tagId === tagId,
      )
    })
  }

  const errorCount = () => admin.view.summary().errorFrames
  const savedCount = () => admin.filters.engine.configs().length

  return (
    <div
      data-reatom-name="FilterBar"
      css={`
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--admin-space-6);
        row-gap: var(--admin-space-4);
        min-height: ${size.filter};
        padding-block: var(--admin-space-4);
        padding-inline: var(--admin-space-8);
        border-bottom: 1px solid ${tokens.border1};
        background: ${tokens.canvas};
        min-width: 0;
      `}
    >
      <SearchField
        value={search.searchQuery}
        label="Search frames"
        placeholder="Filter frames"
        testId="filter-search-input"
      />
      <SelectField
        value={search.searchTarget}
        label="Search target"
        options={TARGETS}
      />
      <div
        data-filter-quick=""
        css={`
          display: flex;
          align-items: center;
          gap: var(--admin-space-4);
          flex: 0 0 auto;
          @container admin-shell (max-width: 520px) {
            display: none;
          }
        `}
      >
        <span
          css={`
            display: inline-flex;
            align-items: center;
            gap: var(--admin-space-4);
          `}
        >
          <Button
            variant="ghost"
            label="Errors"
            title={() => `Errors ${errorCount()}`}
            pressed={() => hasQuickRule('error')}
            onClick={() => toggleQuickRule('error', 'show')}
          />
          <span
            aria-hidden="true"
            css={`
              ${type.meta}
              min-width: 1.15rem;
              height: 16px;
              padding-inline: 5px;
              border-radius: 999px;
              background: ${tokens.surface3};
              color: ${tokens.text2};
              display: inline-flex;
              align-items: center;
              justify-content: center;
            `}
          >
            {errorCount}
          </span>
        </span>
        <Button
          variant="ghost"
          label="Actions"
          pressed={() => hasQuickRule('action')}
          onClick={() => toggleQuickRule('action', 'show')}
        />
      </div>
      <details
        css={`
          position: relative;
          flex: 0 0 auto;
        `}
      >
        <summary
          aria-label="More filters"
          title="More filters"
          css={`
            ${type.ui}
            list-style: none;
            cursor: pointer;
            color: ${tokens.text2};
            width: 28px;
            min-height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid ${tokens.border1};
            background: ${tokens.surface2};
            border-radius: var(--admin-radius-4);
            &::-webkit-details-marker {
              display: none;
            }
          `}
        >
          <Icon name="more" />
        </summary>
        <div
          css={`
            position: absolute;
            inset-inline-end: 0;
            top: calc(100% + var(--admin-space-4));
            z-index: 4;
            display: grid;
            gap: var(--admin-space-6);
            padding: var(--admin-space-8);
            background: ${tokens.surface2};
            border: 1px solid ${tokens.border1};
            min-width: 12rem;
            & > [data-compact-filter] {
              display: none;
            }
            @container admin-shell (max-width: 520px) {
              & > [data-compact-filter] {
                display: contents;
              }
            }
            & > [data-compact-rules] {
              display: none;
            }
            @container admin-shell (max-width: 680px) {
              & > [data-compact-rules] {
                display: contents;
              }
            }
          `}
        >
          <span data-compact-filter="">
            <Button
              variant="ghost"
              label="Errors"
              pressed={() => hasQuickRule('error')}
              onClick={() => toggleQuickRule('error', 'show')}
            />
          </span>
          <span data-compact-filter="">
            <Button
              variant="ghost"
              label="Actions"
              pressed={() => hasQuickRule('action')}
              onClick={() => toggleQuickRule('action', 'show')}
            />
          </span>
          <span data-compact-rules="">
            <Button
              variant="ghost"
              label="Saved rules"
              onClick={() => urlAtom.go('/filters')}
            />
          </span>
          <Button
            variant="ghost"
            label="State only"
            pressed={() => hasQuickRule('reactive')}
            onClick={() => toggleQuickRule('reactive', 'show')}
          />
          <Button
            variant="ghost"
            label="Reset"
            onClick={() => {
              admin.filters.search.searchQuery.set('')
              admin.filters.search.searchTarget.set('all')
            }}
          />
        </div>
      </details>
      <div
        css={`
          display: inline-flex;
          align-items: center;
          gap: var(--admin-space-6);
          margin-inline-start: auto;
          min-width: 0;
          @container admin-shell (max-width: 680px) {
            display: none;
          }
        `}
      >
        <span
          css={`
            display: inline-flex;
            align-items: center;
            gap: var(--admin-space-4);
          `}
        >
          <Button
            variant="secondary"
            label="Saved rules"
            onClick={() => urlAtom.go('/filters')}
          />
          <span
            aria-hidden="true"
            css={`
              ${type.meta}
              min-width: 1.15rem;
              height: 16px;
              padding-inline: 5px;
              border-radius: 999px;
              background: ${tokens.surface3};
              color: ${tokens.text2};
              display: inline-flex;
              align-items: center;
              justify-content: center;
            `}
          >
            {savedCount}
          </span>
        </span>
        <span css={visuallyHidden}>
          {() => `${savedCount()} active rule(s)`}
        </span>
      </div>
    </div>
  )
}
