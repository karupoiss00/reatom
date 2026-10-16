import { Marked, type MarkedExtension, type Token, type Tokens } from 'marked'

import { createCodeBlock, escapeHtml, writeCodeBlock } from './codeBlock'
import {
  discardExtensionSlots,
  holdExtensionHtml,
  safeUrl,
  sanitizeHtml,
  type SanitizeExtra,
} from './sanitize'

export type MarkdownExtension = MarkedExtension & {
  sanitize?: SanitizeExtra
}

const baseRenderer: MarkedExtension = {
  renderer: {
    link(token) {
      const href = token.href?.trim() ?? ''
      if (href.length === 0) return escapeHtml(token.raw)
      const safe = safeUrl(href)
      if (!safe) return escapeHtml(token.text)
      const inner = this.parser.parseInline(token.tokens)
      return `<a href="${escapeHtml(safe)}">${inner}</a>`
    },
    image(token) {
      const href = token.href?.trim() ?? ''
      const label = token.text?.trim() || href
      const safe = safeUrl(href)
      if (!safe) return escapeHtml(label || token.raw)
      return `<a href="${escapeHtml(safe)}">${escapeHtml(label)}</a>`
    },
    code() {
      return ''
    },
  },
}

const extensions: MarkdownExtension[] = []

let marked = new Marked({ gfm: true, breaks: false })

type RenderFn = (this: unknown, ...args: never[]) => unknown

const wrapRender = (render: RenderFn, extra: SanitizeExtra): RenderFn =>
  function (this: unknown, ...args: never[]) {
    const result = render.apply(this, args)
    if (typeof result !== 'string') return result
    return holdExtensionHtml(result, extra)
  }

const scopedExtension = (extension: MarkdownExtension): MarkedExtension => {
  const { sanitize: extra, renderer, extensions: nested, ...rest } = extension
  const scoped: MarkedExtension = { ...rest }
  if (renderer) {
    if (!extra) scoped.renderer = renderer
    else {
      const wrapped: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(renderer)) {
        wrapped[key] =
          typeof value === 'function'
            ? wrapRender(value as RenderFn, extra)
            : value
      }
      scoped.renderer = wrapped as MarkedExtension['renderer']
    }
  }
  if (nested) {
    scoped.extensions = nested.map((item) => {
      if (
        !extra ||
        !('renderer' in item) ||
        typeof item.renderer !== 'function'
      ) {
        return item
      }
      return {
        ...item,
        renderer: wrapRender(item.renderer as RenderFn, extra),
      }
    }) as MarkedExtension['extensions']
  }
  return scoped
}

const rebuildMarked = () => {
  marked = new Marked({ gfm: true, breaks: false })
  marked.use(baseRenderer)
  for (const extension of extensions) marked.use(scopedExtension(extension))
}

rebuildMarked()

export const registerMarkdownExtension = (extension: MarkdownExtension) => {
  extensions.push(extension)
  rebuildMarked()
}

export const unregisterMarkdownExtension = (extension: MarkdownExtension) => {
  const index = extensions.indexOf(extension)
  if (index >= 0) extensions.splice(index, 1)
  rebuildMarked()
}

export const blockRaw = new WeakMap<HTMLElement, string>()

const isCodeToken = (token: Token): token is Tokens.Code =>
  token.type === 'code' && 'text' in token

const isPlainParagraph = (token: Token): token is Tokens.Paragraph =>
  token.type === 'paragraph' &&
  'tokens' in token &&
  Array.isArray(token.tokens) &&
  token.tokens.every(
    (child) => child.type === 'text' || child.type === 'escape',
  )

const htmlFor = (token: Token) => {
  const html = marked.parser([token])
  if (typeof html !== 'string') {
    throw new Error('Markdown extension returned a promise')
  }
  return html
}

const adoptBlock = (fragment: DocumentFragment, kind: string) => {
  const elements = [...fragment.childNodes].filter(
    (node): node is HTMLElement => node instanceof HTMLElement,
  )
  if (elements.length === 1) {
    elements[0].dataset.mdKind = kind
    return elements[0]
  }
  const shell = document.createElement('div')
  shell.dataset.mdKind = kind
  shell.append(fragment)
  return shell
}

const plainParagraphMarkup = (text: string) => {
  const escaped = escapeHtml(text)
  return new Set([`<p>${escaped}</p>\n`, `<p>${escaped}</p>`])
}

const frameObservers = new WeakMap<HTMLElement, ResizeObserver>()

const tableFramesIn = (root: ParentNode) => [
  ...(root instanceof Element && root.matches('[data-table-frame]')
    ? [root]
    : []),
  ...root.querySelectorAll('[data-table-frame]'),
]

