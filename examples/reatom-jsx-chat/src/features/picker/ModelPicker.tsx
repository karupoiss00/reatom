import { ui } from '../../app/ui'
import { catalogById, catalogFetchedAt, catalogStatus, refreshCatalog } from '../../catalog'
import { activeChat, regenerate } from '../../chat'
import { favoriteModels, recentModels } from '../../storage/prefs'
import { Button, Chip, Dialog, Icon, Skeleton, Spinner, Switch, TextField } from '../../ui'
import { announce } from '../../ui/LiveRegion'
import { resetButton } from '../../ui/mixins'
import { resolvedTheme } from '../layout/theme'
import { CustomOffer, ModelOption, sectionLabelStyles } from './ModelRow'
import {
  activeIndex,
  bindPickerLifecycle,
  catalogFooterLead,
  closePicker,
  cursor,
  filtering,
  compareMode,
  comparePicks,
  finishPickerDismiss,
  listed,
  noteCustomModel,
  optionDomId,
  picker,
  pickerEpoch,
  pickerOpen,
  refreshFailedNote,
  toggleCompareModel,
} from './model'

const selectModel = (modelId: string) => {
  const request = ui.picker()
  const chat = activeChat()
  if (request?.purpose === 'chat' && compareMode()) {
    noteCustomModel(modelId)
    toggleCompareModel(modelId)
    return
  }
  if (request?.purpose === 'chat') {
    noteCustomModel(modelId)
    chat.setModel(modelId)
    announce(catalogById().get(modelId)?.name ?? modelId)
  } else if (
    request?.purpose === 'regenerate' &&
    request.messageId &&
    chat.id !== 'new'
  ) {
    regenerate(chat.id, request.messageId, { model: modelId })
  }
  closePicker()
}

const move = (delta: number) => {
  const rows = listed()
  if (rows.length === 0) return
  const next = (activeIndex() + delta + rows.length) % rows.length
  cursor.set(next)
  const key = rows[next]?.key
  if (!key) return
  queueMicrotask(() => {
    document.getElementById(optionDomId(key))?.scrollIntoView({ block: 'nearest' })
  })
}

const onPickerKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    closePicker()
    return
  }
  if (event.target instanceof HTMLSelectElement) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
    return
  }
  if (event.key !== 'Enter') return
  if (
    event.target instanceof HTMLElement &&
    event.target.closest(
      'button, a, select, [data-testid="model-picker-compare-switch"]',
    )
  ) {
    return
  }
  const row = listed()[activeIndex()]
  if (!row) return
  event.preventDefault()
  selectModel(row.kind === 'custom' ? row.id : row.model.id)
}

const SkeletonList = () => (
  <div
    aria-busy="true"
    css={`
      display: grid;
      gap: var(--space-4);
      padding: var(--space-3) 0;
    `}
  >
    {Array.from({ length: 6 }, () => (
      <span
        css={`
          display: grid;
          gap: var(--space-2);
        `}
      >
        <Skeleton width="42%" height="0.9rem" radius="var(--radius-pill)" />
        <Skeleton width="78%" height="0.7rem" radius="var(--radius-pill)" />
      </span>
    ))}
  </div>
)

const CatalogNotice = ({ sentence }: { sentence: string }) => (
  <div
    css={`
      display: grid;
      justify-items: start;
      gap: var(--space-3);
      padding: var(--space-5) 0 var(--space-2);
    `}
  >
    <p
      css={`
        margin: 0;
        font-family: var(--font-display);
        font-size: var(--text-md);
        line-height: var(--leading-snug);
      `}
    >
      {sentence}
    </p>
    <Button
      variant="secondary"
      size="sm"
      on:click={() => {
        refreshCatalog().catch(() => {})
      }}
    >
      Retry
    </Button>
    <CustomOffer placeholder onSelect={selectModel} />
  </div>
)

const CompareSwitch = () => (
  <span
    class="model-picker-compare"
    css={`
      display: inline-flex;
      align-items: center;
      min-height: var(--control-height-compact);

      & label {
        min-height: var(--control-height-compact);
        gap: var(--space-2);
        padding-block: 0;
      }

      & [data-toggle-label] {
        color: var(--text);
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        line-height: var(--leading-none);
        white-space: nowrap;
      }
    `}
  >
    <Switch
      label="Compare"
      checked={compareMode}
      data-testid="model-picker-compare-switch"
      aria-label="Compare models"
      attr:aria-pressed={() => (compareMode() ? 'true' : 'false')}
    />
  </span>
)

const sortChevronStroke = { light: '#5f5d56', dark: '#b0ada4' } as const

