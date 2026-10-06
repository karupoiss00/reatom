import { atom, computed } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { cdp, page } from 'vitest/browser'
import { afterEach, expect, test } from 'vitest'

import { copyText as platformCopyText } from '../../platform/clipboard'
import { globalStyles } from '../../styles/tokens'
import {
  externalRequests,
  installOpenRouterMock,
  openRouterRequests,
  resetOpenRouterMock,
  uninstallOpenRouterMock,
} from '../../testing/openrouter-mock'
import { shot } from '../../testing/screenshot'
import {
  composite,
  contrastRatio,
  parseColor,
  relativeLuminance,
} from '../../ui/contrast'
import {
  detectDir,
  MessageBody,
  registerMarkdownExtension,
  renderMarkdown,
  setCopyText,
  unregisterMarkdownExtension,
} from '../index'

const flush = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })

const emulateScheme = (scheme: 'light' | 'dark') =>
  (
    cdp() as {
      send: (method: string, params?: Record<string, unknown>) => Promise<void>
    }
  ).send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: scheme }],
  })

const mounted: Array<{ unmount: () => void }> = []

const mountHost = () => {
  document.body.replaceChildren()
  const host = document.createElement('div')
  document.body.append(host)
  return host
}

const mountIn = (host: HTMLElement, node: Element) => {
  const handle = mount(host, node as HTMLElement)
  mounted.push(handle)
  return handle
}

const message = (sourceText: string, streaming = false) => {
  const source = atom(sourceText, 'render.test.source')
  const streamingState = atom(streaming, 'render.test.streamingState')
  const streamingView = computed(
    () => streamingState(),
    'render.test.streaming',
  )
  const body = (
    <MessageBody source={source} streaming={streamingView} />
  ) as HTMLElement
  return { source, streamingState, body }
}

afterEach(() => {
  for (const handle of mounted) handle.unmount()
  mounted.length = 0
  setCopyText()
  document.body.replaceChildren()
})

test('GFM tables render as `<table>` with `<th>` cells.', () => {
  const fragment = renderMarkdown(
    '| Model | Context |\n| --- | --- |\n| Claude | 200k |\n',
    { streaming: false },
  )
  const host = mountHost()
  host.append(fragment)
  const table = host.querySelector('table')
  expect(table).toBeInstanceOf(HTMLTableElement)
  expect(table?.querySelector('th')?.textContent).toBe('Model')
  expect(table?.querySelectorAll('th').length).toBe(2)
  expect(table?.textContent).toContain('200k')
})

test('Links open in a new tab with `rel="noopener noreferrer"`.', () => {
  const fragment = renderMarkdown(
    'Read the [docs](https://openrouter.ai/docs).\n',
    { streaming: false },
  )
  const host = mountHost()
  host.append(fragment)
  const link = host.querySelector('a')
  expect(link?.getAttribute('href')).toBe('https://openrouter.ai/docs')
  expect(link?.getAttribute('target')).toBe('_blank')
  expect(link?.getAttribute('rel')).toBe('noopener noreferrer')
  expect(link?.textContent).toBe('docs')
})

test('Output containing `<script>`, `<img onerror>`, or `javascript:` links runs nothing and renders as inert text or a stripped element.', () => {
  const marker = '__atelierXss'
  ;(window as unknown as Record<string, number>)[marker] = 0
  const fragment = renderMarkdown(
    [
      '<script>window.__atelierXss = 1</script>',
      '<img src="x" onerror="window.__atelierXss = 1">',
      '[click](javascript:window.__atelierXss = 1)',
      'Hello after the payload.',
    ].join('\n\n'),
    { streaming: false },
  )
  const host = mountHost()
  host.append(fragment)
  expect(host.querySelector('script')).toBeNull()
  expect(host.querySelector('img')).toBeNull()
  expect(host.querySelector('[onerror]')).toBeNull()
  expect(host.querySelector('a[href^="javascript:"]')).toBeNull()
  expect((window as unknown as Record<string, number>)[marker]).toBe(0)
  expect(host.textContent).toContain('Hello after the payload.')
})

test('Markdown images and remote `http(s)` image URLs render as links, not `<img>`. No request leaves for any host other than `openrouter.ai`.', async () => {
  installOpenRouterMock()
  resetOpenRouterMock()
  performance.clearResourceTimings()
  const seen: string[] = []
  const mockedFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    seen.push(url)
    return mockedFetch(input, init)
  }
  try {
    const fragment = renderMarkdown(
      [
        '![Diagram](https://evil.example/diagram.png)',
        '<img src="https://cdn.example/photo.jpg" alt="Photo">',
        'https://images.example/raw.png',
      ].join('\n\n'),
      { streaming: false },
    )
    const host = mountHost()
    host.append(fragment)
    await flush()
    expect(host.querySelector('img')).toBeNull()
    const hrefs = [...host.querySelectorAll('a')].map((link) =>
      link.getAttribute('href'),
    )
    expect(hrefs).toContain('https://evil.example/diagram.png')
    expect(hrefs).toContain('https://cdn.example/photo.jpg')
    expect(hrefs).toContain('https://images.example/raw.png')
    expect(
      host.querySelector('a[href="https://evil.example/diagram.png"]')
        ?.textContent,
    ).toBe('Diagram')
    expect(
      host.querySelector('a[href="https://cdn.example/photo.jpg"]')
        ?.textContent,
    ).toBe('Photo')
    const resources = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
    const foreign = [...seen, ...resources].filter(
      (url) => !url.includes('openrouter.ai'),
    )
    expect(foreign).toEqual([])
    expect(
      openRouterRequests().every((request) =>
        request.url.includes('openrouter.ai'),
      ),
    ).toBe(true)
  } finally {
    globalThis.fetch = mockedFetch
    uninstallOpenRouterMock()
  }
})

