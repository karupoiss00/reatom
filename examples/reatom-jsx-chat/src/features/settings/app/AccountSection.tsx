import { computed, withAsyncData, wrap } from '@reatom/core'

import { ui } from '../../../app/ui'
import { keyStatus } from '../../../auth'
import { modelName } from '../../../catalog'
import { formatUsd } from '../../../money/format'
import { spendByDay, spendByModel, type SpendRow } from '../../../money/spend'
import { repo } from '../../../storage/repo'
import type { AssistantMessage } from '../../../storage/types'
import { Button, Skeleton } from '../../../ui'
import { KeyFacts } from '../../keychip/KeyFacts'
import { keyFacts, retryLimit } from '../../keychip/model'

const headingStyles = `
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  line-height: var(--leading-tight);
  letter-spacing: var(--tracking-display);
`

const noteStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
`

const tableStyles = `
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: start;

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr);
  }

  & table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    line-height: var(--leading-snug);
  }

  & caption {
    caption-side: top;
    padding: 0 0 var(--space-2);
    text-align: start;
    font-family: var(--font-display);
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
    letter-spacing: var(--tracking-display);
  }

  & th,
  & td {
    padding: var(--space-1-5) 0;
    border-bottom: 1px solid var(--line);
    vertical-align: baseline;
  }

  & th {
    font-weight: var(--weight-medium);
    text-align: start;
    overflow-wrap: break-word;
  }

  & thead th {
    color: var(--text-muted);
    font-size: var(--text-xs, 0.75rem);
    font-weight: var(--weight-medium);
    letter-spacing: 0.01em;
  }

  & td {
    width: 7.5rem;
    color: var(--text);
    text-align: end;
    white-space: nowrap;
  }

  & tbody th {
    color: var(--text);
    font-weight: var(--weight-regular, 400);
  }

  & tfoot th,
  & tfoot td {
    border-bottom: 0;
    font-weight: var(--weight-semibold);
  }

  & [data-estimate] {
    color: var(--text-muted);
    font-weight: var(--weight-medium);
  }
`

const localSpend = computed(async () => {
  ui.appSettings()
  const messages: AssistantMessage[] = []
  await wrap(
    repo.scanMessages((message) => {
      if (message.role === 'assistant') messages.push(message)
    }),
  )
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    byDay: spendByDay(messages, timeZone, Date.now()),
    byModel: spendByModel(messages),
  }
}, 'features.settings.account.localSpend').extend(withAsyncData())

const ModelSpendName = ({ id }: { id: string }) => {
  const name = modelName(id)
  const splitAt = name.indexOf(': ')
  if (splitAt < 0) return <span>{name}</span>
  return (
    <span>
      {name.slice(0, splitAt)}
      <span css="display: block;">{name.slice(splitAt + 2)}</span>
    </span>
  )
}
const spendAmount = (amount: number, estimated: boolean) => (
  <>
    {formatUsd(amount)}
    {estimated ? <span data-estimate=""> est.</span> : null}
  </>
)

const totalOf = (rows: readonly SpendRow[]): SpendRow => ({
  key: 'Total',
  amount: rows.reduce((sum, row) => sum + row.amount, 0),
  estimated: rows.some((row) => row.estimated),
})

const SpendTable = ({
  label,
  caption,
  heading,
  rows,
  name,
}: {
  label: string
  caption: string
  heading: string
  rows: readonly SpendRow[]
  name: (row: SpendRow) => string
}) => {
  const total = totalOf(rows)
  return (
    <table aria-label={label}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{heading}</th>
          <th scope="col">Spend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr data-spend-key={row.key}>
            <th scope="row">
              {label === 'Spend by model' ? (
                <ModelSpendName id={row.key} />
              ) : (
                name(row)
              )}
            </th>
            <td>{spendAmount(row.amount, row.estimated)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr data-spend-key="Total">
          <th scope="row">Total</th>
          <td>{spendAmount(total.amount, total.estimated)}</td>
        </tr>
      </tfoot>
    </table>
  )
}

const ReadFailure = () => (
  <div
    css={`
      display: grid;
      justify-items: start;
      gap: var(--space-3);
    `}
  >
    <p role="alert" css={noteStyles}>
      Couldn't read local usage.
    </p>
    <Button
      variant="secondary"
      size="sm"
      on:click={() => {
        localSpend.retry().catch(() => {})
      }}
    >
      Retry
    </Button>
  </div>
)

const LocalSpend = () => (
  <section
    data-slot="LocalSpend"
    aria-label="Local usage"
    ref={() => {
      localSpend.retry().catch(() => {})
    }}
    css={`
      display: grid;
      gap: var(--space-3);
      min-width: 0;
    `}
  >
    <div
      css={`
        display: grid;
        gap: var(--space-1);
      `}
    >
      <h3 css={headingStyles}>In this browser</h3>
      <p css={noteStyles}>Spend saved with messages on this device.</p>
    </div>
    {() => {
      if (localSpend.error()) return <ReadFailure />
      const spend = localSpend.data()
      if (!localSpend.ready() || !spend) return <Skeleton lines={4} />
      if (spend.byModel.length === 0) {
        return <p css={noteStyles}>No spend recorded in this browser yet</p>
      }
      return (
        <div css={tableStyles}>
          <SpendTable
            label="Spend by day"
            caption="Last 30 days"
            heading="Day"
            rows={spend.byDay}
            name={(row) => row.key}
          />
          <SpendTable
            label="Spend by model"
            caption="By model"
            heading="Model"
            rows={spend.byModel}
            name={(row) => modelName(row.key)}
          />
        </div>
      )
    }}
  </section>
)

export const AccountSection = () => (
  <section
    data-slot="AccountSection"
    aria-label="Account and usage"
    css={`
      display: grid;
      align-content: start;
      gap: var(--space-5);
      min-width: 0;
    `}
  >
    <div
      css={`
        display: grid;
        gap: var(--space-3);
      `}
    >
      <div
        css={`
          display: grid;
          gap: var(--space-1);
        `}
      >
        <h3 css={headingStyles}>Key</h3>
        <p css={noteStyles}>Spending numbers from this OpenRouter key.</p>
      </div>
      {() => {
        const status = keyStatus()
        if (status === 'loading') {
          return <Skeleton lines={4} />
        }
        if (status === 'unavailable') {
          return (
            <div
              css={`
                display: grid;
                justify-items: start;
                gap: var(--space-3);
              `}
            >
              <p
                css={`
                  margin: 0;
                  color: var(--text);
                  font-size: var(--text-sm);
                `}
              >
                Limit unavailable
              </p>
              <Button variant="secondary" size="sm" on:click={() => retryLimit()}>
                Retry
              </Button>
            </div>
          )
        }
        if (status === 'none' || status === 'revoked' || !keyFacts()) {
          return (
            <p css={noteStyles}>
              {status === 'revoked'
                ? 'Your key was revoked or disabled.'
                : 'No key on this device.'}
            </p>
          )
        }
        return <KeyFacts quiet />
      }}
    </div>
    <LocalSpend />
  </section>
)