const sortChevron = (stroke: string) => {
  const color = stroke.replace('#', '%23')
  return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='1.75' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6.5 9.5 5.5 5.5 5.5-5.5'/%3E%3C/svg%3E")`
}

const sortFieldStyles = (theme: keyof typeof sortChevronStroke) => `
  appearance: none;
  height: var(--control-height-compact);
  padding-block: 0;
  padding-inline: var(--space-3) calc(var(--space-3) + 0.875rem + var(--space-2));
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-pill);
  background-color: var(--bg-elevated);
  background-image: ${sortChevron(sortChevronStroke[theme])};
  background-repeat: no-repeat;
  background-position: right var(--space-3) center;
  background-size: 0.875rem 0.875rem;
  box-shadow: var(--shadow-1);
  color: var(--text);
  font: inherit;
  font-size: var(--text-sm);
  font-weight: var(--weight-medium);
  line-height: calc(var(--control-height-compact) - 2px);
  cursor: pointer;

  &:focus-visible {
    outline: var(--focus-width) solid var(--focus);
    outline-offset: var(--focus-offset);
  }
`

const FilterBar = () => (
  <div
    css={`
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--space-2);
      padding-bottom: var(--space-2);
    `}
  >
    <Chip
      selected={picker.chips.free}
      on:click={() => picker.chips.free.set((value) => !value)}
    >
      Free
    </Chip>
    <Chip
      selected={picker.chips.reasoning}
      on:click={() => picker.chips.reasoning.set((value) => !value)}
    >
      Reasoning
    </Chip>
    <Chip
      selected={picker.chips.images}
      on:click={() => picker.chips.images.set((value) => !value)}
    >
      Images
    </Chip>
    <Chip
      selected={picker.chips.longContext}
      on:click={() => picker.chips.longContext.set((value) => !value)}
    >
      Long context (≥200k)
    </Chip>
    <label
      css={`
        display: inline-flex;
        align-items: center;
        gap: var(--space-2);
        margin-left: auto;
        color: var(--text-muted);
        font-size: var(--text-sm);
        line-height: var(--leading-none);
      `}
    >
      Sort
      <select
        aria-label="Sort"
        model:value={picker.sort}
        css={() => sortFieldStyles(resolvedTheme())}
      >
        <option value="match">Best match</option>
        <option value="price">Price</option>
        <option value="context">Context</option>
      </select>
    </label>
  </div>
)

