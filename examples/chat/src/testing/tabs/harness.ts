import {
  harnessTag,
  type TabCommand,
  type TabMessage,
  type TabRequest,
  type TabResults,
} from './protocol'

export type { TabCommand, TabResults, TabState } from './protocol'

const readyWaitMs = 15_000
const replyWaitMs = 10_000

export interface TabHandle {
  readonly frame: HTMLIFrameElement
  call<Command extends TabCommand>(
    command: Command,
  ): Promise<TabResults[Command['type']]>
  /** Removes the iframe, which ends its realm like closing a tab. */
  remove(): void
}

export interface OpenTabOptions {
  /** Boots the second tab without `navigator.locks`. */
  webLocks?: boolean
  width?: number
  height?: number
}

const openTabs = new Set<TabHandle>()

/**
 * Appended to `<html>` rather than `<body>` so `bootApp`, which replaces the
 * body, does not close the second tab.
 */
export const openTab = async (
  options: OpenTabOptions = {},
): Promise<TabHandle> => {
  const url = new URL('./tab.html', import.meta.url)
  if (options.webLocks === false) url.searchParams.set('locks', 'off')
  const frame = document.createElement('iframe')
  frame.title = 'Second Atelier tab'
  frame.style.cssText = `position:fixed;left:-10000px;top:0;border:0;width:${options.width ?? 1024}px;height:${options.height ?? 768}px;`

  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()
  let nextId = 1
  let markReady = () => {}
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })

  const onMessage = (event: MessageEvent<TabMessage>) => {
    if (event.source !== frame.contentWindow) return
    const message = event.data
    if (message?.tag !== harnessTag) return
    if (message.type === 'ready') {
      markReady()
      return
    }
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.ok) waiter.resolve(message.value)
    else waiter.reject(new Error(`Second tab failed: ${message.error}`))
  }
  window.addEventListener('message', onMessage)

  const remove = () => {
    window.removeEventListener('message', onMessage)
    for (const waiter of pending.values()) {
      waiter.reject(new Error('The second tab was removed'))
    }
    pending.clear()
    frame.remove()
    openTabs.delete(handle)
  }

  const handle: TabHandle = {
    frame,
    call<Command extends TabCommand>(
      command: Command,
    ): Promise<TabResults[Command['type']]> {
      const target = frame.contentWindow
      if (!target) return Promise.reject(new Error('The second tab is closed'))
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`The second tab did not answer "${command.type}"`))
        }, replyWaitMs)
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value as TabResults[Command['type']])
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
        })
        const request: TabRequest = { tag: harnessTag, id, command }
        target.postMessage(request, location.origin)
      })
    },
    remove,
  }
  openTabs.add(handle)

  frame.src = url.href
  document.documentElement.append(frame)

  let readyTimer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_, reject) => {
    readyTimer = setTimeout(
      () => reject(new Error(`The second tab did not load ${url.pathname}`)),
      readyWaitMs,
    )
  })
  try {
    await Promise.race([ready, timedOut])
  } catch (error) {
    remove()
    throw error
  } finally {
    clearTimeout(readyTimer)
  }
  return handle
}

export const closeAllTabs = () => {
  for (const tab of [...openTabs]) tab.remove()
}
