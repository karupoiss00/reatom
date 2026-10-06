import '../setup'

import { button, createActor, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { activeChat } from '../chat'
import { bootApp, unmountApp } from './boot'
import { generationRecord } from './fixtures/generation'
import { limitedKey } from './fixtures/keys'
import {
  externalRequests,
  mockChatStream,
  mockGeneration,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-math-story'
const modelLabel = 'OpenAI: GPT-4o-mini'

const partial = 'The integral\n\n$$\\int_0^1'
const rest =
  ' x\\,dx$$\n\nIt costs $5 and $10.\n\nEnergy $E=mc^2$, sum \\(a+b\\), and \\[c+d\\]\n\n```\n$x$\n```\n'
const renderedSource = `${partial}${rest}`
const invalidSource =
  'The opening paragraph remains.\n\n$$\\frac{$$\n\nThe closing paragraph remains.\n'

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 280))

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

let clipboardText = ''

const installClipboard = () => {
  clipboardText = ''
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        clipboardText = value
      },
    },
  })
}

const shoot = async (name: string) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  await shot('F-09', name)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>('[data-slot="Composer"] textarea')

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>(
    '[data-slot="Composer"] [data-send]',
  )

const assistants = () =>
  [...document.querySelectorAll<HTMLElement>('[data-slot="AssistantMessage"]')]

const bodyOf = (article: Element | undefined) =>
  article?.querySelector<HTMLElement>('[data-message-body]') ?? null

const texOf = (math: Element) =>
  math.querySelector('annotation')?.textContent ?? ''

const onScreen = (element: Element) => {
  const box = element.getBoundingClientRect()
  expect(box.width).toBeGreaterThan(0)
  expect(box.height).toBeGreaterThan(0)
  expect(box.top).toBeGreaterThanOrEqual(-1)
  expect(box.left).toBeGreaterThanOrEqual(-1)
  expect(box.bottom).toBeLessThanOrEqual(desktop.height + 1)
  expect(box.right).toBeLessThanOrEqual(desktop.width + 1)
}

const foreignResource = (url: string) => {
  if (/katex\.org|cdnjs|jsdelivr|unpkg|gstatic|googleapis|fonts\./i.test(url)) {
    return true
  }
  try {
    const host = new URL(url, location.href).host
    return host.length > 0 && !/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
  } catch {
    return false
  }
}

const chunk = (
  content: string,
  finish: 'stop' | null = null,
  id = 'gen-math-1',
) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: 'openai/gpt-4o-mini',
  choices: [
    {
      index: 0,
      delta: { content },
      finish_reason: finish,
    },
  ],
  ...(finish === 'stop'
    ? {
        usage: {
          prompt_tokens: 10,
          completion_tokens: 4,
          total_tokens: 14,
          cost: 0.000012,
          is_byok: false,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      }
    : {}),
})

const resources: string[] = []
let observer: PerformanceObserver | null = null

