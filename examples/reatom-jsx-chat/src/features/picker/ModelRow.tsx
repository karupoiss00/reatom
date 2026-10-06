import { catalogNewIds, modelPriceLabel, toggleFavorite } from '../../catalog'
import type { CatalogModel } from '../../catalog'
import { formatContextLength } from '../../money'
import { favoriteModels } from '../../storage/prefs'
import { Badge } from '../../ui'
import { resetButton } from '../../ui/mixins'
import {
  activeIndex,
  comparePicks,
  listed,
  modelReleaseLabel,
  optionDomId,
  picker,
  type PickerRow,
} from './model'

const badgeLabels = (model: CatalogModel) => {
  const labels: string[] = []
  if (model.inputModalities.includes('image')) labels.push('Image in')
  if (model.inputModalities.includes('file')) labels.push('File in')
  if (model.isReasoning) labels.push('Reasoning')
  if (model.isModerated) labels.push('Moderated')
  return labels
}

const StarIcon = ({ filled }: { filled: boolean }) => (
  <svg:svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    css="width: 1rem; height: 1rem; display: block;"
  >
    <svg:path
      d="M12 3.4 14.6 9l6 .55-4.55 3.9 1.4 5.85L12 16.7 6.55 19.3 7.95 13.45 3.4 9.55 9.4 9z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linejoin="round"
    />
  </svg:svg>
)

const rowStyles = `
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  border-radius: var(--radius-md);

  &[data-active='true'] {
    background: var(--accent-soft);
  }

  &:hover {
    background: var(--surface-hover);
  }

  &[data-active='true']:hover {
    background: var(--accent-soft-hover);
  }

  &[data-compare-selected='true'] {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  &[data-compare-selected='true']:hover,
  &[data-compare-selected='true'][data-active='true']:hover {
    background: var(--accent-soft-hover);
  }
`

const isActive = (key: string) => listed()[activeIndex()]?.key === key