test('While streaming, an unclosed fence renders as a growing code block, not as raw backticks.', async () => {
  const { source, body } = message('```js\nconst value = 1', true)
  const host = mountHost()
  mountIn(host, body)
  await flush()
  const code = body.querySelector('code')
  expect(code).toBeInstanceOf(HTMLElement)
  expect(code?.textContent).toContain('const value = 1')
  expect(body.textContent).not.toContain('```')
  expect(body.querySelector('[data-code-lang]')?.textContent).toBe('js')
  expect(body.querySelector('[data-code-block]')?.getAttribute('dir')).toBe(
    'ltr',
  )
  source.set('```js\nconst value = 1\nconst next = 2')
  await flush()
  expect(body.querySelector('code')).toBe(code)
  expect(code?.textContent).toContain('const next = 2')
  expect(body.textContent).not.toContain('```')
})

test('Each code block has a language label (or "text") and a Copy button. Clicking it shows "Copied" for 2 s, and the clipboard holds exactly the code.', async () => {
  const copied: string[] = []
  setCopyText(async (text) => {
    copied.push(text)
    return true
  })
  const { body } = message(
    [
      'Plain fence:',
      '',
      '```',
      'alpha',
      'beta',
      '```',
      '',
      '```typescript',
      'export const n = 1',
      '```',
    ].join('\n'),
    false,
  )
  const host = mountHost()
  mountIn(host, body)
  await flush()
  const blocks = [...body.querySelectorAll('[data-code-block]')]
  expect(blocks).toHaveLength(2)
  expect(blocks[0]?.querySelector('[data-code-lang]')?.textContent).toBe('text')
  expect(blocks[1]?.querySelector('[data-code-lang]')?.textContent).toBe(
    'typescript',
  )
  const button = blocks[1]?.querySelector('[data-copy-code]')
  expect(button).toBeInstanceOf(HTMLButtonElement)
  expect(button?.textContent).toBe('Copy')
  ;(button as HTMLButtonElement).click()
  await expect.poll(() => button?.textContent).toBe('Copied')
  const code = blocks[1]?.querySelector('code')?.textContent ?? ''
  expect(copied).toEqual([code])
  expect(code).toContain('export const n = 1')
  expect(code).not.toContain('```')
  await new Promise((resolve) => setTimeout(resolve, 2100))
  expect(button?.textContent).toBe('Copy')
})

test('a clipboard rejection shows "Couldn\'t copy. Select the text instead.", and the message stays.', async () => {
  setCopyText(async () => false)
  const { body } = message('```js\nconst kept = true\n```\n', false)
  const host = mountHost()
  host.style.width = '240px'
  mountIn(host, body)
  await flush()
  const button = body.querySelector('[data-copy-code]')
  expect(button).toBeInstanceOf(HTMLButtonElement)
  ;(button as HTMLButtonElement).click()
  await expect
    .poll(() => button?.textContent)
    .toBe("Couldn't copy. Select the text instead.")
  const figure = body.querySelector('[data-code-block]')
  expect(figure).toBeInstanceOf(HTMLElement)
  const buttonBox = (button as HTMLElement).getBoundingClientRect()
  const figureBox = (figure as HTMLElement).getBoundingClientRect()
  expect(buttonBox.right).toBeLessThanOrEqual(figureBox.right + 1)
  expect(buttonBox.left).toBeGreaterThanOrEqual(figureBox.left - 1)
  expect((button as HTMLElement).scrollWidth).toBeLessThanOrEqual(
    (button as HTMLElement).clientWidth + 1,
  )
  expect(body.querySelector('code')?.textContent).toContain('const kept = true')
})

