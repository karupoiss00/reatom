import type { Token } from 'marked'
import { computed, type Atom, type Computed } from '@reatom/core'

import { clearCopyTimersIn, commitCodeCopy } from './codeBlock'
import {
  blockRaw,
  blockTokens,
  refreshTableFades,
  observeTableFrames,
  releaseTableFrames,
  renderBlock,
  writeTail,
} from './markdown'

const markdownCss = `
  max-width: 100%;
  min-width: 0;
  color: var(--text);
  font-size: var(--text-md);
  line-height: 1.65;
  letter-spacing: -0.011em;

  & ::selection {
    background: var(--accent-soft);
  }

  & > :first-child {
    margin-top: 0;
  }

  & > :last-child {
    margin-bottom: 0;
  }

  & h1,
  & h2,
  & h3,
  & h4,
  & h5,
  & h6 {
    font-family: var(--font-display);
    font-weight: 500;
    letter-spacing: -0.025em;
    line-height: var(--leading-tight);
    color: var(--text);
  }

  & h1 {
    font-size: 1.7rem;
    margin: 0 0 0.7rem;
  }

  & h2 {
    font-size: 1.35rem;
    margin: 1.45rem 0 0.5rem;
  }

  & h3 {
    font-size: 1.18rem;
    margin: 1.25rem 0 0.4rem;
  }

  & h4,
  & h5,
  & h6 {
    font-size: 1.08rem;
    margin: 1.05rem 0 0.35rem;
  }

  & p {
    margin: 0.55rem 0 0.8rem;
  }

  & a {
    color: var(--accent-strong);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.18em;
  }

  & a:hover {
    color: var(--accent);
  }

  & strong {
    font-weight: 600;
  }

  & em {
    font-family: var(--font-display);
  }

  & ul,
  & ol {
    margin: 0.35rem 0 0.9rem;
    padding-inline-start: 1.3rem;
  }

  & li {
    margin: 0.28rem 0;
    padding-inline-start: 0.15rem;
  }

  & ol li::marker,
  & ul li::marker {
    color: var(--accent);
  }

  & blockquote {
    margin: 0.9rem 0 1rem;
    padding: 0.1rem 0 0.1rem 0.95rem;
    border-left: 2px solid var(--accent);
    color: var(--text-muted);
    font-family: var(--font-display);
    font-style: italic;
    font-size: 1.08rem;
    line-height: 1.5;
  }

  & blockquote p {
    margin: 0.3rem 0;
  }

  & :not(pre) > code {
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.86em;
    letter-spacing: 0;
    background: var(--sidebar);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 0.08em 0.38em;
  }

  & [data-code-block] {
    margin: 1.45rem 0 1.55rem;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
    overflow: hidden;
    box-shadow: 0 1px 0 rgba(40, 36, 28, 0.03);
  }

  & [data-code-header] {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    min-height: 2.15rem;
    padding: 0.35rem 0.55rem 0.35rem 0.85rem;
    border-bottom: 1px solid var(--line);
    background: color-mix(in srgb, var(--sidebar) 72%, var(--bg-elevated));
  }

  & [data-code-lang] {
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 500;
    letter-spacing: 0.01em;
    text-transform: lowercase;
  }

  & [data-copy-code] {
    min-width: 0;
    max-width: 100%;
    border: 1px solid var(--text-muted);
    border-radius: var(--radius-pill);
    background: var(--bg-elevated);
    color: var(--text);
    padding: 0.22rem 0.7rem;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    letter-spacing: 0.01em;
    line-height: 1.35;
    white-space: normal;
    text-align: center;
  }

  & [data-copy-code]:hover {
    color: var(--accent-strong);
    border-color: var(--accent);
  }

  & pre {
    margin: 0;
    padding: 0.9rem 1rem 1rem;
    overflow-x: auto;
    scrollbar-width: thin;
    scrollbar-color: var(--text-faint) var(--sidebar);
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.84rem;
    line-height: 1.6;
    letter-spacing: 0;
    color: var(--text);
  }

  & pre::-webkit-scrollbar,
  & [data-table-scroll]::-webkit-scrollbar {
    -webkit-appearance: none;
    height: 10px;
    display: block;
  }

  & pre::-webkit-scrollbar-track,
  & [data-table-scroll]::-webkit-scrollbar-track {
    background: var(--sidebar);
  }

  & pre::-webkit-scrollbar-thumb,
  & [data-table-scroll]::-webkit-scrollbar-thumb {
    background: var(--text-muted);
    border-radius: 99px;
  }

  & pre code {
    font-family: inherit;
    font-size: inherit;
    background: none;
    border: 0;
    padding: 0;
  }

  & [data-table-frame] {
    position: relative;
    margin: 1.45rem 0 1.55rem;
  }

  & [data-table-frame][data-fade-end='1']::after {
    content: '';
    position: absolute;
    z-index: 1;
    top: 0;
    right: 0;
    bottom: 16px;
    width: 3.25rem;
    pointer-events: none;
    background: linear-gradient(to left, var(--bg-elevated), transparent);
  }

  & [data-table-scroll] {
    overflow-x: auto;
    scrollbar-width: none;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg-elevated);
  }

  & [data-table-scroll]::-webkit-scrollbar {
    display: none;
    height: 0;
  }

  & [data-table-scrollbar] {
    height: 6px;
    margin: 8px 4px 0;
    border-radius: 99px;
    background: color-mix(in srgb, var(--text) 10%, var(--bg-elevated));
    position: relative;
    overflow: hidden;
  }

  & [data-table-thumb] {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 99px;
    background: transparent;
  }

  & [data-table-frame]:hover [data-table-thumb] {
    background: color-mix(in srgb, var(--text) 28%, var(--bg-elevated));
  }

  & table {
    width: max-content;
    min-width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
    line-height: 1.45;
    letter-spacing: 0;
  }

  & th,
  & td {
    padding: 0.58rem 0.85rem;
    text-align: start;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }

  & th {
    white-space: nowrap;
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-muted);
    background: var(--bg-elevated);
  }

  & tr:last-child td {
    border-bottom: 0;
  }

  & [data-render-fallback] {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  & [data-render-fallback] p {
    margin: 0;
  }

  & [data-show-raw] {
    border: 0;
    padding: 0;
    background: none;
    color: var(--accent-strong);
    font-size: inherit;
    text-decoration: underline;
    text-underline-offset: 0.18em;
  }

  & [data-raw-text] {
    margin: 0.75rem 0 0;
    white-space: pre-wrap;
    overflow-x: auto;
    color: var(--text);
    font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
    font-size: 0.84rem;
    line-height: 1.55;
  }
`

