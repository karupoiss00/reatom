import {
  atom,
  type Atom,
  type AtomLike,
  computed,
  effect,
  peek,
} from '@reatom/core'

import {
  focusVisible,
  Icon,
  tokens,
  type,
  visuallyHidden,
} from '../design-system'
import {
  collectionTagText,
  createInspectorFields,
  formatLeaf,
  type InspectorFieldModel,
  type InspectorHooks,
  INSPECTOR_PAGE_SIZE,
  type InspectorTone,
  collectionPreviewBody,
  readFieldPage,
} from './model'

export interface InspectorProps {
  /** Value to render. Pass an atom so later writes reuse this tree. */
  value: AtomLike<unknown>
  hooks?: InspectorHooks
  /** Root starts open. Nested values start closed until the caret is used. */
  defaultExpanded?: boolean
  /** Observable cell prefix, rendered as `name = `. */
  name?: string
}

let serial = 0

const nextName = (slot: string) => {
  serial += 1
  return `_Admin.inspector.${slot}.${serial}`
}

const toneColor: Record<InspectorTone, string> = {
  text: tokens.text1,
  string: tokens.info,
  number: tokens.success,
  boolean: tokens.warning,
  null: tokens.warning,
  undefined: tokens.warning,
  date: tokens.success,
  regexp: tokens.success,
  symbol: tokens.accent,
  function: tokens.accent,
  error: tokens.error,
  forbidden: tokens.accent,
  empty: tokens.text3,
  key: tokens.accent,
}

const inspectorCss = `
  ${type.data}
  display: block;
  min-width: 0;
  overflow-x: auto;
  white-space: pre-wrap;
  color: ${tokens.text1};
`

const caretButtonCss = `
  ${focusVisible}
  display: inline;
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: inherit;
  cursor: pointer;
  vertical-align: baseline;
`

const fieldCss = `
  display: block;
  margin-left: 1em;
  text-indent: -1em;
`

const keyCss = `
  color: ${tokens.accent};
`

const atomLinkCss = `
  ${focusVisible}
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-inline: 0.25em;
  padding: 0;
  border: 0;
  border-radius: var(--admin-radius-2);
  background: transparent;
  color: ${tokens.accent};
  vertical-align: middle;
  cursor: pointer;
`

const moreCss = `
  ${focusVisible}
  display: block;
  margin: 0 0 0 1em;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${tokens.text2};
  font: inherit;
  cursor: pointer;
  &[hidden] {
    display: none !important;
  }
`

const stringExpandCss = `
  ${focusVisible}
  margin-inline-start: 0.5em;
  padding: 0;
  border: 0;
  background: transparent;
  color: ${tokens.text2};
  font: inherit;
  cursor: pointer;
`

const Caret = ({ expanded }: { expanded: Atom<boolean> }) => (
  <svg:svg
    width="8"
    height="8"
    viewBox="0 0 8 8"
    aria-hidden="true"
    css={`
      display: inline-block;
      margin-right: 0.35em;
      vertical-align: middle;
    `}
  >
    <svg:path
      d={() => (expanded() ? 'M4 7L0 1h8z' : 'M7 4L1 8V0z')}
      fill="currentColor"
    />
  </svg:svg>
)

const LeafView = ({ value }: { value: AtomLike<unknown> }) => {
  const full = atom(false, nextName('string'))
  return (
    <span data-inspector-leaf="">
      <span
        data-tone={() => formatLeaf(value()).tone}
        style:color={() =>
          toneColor[formatLeaf(value(), full() ? 'full' : 'shallow').tone]
        }
      >
        {() => formatLeaf(value(), full() ? 'full' : 'shallow').text}
      </span>
      {() => {
        const current = value()
        if (typeof current !== 'string' || current.length <= 100 || full()) {
          return null
        }
        return (
          <button
            type="button"
            css={stringExpandCss}
            on:click={() => full.set(true)}
          >
            Show truncated
          </button>
        )
      }}
    </span>
  )
}

const PreviewLine = ({
  value,
  hooks,
}: {
  value: AtomLike<unknown>
  hooks: InspectorHooks
}) => (
  <span data-inspector-preview="">
    {() =>
      collectionPreviewBody(value(), hooks).map((part) => (
        <span
          data-tone={part.tone}
          style:color={toneColor[part.tone]}
          css={part.tone === 'empty' ? 'font-style: italic;' : ''}
        >
          {part.text}
        </span>
      ))
    }
  </span>
)

