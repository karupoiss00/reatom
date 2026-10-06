import {
  abortVar,
  atom,
  computed,
  effect,
  isAbort,
  onEvent,
  peek,
  take,
  withMemo,
  wrap,
  type Atom,
} from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import { ui } from '../../app/ui'
import type { ChatModel, ThreadNode } from '../../chat/types'
import { prefersReducedMotion } from '../../platform/env'
import { dbHealth } from '../../storage'
import type { MessageId } from '../../storage/types'
import type { ChatSlotProps, NodeSlotProps } from '../slots'
import { AssistantMessage } from './AssistantMessage'
import { CompareColumns } from './CompareColumns'
import { UserMessage } from './UserMessage'

const detachGap = 40

const emptyNote = 'Chats live only in this browser. Export to keep a copy.'
const memoryNote = "This browser won't keep chats after you close the tab."

const EmptyThread = () => (
  <div
    css={`
      display: grid;
      place-items: center;
      padding: var(--space-6) var(--space-6) var(--space-2);
      text-align: center;
    `}
  >
    <div
      css={`
        display: grid;
        gap: var(--space-2);
        max-width: 28rem;
      `}
    >
      <p
        css={`
          margin: 0;
          font-family: var(--font-display);
          font-size: var(--text-xl);
          line-height: var(--leading-tight);
          letter-spacing: -0.03em;
        `}
      >
        What should we think about?
      </p>
      <p
        css={`
          margin: 0;
          color: var(--text-muted);
          font-size: var(--text-sm);
        `}
      >
        {() => (dbHealth().status === 'memory' ? memoryNote : emptyNote)}
      </p>
    </div>
  </div>
)

const isSameNode = (previous: ThreadNode | undefined, next: ThreadNode) =>
  previous !== undefined &&
  previous.message === next.message &&
  previous.versionIndex === next.versionIndex &&
  previous.versions.length === next.versions.length &&
  previous.versions.every((id, index) => id === next.versions[index])

const AssistantRow = ({ chat, node }: NodeSlotProps) => {
  const messageId = peek(node).message.id
  const isCompare = computed(() => {
    const message = node().message
    return message.role === 'assistant' && message.compareGroup !== null
  }, `features.thread.row#${messageId}.isCompare`)

  return (
    <div css="display: contents;">
      {() =>
        isCompare() ? (
          <CompareColumns chat={chat} node={node} />
        ) : (
          <AssistantMessage chat={chat} node={node} />
        )
      }
    </div>
  )
}

const reatomThreadRows = (chat: ChatModel) => {
  const name = `features.thread#${chat.id}`
  const nodesById = computed(
    () => new Map(chat.path().map((node) => [node.message.id, node])),
    `${name}.nodesById`,
  )
  const rowIds = computed(
    () => chat.path().map((node) => node.message.id),
    `${name}.rowIds`,
  ).extend(withMemo())
  const rowElements = new Map<MessageId, JSX.Element>()

  const createRow = (id: MessageId) => {
    const initialNode = peek(nodesById).get(id)!
    const node = computed(
      (previous?: ThreadNode) => nodesById().get(id) ?? previous ?? initialNode,
      `${name}.row#${id}.node`,
    ).extend(withMemo(isSameNode))

    return (
      <li
        data-message-id={id}
        data-role={initialNode.message.role}
        css={`
          display: grid;
          min-width: 0;
        `}
      >
        {initialNode.message.role === 'user' ? (
          <UserMessage chat={chat} node={node} />
        ) : (
          <AssistantRow chat={chat} node={node} />
        )}
      </li>
    )
  }

  const rows = (ids: MessageId[]) => {
    for (const id of rowElements.keys()) {
      if (!ids.includes(id)) rowElements.delete(id)
    }
    return ids.map((id) => {
      let row = rowElements.get(id)
      if (!row) {
        row = createRow(id)
        rowElements.set(id, row)
      }
      return row
    })
  }

  const isEmpty = computed(() => rowIds().length === 0, `${name}.isEmpty`)

  return { rowIds, rows, isEmpty }
}

const readLive = (chat: ChatModel) => {
  const streaming = (chat as { streaming?: () => unknown }).streaming
  return typeof streaming === 'function' ? streaming() !== null : false
}

const nextFrame = () => {
  const { signal } = abortVar.require()
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    let frameId = 0
    const onAbort = () => {
      cancelAnimationFrame(frameId)
      reject(signal.reason)
    }
    frameId = requestAnimationFrame(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    })
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

const ignoreAbort = (promise: Promise<unknown>) => {
  promise.catch((error) => {
    if (!isAbort(error)) throw error
  })
}