test('Wide tables and long code lines scroll horizontally inside their block.', async () => {
  const wide = 'anthropic/claude-sonnet-4.5-preview-extended-context-window'
  const { body } = message(
    [
      `| Model | Note |`,
      `| --- | --- |`,
      `| ${wide} | stays on one row |`,
      '',
      '```text',
      wide,
      '```',
    ].join('\n'),
    false,
  )
  const host = mountHost()
  host.style.width = '320px'
  mountIn(host, body)
  await flush()
  const scroller = body.querySelector('[data-table-scroll]')
  const pre = body.querySelector('pre')
  expect(scroller).toBeInstanceOf(HTMLElement)
  expect(pre).toBeInstanceOf(HTMLElement)
  expect((scroller as HTMLElement).scrollWidth).toBeGreaterThan(
    (scroller as HTMLElement).clientWidth,
  )
  expect((pre as HTMLElement).scrollWidth).toBeGreaterThan(
    (pre as HTMLElement).clientWidth,
  )
  const tableFrameEl = body.querySelector('[data-table-frame]')
  expect(tableFrameEl).toBeInstanceOf(HTMLElement)
  expect(tableFrameEl?.getAttribute('data-fade-end')).toBe('1')
  expect(getComputedStyle(tableFrameEl as HTMLElement, '::after').content).toBe(
    '""',
  )
  const bar = body.querySelector('[data-table-scrollbar]')
  expect(bar).toBeInstanceOf(HTMLElement)
  expect((bar as HTMLElement).hidden).toBe(false)
  expect(
    Number.parseFloat(getComputedStyle(bar as HTMLElement).height),
  ).toBeGreaterThan(0)
  const el = scroller as HTMLElement
  el.scrollLeft = el.scrollWidth
  el.dispatchEvent(new Event('scroll'))
  expect(el.scrollLeft).toBeGreaterThan(10)
  expect(tableFrameEl?.getAttribute('data-fade-end')).toBe('0')
})

test('A malformed construct (an unterminated table, or a link with an empty URL) renders as plain text, and the rest of the message renders.', () => {
  const fragment = renderMarkdown(
    [
      'Before the break.',
      '',
      '| a | b',
      '| --- |',
      'still here',
      '',
      '[label]()',
      '',
      'After the break.',
    ].join('\n'),
    { streaming: false },
  )
  const host = mountHost()
  host.append(fragment)
  expect(host.querySelector('table')).toBeNull()
  expect(host.querySelector('a[href=""]')).toBeNull()
  expect(host.querySelectorAll('a')).toHaveLength(0)
  expect(host.textContent).toContain('| a | b')
  expect(host.textContent).toContain('still here')
  expect(host.textContent).toContain('[label]()')
  expect(host.textContent).toContain('Before the break.')
  expect(host.textContent).toContain('After the break.')
})

test('A render exception shows "Couldn\'t render this message · Show raw text" for that message only.', async () => {
  const throwingExtension = {
    renderer: {
      paragraph(token: { text: string }) {
        if (token.text.includes('THROW_RENDER'))
          throw new Error('render failed')
        return false as const
      },
    },
  }
  registerMarkdownExtension(throwingExtension)
  const host = mountHost()
  try {
    const broken = message('Fine line.\n\nTHROW_RENDER\n', false)
    const healthy = message('The other message still renders.\n', false)
    const shell = (
      <div>
        {broken.body}
        {healthy.body}
      </div>
    )
    mountIn(host, shell)
    await flush()
    expect(broken.body.textContent).toContain(
      "Couldn't render this message · Show raw text",
    )
    expect(healthy.body.textContent).toContain(
      'The other message still renders.',
    )
    expect(healthy.body.textContent).not.toContain(
      "Couldn't render this message",
    )
    const showRaw = broken.body.querySelector('[data-show-raw]')
    expect(showRaw).toBeInstanceOf(HTMLButtonElement)
    ;(showRaw as HTMLButtonElement).click()
    expect(broken.body.textContent).toContain('THROW_RENDER')
    expect(healthy.body.querySelector('[data-show-raw]')).toBeNull()
  } finally {
    unregisterMarkdownExtension(throwingExtension)
  }
  const restored = message('THROW_RENDER stays text.\n', false)
  mountIn(host, restored.body)
  await flush()
  expect(restored.body.textContent).toContain('THROW_RENDER stays text.')
  expect(restored.body.textContent).not.toContain(
    "Couldn't render this message",
  )
})

test('a fixture whose first strong character is Arabic or Hebrew computes `direction: rtl`', async () => {
  expect(detectDir('مرحبا')).toBe('rtl')
  expect(detectDir('שלום')).toBe('rtl')
  expect(detectDir('  ، مرحبا')).toBe('rtl')
  expect(detectDir('Привет')).toBe('ltr')
  expect(detectDir('你好')).toBe('ltr')
  expect(detectDir('Hello')).toBe('ltr')
  expect(detectDir('123 …')).toBe('auto')

  const { body } = message('مرحبا بالعالم', false)
  const host = mountHost()
  mountIn(host, body)
  await flush()
  expect(body.getAttribute('dir')).toBe('auto')
  expect(getComputedStyle(body).direction).toBe('rtl')
  expect(body.textContent).toContain('مرحبا بالعالم')

  const cjk = message('你好，Привет', false)
  mountIn(host, cjk.body)
  await flush()
  expect(cjk.body.textContent).toContain('你好')
  expect(cjk.body.textContent).toContain('Привет')
  expect(getComputedStyle(cjk.body).direction).toBe('ltr')
})

