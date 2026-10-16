import katex from 'katex'

import { escapeHtml } from './codeBlock'
import { registerMarkdownExtension, type MarkdownExtension } from './markdown'

const mathmlNamespace = 'http://www.w3.org/1998/Math/MathML'

const mathCss = `
  [data-message-body] math[display='block'] {
    display: block;
    width: fit-content;
    margin: 0.85rem auto 1rem;
    font-size: 1.2em;
  }

  [data-message-body] annotation {
    display: none;
  }
`

const mountMathCss = () => {
  if (
    typeof document === 'undefined' ||
    document.getElementById('atelier-math')
  ) {
    return
  }
  const style = document.createElement('style')
  style.id = 'atelier-math'
  style.textContent = mathCss
  document.head.append(style)
}

const oddEscape = (src: string, index: number) => {
  let slashes = 0
  for (
    let cursor = index - 1;
    cursor >= 0 && src[cursor] === '\\';
    cursor -= 1
  ) {
    slashes += 1
  }
  return slashes % 2 === 1
}

const isSpace = (char: string | undefined) =>
  char !== undefined && /\s/.test(char)

const closed = (src: string, open: string, close: string) => {
  if (!src.startsWith(open) || oddEscape(src, 0)) return undefined
  let search = open.length
  while (search < src.length) {
    const found = src.indexOf(close, search)
    if (found < 0) return undefined
    if (!oddEscape(src, found)) {
      const text = src.slice(open.length, found)
      if (!text.trim()) return undefined
      return { raw: src.slice(0, found + close.length), text }
    }
    search = found + close.length
  }
  return undefined
}

const matchSingleDollar = (src: string) => {
  if (src[0] !== '$' || src[1] === '$' || oddEscape(src, 0)) return undefined
  if (src[1] === undefined || isSpace(src[1])) return undefined
  for (let index = 1; index < src.length; index += 1) {
    const char = src[index]
    if (char === '\n') return undefined
    if (char !== '$' || src[index + 1] === '$' || oddEscape(src, index))
      continue
    if (isSpace(src[index - 1])) continue
    const after = src[index + 1]
    if (after !== undefined && after >= '0' && after <= '9') continue
    const text = src.slice(1, index)
    if (!text || isSpace(text[0]) || isSpace(text[text.length - 1])) continue
    return { raw: src.slice(0, index + 1), text }
  }
  return undefined
}

const matchBlock = (src: string) => {
  const indented = /^( {0,3})([\s\S]*)$/.exec(src)
  if (!indented) return undefined
  const indent = indented[1] ?? ''
  const body = indented[2] ?? ''
  const display = closed(body, '$$', '$$') ?? closed(body, '\\[', '\\]')
  if (!display) return undefined
  const after = body.slice(display.raw.length)
  const trail = /^[ \t]*(?:\n+|$)/.exec(after)
  if (!trail) return undefined
  return {
    raw: indent + display.raw + trail[0],
    text: display.text,
  }
}

const blockStart = (src: string) => /\n {0,3}(?:\$\$|\\\[)/.exec(src)?.index

const inlineStart = (src: string) => /\$|\\\(|\\\[/.exec(src)?.index

type MathToken = {
  text?: string
  raw: string
  display?: boolean
}

const renderMath = (token: MathToken) => {
  const display = token.display === true
  const tex = typeof token.text === 'string' ? token.text : ''
  try {
    const html = katex
      .renderToString(tex.trim(), {
        displayMode: display,
        output: 'mathml',
        throwOnError: true,
      })
      .trim()
    return display ? `<div>${html}</div>` : html
  } catch {
    const source = token.raw.replace(/[ \t]*\n+$/g, '')
    return `<code role="img" aria-label="Couldn't render formula">${escapeHtml(source)}</code>`
  }
}

const mathBlock = {
  name: 'mathBlock',
  level: 'block' as const,
  start: blockStart,
  tokenizer(src: string) {
    const match = matchBlock(src)
    if (!match) return undefined
    return {
      type: 'mathBlock',
      raw: match.raw,
      text: match.text,
      display: true,
    }
  },
  renderer: renderMath,
}

const mathInline = {
  name: 'mathInline',
  level: 'inline' as const,
  start: inlineStart,
  tokenizer(src: string) {
    const display = closed(src, '$$', '$$') ?? closed(src, '\\[', '\\]')
    if (display) {
      return {
        type: 'mathInline',
        raw: display.raw,
        text: display.text,
        display: true,
      }
    }
    const paren = closed(src, '\\(', '\\)')
    if (!paren) {
      const dollar = matchSingleDollar(src)
      if (!dollar) return undefined
      return {
        type: 'mathInline',
        raw: dollar.raw,
        text: dollar.text,
        display: false,
      }
    }
    return {
      type: 'mathInline',
      raw: paren.raw,
      text: paren.text,
      display: false,
    }
  },
  renderer: renderMath,
}

const mathExtension: MarkdownExtension = {
  sanitize: {
    tags: [
      'math',
      'semantics',
      'annotation',
      'mrow',
      'mi',
      'mo',
      'mn',
      'mtext',
      'mspace',
      'msubsup',
      'msup',
      'msub',
      'mfrac',
      'msqrt',
      'mroot',
      'mtable',
      'mtr',
      'mtd',
      'mover',
      'munder',
      'munderover',
      'menclose',
      'mpadded',
      'mphantom',
      'mstyle',
      'mmultiscripts',
      'mprescripts',
      'merror',
      'mfenced',
      'ms',
      'none',
    ],
    attributes: [
      'aria-label',
      'display',
      'encoding',
      'xmlns',
      'role',
      'stretchy',
      'mathvariant',
      'scriptlevel',
      'displaystyle',
      'lspace',
      'rspace',
      'fence',
      'separator',
      'accent',
      'form',
      'largeop',
      'movablelimits',
      'symmetric',
      'linethickness',
      'notation',
      'columnalign',
      'rowalign',
      'width',
      'height',
      'depth',
    ],
    namespaces: [mathmlNamespace],
  },
  extensions: [mathBlock, mathInline],
}

mountMathCss()
registerMarkdownExtension(mathExtension)
