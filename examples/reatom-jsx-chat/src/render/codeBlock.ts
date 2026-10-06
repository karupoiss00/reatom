import type { Tokens } from 'marked'

import { copyText as platformCopyText } from '../platform/clipboard'

export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

const languageLabel = (lang: string | undefined) => {
  const token = /[\w-]+/.exec(lang ?? '')?.[0] ?? ''
  return token.length > 0 ? token : 'text'
}

const copyName = (label: string) => `Copy ${label} code`

const failureCopy = "Couldn't copy. Select the text instead."

let copyTextImpl = platformCopyText

const copiedTimers = new WeakMap<HTMLButtonElement, number>()

export const setCopyText = (copy?: (text: string) => Promise<boolean>) => {
  copyTextImpl = copy ?? platformCopyText
}

const labelOf = (button: HTMLButtonElement) =>
  button.closest('[data-code-block]')?.querySelector('[data-code-lang]')
    ?.textContent || 'text'

const showCopy = (button: HTMLButtonElement) => {
  button.textContent = 'Copy'
  button.setAttribute('aria-label', copyName(labelOf(button)))
}

export const createCodeBlock = (token: Tokens.Code) => {
  const label = languageLabel(token.lang)
  const figure = document.createElement('figure')
  figure.dir = 'ltr'
  figure.dataset.codeBlock = ''
  figure.dataset.mdKind = 'code'
  const header = document.createElement('div')
  header.dataset.codeHeader = ''
  const lang = document.createElement('span')
  lang.dataset.codeLang = ''
  lang.textContent = label
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.copyCode = ''
  button.textContent = 'Copy'
  button.setAttribute('aria-label', copyName(label))
  const pre = document.createElement('pre')
  pre.dir = 'ltr'
  const code = document.createElement('code')
  code.textContent = token.text
  if (label !== 'text') code.className = `language-${label}`
  pre.append(code)
  header.append(lang, button)
  figure.append(header, pre)
  return figure
}

export const writeCodeBlock = (figure: HTMLElement, token: Tokens.Code) => {
  const label = languageLabel(token.lang)
  const lang = figure.querySelector('[data-code-lang]')
  const code = figure.querySelector('code')
  const button = figure.querySelector('[data-copy-code]')
  const pre = figure.querySelector('pre')
  if (lang) lang.textContent = label
  if (code) {
    code.textContent = token.text
    code.className = label === 'text' ? '' : `language-${label}`
  }
  if (pre instanceof HTMLElement) pre.dir = 'ltr'
  figure.dir = 'ltr'
  if (button instanceof HTMLButtonElement && button.textContent === 'Copy') {
    button.setAttribute('aria-label', copyName(label))
  }
}

export const clearCopyTimersIn = (root: ParentNode) => {
  root.querySelectorAll('[data-copy-code]').forEach((node) => {
    if (!(node instanceof HTMLButtonElement)) return
    const timer = copiedTimers.get(node)
    if (timer === undefined) return
    window.clearTimeout(timer)
    copiedTimers.delete(node)
  })
}

export const commitCodeCopy = async (button: HTMLButtonElement) => {
  const code =
    button.closest('[data-code-block]')?.querySelector('code')?.textContent ??
    ''
  const copied = await copyTextImpl(code)
  if (!button.isConnected) return
  const pending = copiedTimers.get(button)
  if (pending !== undefined) window.clearTimeout(pending)
  if (!copied) {
    button.textContent = failureCopy
    button.setAttribute('aria-label', failureCopy)
    copiedTimers.delete(button)
    return
  }
  button.textContent = 'Copied'
  button.setAttribute('aria-label', 'Copied')
  const timer = window.setTimeout(() => {
    copiedTimers.delete(button)
    if (button.isConnected) showCopy(button)
  }, 2000)
  copiedTimers.set(button, timer)
}
