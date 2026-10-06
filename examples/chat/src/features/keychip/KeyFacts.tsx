import { keyFacts, type KeyFacts as KeyFactValues } from './model'

const factRows = (
  facts: KeyFactValues,
): Array<{ label: string; value: string }> => [
  { label: 'Limit', value: facts.limit },
  { label: 'Remaining', value: facts.remaining },
  ...(facts.reset ? [{ label: 'Reset', value: facts.reset }] : []),
  { label: 'Today', value: facts.usageDaily },
  { label: 'This week', value: facts.usageWeekly },
  { label: 'This month', value: facts.usageMonthly },
  { label: 'BYOK this month', value: facts.byokUsageMonthly },
]

export const KeyFacts = ({ quiet = false }: { quiet?: boolean }) => (
  <div data-key-facts="">
    {() => {
      const facts = keyFacts()
      if (!facts) return null
      return (
        <div
          css={`
            display: grid;
            gap: ${quiet ? 'var(--space-3)' : 'var(--space-2)'};
          `}
        >
          <p
            data-key-label=""
            css={`
              margin: 0;
              font-family: var(--font-display);
              font-size: ${quiet ? 'var(--text-md)' : 'var(--text-sm)'};
              font-weight: var(--weight-medium);
              line-height: var(--leading-tight);
              letter-spacing: var(--tracking-display);
              overflow-wrap: anywhere;
            `}
          >
            {facts.label}
          </p>
          <dl
            css={`
              display: grid;
              gap: ${quiet ? 'var(--space-1-5)' : '0.125rem'};
              margin: 0;

              & div {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: var(--space-4);
                align-items: baseline;
              }

              & dt,
              & dd {
                margin: 0;
                line-height: ${quiet ? 'var(--leading-snug)' : '1.2'};
              }

              & dt {
                color: var(--text-muted);
                font-size: var(--text-sm);
              }

              & dd {
                color: var(--text);
                font-size: var(--text-sm);
                font-variant-numeric: tabular-nums;
                text-align: end;
              }
            `}
          >
            {factRows(facts).map((row) => (
              <div>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          {facts.freeTier ? (
            <p
              css={`
                margin: 0;
                color: var(--text-muted);
                font-size: var(--text-sm);
              `}
            >
              Free-tier key
            </p>
          ) : null}
        </div>
      )
    }}
  </div>
)
