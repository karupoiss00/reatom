import {
  addCallHook,
  atom,
  clearStack,
  computed,
  context,
  reatomLinkedList,
  sleep,
  withInit,
  wrap,
} from '@reatom/core'
import { expect, test, vi } from 'vitest'

import {
  DEBUG,
  ErrorBoundary,
  // eslint-disable-next-line unused-imports/no-unused-imports
  h,
  // eslint-disable-next-line unused-imports/no-unused-imports
  hf,
  type JSX,
  jsxError,
  type JsxErrorPayload,
  mount,
} from '.'

clearStack()

DEBUG.extend(withInit(() => false))

const parent = atom(() => {
  const main = document.createElement('main')
  document.body.appendChild(main)
  return main
}, 'parent')

test('hybrid default: keeps stale DOM, reports jsxError, sets data-reatom-error', () =>
  context.start(async () => {
    const reports: JsxErrorPayload[] = []
    const unhook = addCallHook(jsxError, (payload) => {
      reports.push(payload)
    })

    const flag = atom(false, 'flag')
    const view = computed(() => {
      if (flag()) throw new Error('boom')
      return 'ok'
    }, 'view')

    const element = <div>{view}</div>
    const { unmount } = mount(parent(), element)
    await wrap(sleep())

    expect(element.textContent).toBe('ok')
    expect(reports).toEqual([])

    flag.set(true)
    await wrap(sleep())

    expect(element.textContent).toBe('ok')
    expect(element.hasAttribute('data-reatom-error')).toBe(true)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.phase).toBe('children')
    expect((reports[0]!.error as Error).message).toBe('boom')

    flag.set(false)
    await wrap(sleep())

    expect(element.textContent).toBe('ok')
    expect(element.hasAttribute('data-reatom-error')).toBe(false)

    unhook()
    unmount()
  }))

test('ErrorBoundary catches lazy child construction error and supports retry', () =>
  context.start(async () => {
    const shouldThrow = atom(true, 'shouldThrow')
    const onError = vi.fn()

    const element = (
      <ErrorBoundary
        fallback={(error, retry) => (
          <div id="fallback">
            {(error as Error).message}
            <button id="retry" on:click={retry}>
              retry
            </button>
          </div>
        )}
        onError={onError}
      >
        {() => {
          if (shouldThrow()) throw new Error('construct')
          return <span id="ok">ok</span>
        }}
      </ErrorBoundary>
    )

    const host = <div>{element}</div>
    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(element.nodeName).toBe('SPAN')
    expect(element.style.display).toBe('contents')
    expect(host.querySelector('#fallback')?.textContent).toContain('construct')
    expect(host.querySelector('#ok')).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)

    shouldThrow.set(false)
    host.querySelector('#retry')!.dispatchEvent(new Event('click'))
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('ok')
    expect(host.querySelector('#fallback')).toBeNull()

    unmount()
  }))