test("While a 20,000-character reply streams, the streaming message's root element keeps the same DOM identity across chunks, and a composer keystroke commits within 50 ms.", async () => {
  const intro = '# Kept\n\nThe introduction stays put.\n\n'
  let tail = ''
  const sentence = 'Streaming keeps the composer responsive. '
  while (tail.length < 20_000) tail += sentence
  const source = atom(intro, 'render.perf.source')
  const streamingState = atom(true, 'render.perf.streamingState')
  const streaming = computed(() => streamingState(), 'render.perf.streaming')
  const draft = atom('', 'render.perf.draft')
  const body = (
    <MessageBody source={source} streaming={streaming} />
  ) as HTMLElement
  const host = mountHost()
  const shell = (
    <div>
      {body}
      <textarea model:value={draft} data-testid="composer" />
    </div>
  )
  mountIn(host, shell)
  await flush()
  const root = body
  const heading = body.querySelector('h1')
  const introduction = [...body.querySelectorAll('p')].find((node) =>
    node.textContent?.includes('introduction stays put'),
  )
  expect(heading).toBeInstanceOf(HTMLElement)
  expect(introduction).toBeInstanceOf(HTMLElement)

  let text = intro
  for (let index = 0; index < 200; index += 1) {
    text += `w${index} `
    source.set(text)
    expect(body).toBe(root)
    expect(body.isConnected).toBe(true)
  }
  await flush()
  expect(body.querySelector('h1')).toBe(heading)
  expect(
    [...body.querySelectorAll('p')].find((node) =>
      node.textContent?.includes('introduction stays put'),
    ),
  ).toBe(introduction)
  expect(body.textContent).toContain('w199')

  source.set(intro + tail)
  await flush()
  expect(body).toBe(root)
  expect((body.textContent ?? '').length).toBeGreaterThan(20_000)

  const samples: number[] = []
  const textarea = host.querySelector('textarea')
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now()
    source.set(intro + tail + 'x'.repeat(index + 1))
    draft.set(`k${index}`)
    await Promise.resolve()
    expect(textarea?.value).toBe(`k${index}`)
    samples.push(performance.now() - started)
  }
  const elapsed = Math.max(...samples)
  expect(elapsed, `keystroke commit took ${elapsed}ms`).toBeLessThan(50)
  await flush()
  expect(body).toBe(root)
  expect(body.querySelector('h1')).toBe(heading)
})

test('CJK and Cyrillic render as text, and a fenced block inside RTL stays ltr.', async () => {
  const cjk = message('你好 world', false)
  const cyrillic = message('Привет world', false)
  const mixed = message('مرحبا بالعالم\n\n```js\nconst value = 1\n```\n', false)
  const host = mountHost()
  mountIn(host, cjk.body)
  await flush()
  expect(cjk.body.textContent).toContain('你好')
  expect(getComputedStyle(cjk.body).direction).toBe('ltr')
  mountIn(host, cyrillic.body)
  await flush()
  expect(cyrillic.body.textContent).toContain('Привет')
  expect(getComputedStyle(cyrillic.body).direction).toBe('ltr')
  mountIn(host, mixed.body)
  await flush()
  const pre = mixed.body.querySelector('pre')
  expect(pre).toBeInstanceOf(HTMLElement)
  expect(pre?.getAttribute('dir')).toBe('ltr')
  expect(getComputedStyle(pre!).direction).toBe('ltr')
  expect(getComputedStyle(mixed.body).direction).toBe('rtl')
})

test('remote media, svg, style urls, forms, and fixed overlays are stripped and make no external request.', async () => {
  installOpenRouterMock()
  resetOpenRouterMock()
  performance.clearResourceTimings()
  const seen: string[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) seen.push(entry.name)
  })
  observer.observe({ type: 'resource', buffered: true })
  const attacks = [
    {
      html: '<video src="https://evil.example/clip.mp4"></video>',
      absent: 'video, audio, source',
    },
    {
      html: '<svg><image href="https://evil.example/pic.svg"></image></svg>',
      absent: 'svg, image',
    },
    {
      html: '<p style="background:url(https://evil.example/bg.png)">styled</p>',
      absent: '[style]',
    },
    {
      html: '<form action="https://evil.example/post"><input type="text" name="q"></form>',
      absent: 'form, input[type="text"]',
    },
    {
      html: '<table background="https://evil.example/table.png"><tr><td background="https://evil.example/cell.png">cell</td></tr></table>',
      absent: '[background]',
    },
    {
      html: '<input type="image" src="https://evil.example/button.png" alt="go">',
      absent: 'input',
    },
    {
      html: '<math><mglyph src="https://evil.example/glyph.png" alt="g"></mglyph></math>',
      absent: 'math, mglyph',
    },
    {
      html: '<div style="position:fixed;inset:0;background:url(https://evil.example/cover.png)">cover</div>',
      absent: '[style]',
    },
  ]
  try {
    for (const attack of attacks) {
      const fragment = renderMarkdown(`${attack.html}\n\nStill here.\n`, {
        streaming: false,
      })
      const host = mountHost()
      host.append(fragment)
      await flush()
      expect(host.querySelector(attack.absent)).toBeNull()
      expect(host.textContent).toContain('Still here.')
      const fixed = [...host.querySelectorAll('div')].some(
        (node) => getComputedStyle(node).position === 'fixed',
      )
      expect(fixed).toBe(false)
    }
    const resources = [
      ...seen,
      ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ]
    expect(resources.some((url) => url.includes('evil.example'))).toBe(false)
    expect(externalRequests()).toEqual([])
  } finally {
    observer.disconnect()
    uninstallOpenRouterMock()
  }
})