type Session = {
  finished: HTMLElement[]
  tail: HTMLElement | null
  tailRaw: string
  memo: Map<string, HTMLElement[]>
}

type Job = {
  text: string
  streaming: boolean
  frame: number
}

const sessions = new WeakMap<HTMLElement, Session>()
const jobs = new WeakMap<HTMLElement, Job>()

let messageSeq = 0

const sessionFor = (root: HTMLElement) => {
  const existing = sessions.get(root)
  if (existing) return existing
  const session: Session = {
    finished: [],
    tail: null,
    tailRaw: '',
    memo: new Map(),
  }
  sessions.set(root, session)
  return session
}

const dropTail = (session: Session) => {
  if (session.tail) releaseTableFrames(session.tail)
  session.tail?.remove()
  session.tail = null
  session.tailRaw = ''
}

const park = (session: Session, node: HTMLElement) => {
  releaseTableFrames(node)
  const raw = blockRaw.get(node)
  node.remove()
  delete node.dataset.tail
  if (!raw) return
  const bucket = session.memo.get(raw)
  if (bucket) bucket.push(node)
  else session.memo.set(raw, [node])
}

const claimFinished = (session: Session, token: Token) => {
  if (session.tail && session.tailRaw === token.raw) {
    const node = session.tail
    session.tail = null
    session.tailRaw = ''
    delete node.dataset.tail
    return node
  }
  const bucket = session.memo.get(token.raw)
  while (bucket && bucket.length > 0) {
    const cached = bucket.pop()!
    if (cached.isConnected) continue
    delete cached.dataset.tail
    observeTableFrames(cached)
    return cached
  }
  const created = renderBlock(token)
  delete created.dataset.tail
  return created
}