const FieldView = ({
  row,
  hooks,
}: {
  row: InspectorFieldModel
  hooks: InspectorHooks
}) => (
  <div
    data-inspector-key={row.fieldKey}
    data-inspector-id={row.id}
    css={fieldCss}
  >
    <span css={keyCss}>{() => row.label()}</span>
    {() =>
      row.actions().map((action) => (
        <button
          type="button"
          aria-label={action.label}
          title={action.label}
          data-testid="inspector-atom-link"
          css={atomLinkCss}
          on:click={(event: MouseEvent) => {
            event.stopPropagation()
            action.onClick()
          }}
        >
          <Icon name="timeline" />
          <span css={visuallyHidden}>{action.label}</span>
        </button>
      ))
    }
    <span>{': '}</span>
    <ValueView value={row.value} hooks={hooks} />
  </div>
)

const CollectionView = ({
  value,
  hooks,
  defaultExpanded,
}: {
  value: AtomLike<unknown>
  hooks: InspectorHooks
  defaultExpanded: boolean
}) => {
  const open = atom(
    defaultExpanded || hooks.initiallyExpanded?.(peek(value)) === true,
    nextName('open'),
  )
  const shown = atom(INSPECTOR_PAGE_SIZE, nextName('shown'))
  const truncated = atom(false, nextName('truncated'))
  const fields = createInspectorFields(nextName('fields'))
  const fieldViews = fields.rows.reatomMap(
    (row) => <FieldView row={row} hooks={hooks} />,
    nextName('rows'),
  )
  const bracket = (kind: 'open' | 'close') => {
    const summary = collectionTagText(value(), hooks)
    if (!summary) return ''
    if (kind === 'close') return summary.arrayish ? ']' : '}'
    return `${summary.tag}${summary.arrayish ? ' [' : ' {'}`
  }

  return (
    <div
      data-inspector-collection=""
      css={`
        display: inline;
      `}
      ref={() => {
        const stop = effect(() => {
          const expanded = open()
          const limit = shown()
          if (!expanded) {
            fields.clear()
            if (peek(truncated)) truncated.set(false)
            return
          }
          const page = readFieldPage(value(), hooks, limit)
          if (!page) {
            fields.clear()
            if (peek(truncated)) truncated.set(false)
            return
          }
          fields.sync(page.entries)
          if (peek(truncated) !== page.truncated) truncated.set(page.truncated)
        }, nextName('sync'))
        return () => stop.unsubscribe()
      }}
    >
      <button
        type="button"
        data-testid="inspector-expand"
        css={caretButtonCss}
        aria-expanded={open}
        on:click={(event: MouseEvent) => {
          event.stopPropagation()
          open.set((current) => !current)
        }}
      >
        <Caret expanded={open} />
        {() => bracket('open')}
      </button>
      {() => (open() ? null : <PreviewLine value={value} hooks={hooks} />)}
      <div prop:hidden={() => !open()}>
        <div>{fieldViews}</div>
        {() =>
          truncated() ? (
            <button
              type="button"
              css={moreCss}
              on:click={(event: MouseEvent) => {
                event.stopPropagation()
                shown.set((count) => count + INSPECTOR_PAGE_SIZE)
              }}
            >
              … more
            </button>
          ) : null
        }
      </div>
      <span>{() => bracket('close')}</span>
    </div>
  )
}

const ValueView = ({
  value,
  hooks,
  defaultExpanded = false,
}: {
  value: AtomLike<unknown>
  hooks: InspectorHooks
  defaultExpanded?: boolean
}) => {
  const shape = computed(
    () => (collectionTagText(value(), hooks) ? 'collection' : 'leaf'),
    nextName('shape'),
  )

  return (
    <span data-inspector-value="">
      {() => (shape() === 'leaf' ? <LeafView value={value} /> : null)}
      {() =>
        shape() === 'collection' ? (
          <CollectionView
            value={value}
            hooks={hooks}
            defaultExpanded={defaultExpanded}
          />
        ) : null
      }
    </span>
  )
}

/** Expandable value tree in the Observable inspector style. */
export const Inspector = ({
  value,
  hooks = {},
  defaultExpanded = false,
  name,
}: InspectorProps) => (
  <div data-reatom-name="Inspector" css={inspectorCss}>
    {name ? <span css={keyCss}>{`${name} = `}</span> : null}
    <ValueView value={value} hooks={hooks} defaultExpanded={defaultExpanded} />
  </div>
)