afterEach(async () => {
  observer?.disconnect()
  observer = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya reads LaTeX in a reply', async () => {
  resetLocation()
  installClipboard()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  mockGeneration({ ...generationRecord, id: 'gen-math-1', total_cost: 0.000012 })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  performance.clearResourceTimings()
  resources.length = 0
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) resources.push(entry.name)
  })
  observer.observe({ type: 'resource', buffered: true })

  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)

  mockChatStream({
    chunks: [
      { data: chunk('', null) },
      { data: chunk(partial, null) },
      { delayMs: 2_000, data: chunk(rest, null) },
      { data: chunk('', 'stop') },
    ],
  })
  setDraft('Show the integral')
  await keyboard.keyboard('{Enter}')

  const streamingBody = () => bodyOf(assistants()[0])
  await expect
    .poll(() => streamingBody()?.innerText ?? '', { timeout: 6_000 })
    .toContain('$$\\int_0^1')
  expect(streamingBody()?.innerText ?? '').not.toContain('x\\,dx$$')
  expect(streamingBody()?.querySelector('math')).toBeNull()
  streamingBody()?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  if (streamingBody()) onScreen(streamingBody()!)
  await shoot('streaming')

  await expect
    .poll(() => streamingBody()?.innerText ?? '', { timeout: 8_000 })
    .toContain('It costs $5 and $10')
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Send')

  const rendered = streamingBody()
  expect(rendered).toBeTruthy()
  const formulas = [...(rendered?.querySelectorAll('math') ?? [])]
  const integral = formulas.find((math) => texOf(math).includes('\\int_0^1'))
  const energy = formulas.find((math) => texOf(math) === 'E=mc^2')
  const sum = formulas.find((math) => texOf(math) === 'a+b')
  const bracket = formulas.find((math) => texOf(math) === 'c+d')
  expect(integral).toBeTruthy()
  expect(rendered?.innerText ?? '').not.toContain('$$')
  expect(integral?.getAttribute('display')).toBe('block')
  expect(getComputedStyle(integral!).display).toBe('block')

  const cost = [...(rendered?.querySelectorAll('p') ?? [])].find((paragraph) =>
    paragraph.textContent?.includes('It costs'),
  )
  expect(cost?.textContent).toContain('$5 and $10')
  expect(cost?.querySelector('math')).toBeNull()
  expect(integral!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
    (cost?.getBoundingClientRect().top ?? 0) + 2,
  )
  const integralRow = integral!.querySelector('mrow') ?? integral!
  const integralBox = integralRow.getBoundingClientRect()
  const column = rendered!.getBoundingClientRect()
  expect(
    Math.abs(integralBox.left + integralBox.width / 2 - (column.left + column.width / 2)),
  ).toBeLessThan(16)

  expect(energy).toBeTruthy()
  expect(sum).toBeTruthy()
  expect(energy?.getAttribute('display')).not.toBe('block')
  expect(sum?.getAttribute('display')).not.toBe('block')
  const energyLine = energy?.closest('p')
  expect(energyLine?.textContent).toContain('Energy')
  expect(energyLine?.textContent).toContain('sum')
  expect(
    Math.abs(
      (energy?.getBoundingClientRect().top ?? 0) -
        (sum?.getBoundingClientRect().top ?? 0),
    ),
  ).toBeLessThan(10)

  expect(bracket).toBeTruthy()
  expect(bracket?.getAttribute('display')).toBe('block')
  expect(bracket!.getBoundingClientRect().top).toBeGreaterThan(
    (energy?.getBoundingClientRect().bottom ?? 0) - 2,
  )

  const code = rendered?.querySelector('pre, [data-code-block]')
  expect(code?.textContent).toContain('$x$')
  expect(code?.querySelector('math')).toBeNull()

  rendered?.scrollIntoView({ block: 'start', inline: 'nearest' })
  await settle()
  for (const formula of [integral!, energy!, sum!, bracket!]) onScreen(formula)
  onScreen(cost!)
  await shoot('rendered')

  await I.see(text(/It costs \$5 and \$10/))
  await I.click(button('Copy reply'))
  await expect.poll(() => clipboardText).toBe(renderedSource)
  await expect
    .poll(
      () =>
        assistants()[0]?.querySelector('[data-slot="MessageActions"] button')
          ?.textContent ?? '',
      { timeout: 4_000 },
    )
    .toBe('Copy')

  mockChatStream({
    chunks: [
      { data: chunk('', null, 'gen-math-2') },
      { data: chunk(invalidSource, null, 'gen-math-2') },
      { data: chunk('', 'stop', 'gen-math-2') },
    ],
  })
  setDraft('Show a broken formula')
  await keyboard.keyboard('{Enter}')
  await expect
    .poll(() => assistants().length, { timeout: 6_000 })
    .toBe(2)
  const invalidBody = () => bodyOf(assistants()[1])
  await expect
    .poll(() => invalidBody()?.innerText ?? '', { timeout: 6_000 })
    .toContain('The closing paragraph remains.')
  await expect.poll(() => sendButton()?.getAttribute('aria-label')).toBe('Send')

  const broken = invalidBody()
  expect(broken?.innerText).toContain('The opening paragraph remains.')
  expect(broken?.innerText).toContain('The closing paragraph remains.')
  const fallback = broken?.querySelector(
    '[aria-label="Couldn\'t render formula"]',
  )
  expect(fallback).toBeTruthy()
  expect(fallback?.textContent).toContain('\\frac{')
  expect(fallback?.textContent).toContain('$$')
  expect(fallback?.getAttribute('role')).toBe('img')
  const paragraphs = [...(broken?.querySelectorAll('p') ?? [])].map(
    (paragraph) => paragraph.textContent ?? '',
  )
  expect(paragraphs.some((paragraph) => paragraph.includes('opening paragraph'))).toBe(
    true,
  )
  expect(paragraphs.some((paragraph) => paragraph.includes('closing paragraph'))).toBe(
    true,
  )

  broken?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  onScreen(fallback!)
  for (const paragraph of broken?.querySelectorAll('p') ?? []) onScreen(paragraph)
  await I.see(text(/The opening paragraph remains/))
  await shoot('invalid')

  const loaded = [
    ...resources,
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
  ]
  expect(externalRequests()).toEqual([])
  expect(loaded.filter(foreignResource)).toEqual([])
})