test('unsafe link schemes are rejected after control characters, case, and entities are normalised.', () => {
  const schemes = [
    `java${'\u0000'}script:alert(1)`,
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'vbscript:msgbox(1)',
    '&#106;avascript:alert(1)',
    'javascript&#58;alert(1)',
    'java\tscript:alert(1)',
  ]
  for (const href of schemes) {
    const fragment = renderMarkdown(
      [`[x](${href})`, `<a href="${href}">y</a>`].join('\n\n'),
      { streaming: false },
    )
    const host = mountHost()
    host.append(fragment)
    for (const element of host.querySelectorAll('*')) {
      for (const attribute of element.attributes) {
        const value = attribute.value.toLowerCase().replace(/\s/g, '')
        expect(value.includes('javascript:')).toBe(false)
        expect(value.includes('vbscript:')).toBe(false)
        expect(value.startsWith('data:')).toBe(false)
      }
    }
  }
  const safe = renderMarkdown(
    '[site](https://openrouter.ai) and [mail](mailto:a@b.c) and [jump](#part)\n',
    { streaming: false },
  )
  const safeHost = mountHost()
  safeHost.append(safe)
  const hrefs = [...safeHost.querySelectorAll('a')].map((link) =>
    link.getAttribute('href'),
  )
  expect(hrefs).toContain('https://openrouter.ai')
  expect(hrefs).toContain('mailto:a@b.c')
  expect(hrefs).toContain('#part')
})

test('streaming new blocks keeps an earlier Copy button focused and its code scrolled.', async () => {
  const longLine = 'token '.repeat(40)
  const sourceText = ['```js', longLine, '```', '', 'Start'].join('\n')
  const { source, body } = message(sourceText, true)
  const host = mountHost()
  host.style.width = '280px'
  mountIn(host, body)
  await flush()
  const button = body.querySelector('[data-copy-code]')
  const pre = body.querySelector('pre')
  expect(button).toBeInstanceOf(HTMLButtonElement)
  expect(pre).toBeInstanceOf(HTMLElement)
  ;(button as HTMLButtonElement).focus()
  ;(pre as HTMLElement).scrollLeft = 48
  let text = sourceText
  for (let index = 0; index < 50; index += 1) {
    text += `\n\nParagraph ${index} keeps going.`
    source.set(text)
    await flush()
    expect(document.activeElement).toBe(button)
    expect((pre as HTMLElement).scrollLeft).toBe(48)
  }
})

const watchClearTimeout = () => {
  let saw = false
  const original = window.clearTimeout.bind(window)
  window.clearTimeout = ((id: number) => {
    saw = true
    return original(id)
  }) as typeof window.clearTimeout
  return () => {
    window.clearTimeout = original as typeof window.clearTimeout
    return saw
  }
}

test('Copy code names the language, reports Copied, and clears its timer on unmount.', async () => {
  expect(typeof platformCopyText).toBe('function')
  setCopyText(async () => true)
  const { body } = message('```typescript\nconst kept = true\n```\n', false)
  const host = mountHost()
  const handle = mountIn(host, body)
  await flush()
  const button = body.querySelector('[data-copy-code]')
  expect(button).toBeInstanceOf(HTMLButtonElement)
  expect(button?.getAttribute('aria-label')).toBe('Copy typescript code')
  expect(button?.textContent).toBe('Copy')
  ;(button as HTMLButtonElement).click()
  await expect.poll(() => button?.textContent).toBe('Copied')
  expect(button?.getAttribute('aria-label')).toBe('Copied')
  const cleared = watchClearTimeout()
  const index = mounted.indexOf(handle)
  if (index >= 0) mounted.splice(index, 1)
  handle.unmount()
  expect(cleared()).toBe(true)
  expect(button?.isConnected).toBe(false)
})

test('headings step down from h2, lists share a marker color, and tables breathe more than paragraphs.', async () => {
  const { body } = message(
    [
      '## Section',
      '',
      '### Detail',
      '',
      '#### Note',
      '',
      'A paragraph.',
      '',
      '1. One',
      '2. Two',
      '3. Three',
      '',
      '| Model | Note |',
      '| --- | --- |',
      '| Claude | warm |',
      '',
      '```js',
      'const n = 1',
      '```',
    ].join('\n'),
    false,
  )
  const host = mountHost()
  host.style.width = '640px'
  mountIn(host, body)
  await emulateScheme('light')
  await flush()
  const size = (selector: string) =>
    Number.parseFloat(getComputedStyle(body.querySelector(selector)!).fontSize)
  expect(size('h3')).toBeLessThan(size('h2'))
  expect(size('h4')).toBeLessThan(size('h3'))
  expect(size('h4')).toBeGreaterThan(size('p'))
  const markers = [...body.querySelectorAll('ol li')].map(
    (item) => getComputedStyle(item, '::marker').color,
  )
  expect(new Set(markers).size).toBe(1)
  const paragraphGap = Number.parseFloat(
    getComputedStyle(body.querySelector('p')!).marginTop,
  )
  const tableGap = Number.parseFloat(
    getComputedStyle(
      body.querySelector('[data-table-frame], [data-table-scroll]')!,
    ).marginTop,
  )
  const codeGap = Number.parseFloat(
    getComputedStyle(body.querySelector('[data-code-block]')!).marginTop,
  )
  expect(tableGap).toBeGreaterThan(paragraphGap * 1.4)
  expect(codeGap).toBeGreaterThan(paragraphGap * 1.4)
})

