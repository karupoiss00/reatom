import { Button, ChoiceButton, Switch } from '../design-system'
import {
  clearFilterTypes,
  clearFilters,
  filterSizeMaxKb,
  filterSizeMinKb,
  filterTypes,
  IMAGE_TYPE_OPTIONS,
  includeSubfolders,
  searchQuery,
  setFilterSizeMaxKb,
  setFilterSizeMinKb,
  toggleFilterType,
} from '../model'
import { fieldCss } from './fieldStyles'
import { Panel } from './Panel'
import { filterPanelWidth } from './panelLayout'
import { filterPanelOpen } from './panelState'

export const FilterPanel = () => (
  <Panel
    label="Filters"
    closeLabel="Close filters"
    open={filterPanelOpen}
    onClose={() => filterPanelOpen.set(false)}
    width={filterPanelWidth}
  >
    <div css="margin-bottom: 16px;">
      <input
        type="search"
        placeholder="Search by filename..."
        aria-label="Search by filename"
        model:value={searchQuery}
        css={`
          width: 100%;
          ${fieldCss}
        `}
      />
    </div>

    <h3
      css={`
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin-bottom: 8px;
      `}
    >
      File Types
    </h3>
    <div
      css={`
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: calc(6px + var(--shadow-clearance, 0px));
        margin-bottom: 16px;
      `}
    >
      <ChoiceButton
        label="All types"
        selected={() => filterTypes().size === 0}
        onClick={clearFilterTypes}
        css="grid-column: 1 / -1;"
      />
      {IMAGE_TYPE_OPTIONS.map((option) => (
        <ChoiceButton
          label={option.label}
          selection="checked"
          selected={() => filterTypes().has(option.ext)}
          onClick={() => toggleFilterType(option.ext)}
          css="min-width: 0; padding-inline: 6px;"
        />
      ))}
    </div>

    <h3
      css={`
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--text-secondary);
        margin-bottom: 8px;
      `}
    >
      File Size (KB)
    </h3>
    <div css="display: flex; gap: 8px; margin-bottom: 16px;">
      <input
        type="number"
        placeholder="Min"
        aria-label="Minimum file size in KB"
        value={filterSizeMinKb}
        on:input={(event: Event & { currentTarget: HTMLInputElement }) =>
          setFilterSizeMinKb(Number(event.currentTarget.value))
        }
        css={`
          width: 50%;
          ${fieldCss}
        `}
      />
      <input
        type="number"
        placeholder="Max"
        aria-label="Maximum file size in KB"
        value={filterSizeMaxKb}
        on:input={(event: Event & { currentTarget: HTMLInputElement }) => {
          const value = event.currentTarget.value
          if (value === '') {
            setFilterSizeMaxKb(null)
            return
          }
          setFilterSizeMaxKb(Number(value))
        }}
        css={`
          width: 50%;
          ${fieldCss}
        `}
      />
    </div>

    <div css="margin-bottom: 16px;">
      <Switch
        label="Include Subfolders"
        checked={includeSubfolders}
        onToggle={includeSubfolders.toggle}
      />
    </div>

    <Button
      appearance="quiet"
      label="Clear All Filters"
      onClick={clearFilters}
      css="width: 100%;"
    />
  </Panel>
)