export const ModelOption = ({
  row,
  onSelect,
}: {
  row: Extract<PickerRow, { kind: 'model' }>
  onSelect: (modelId: string) => void
}) => {
  const { model, section, key } = row
  const starred = favoriteModels().includes(model.id)
  const price = modelPriceLabel(model)
  const context = Number.isFinite(model.contextLength)
    ? formatContextLength(model.contextLength)
    : ''
  const labels = badgeLabels(model)
  const isNew = section === 'all' && catalogNewIds().includes(model.id)
  const release = modelReleaseLabel(model.created)
  const releaseIso =
    typeof model.created === 'number' && model.created > 0
      ? new Date(model.created).toISOString().slice(0, 10)
      : ''
  return (
    <div
      data-model-id={model.id}
      data-active={() => (isActive(key) ? 'true' : 'false')}
      data-compare-selected={() =>
        comparePicks().includes(model.id) ? 'true' : 'false'
      }
      css={rowStyles}
    >
      <button
        type="button"
        aria-label={starred ? `Unstar ${model.name}` : `Star ${model.name}`}
        aria-pressed={starred ? 'true' : 'false'}
        on:click={(event) => {
          event.stopPropagation()
          toggleFavorite(model.id)
        }}
        css={`
          ${resetButton}
          display: grid;
          place-items: center;
          align-self: stretch;
          width: var(--hit);
          color: var(--text-muted);
          cursor: pointer;

          &[aria-pressed='true'] {
            color: var(--accent);
          }

          &:hover {
            color: var(--accent-text);
          }
        `}
      >
        <StarIcon filled={starred} />
      </button>
      <div
        id={optionDomId(key)}
        role="option"
        aria-selected={() => (isActive(key) ? 'true' : 'false')}
        on:click={() => onSelect(model.id)}
        css={`
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          column-gap: var(--space-3);
          row-gap: 0;
          min-width: 0;
          padding: var(--space-2) var(--space-2) var(--space-2) 0;
          border-radius: var(--radius-sm);
          cursor: pointer;
          text-align: start;
        `}
      >
        <span
          css={`
            overflow: hidden;
            color: var(--text);
            font-size: var(--text-sm);
            font-weight: var(--weight-medium);
            line-height: var(--leading-snug);
            text-overflow: ellipsis;
            white-space: nowrap;
          `}
        >
          {model.name}
        </span>
        <span
          css={`
            color: var(--text);
            font-size: var(--text-sm);
            font-variant-numeric: tabular-nums;
            line-height: var(--leading-snug);
            white-space: nowrap;
          `}
        >
          {price}
        </span>
        <span
          css={`
            overflow: hidden;
            color: var(--text-muted);
            font-family: var(--font-mono);
            font-size: var(--text-xs);
            line-height: var(--leading-snug);
            text-overflow: ellipsis;
            white-space: nowrap;
          `}
        >
          {model.id}
        </span>
        <span
          css={`
            display: flex;
            align-items: baseline;
            justify-content: flex-end;
            gap: var(--space-2);
            min-width: 0;
            color: var(--text-muted);
            font-size: var(--text-xs);
            font-variant-numeric: tabular-nums;
            line-height: var(--leading-snug);
            white-space: nowrap;
          `}
        >
          {release ? (
            <time
              class="model-release-date"
              data-testid="model-release-date"
              datetime={releaseIso}
              css={`
                flex: none;
              `}
            >
              {release}
            </time>
          ) : null}
          {context ? <span>{context}</span> : null}
        </span>
        {() =>
          comparePicks().includes(model.id) ? (
            <span
              data-compare-pick=""
              css={`
                grid-column: 1 / -1;
                justify-self: start;
                display: inline-flex;
                align-items: center;
                min-height: 1.25rem;
                margin-top: var(--space-1);
                padding: 0 var(--space-2);
                border-radius: var(--radius-pill);
                background: var(--accent-soft-hover);
                color: var(--accent-text);
                font-size: var(--text-xs);
                font-weight: var(--weight-medium);
                line-height: var(--leading-none);
                white-space: nowrap;
              `}
            >
              Selected
            </span>
          ) : null
        }
        {labels.length === 0 && !isNew ? null : (
          <span
            css={`
              display: flex;
              flex-wrap: wrap;
              grid-column: 1 / -1;
              gap: var(--space-1);
              margin-top: var(--space-1-5);
            `}
          >
            {isNew ? <Badge tone="accent">New</Badge> : null}
            {labels.map((label) => (
              <Badge>{label}</Badge>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

export const CustomOffer = ({
  onSelect,
  placeholder = false,
}: {
  onSelect: (modelId: string) => void
  placeholder?: boolean
}) => {
  const id = picker.sections().customOffer
  if (!id && !placeholder) return null
  const label = id ? `Use \`${id}\` as model id` : 'Use a custom model id'
  const key = id ? `custom:${id}` : ''
  const active = key !== '' && isActive(key)
  return (
    <div
      data-custom-id=""
      id={key ? optionDomId(key) : undefined}
      role="option"
      aria-selected={active ? 'true' : 'false'}
      data-active={active ? 'true' : 'false'}
      on:click={() => {
        if (id) onSelect(id)
        else {
          document
            .querySelector<HTMLInputElement>('[data-slot="ModelPicker"] input')
            ?.focus()
        }
      }}
      css={`
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--space-3);
        min-height: var(--hit);
        margin-top: var(--space-2);
        padding: var(--space-2) var(--space-3);
        border: 1px dashed var(--line-strong);
        border-radius: var(--radius-md);
        background: var(--bg-sunken);
        color: var(--text);
        cursor: pointer;

        &[data-active='true'] {
          border-style: solid;
          border-color: var(--accent);
          background: var(--accent-soft);
        }
      `}
    >
      <span
        css={`
          min-width: 0;
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
        `}
      >
        {label}
      </span>
      <Badge tone="accent">Custom</Badge>
    </div>
  )
}

export const sectionLabelStyles = `
  margin: 0;
  padding: var(--space-3) var(--space-2) var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-xs);
  font-weight: var(--weight-medium);
  letter-spacing: 0.04em;
  line-height: var(--leading-snug);
`