test('the Copy button contrast holds in light and dark.', async () => {
  const { body } = message('```js\nconst n = 1\n```\n', false)
  const host = mountHost()
  const stage = (
    <div>
      <style>{globalStyles}</style>
      {body}
    </div>
  )
  mountIn(host, stage)
  for (const scheme of ['light', 'dark'] as const) {
    await emulateScheme(scheme)
    await flush()
    const button = body.querySelector('[data-copy-code]')
    expect(button).toBeInstanceOf(HTMLElement)
    const style = getComputedStyle(button as HTMLElement)
    const textContrast = contrastRatio(style.color, style.backgroundColor)
    const borderContrast = contrastRatio(
      style.borderTopColor,
      style.backgroundColor,
    )
    expect(textContrast, scheme).toBeGreaterThanOrEqual(4.5)
    expect(borderContrast, scheme).toBeGreaterThanOrEqual(3)
  }
})

const remoteAttributes = (root: ParentNode, hostName: string) =>
  [...root.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) => attribute.value.includes(hostName))
      .map(
        (attribute) =>
          `${element.tagName.toLowerCase()} ${attribute.name}=${attribute.value}`,
      ),
  )

const eventHandlers = (root: ParentNode) =>
  [...root.querySelectorAll('*')].flatMap((element) =>
    [...element.attributes]
      .filter((attribute) => attribute.name.toLowerCase().startsWith('on'))
      .map(
        (attribute) =>
          `${element.tagName.toLowerCase()} ${attribute.name}=${attribute.value}`,
      ),
  )

test('registerMarkdownExtension sanitize extras do not fetch a remote image, and a second message stays clean', () => {
  const svg = 'http://www.w3.org/2000/svg'
  const remote = 'https://evil.example/pixel.png'
  const extension = {
    sanitize: {
      tags: ['svg', 'image'],
      attributes: [
        'xlink:href',
        'ONLOAD',
        'OnMouseOver',
        'filter',
        'fill',
        'clip-path',
        'mask',
        'marker-start',
        'stroke',
        'cursor',
      ],
      namespaces: [svg],
    },
    renderer: {
      html(token: { text: string }) {
        if (!token.text.includes('data-ext-badge')) return false as const
        return [
          `<svg xmlns="${svg}" onload="alert(1)" filter="url(${remote}#f)" fill="url(${remote}#g)" clip-path="url(${remote}#c)" mask="url(${remote}#m)" marker-start="url(${remote}#k)" stroke="url(${remote}#s)" cursor="url(${remote}#p), auto"><image xlink:href="${remote}" href="${remote}"></image></svg>`,
          `<svg xmlns="${svg}" fill="currentColor" filter="url(#shade)"></svg>`,
          `<svg xmlns="${svg}" filter="\\75 rl(${remote})"></svg>`,
          `<div onmouseover="alert(1)">hover</div>`,
          `<iframe src="${remote}"></iframe>`,
          `<img src="${remote}" alt="pixel">`,
          `<p style="background:url(${remote})">styled</p>`,
          '<p>extension output</p>',
        ].join('')
      },
    },
  }
  registerMarkdownExtension(extension)
  try {
    const host = mountHost()
    const first = document.createElement('div')
    const second = document.createElement('div')
    host.append(first, second)
    first.append(
      renderMarkdown('<div data-ext-badge></div>\n', { streaming: false }),
    )
    second.append(
      renderMarkdown(
        [
          'Second stays clean.',
          '',
          `<svg xmlns="${svg}" onload="alert(1)"><image xlink:href="${remote}" filter="url(${remote})"></image></svg>`,
          '',
          `<div onmouseover="alert(1)">hover</div>`,
          `<iframe src="${remote}"></iframe>`,
          `<p style="background:url(${remote})">styled</p>`,
        ].join('\n'),
        { streaming: false },
      ),
    )
    expect(first.textContent).toContain('extension output')
    expect(eventHandlers(first)).toEqual([])
    expect(eventHandlers(second)).toEqual([])
    expect(
      remoteAttributes(first, 'evil.example').filter(
        (entry) => !entry.startsWith('a '),
      ),
    ).toEqual([])
    const safePaint = [...first.querySelectorAll('svg')].find(
      (node) => node.getAttribute('fill') === 'currentColor',
    )
    expect(safePaint?.getAttribute('filter')).toBe('url(#shade)')
    expect(first.querySelector('iframe, img, [style]')).toBeNull()
    expect(second.querySelector('svg, image, img, iframe, [style]')).toBeNull()
    expect(remoteAttributes(second, 'evil.example')).toEqual([])
    expect(second.textContent).toContain('Second stays clean.')
  } finally {
    unregisterMarkdownExtension(extension)
  }
})