const followThread = ({
  element,
  chat,
  following,
  scrollRequest,
  name,
}: {
  element: HTMLDivElement
  chat: ChatModel
  following: Atom<boolean>
  scrollRequest: Atom<number>
  name: string
}) =>
  effect(async () => {
    let programmatic = false
    let ignoredScrolls = 0

    const distanceFromEnd = () =>
      element.scrollHeight - element.scrollTop - element.clientHeight

    const followTop = () =>
      Math.max(0, element.scrollHeight - element.clientHeight)

    const jumpToEnd = (smooth: boolean) => {
      const behavior = smooth && !peek(prefersReducedMotion) ? 'smooth' : 'auto'
      const top = followTop()
      programmatic = true
      if (behavior === 'auto') element.scrollTop = top
      else element.scrollTo({ top, behavior })
      ignoreAbort(
        wrap(nextFrame())
          .then(
            wrap(() => {
              programmatic = true
              if (peek(following)) element.scrollTop = followTop()
            }),
          )
          .finally(() => {
            programmatic = false
          }),
      )
    }

    const scheduleJump = (attached: boolean) => {
      ignoreAbort(
        wrap(nextFrame()).then(
          wrap(() => {
            if (attached || peek(following)) jumpToEnd(false)
          }),
        ),
      )
    }

    onEvent(
      element,
      'scroll',
      () => {
        if (programmatic || ignoredScrolls > 0) return
        following.set(distanceFromEnd() <= detachGap)
      },
      { passive: true },
    )

    const pauseForLayout = () => {
      ignoredScrolls += 1
      ignoreAbort(
        wrap(nextFrame())
          .then(() => wrap(nextFrame()))
          .finally(() => {
            ignoredScrolls -= 1
          }),
      )
    }
    onEvent(window, 'resize', pauseForLayout)
    if (window.visualViewport) {
      onEvent(window.visualViewport, 'resize', pauseForLayout)
    }

    const list = element.querySelector('ol')
    const observer = new ResizeObserver(
      wrap(() => {
        if (peek(following)) jumpToEnd(false)
      }),
    )
    if (list) observer.observe(list)
    observer.observe(element)
    abortVar.subscribe(() => observer.disconnect())

    const watchPath = async () => {
      let sawPath = false
      let seenUserId: string | null = null
      const settle = (nodes: readonly ThreadNode[]) => {
        const latestUser = [...nodes]
          .reverse()
          .find((node) => node.message.role === 'user')
        const userId = latestUser?.message.id ?? null
        const attached = sawPath && userId !== null && userId !== seenUserId
        if (attached) following.set(true)
        sawPath = true
        seenUserId = userId
        if (attached || peek(following)) scheduleJump(attached)
      }

      let pending = take(chat.path)
      settle(peek(chat.path))
      while (true) {
        const nodes = await wrap(pending)
        pending = take(chat.path)
        settle(nodes)
      }
    }

    const watchEditing = async () => {
      const detach = (messageId: string | null) => {
        if (messageId) following.set(false)
      }
      let pending = take(ui.editing)
      detach(peek(ui.editing))
      while (true) {
        const messageId = await wrap(pending)
        pending = take(ui.editing)
        detach(messageId)
      }
    }

    const watchJump = async () => {
      while (true) {
        await wrap(take(scrollRequest))
        ignoredScrolls += 1
        try {
          following.set(true)
          await wrap(nextFrame())
          jumpToEnd(true)
          await wrap(nextFrame())
          if (peek(following)) jumpToEnd(false)
        } finally {
          ignoredScrolls -= 1
        }
      }
    }

    await wrap(Promise.all([watchPath(), watchEditing(), watchJump()]))
  }, `${name}.follow`)

export const Thread = ({ chat }: ChatSlotProps) => {
  const thread = reatomThreadRows(chat)
  const name = `features.thread#${chat.id}`
  const following = atom(true, `${name}.following`)
  const scrollRequest = atom(0, `${name}.scrollRequest`)

  const reattach = () => {
    scrollRequest.set((count) => count + 1)
  }

  return (
    <div
      data-empty={() => (thread.isEmpty() ? 'true' : null)}
      css={`
        position: relative;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;

        &[data-empty='true'] {
          flex: 0 1 auto;
        }
      `}
    >
      <div
        data-slot="Thread"
        data-following={() => (following() ? 'true' : 'false')}
        data-empty={() => (thread.isEmpty() ? 'true' : null)}
        ref={(scroller: HTMLDivElement) => {
          const running = followThread({
            element: scroller,
            chat,
            following,
            scrollRequest,
            name,
          })
          return () => running.unsubscribe()
        }}
        css={`
          flex: 1;
          min-height: 0;
          overflow: auto;
          overflow-anchor: none;
          scroll-behavior: auto;

          &[data-empty='true'] {
            flex: 0 1 auto;
            overflow: visible;
          }
        `}
      >
        {() => (thread.isEmpty() ? <EmptyThread /> : null)}
        <ol
          hidden={thread.isEmpty}
          css={`
            display: grid;
            gap: var(--space-5);
            width: min(46rem, 100%);
            margin: 0 auto;
            padding: var(--space-6) var(--space-5) 2.5rem;
            list-style: none;

            &[hidden] {
              display: none;
            }
          `}
        >
          {() => thread.rows(thread.rowIds())}
        </ol>
      </div>
      {() =>
        following() ? null : (
          <div
            css={`
              position: absolute;
              bottom: 0;
              left: 50%;
              z-index: 1;
              transform: translateX(-50%);
              display: flex;
              justify-content: center;
              padding: 1.25rem var(--space-4) var(--space-3);
              pointer-events: none;
            `}
          >
            <button
              type="button"
              data-scroll-pill=""
              on:click={reattach}
              css={`
                display: inline-flex;
                align-items: center;
                min-height: 2.25rem;
                padding: 0 var(--space-4);
                border: 1px solid var(--line-strong);
                border-radius: var(--radius-pill);
                background: var(--bg-elevated);
                box-shadow: var(--shadow-2);
                color: var(--text);
                font-size: var(--text-sm);
                pointer-events: auto;
                cursor: pointer;

                &:focus-visible {
                  outline: var(--focus-width) solid var(--focus);
                  outline-offset: 2px;
                }
              `}
            >
              {() => (readLive(chat) ? 'New text below ↓' : 'Jump to latest ↓')}
            </button>
          </div>
        )
      }
    </div>
  )
}