const placeChildren = (root: HTMLElement, nodes: HTMLElement[]) => {
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!
    const current = root.children[index]
    if (current === node) continue
    if (current) root.insertBefore(node, current)
    else root.append(node)
  }
  while (root.children.length > nodes.length) {
    root.lastElementChild?.remove()
  }
  refreshTableFades(root)
}

const syncBlocks = (root: HTMLElement, text: string, streaming: boolean) => {
  const session = sessionFor(root)
  const tokens = blockTokens(text)
  const finishedTokens = streaming ? tokens.slice(0, -1) : tokens
  const tailToken = streaming ? tokens[tokens.length - 1] : undefined

  let index = 0
  while (
    index < finishedTokens.length &&
    index < session.finished.length &&
    blockRaw.get(session.finished[index]!) === finishedTokens[index]!.raw
  ) {
    index += 1
  }

  while (session.finished.length > index) {
    park(session, session.finished.pop()!)
  }

  for (; index < finishedTokens.length; index += 1) {
    session.finished.push(claimFinished(session, finishedTokens[index]!))
  }

  if (!tailToken) {
    if (session.tail) dropTail(session)
  } else if (session.tail && writeTail(session.tail, tailToken)) {
    session.tailRaw = tailToken.raw
    session.tail.dataset.tail = ''
  } else if (session.tail && session.tailRaw === tailToken.raw) {
    session.tail.dataset.tail = ''
  } else {
    if (session.tail) dropTail(session)
    const created = renderBlock(tailToken)
    created.dataset.tail = ''
    session.tail = created
    session.tailRaw = tailToken.raw
  }

  const nodes = session.tail
    ? [...session.finished, session.tail]
    : [...session.finished]
  placeChildren(root, nodes)
  delete root.dataset.renderFallback
}

const showFallback = (root: HTMLElement, text: string) => {
  const session = sessionFor(root)
  releaseTableFrames(root)
  for (const cached of session.memo.values()) {
    for (const node of cached) releaseTableFrames(node)
  }
  session.finished = []
  session.memo.clear()
  dropTail(session)
  root.dataset.renderFallback = 'true'
  const box = document.createElement('div')
  box.dataset.renderFallback = ''
  const message = document.createElement('p')
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.showRaw = ''
  button.textContent = 'Show raw text'
  message.append("Couldn't render this message · ", button)
  const raw = document.createElement('pre')
  raw.dataset.rawText = ''
  raw.hidden = true
  raw.textContent = text
  box.append(message, raw)
  root.replaceChildren(box)
}

const schedule = (root: HTMLElement, text: string, streaming: boolean) => {
  const pending = jobs.get(root)
  if (pending?.frame) cancelAnimationFrame(pending.frame)
  jobs.set(root, { text, streaming, frame: 0 })
  try {
    syncBlocks(root, text, streaming)
  } catch {
    showFallback(root, text)
  }
}

const onBodyClick = (event: MouseEvent) => {
  const root = event.currentTarget
  const target = event.target
  if (!(root instanceof HTMLElement) || !(target instanceof Element)) return
  const copyButton = target.closest('[data-copy-code]')
  if (copyButton instanceof HTMLButtonElement && root.contains(copyButton)) {
    void commitCodeCopy(copyButton)
    return
  }
  const rawButton = target.closest('[data-show-raw]')
  if (!(rawButton instanceof HTMLElement) || !root.contains(rawButton)) return
  const raw = root.querySelector('[data-raw-text]')
  if (raw instanceof HTMLElement) raw.hidden = false
}

export const MessageBody = (props: {
  source: Computed<string> | Atom<string>
  streaming: Computed<boolean>
}): HTMLElement => {
  const id = ++messageSeq
  return (
    <div
      dir="auto"
      data-message-body
      css={markdownCss}
      on:click={onBodyClick}
      ref={(element) => {
        const view = computed(
          () => ({
            text: props.source(),
            streaming: props.streaming(),
          }),
          `render.messageBody#${id}.view`,
        )
        const unsubscribe = view.subscribe((state) => {
          schedule(element, state.text, state.streaming)
        })
        return () => {
          unsubscribe()
          const job = jobs.get(element)
          if (job?.frame) cancelAnimationFrame(job.frame)
          jobs.delete(element)
          clearCopyTimersIn(element)
          releaseTableFrames(element)
        }
      }}
    />
  ) as HTMLDivElement
}