const bindTableFrame = (frame: HTMLElement) => {
  if (frameObservers.has(frame)) return
  const scroller = frame.querySelector('[data-table-scroll]')
  if (!(scroller instanceof HTMLElement)) return
  const observer = new ResizeObserver(() => refreshTableFades(frame))
  observer.observe(scroller)
  frameObservers.set(frame, observer)
}

export const observeTableFrames = (root: ParentNode) => {
  for (const frame of tableFramesIn(root)) {
    if (frame instanceof HTMLElement) bindTableFrame(frame)
  }
}

export const refreshTableFades = (root: ParentNode) => {
  for (const frame of tableFramesIn(root)) {
    if (!(frame instanceof HTMLElement)) continue
    const scroller = frame.querySelector('[data-table-scroll]')
    if (!(scroller instanceof HTMLElement)) continue
    const overflow = scroller.scrollWidth - scroller.clientWidth > 1
    const atEnd =
      scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1
    frame.dataset.fadeEnd = overflow && !atEnd ? '1' : '0'
    const track = frame.querySelector('[data-table-scrollbar]')
    const thumb = frame.querySelector('[data-table-thumb]')
    if (!(track instanceof HTMLElement) || !(thumb instanceof HTMLElement)) {
      continue
    }
    track.hidden = !overflow
    if (!overflow) continue
    const trackWidth = track.clientWidth || scroller.clientWidth
    const thumbWidth = Math.max(
      28,
      (scroller.clientWidth / scroller.scrollWidth) * trackWidth,
    )
    const travel = Math.max(0, trackWidth - thumbWidth)
    const range = scroller.scrollWidth - scroller.clientWidth
    const left = range > 0 ? (scroller.scrollLeft / range) * travel : 0
    thumb.style.width = `${thumbWidth}px`
    thumb.style.transform = `translateX(${left}px)`
  }
}

export const releaseTableFrames = (root: ParentNode) => {
  for (const frame of tableFramesIn(root)) {
    if (!(frame instanceof HTMLElement)) continue
    frameObservers.get(frame)?.disconnect()
    frameObservers.delete(frame)
  }
}

const tableFrame = (table: HTMLElement) => {
  const frame = document.createElement('div')
  frame.dataset.tableFrame = ''
  frame.dataset.mdKind = 'table'
  const scroller = document.createElement('div')
  scroller.dataset.tableScroll = ''
  scroller.append(table)
  scroller.addEventListener('scroll', () => refreshTableFades(frame), {
    passive: true,
  })
  const track = document.createElement('div')
  track.dataset.tableScrollbar = ''
  const thumb = document.createElement('div')
  thumb.dataset.tableThumb = ''
  track.append(thumb)
  frame.append(scroller, track)
  bindTableFrame(frame)
  return frame
}

export const renderBlock = (token: Token): HTMLElement => {
  try {
    if (isCodeToken(token)) {
      const figure = createCodeBlock(token)
      blockRaw.set(figure, token.raw)
      return figure
    }
    const html = htmlFor(token)
    if (isPlainParagraph(token) && plainParagraphMarkup(token.text).has(html)) {
      const paragraph = document.createElement('p')
      paragraph.dataset.mdKind = 'paragraph'
      paragraph.textContent = token.text
      blockRaw.set(paragraph, token.raw)
      return paragraph
    }
    const block = adoptBlock(sanitizeHtml(html), token.type)
    if (token.type !== 'table') {
      blockRaw.set(block, token.raw)
      return block
    }
    const frame = tableFrame(block)
    blockRaw.set(frame, token.raw)
    return frame
  } finally {
    discardExtensionSlots()
  }
}

export const blockTokens = (source: string) =>
  marked.lexer(source).filter((token) => token.type !== 'space')

export const writeTail = (element: HTMLElement, token: Token) => {
  if (isCodeToken(token) && element.hasAttribute('data-code-block')) {
    writeCodeBlock(element, token)
    blockRaw.set(element, token.raw)
    return true
  }
  if (isPlainParagraph(token) && element.dataset.mdKind === 'paragraph') {
    const html = htmlFor(token)
    discardExtensionSlots()
    if (!plainParagraphMarkup(token.text).has(html)) return false
    element.textContent = token.text
    blockRaw.set(element, token.raw)
    return true
  }
  return false
}

export const renderMarkdown = (
  source: string,
  opts: { streaming: boolean },
) => {
  const tokens = blockTokens(source)
  const fragment = document.createDocumentFragment()
  const last = tokens.length - 1
  tokens.forEach((token, index) => {
    const block = renderBlock(token)
    if (opts.streaming && index === last) block.dataset.tail = ''
    fragment.append(block)
  })
  return fragment
}
