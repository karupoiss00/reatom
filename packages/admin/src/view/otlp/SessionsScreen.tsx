import { computed, effect, peek, wrap } from '@reatom/core'
import type { OtlpAdmin, AdminRecord } from '../../otlp'
import {
  journeySignal,
  sessionPage,
  sessionSource,
  type InvestigationSession,
} from '../../otlp/sessions'
import {
  Button,
  DataGrid,
  EmptyState,
  SearchField,
  SelectField,
  Toolbar,
  tokens,
  type DataGridColumn,
} from '../design-system'
import { formatAxisOffset } from './GanttChart'

export const SessionsScreen = ({ admin }: { admin: OtlpAdmin }) => {
  const model = admin.investigation
  const selectedKey = computed(
    () => model.selected()?.id ?? null,
    '_Admin.sessions.selectedKey',
  )
  const selected = () => model.selected()!
  const openTimeline = (record?: AdminRecord) => {
    const session = model.selected()
    if (!session) return
    admin.resetFilter()
    model.scopeSessionId.set(session.id)
    admin.timelineUnit.set('records')
    admin.view.set('timeline')
    if (record) {
      admin.selectRecord(record)
      admin.cardOpen.setTrue()
    }
  }
  const columns: DataGridColumn<InvestigationSession>[] = [
    {
      id: 'id',
      header: 'Session / capture',
      width: 'minmax(180px, 2fr)',
      render: (session) => (
        <span>
          {session.label}
          <small
            css={`
              display: block;
              color: ${tokens.text3};
            `}
          >
            {sessionSource(session)}
          </small>
        </span>
      ),
    },
    {
      id: 'start',
      header: 'Start',
      width: '170px',
      render: (session) => <span>{new Date(session.start).toISOString()}</span>,
    },
    {
      id: 'duration',
      header: 'Captured duration',
      width: '130px',
      render: (session) => (
        <span>{formatAxisOffset(session.end - session.start)}</span>
      ),
    },
    {
      id: 'pages',
      header: 'Pages',
      width: '60px',
      render: (session) => <span>{String(session.pages)}</span>,
    },
    {
      id: 'errors',
      header: 'Errors',
      width: '60px',
      render: (session) => <span>{String(session.errors)}</span>,
    },
    {
      id: 'records',
      header: 'Records',
      width: '70px',
      render: (session) => <span>{String(session.records.length)}</span>,
    },
    {
      id: 'path',
      header: 'Entry → last',
      width: 'minmax(160px, 1fr)',
      render: (session) => (
        <span>{`${session.entry ?? '—'} → ${session.last ?? '—'}`}</span>
      ),
    },
  ]
  const journeyColumns: DataGridColumn<AdminRecord>[] = [
    {
      id: 'offset',
      header: 'Offset',
      width: '85px',
      render: (record) => (
        <span>
          {formatAxisOffset(
            record.start - (model.selected()?.start ?? record.start),
          )}
        </span>
      ),
    },
    {
      id: 'signal',
      header: 'Signal',
      width: '110px',
      render: (record) => (
        <span>
          {
            {
              errors: 'Error',
              spans: 'Span',
              logs: 'Log',
              measurements: 'Measurement',
            }[journeySignal(record)]
          }
        </span>
      ),
    },
    {
      id: 'event',
      header: 'Event',
      width: 'minmax(160px, 1fr)',
      render: (record) => <span>{record.name}</span>,
    },
    {
      id: 'page',
      header: 'Page',
      width: '140px',
      render: (record) => <span>{sessionPage(record) ?? '—'}</span>,
    },
    {
      id: 'trace',
      header: 'Trace / span',
      width: '180px',
      render: (record) => (
        <span
          title={`${record.traceId} / ${record.spanId}`}
        >{`${record.traceId || '—'} / ${record.spanId || '—'}`}</span>
      ),
    },
    {
      id: 'detail',
      header: 'Detail',
      width: 'minmax(200px, 2fr)',
      render: (record) => (
        <span>
          {record.error?.message ??
            (record.attributes['exception.message'] as string) ??
            (journeySignal(record) === 'measurements'
              ? `${record.attributes['measurement.type']}: ${JSON.stringify(record.attributes['measurement.values'])}`
              : typeof record.body === 'string'
                ? record.body
                : record.body === undefined
                  ? `${record.outcome ?? 'captured'}${record.end === undefined ? '' : ` · ${formatAxisOffset(record.end - record.start)}`}`
                  : 'Structured payload (inspect record)')}
        </span>
      ),
    },
  ]
  return (
    <section
      aria-label="Session investigation"
      css={`
        height: 100%;
        min-height: 0;
        display: flex;
        flex-direction: column;
        color: ${tokens.text1};
        background: ${tokens.canvas};
      `}
    >
      {() => {
        if (selectedKey() === null)
          return (
            <>
              <Toolbar>
                <SearchField
                  value={model.search}
                  label="Search sessions"
                  placeholder="Search sessions"
                  shortcut=""
                />
                <Button
                  variant="ghost"
                  label="Sessions with errors"
                  pressed={model.errorsOnly}
                  onClick={() => model.errorsOnly.set(!model.errorsOnly())}
                >
                  Errors
                </Button>
                <SelectField
                  value={model.sort}
                  label="Sort sessions"
                  options={[
                    'newest',
                    'oldest',
                    'errors',
                    'pages',
                    'duration',
                  ].map((value) => ({
                    value: value as ReturnType<typeof model.sort>,
                    label: value,
                  }))}
                />
              </Toolbar>
              <p css="margin: var(--admin-space-8);">
                {() =>
                  `${model.rows().length} sessions / captures · Diagnostic captures group records by source and resource; no visitor identity is inferred.`
                }
                {admin.source() === 'remote'
                  ? ' · Partial capture: latest 500 records per signal.'
                  : ''}
              </p>
              <Pagination model={model} journey={false} />
              <div
                css="flex: 1; min-height: 0; overflow-x: auto;"
                ref={rememberScroll(model.scrollTop, model.rows)}
              >
                <div css="height: 100%; min-width: 900px; & > [role='grid'] { height: 100%; }">
                  <DataGrid
                    columns={columns}
                    rows={() =>
                      model
                        .rows()
                        .slice(
                          model.listPage() * 100,
                          (model.listPage() + 1) * 100,
                        )
                    }
                    getRowId={(session) => session.id}
                    selectedId={model.selectedId}
                    onSelect={(session) => model.selectedId.set(session.id)}
                    empty={
                      <div>
                        {() => (
                          <EmptyState
                            title={
                              model.sessions().length === 0
                                ? 'No captured sessions or diagnostics.'
                                : 'No matching sessions.'
                            }
                            description="Capture or import OTLP records to investigate sessions and local diagnostics."
                            action={
                              <Button
                                label="Reset session filters"
                                onClick={() => {
                                  model.search.set('')
                                  model.errorsOnly.set(false)
                                }}
                              >
                                Reset filters
                              </Button>
                            }
                          />
                        )}
                      </div>
                    }
                    ariaLabel="Sessions"
                  />
                </div>
              </div>
            </>
          )
        return (
          <>
            <Toolbar>
              <Button
                label="Back to sessions"
                onClick={() => model.selectedId.set(null)}
              >
                Back
              </Button>
              <span>{() => selected().label}</span>
              <Button
                label="Open session in Timeline"
                onClick={() => openTimeline()}
              >
                Open session in Timeline
              </Button>
              <Button
                label="Open selected event in Timeline"
                disabled={() =>
                  !selected().records.some(
                    (record) => record.id === admin.selectedRecordId(),
                  )
                }
                onClick={() => {
                  const record = selected().records.find(
                    (record) => record.id === admin.selectedRecordId(),
                  )
                  if (record) openTimeline(record)
                }}
              >
                Open selected event in Timeline
              </Button>
            </Toolbar>
            <p css="margin: var(--admin-space-8);">
              {() => sessionSource(selected())}
              <br />
              {() =>
                `${selected().records.length} captured records · ${selected().pages} page views · ${selected().errors} errors · Captured duration ${formatAxisOffset(selected().end - selected().start)}`
              }
            </p>
            <Toolbar>
              <SearchField
                value={model.journeySearch}
                label="Search journey"
                placeholder="Search journey"
                shortcut=""
              />
              <SelectField
                value={model.signal}
                label="Journey signal"
                options={['all', 'errors', 'spans', 'logs', 'measurements'].map(
                  (value) => ({
                    value: value as ReturnType<typeof model.signal>,
                    label: value,
                  }),
                )}
              />
            </Toolbar>
            <Pagination model={model} journey={true} />
            <div
              css="flex: 1; min-height: 0; overflow-x: auto;"
              ref={rememberScroll(model.journeyScrollTop, model.journey)}
            >
              <div css="height: 100%; min-width: 1000px; & > [role='grid'] { height: 100%; }">
                <DataGrid
                  columns={journeyColumns}
                  rows={() =>
                    model
                      .journey()
                      .slice(
                        model.journeyPage() * 100,
                        (model.journeyPage() + 1) * 100,
                      )
                  }
                  getRowId={(record) => record.id}
                  selectedId={admin.selectedRecordId}
                  onSelect={(record) => {
                    admin.selectRecord(record)
                    admin.cardOpen.setTrue()
                  }}
                  empty={
                    <EmptyState
                      title="No matching records."
                      description="Clear journey filters to see the full captured context."
                      action={
                        <Button
                          label="Reset journey filters"
                          onClick={() => {
                            model.journeySearch.set('')
                            model.signal.set('all')
                          }}
                        >
                          Reset filters
                        </Button>
                      }
                    />
                  }
                  ariaLabel="Session journey"
                />
              </div>
            </div>
          </>
        )
      }}
    </section>
  )
}