const quietNote = `
  margin: 0;
  padding: 0 var(--space-2) var(--space-2);
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const Sections = () => {
  const data = picker.sections()
  const narrowed = filtering()
  const favoritesSaved = favoriteModels()
  const recentSaved = recentModels()
  const rowsFor = (section: 'favorites' | 'recent' | 'all') =>
    data[section].map((model) => (
      <ModelOption
        row={{ key: `${section}:${model.id}`, kind: 'model', section, model }}
        onSelect={selectModel}
      />
    ))
  const ownedOptionIds = listed()
    .map((row) => optionDomId(row.key))
    .join(' ')
  return (
    <div
      id="model-picker-list"
      css={`
        display: grid;
        align-content: start;
        position: relative;
      `}
    >
      <div
        id="model-picker-listbox"
        role="listbox"
        aria-label="Models"
        aria-owns={ownedOptionIds}
        css={`
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0 0 0 0);
          white-space: nowrap;
          border: 0;
        `}
      />
      <div
        css={`
          overflow: auto;
          max-height: min(22rem, calc(100dvh - 28rem));
        `}
      >
        {!narrowed || data.favorites.length > 0 ? (
          <section data-picker-section="favorites">
            <h3 css={sectionLabelStyles}>Favorites</h3>
            {favoritesSaved.length === 0 ? (
              <p css={quietNote}>Star models to keep them here</p>
            ) : (
              rowsFor('favorites')
            )}
          </section>
        ) : null}
        {!narrowed || data.recent.length > 0 ? (
          <section data-picker-section="recent">
            <h3 css={sectionLabelStyles}>Recent</h3>
            {recentSaved.length === 0 ? (
              <p css={quietNote}>Models you pick show up here</p>
            ) : (
              rowsFor('recent')
            )}
          </section>
        ) : null}
        <section data-picker-section="all">
          <h3 css={sectionLabelStyles}>All models</h3>
          {data.all.length > 0 ? (
            rowsFor('all')
          ) : (
            <p css={quietNote}>
              {narrowed ? 'No models match these filters.' : 'No models yet.'}
            </p>
          )}
          <CustomOffer onSelect={selectModel} />
        </section>
      </div>
    </div>
  )
}

const RefreshFailedBanner = () => {
  const note = refreshFailedNote()
  if (!note) return null
  return (
    <p
      data-refresh-failed=""
      role="status"
      css={`
        display: flex;
        align-items: center;
        gap: var(--space-2);
        margin: 0 0 var(--space-3);
        padding: var(--space-2) var(--space-4);
        border: 1px solid var(--inverse-line);
        border-radius: var(--radius-md);
        background: var(--inverse-bg);
        box-shadow: var(--shadow-3);
        color: var(--inverse-text);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);
      `}
    >
      <Icon name="warning" size="1.125rem" />
      <span>{note}</span>
    </p>
  )
}

const PickerBody = () => {
  const status = catalogStatus()
  if (status === 'loading') return <SkeletonList />
  if (status === 'error') return <CatalogNotice sentence="Couldn't load models." />
  if (status === 'empty') {
    return <CatalogNotice sentence="OpenRouter returned no models." />
  }
  return (
    <>
      <RefreshFailedBanner />
      <FilterBar />
      <Sections />
    </>
  )
}

const CatalogFooter = () => {
  const status = catalogStatus()
  if (status === 'loading' || status === 'empty' || status === 'error') return null
  const refreshing = status === 'revalidating'
  const { tone, lead } = catalogFooterLead(status, catalogFetchedAt())
  return (
    <div
      data-catalog-footer=""
      data-tone={tone}
      aria-busy={refreshing ? 'true' : 'false'}
      css={`
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        width: 100%;
        min-height: 2.5rem;
        color: var(--text-muted);
        font-size: var(--text-sm);
        line-height: var(--leading-snug);

        &[data-tone='warning'] {
          margin: calc(var(--space-3) * -1) calc(var(--space-5) * -1)
            calc(var(--space-5) * -1);
          padding: var(--space-3) var(--space-5) var(--space-5);
          background: var(--warning-soft);
          color: var(--warning);
        }
      `}
    >
      {refreshing ? <Spinner label="Updating catalog" size="1rem" /> : null}
      <span>{lead}</span>
      <span aria-hidden="true">{' · '}</span>
      <button
        type="button"
        disabled={refreshing}
        on:click={() => {
          refreshCatalog().catch(() => {})
        }}
        css={`
          ${resetButton}
          min-height: var(--hit);
          padding: 0 var(--space-2);
          color: inherit;
          font: inherit;
          font-weight: var(--weight-medium);
          text-decoration: underline;
          text-underline-offset: 0.18em;
          cursor: pointer;

          &:disabled {
            cursor: progress;
            opacity: 0.7;
          }
        `}
      >
        Refresh
      </button>
    </div>
  )
}

const bindDialogChrome = (node: HTMLElement) => {
  const dialog = node.closest('dialog')
  const markIntentionalClose = (event: Event) => {
    const target = event.target
    if (!(target instanceof Node) || !dialog) return
    if (target instanceof Element && target.closest('[data-dialog-close]')) {
      closePicker()
      return
    }
    if (event.target !== dialog || !(event instanceof MouseEvent)) return
    const rect = dialog.getBoundingClientRect()
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    if (outside) closePicker()
  }
  dialog?.addEventListener('click', markIntentionalClose, true)
  return () => {
    dialog?.removeEventListener('click', markIntentionalClose, true)
  }
}

export const ModelPicker = () => (
  <div ref={() => bindPickerLifecycle()} css="display: contents;">
    <span
      data-testid="model-picker-compare-models"
      hidden
      data-model-ids={() => comparePicks().join(',')}
    />
    {() => {
      pickerEpoch()
      return (
        <Dialog
          open={pickerOpen}
          title="Choose a model"
          size="lg"
          actions={() =>
            ui.picker()?.purpose === 'chat' ? <CompareSwitch /> : null
          }
          onClose={finishPickerDismiss}
          footer={() => <CatalogFooter />}
        >
          <div
            data-slot="ModelPicker"
            on:keydown={onPickerKeyDown}
            ref={bindDialogChrome}
          >
            <TextField
              label="Search models"
              labelHidden
              type="search"
              leadingIcon="search"
              placeholder="Search by name or id"
              value={picker.query}
              autofocus
              attr:aria-controls="model-picker-listbox"
              attr:aria-activedescendant={() => {
                const row = listed()[activeIndex()]
                return row ? optionDomId(row.key) : null
              }}
              attr:aria-autocomplete="list"
            />
            {() => <PickerBody />}
          </div>
        </Dialog>
      )
    }}
  </div>
)
