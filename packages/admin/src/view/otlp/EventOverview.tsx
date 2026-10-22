import type { AdminRecord } from '../../otlp'
import { tokens, type } from '../design-system'
import { isExpandableValue } from '../inspector'
import {
  eventOverviewError,
  overviewEventSections,
  type EventOverviewEntry,
} from './frameValues'
import { SnapshotInspector } from './SnapshotInspector'

const LONG_VALUE_CHARS = 120

export const EventOverview = ({ record }: { record: AdminRecord }) => {
  const sections = overviewEventSections(record)
  const errorLabel = eventOverviewError(record)
  return (
    <div
      data-reatom-name="EventOverview"
      css={`
        display: grid;
        gap: var(--admin-space-12);
        min-width: 0;
      `}
    >
      {errorLabel ? (
        <p
          role="alert"
          css={`
            ${type.body}
            margin: 0;
            color: ${tokens.error};
          `}
        >
          {errorLabel}
        </p>
      ) : null}
      {sections.length === 0 ? (
        <p
          css={`
            ${type.meta}
            margin: 0;
            color: ${tokens.text2};
          `}
        >
          No attributes
        </p>
      ) : null}
      {sections.map((section) => (
        <section
          css={`
            display: grid;
            gap: var(--admin-space-4);
            min-width: 0;
          `}
        >
          <h3
            css={`
              ${type.ui}
              margin: 0;
            `}
          >
            {section.title}
          </h3>
          <dl
            css={`
              display: grid;
              grid-template-columns: max-content minmax(0, 1fr);
              column-gap: var(--admin-space-8);
              row-gap: var(--admin-space-4);
              align-items: start;
              min-width: 0;
              margin: 0;
            `}
          >
            {section.entries.map((entry) => (
              <EventAttributeRow entry={entry} />
            ))}
          </dl>
        </section>
      ))}
    </div>
  )
}

function isLongEventValue(key: string, display: string): boolean {
  return key === 'exception.stacktrace' || display.length > LONG_VALUE_CHARS
}

const EventAttributeRow = ({ entry }: { entry: EventOverviewEntry }) => (
  <div
    css={`
      display: contents;
    `}
  >
    <dt
      css={`
        ${type.data}
        margin: 0;
        color: ${tokens.text2};
      `}
    >
      {entry.key}
    </dt>
    <dd
      css={`
        margin: 0;
        min-width: 0;
      `}
    >
      <EventAttributeValue entry={entry} />
    </dd>
  </div>
)

const EventAttributeValue = ({ entry }: { entry: EventOverviewEntry }) => {
  if (isExpandableValue(entry.value)) {
    return <SnapshotInspector value={entry.value} />
  }
  if (isLongEventValue(entry.key, entry.display)) {
    return (
      <pre
        title={entry.title}
        css={`
          ${type.data}
          margin: 0;
          min-width: 0;
          overflow-wrap: anywhere;
          white-space: pre-wrap;
        `}
      >
        {entry.display}
      </pre>
    )
  }
  return (
    <span
      title={entry.title}
      css={`
        ${type.data}
        min-width: 0;
        overflow-wrap: anywhere;
      `}
    >
      {entry.display}
    </span>
  )
}