const Pagination = ({
  model,
  journey,
}: {
  model: OtlpAdmin['investigation']
  journey: boolean
}) => {
  const page = journey ? model.journeyPage : model.listPage
  const rows = journey ? model.journey : model.rows
  const target = journey ? model.journeyPageChoice : model.listPageChoice
  return (
    <Toolbar>
      <Button
        label="Previous page"
        disabled={() => page() === 0}
        onClick={() => target.set(page() - 1)}
      >
        Previous
      </Button>
      <span>
        {() =>
          `${rows().length === 0 ? 0 : page() * 100 + 1}–${Math.min(rows().length, (page() + 1) * 100)} of ${rows().length}`
        }
      </span>
      <Button
        label="Next page"
        disabled={() => (page() + 1) * 100 >= rows().length}
        onClick={() => target.set(page() + 1)}
      >
        Next
      </Button>
    </Toolbar>
  )
}

function rememberScroll(
  position: OtlpAdmin['investigation']['scrollTop'],
  rows: () => unknown,
) {
  return (element: HTMLElement) => {
    const save = wrap((event: Event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.getAttribute('role') === 'rowgroup'
      )
        position.set(event.target.scrollTop)
    })
    element.addEventListener('scroll', save, true)
    const restore = effect(() => {
      rows()
      const value = peek(position)
      queueMicrotask(() => {
        const scroller = element.querySelector('[role="rowgroup"]')
        if (scroller instanceof HTMLElement) scroller.scrollTop = value
      })
    }, '_Admin.sessions.restoreScroll')
    return () => {
      restore.unsubscribe()
      element.removeEventListener('scroll', save, true)
    }
  }
}