test('ErrorBoundary catches reactive child update errors', () =>
  context.start(async () => {
    const flag = atom(false, 'flag')
    const view = computed(() => {
      if (flag()) throw new Error('update')
      return <span id="ok">ok</span>
    }, 'view')

    const host = (
      <div>
        <ErrorBoundary
          fallback={(error) => (
            <div id="fallback">{(error as Error).message}</div>
          )}
        >
          {() => <div>{view}</div>}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#ok')?.textContent).toBe('ok')

    flag.set(true)
    await wrap(sleep())

    expect(host.querySelector('#fallback')?.textContent).toBe('update')
    expect(host.querySelector('#ok')).toBeNull()

    unmount()
  }))

test('ErrorBoundary pending fallback recovers when promise settles', () =>
  context.start(async () => {
    let resolve!: (value: string) => void
    const promise = new Promise<string>((res) => {
      resolve = res
    })
    const ready = atom(false, 'ready')
    const view = computed(() => {
      if (!ready()) throw promise
      return <span id="ok">done</span>
    }, 'view')

    const host = (
      <div>
        <ErrorBoundary
          pending={<div id="pending">loading</div>}
          fallback={() => <div id="fallback">err</div>}
        >
          {() => <div>{view}</div>}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    ready.set(true)
    resolve('x')
    await wrap(sleep())
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('done')
    expect(host.querySelector('#pending')).toBeNull()

    unmount()
  }))

test('ErrorBoundary pending recovers for lazy child inside fragment', () =>
  context.start(async () => {
    let resolve!: (value: string) => void
    const promise = new Promise<string>((res) => {
      resolve = res
    })
    const ready = atom(false, 'ready')

    const host = (
      <div>
        <ErrorBoundary
          pending={<div id="pending">loading</div>}
          fallback={() => <div id="fallback">err</div>}
        >
          <>
            {() => {
              if (!ready()) throw promise
              return <span id="ok">done</span>
            }}
          </>
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    ready.set(true)
    resolve('x')
    await wrap(sleep())
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('done')
    expect(host.querySelector('#pending')).toBeNull()

    unmount()
  }))

test('ErrorBoundary catches construction error inside fragment and supports retry', () =>
  context.start(async () => {
    const shouldThrow = atom(true, 'shouldThrow')
    const onError = vi.fn()

    const host = (
      <div>
        <ErrorBoundary
          fallback={(error, retry) => (
            <div id="fallback">
              {(error as Error).message}
              <button id="retry" on:click={retry}>
                retry
              </button>
            </div>
          )}
          onError={onError}
        >
          <>
            {() => {
              if (shouldThrow()) throw new Error('construct')
              return <span id="ok">ok</span>
            }}
          </>
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(host.querySelector('#fallback')?.textContent).toContain('construct')
    expect(host.querySelector('#ok')).toBeNull()
    expect(onError).toHaveBeenCalledTimes(1)

    shouldThrow.set(false)
    host.querySelector('#retry')!.dispatchEvent(new Event('click'))
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('ok')
    expect(host.querySelector('#fallback')).toBeNull()

    unmount()
  }))

test('ErrorBoundary pending recovers for multi-child fragment recipe', () =>
  context.start(async () => {
    let resolve!: (value: string) => void
    const promise = new Promise<string>((res) => {
      resolve = res
    })
    const ready = atom(false, 'ready')

    const host = (
      <div>
        <ErrorBoundary
          pending={<div id="pending">loading</div>}
          fallback={() => <div id="fallback">err</div>}
        >
          <>
            <span id="prefix">pre</span>
            {() => {
              if (!ready()) throw promise
              return <span id="ok">done</span>
            }}
          </>
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    ready.set(true)
    resolve('x')
    await wrap(sleep())
    await wrap(sleep())

    expect(host.querySelector('#prefix')?.textContent).toBe('pre')
    expect(host.querySelector('#ok')?.textContent).toBe('done')
    expect(host.querySelector('#pending')).toBeNull()

    unmount()
  }))

test('ErrorBoundary pending recovers for lazy child inside nested fragments', () =>
  context.start(async () => {
    let resolve!: (value: string) => void
    const promise = new Promise<string>((res) => {
      resolve = res
    })
    const ready = atom(false, 'ready')

    const host = (
      <div>
        <ErrorBoundary
          pending={<div id="pending">loading</div>}
          fallback={() => <div id="fallback">err</div>}
        >
          <>
            <>
              {() => {
                if (!ready()) throw promise
                return <span id="ok">done</span>
              }}
            </>
          </>
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    ready.set(true)
    resolve('x')
    await wrap(sleep())
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('done')
    expect(host.querySelector('#pending')).toBeNull()

    unmount()
  }))

test('ErrorBoundary renders a fragment child without building it twice', () =>
  context.start(async () => {
    let builds = 0
    const fragment = (
      <>
        {() => {
          builds++
          return <span id="ok">ok</span>
        }}
      </>
    )

    const host = (
      <div>
        <ErrorBoundary fallback={() => <div id="fallback">err</div>}>
          {fragment}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(host.querySelector('#ok')?.textContent).toBe('ok')
    expect(builds).toBe(1)
    expect(fragment.childNodes).toHaveLength(0)

    unmount()
  }))

test('ErrorBoundary re-runs fragment function children on retry after an update error', () =>
  context.start(async () => {
    const shouldThrow = atom(false, 'shouldThrow')

    const host = (
      <div>
        <ErrorBoundary
          fallback={(error, retry) => (
            <button id="retry" on:click={retry}>
              {(error as Error).message}
            </button>
          )}
        >
          <>
            <h1 id="title">title</h1>
            {() => {
              if (shouldThrow()) throw new Error('update')
              return <span id="ok">ok</span>
            }}
          </>
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())
    expect(host.querySelector('#ok')?.textContent).toBe('ok')

    shouldThrow.set(true)
    await wrap(sleep())
    expect(host.querySelector('#retry')?.textContent).toBe('update')
    expect(host.querySelector('#title')).toBeNull()

    shouldThrow.set(false)
    host.querySelector('#retry')!.dispatchEvent(new Event('click'))
    await wrap(sleep())

    expect(host.querySelector('#title')?.textContent).toBe('title')
    expect(host.querySelector('#ok')?.textContent).toBe('ok')
    expect(host.querySelector('#retry')).toBeNull()

    unmount()
  }))

test('ErrorBoundary keeps element bindings live after retry for a lazy fragment child', () =>
  context.start(async () => {
    const label = atom('a', 'label')
    const shouldThrow = atom(false, 'shouldThrow')

    const host = (
      <div>
        <ErrorBoundary
          fallback={(error, retry) => (
            <button id="retry" on:click={retry}>
              {(error as Error).message}
            </button>
          )}
        >
          {() => (
            <>
              <span id="label">{label}</span>
              {() => {
                if (shouldThrow()) throw new Error('update')
                return 'ok'
              }}
            </>
          )}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    shouldThrow.set(true)
    await wrap(sleep())
    expect(host.querySelector('#label')).toBeNull()

    shouldThrow.set(false)
    host.querySelector('#retry')!.dispatchEvent(new Event('click'))
    await wrap(sleep())
    label.set('b')
    await wrap(sleep())

    expect(host.querySelector('#label')?.textContent).toBe('b')

    unmount()
  }))

test('ErrorBoundary shows a fragment pending view on every suspension', () =>
  context.start(async () => {
    const suspense = atom<Promise<void> | null>(null, 'suspense')
    const view = computed(() => {
      const promise = suspense()
      if (promise) throw promise
      return <span id="ok">done</span>
    }, 'view')
    const suspend = () => {
      let resolve!: () => void
      suspense.set(
        new Promise<void>((res) => {
          resolve = res
        }),
      )
      return () => {
        suspense.set(null)
        resolve()
      }
    }

    const host = (
      <div>
        <ErrorBoundary
          pending={
            <>
              <i id="pending">loading</i>
            </>
          }
          fallback={() => <div id="fallback">err</div>}
        >
          {() => <div>{view}</div>}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    const resumeFirst = suspend()
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    resumeFirst()
    await wrap(sleep())
    await wrap(sleep())
    expect(host.querySelector('#ok')?.textContent).toBe('done')

    const resumeSecond = suspend()
    await wrap(sleep())
    expect(host.querySelector('#pending')?.textContent).toBe('loading')

    resumeSecond()
    await wrap(sleep())
    await wrap(sleep())
    expect(host.querySelector('#ok')?.textContent).toBe('done')
    expect(host.querySelector('#pending')).toBeNull()

    unmount()
  }))

test('ErrorBoundary reports a lazy child construction error once', () =>
  context.start(async () => {
    const reports: JsxErrorPayload[] = []
    const unhook = addCallHook(jsxError, (payload) => {
      reports.push(payload)
    })

    const host = (
      <div>
        <ErrorBoundary
          fallback={(error) => (
            <div id="fallback">{(error as Error).message}</div>
          )}
        >
          {() => {
            throw new Error('construct')
          }}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(host.querySelector('#fallback')?.textContent).toBe('construct')
    expect(reports).toHaveLength(1)

    unhook()
    unmount()
  }))

test('ErrorBoundary walks a linked list child instead of calling it', () =>
  context.start(async () => {
    const list = reatomLinkedList((value: string) => ({ value }), 'list')
    list.create('a')
    const rows = list.reatomMap((row) => <p>{row.value}</p>, 'rows')

    const host = (
      <div>
        <ErrorBoundary fallback={() => <div id="fallback">err</div>}>
          {rows as unknown as JSX.ElementChildren}
        </ErrorBoundary>
      </div>
    )

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(host.textContent).toBe('a')

    unmount()
  }))

test('ErrorBoundary warns in DEBUG only about children with eager elements', () =>
  context.start(() => {
    DEBUG.set(true)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const countWarnings = (render: () => unknown) => {
      warn.mockClear()
      render()
      return warn.mock.calls.length
    }
    const fallback = () => 'err'

    try {
      expect(
        countWarnings(() => (
          <ErrorBoundary fallback={fallback}>{() => <span />}</ErrorBoundary>
        )),
      ).toBe(0)
      expect(
        countWarnings(() => (
          <ErrorBoundary fallback={fallback}>
            <>{() => <span />}</>
          </ErrorBoundary>
        )),
      ).toBe(0)
      expect(
        countWarnings(() => (
          <ErrorBoundary fallback={fallback}>
            <span />
          </ErrorBoundary>
        )),
      ).toBe(1)
      expect(
        countWarnings(() => (
          <ErrorBoundary fallback={fallback}>
            <>
              <span />
              {() => <i />}
            </>
          </ErrorBoundary>
        )),
      ).toBe(1)
    } finally {
      warn.mockRestore()
      DEBUG.set(false)
    }
  }))

test('reparented child is adopted by the new ErrorBoundary', () =>
  context.start(async () => {
    const flag = atom(false, 'flag')
    const view = computed(() => {
      if (flag()) throw new Error('moved')
      return <span id="child">child</span>
    }, 'view')

    const childHost = <div id="child-host">{view}</div>

    const boundaryB = (
      <ErrorBoundary fallback={() => <div id="fallback-b">B</div>}>
        {() => <div id="slot-b" />}
      </ErrorBoundary>
    )

    const root = (
      <div>
        {childHost}
        <div id="wrap-b">{boundaryB}</div>
      </div>
    )

    const { unmount } = mount(parent(), root)
    await wrap(sleep())

    const slotB = root.querySelector('#slot-b')!
    slotB.append(childHost)

    flag.set(true)
    await wrap(sleep())

    expect(root.querySelector('#fallback-b')?.textContent).toBe('B')

    unmount()
  }))

test('on: handler reports to jsxError and rethrows', () =>
  context.start(async () => {
    const reports: JsxErrorPayload[] = []
    const unhook = addCallHook(jsxError, (payload) => {
      reports.push(payload)
    })

    const button = (
      <button
        on:click={() => {
          throw new Error('click')
        }}
      >
        go
      </button>
    )

    const { unmount } = mount(parent(), button)
    await wrap(sleep())

    // Browsers do not surface listener throws to dispatchEvent; they become
    // window errors. We still rethrow inside the listener after reporting.
    const windowErrors: unknown[] = []
    const onWindowError = (event: ErrorEvent) => {
      windowErrors.push(event.error)
      event.preventDefault()
    }
    window.addEventListener('error', onWindowError)
    button.dispatchEvent(new Event('click'))
    window.removeEventListener('error', onWindowError)
    await wrap(sleep())

    expect(reports).toHaveLength(1)
    expect(reports[0]!.phase).toBe('event')
    expect((reports[0]!.error as Error).message).toBe('click')
    expect(windowErrors).toHaveLength(1)

    unhook()
    unmount()
  }))

test('throwing ref mount does not break sibling subscriptions', () =>
  context.start(async () => {
    const value = atom('a', 'value')
    const sibling = <span id="sibling">{value}</span>
    const broken = (
      <div
        id="broken"
        ref={() => {
          throw new Error('ref')
        }}
      />
    )

    const host = (
      <div>
        {broken}
        {sibling}
      </div>
    )

    const reports: JsxErrorPayload[] = []
    const unhook = addCallHook(jsxError, (payload) => {
      reports.push(payload)
    })

    const { unmount } = mount(parent(), host)
    await wrap(sleep())

    expect(reports.some((r) => r.phase === 'ref')).toBe(true)
    expect(sibling.textContent).toBe('a')

    value.set('b')
    await wrap(sleep())
    expect(sibling.textContent).toBe('b')

    unhook()
    unmount()
  }))

test('reactive prop error keeps last good value and reports', () =>
  context.start(async () => {
    const flag = atom(false, 'flag')
    const id = computed(() => {
      if (flag()) throw new Error('prop')
      return 'ok-id'
    }, 'id')

    const reports: JsxErrorPayload[] = []
    const unhook = addCallHook(jsxError, (payload) => {
      reports.push(payload)
    })

    const element = <div id={id} />
    const { unmount } = mount(parent(), element)
    await wrap(sleep())
    expect(element.id).toBe('ok-id')

    flag.set(true)
    await wrap(sleep())

    expect(element.id).toBe('ok-id')
    expect(reports.some((r) => r.phase === 'prop')).toBe(true)
    expect(element.hasAttribute('data-reatom-error')).toBe(true)

    flag.set(false)
    await wrap(sleep())

    expect(element.id).toBe('ok-id')
    expect(element.hasAttribute('data-reatom-error')).toBe(false)

    unhook()
    unmount()
  }))