test('fence info string `sidebar evil` does not set class `language-sidebar evil`', () => {
  const fragment = renderMarkdown('```sidebar evil\nalert(1)\n```\n', {
    streaming: false,
  })
  const host = mountHost()
  host.append(fragment)
  const code = host.querySelector('code')
  expect(code).toBeInstanceOf(HTMLElement)
  expect(code?.className).toBe('language-sidebar')
  expect(code?.classList.contains('evil')).toBe(false)
  expect(host.querySelector('[data-code-lang]')?.textContent).toBe('sidebar')
})

test('bidi controls are stripped from link text and href', () => {
  const bidi = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069'
  const fragment = renderMarkdown(
    [
      `[https://openrouter.ai${bidi}@evil.example](https://evil.example/${bidi}path)`,
      '',
      `<a href="https://evil.example/${bidi}id">https://openrouter.ai${bidi}</a>`,
    ].join('\n'),
    { streaming: false },
  )
  const host = mountHost()
  host.append(fragment)
  const links = [...host.querySelectorAll('a')]
  expect(links.length).toBeGreaterThan(0)
  for (const link of links) {
    const href = link.getAttribute('href') ?? ''
    const text = link.textContent ?? ''
    for (const char of bidi) {
      expect(href.includes(char), `href still has U+${char.codePointAt(0)?.toString(16)}`).toBe(false)
      expect(text.includes(char), `text still has U+${char.codePointAt(0)?.toString(16)}`).toBe(false)
    }
  }
  expect(host.textContent).toContain('https://openrouter.ai')
  expect(host.textContent).not.toContain(bidi)
})

test('replacing a streaming table tail disconnects its ResizeObserver', async () => {
  const original = ResizeObserver.prototype.disconnect
  let disconnects = 0
  ResizeObserver.prototype.disconnect = function () {
    disconnects += 1
    return original.call(this)
  }
  try {
    const table = '| Model | Note |\n| --- | --- |\n| Claude | warm |\n'
    const { source, body } = message(table, true)
    const host = mountHost()
    mountIn(host, body)
    await flush()
    expect(body.querySelector('[data-table-frame]')).toBeInstanceOf(HTMLElement)
    const baseline = disconnects
    source.set('Just prose now.\n')
    await flush()
    expect(body.querySelector('[data-table-frame]')).toBeNull()
    expect(disconnects).toBeGreaterThan(baseline)
  } finally {
    ResizeObserver.prototype.disconnect = original
  }
})

const readColor = (color: string) => {
  const modern = color
    .trim()
    .match(
      /^color\(srgb\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+))?\)$/i,
    )
  if (!modern) return parseColor(color)
  const channel = (value: string) => Number(value) * 255
  return {
    r: channel(modern[1] ?? '0'),
    g: channel(modern[2] ?? '0'),
    b: channel(modern[3] ?? '0'),
    a: modern[4] === undefined ? 1 : Number(modern[4]),
  }
}

const opaque = (color: string, behind: { r: number; g: number; b: number; a: number }) =>
  composite(readColor(color), behind)

test('dark theme table chrome is muted and the code language stays readable', async () => {
  const wide = 'anthropic/claude-sonnet-4.5-preview-extended-context-window'
  const { body } = message(
    [
      '| Model | Identifier |',
      '| --- | --- |',
      `| Claude | ${wide} |`,
      '',
      '```typescript',
      'export const greet = (name: string) => name',
      '```',
    ].join('\n'),
    false,
  )
  const host = mountHost()
  host.style.width = '320px'
  const stage = (
    <div>
      <style>{globalStyles}</style>
      {body}
    </div>
  )
  mountIn(host, stage)
  await emulateScheme('dark')
  await flush()
  const scroller = body.querySelector('[data-table-scroll]')
  const frame = body.querySelector('[data-table-frame]')
  const thumb = body.querySelector('[data-table-thumb]')
  const headerCell = body.querySelector('th')
  const label = body.querySelector('[data-code-lang]')
  expect(scroller).toBeInstanceOf(HTMLElement)
  expect(frame).toBeInstanceOf(HTMLElement)
  expect(thumb).toBeInstanceOf(HTMLElement)
  expect(headerCell).toBeInstanceOf(HTMLElement)
  expect(label).toBeInstanceOf(HTMLElement)
  expect(frame?.getAttribute('data-fade-end')).toBe('1')
  const tableBg = readColor(
    getComputedStyle(scroller as HTMLElement).backgroundColor,
  )
  const track = thumb?.parentElement
  expect(track).toBeInstanceOf(HTMLElement)
  const thumbPaint = opaque(
    getComputedStyle(thumb as HTMLElement).backgroundColor,
    opaque(getComputedStyle(track as HTMLElement).backgroundColor, tableBg),
  )
  expect(relativeLuminance(thumbPaint)).toBeLessThan(0.2)
  const fadeImage = getComputedStyle(frame as HTMLElement, '::after').backgroundImage
  const fadeMatch = fadeImage.match(/rgba?\([^)]+\)/)
  expect(fadeMatch?.[0]).toBeTruthy()
  const fade = readColor(fadeMatch?.[0] ?? '')
  const header = readColor(
    getComputedStyle(headerCell as HTMLElement).backgroundColor,
  )
  const same = (left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) =>
    Math.abs(left.r - right.r) < 2 &&
    Math.abs(left.g - right.g) < 2 &&
    Math.abs(left.b - right.b) < 2
  expect(same(fade, tableBg)).toBe(true)
  expect(same(fade, header)).toBe(true)
  const lang = label as HTMLElement
  const langBack = readColor(
    getComputedStyle(lang.parentElement as HTMLElement).backgroundColor,
  )
  const langFore = composite(readColor(getComputedStyle(lang).color), langBack)
  const lighter = Math.max(
    relativeLuminance(langFore),
    relativeLuminance(langBack),
  )
  const darker = Math.min(
    relativeLuminance(langFore),
    relativeLuminance(langBack),
  )
  const langContrast = (lighter + 0.05) / (darker + 0.05)
  expect(langContrast).toBeGreaterThanOrEqual(7)
})

test('final rendered markdown', async () => {
  const source = [
    '# A quieter way to read',
    '',
    'The reply stays in the thread’s measure: **serif headings**, *italic asides*, and a link to the [model list](https://openrouter.ai/models) only when you ask. Inline names such as `MessageBody` sit in the sentence.',
    '',
    '## In the answer',
    '',
    '- Headings use the display face',
    '- Lists keep an easy rhythm',
    '- Quotes rest on a terracotta rule',
    '',
    '1. Read the paragraph',
    '2. Then the table',
    '3. Then the code',
    '',
    '> Render the words first. The chrome should disappear until someone needs the code.',
    '',
    '### Prices',
    '',
    '| Model | Input | Output | Context | Identifier |',
    '| --- | --- | --- | --- | --- |',
    '| Claude Sonnet | $3.00 | $15.00 | 200k | anthropic/claude-sonnet-4.5-20250929-preview-extended |',
    '| GPT-4o mini | $0.15 | $0.60 | 128k | openai/gpt-4o-mini-2024-07-18 |',
    '| Gemini Flash | $0.10 | $0.40 | 1M | google/gemini-2.5-flash |',
    '',
    '```typescript',
    'export const greet = (name: string) => {',
    '  return `Hello, ${name}`',
    '}',
    '```',
  ].join('\n')
  const { body } = message(source, false)
  const host = mountHost()
  const stage = (
    <div
      data-testid="markdown-stage"
      css={`
        min-height: 100%;
        background: var(--thread);
        color: var(--text);
        padding: 3.5rem 1.5rem 4rem;
      `}
    >
      <style>{globalStyles}</style>
      <div
        css={`
          max-width: 40rem;
          margin: 0 auto;
        `}
      >
        {body}
      </div>
    </div>
  )
  mountIn(host, stage)
  await emulateScheme('light')
  await page.viewport(1280, 1400)
  await flush()
  const stageEl = host.querySelector('[data-testid="markdown-stage"]')
  expect(stageEl).toBeInstanceOf(HTMLElement)
  const needed = Math.ceil(
    (stageEl as HTMLElement).getBoundingClientRect().height,
  )
  await page.viewport(1280, Math.max(needed, 900))
  await flush()
  window.scrollTo(0, 0)
  const frame = (stageEl as HTMLElement).getBoundingClientRect()
  expect(frame.top).toBeGreaterThanOrEqual(0)
  expect(frame.bottom).toBeLessThanOrEqual(window.innerHeight + 1)
  expect(body.querySelector('h1')?.textContent).toBe('A quieter way to read')
  expect(body.querySelector('h2')?.textContent).toBe('In the answer')
  expect(body.querySelector('h3')?.textContent).toBe('Prices')
  expect(body.querySelectorAll('ul li').length).toBe(3)
  expect(body.querySelectorAll('ol li').length).toBe(3)
  expect(body.querySelector('blockquote')).toBeInstanceOf(HTMLElement)
  expect(body.querySelector('code')?.textContent).toContain('MessageBody')
  expect(body.querySelector('[data-code-lang]')?.textContent).toBe('typescript')
  expect(body.querySelector('[data-copy-code]')?.textContent).toBe('Copy')
  expect(body.querySelectorAll('th').length).toBe(5)
  const scroller = body.querySelector('[data-table-scroll]')
  expect(scroller).toBeInstanceOf(HTMLElement)
  expect((scroller as HTMLElement).scrollWidth).toBeGreaterThan(
    (scroller as HTMLElement).clientWidth,
  )
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const evidence = await shot('F-08', 'markdown-final')
  expect(String(evidence)).toContain('.team/evidence/F-08/markdown-final.png')
  await emulateScheme('dark')
  await flush()
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  const darkEvidence = await shot('F-08', 'markdown-final-dark')
  expect(String(darkEvidence)).toContain(
    '.team/evidence/F-08/markdown-final-dark.png',
  )
})
