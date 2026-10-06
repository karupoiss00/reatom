import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { button, createActor, role, text, type UserEvent } from 'kahraman'
import { userEvent } from 'storybook/test'
import { afterEach, expect, test } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import { ui } from '../app/ui'
import { activeChat } from '../chat'
import { sessionMode } from '../auth/session'
import { resetRuntime } from '../platform/runtime'
import { openChat } from '../routes'
import { repo } from '../storage/repo'
import { bootApp, unmountApp } from './boot'
import { limitedKey } from './fixtures/keys'
import { catalogModels as fixtureModels } from './fixtures/models'
import { midStreamErrorScript } from './fixtures/sse'
import {
  chatBodies,
  installOpenRouterMock,
  mockChatStream,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { shot } from './screenshot'

const I = createActor()
const desktop = { width: 1280, height: 800 }
const storyKey = 'sk-or-v1-versions-story'
const modelId = 'openai/gpt-4o-mini'
const modelLabel = 'OpenAI: GPT-4o-mini'
const room = 'Sketch a quiet room'
const windowAsk = 'Add a window'
const northLight = 'North light.'
const quieter = 'Quieter still.'
const oneMore = 'One more'
const enough = 'Enough.'
const sketch = 'Look at this sketch'
const northSketch = 'Look at the north light'
const lamp = 'Add a lamp'
const fresh = 'Fresh reply.'
const photo = {
  id: 'room-photo',
  kind: 'image' as const,
  name: 'room.png',
  mime: 'image/png',
  size: 128,
}

const keyboard = userEvent.setup() as unknown as UserEvent & {
  keyboard: (keys: string) => Promise<void>
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 240))

type WireBody = {
  model?: string
  messages?: Array<{ role: string; content: unknown }>
}

const bodies = () => chatBodies() as WireBody[]

let extraUnmount: (() => void) | null = null

const resetLocation = () => {
  if (location.pathname !== '/') history.replaceState(null, '', '/')
}

const shoot = async (
  flowId: string,
  name: string,
  anchor?: Element | null,
) => {
  expect(document.querySelector('vite-error-overlay')).toBeNull()
  anchor?.scrollIntoView({ block: 'center', inline: 'nearest' })
  await settle()
  await shot(flowId, name)
}

const field = () =>
  document.querySelector<HTMLTextAreaElement>(
    '[data-slot="Composer"] textarea',
  )

const setDraft = (value: string) => {
  const textarea = field()
  if (!textarea) throw new Error('missing composer')
  textarea.focus()
  activeChat().draft.text.set(value)
}

const thread = () => document.querySelector<HTMLElement>('[data-slot="Thread"]')

const rows = (roleName: 'user' | 'assistant') => [
  ...document.querySelectorAll<HTMLElement>(`[data-role="${roleName}"]`),
]

const namedButton = (root: ParentNode | null | undefined, name: string) =>
  [...(root?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find(
    (element) =>
      (element.getAttribute('aria-label') ?? element.textContent ?? '').trim() ===
      name,
  )

const versionText = (root: ParentNode | null | undefined) =>
  root?.querySelector('[data-version]')?.textContent ?? ''

const editor = () =>
  document.querySelector<HTMLElement>('[data-slot="UserMessageEditor"]')

const editorField = () => editor()?.querySelector('textarea') ?? null

const chunk = (content: string, id: string) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: modelId,
  choices: [
    { index: 0, delta: { content }, finish_reason: null },
  ],
})

const finish = (id: string) => ({
  id,
  object: 'chat.completion.chunk',
  created: 1710000000,
  model: modelId,
  choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }],
})

const script = (content: string, id: string, firstTokenDelayMs = 0) => ({
  firstTokenDelayMs,
  chunks: [{ data: chunk(content, id) }, { data: finish(id) }],
})

const sendDraft = async (value: string) => {
  setDraft(value)
  await keyboard.keyboard('{Enter}')
}

const reloadApp = async () => {
  unmountApp()
  extraUnmount?.()
  extraUnmount = null
  resetRuntime()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(fixtureModels)
  mockKey(limitedKey)
  const root = document.createElement('div')
  root.id = 'app'
  document.body.replaceChildren(root)
  extraUnmount = mount(root, <App />).unmount
  await boot({ timings: { flushMs: 40 } })
  await expect.poll(() => sessionMode()).not.toBe('booting')
  I.init({ canvasElement: document.body, userEvent: keyboard })
}

afterEach(async () => {
  extraUnmount?.()
  extraUnmount = null
  unmountApp()
  await page.viewport(desktop.width, desktop.height)
})

test('Maya regenerates a reply and switches versions', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)

  mockChatStream(script('Hello', 'gen-v1'))
  await sendDraft(room)
  await expect.poll(() => rows('assistant')[0]?.textContent ?? '').toContain('Hello')
  const firstReply = () => rows('assistant')[0]
  const previous = () => namedButton(firstReply(), 'Previous version')
  const next = () => namedButton(firstReply(), 'Next version')
  expect(previous()?.tagName).toBe('BUTTON')
  expect(next()?.tagName).toBe('BUTTON')
  expect(previous()?.disabled).toBe(true)
  expect(next()?.disabled).toBe(true)
  expect(versionText(firstReply())).toBe('1/1')
  expect(namedButton(firstReply(), 'Regenerate')?.disabled).toBe(false)
  await shoot('F-12', 'single', firstReply()?.querySelector('[data-slot="VersionSwitcher"]'))

  mockChatStream(script(northLight, 'gen-v2'))
  await sendDraft(windowAsk)
  await expect.poll(() => rows('assistant')[1]?.textContent ?? '').toContain(northLight)

  const beforeRegenerate = bodies().length
  mockChatStream(script(quieter, 'gen-v3', 2_000))
  namedButton(firstReply(), 'Regenerate')?.click()
  await expect.poll(() => bodies().length).toBe(beforeRegenerate + 1)
  const regenerated = bodies().at(-1)!
  expect(regenerated.model).toBe(modelId)
  expect(regenerated.messages?.at(-1)).toEqual({ role: 'user', content: room })
  expect(regenerated.messages?.some((message) => message.role === 'assistant')).toBe(
    false,
  )
  await expect.poll(() => versionText(firstReply())).toBe('2/2')
  expect(previous()?.disabled).toBe(false)
  expect(next()?.disabled).toBe(true)
  expect(namedButton(firstReply(), 'Regenerate')?.disabled).toBe(true)
  const streamingBodies = bodies().length
  namedButton(firstReply(), 'Regenerate')?.click()
  await settle()
  expect(bodies().length).toBe(streamingBodies)
  expect(thread()?.textContent ?? '').not.toContain(northLight)
  await shoot('F-12', 'regenerating', firstReply())

  await expect
    .poll(() => firstReply()?.textContent ?? '', { timeout: 8_000 })
    .toContain(quieter)
  expect(versionText(firstReply())).toBe('2/2')
  await expect.poll(() => namedButton(firstReply(), 'Regenerate')?.disabled).toBe(false)
  await shoot('F-12', 'multiple', firstReply()?.querySelector('[data-slot="VersionSwitcher"]'))

  previous()?.click()
  await expect.poll(() => firstReply()?.textContent ?? '').toContain('Hello')
  await expect.poll(() => thread()?.textContent ?? '').toContain(northLight)
  expect(versionText(firstReply())).toBe('1/2')
  expect(previous()?.disabled).toBe(true)
  expect(next()?.disabled).toBe(false)
  await shoot('F-12', 'switched', firstReply())

  mockChatStream(script(enough, 'gen-v4'))
  const beforePath = bodies().length
  await sendDraft(oneMore)
  await expect.poll(() => bodies().length).toBe(beforePath + 1)
  expect(bodies().at(-1)?.messages).toEqual([
    { role: 'user', content: room },
    { role: 'assistant', content: 'Hello' },
    { role: 'user', content: windowAsk },
    { role: 'assistant', content: northLight },
    { role: 'user', content: oneMore },
  ])
  expect(JSON.stringify(bodies().at(-1))).not.toContain(quieter)

  next()?.click()
  await expect.poll(() => firstReply()?.textContent ?? '').toContain(quieter)
  await expect.poll(() => thread()?.textContent ?? '').not.toContain(northLight)

  mockChatStream(midStreamErrorScript)
  namedButton(firstReply(), 'Regenerate')?.click()
  await expect
    .poll(() => firstReply()?.textContent ?? '')
    .toContain('The provider disconnected mid-reply (502).')
  expect(firstReply()?.textContent).toContain('Partial')
  expect(versionText(firstReply())).toBe('3/3')
  expect(next()?.disabled).toBe(true)
  previous()?.click()
  await expect.poll(() => firstReply()?.textContent ?? '').toContain(quieter)
  expect(firstReply()?.textContent ?? '').not.toContain('Partial')
  next()?.click()
  await expect.poll(() => versionText(firstReply())).toBe('3/3')
  await shoot('F-12', 'failed-version', firstReply()?.querySelector('[data-slot="ErrorCard"]'))

  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  const chatId = location.pathname.split('/').pop() ?? ''
  await expect.poll(async () => {
    const stored = await repo.listMessages(chatId)
    return (
      stored.some(
        (message) =>
          message.role === 'assistant' &&
          message.content === 'Partial' &&
          message.status === 'error',
      ) &&
      stored.some(
        (message) => message.role === 'assistant' && message.content === quieter,
      ) &&
      stored.some(
        (message) => message.role === 'assistant' && message.content === 'Hello',
      )
    )
  }).toBe(true)

  const modelBeforePicker = activeChat().model()
  const bodiesBeforePicker = bodies().length
  const failedId = firstReply()?.getAttribute('data-message-id')
  namedButton(firstReply(), 'More ways to regenerate')?.click()
  await I.click(role('menuitem', 'Regenerate with…'))
  await expect.poll(() => ui.picker()?.purpose ?? null).toBe('regenerate')
  expect(ui.picker()?.messageId).toBe(failedId)
  expect(activeChat().model()).toBe(modelBeforePicker)
  await I.see(text('Choose a model'))
  const claude = () =>
    document.querySelector<HTMLElement>(
      '[data-model-id="anthropic/claude-sonnet-4"] [role="option"]',
    )
  if (!claude()) await I.click(button(/All models/))
  await expect.poll(() => claude()).toBeTruthy()
  const claudeId = 'anthropic/claude-sonnet-4'
  mockChatStream(script('From Claude.', 'gen-v5'))
  claude()?.click()
  await expect.poll(() => ui.picker()).toBeNull()
  await expect.poll(() => bodies().length).toBe(bodiesBeforePicker + 1)
  const picked = bodies().at(-1)!
  expect(picked.model).toBe(claudeId)
  expect(picked.model).not.toBe(modelId)
  expect(picked.messages?.at(-1)).toEqual({ role: 'user', content: room })
  expect(picked.messages?.some((message) => message.role === 'assistant')).toBe(
    false,
  )
  expect(activeChat().model()).toBe(modelId)
  await expect
    .poll(() => firstReply()?.textContent ?? '', { timeout: 8_000 })
    .toContain('From Claude.')
  expect(versionText(firstReply())).toBe('4/4')
  const shown = activeChat().path().at(-1)?.message
  expect(shown?.role === 'assistant' ? shown.model : '').toBe(claudeId)

  await expect.poll(async () => {
    const stored = await repo.listMessages(chatId)
    return stored.some(
      (message) =>
        message.role === 'assistant' &&
        message.content === 'From Claude.' &&
        message.model === claudeId,
    )
  }).toBe(true)
  await reloadApp()
  openChat(chatId)
  await expect
    .poll(() => firstReply()?.textContent ?? '', { timeout: 8_000 })
    .toContain('From Claude.')
  expect(versionText(firstReply())).toBe('4/4')
  expect(activeChat().model()).toBe(modelId)
  previous()?.click()
  await expect.poll(() => firstReply()?.textContent ?? '').toContain('Partial')
  expect(versionText(firstReply())).toBe('3/4')
  previous()?.click()
  await expect.poll(() => firstReply()?.textContent ?? '').toContain(quieter)
}, 40_000)

test('Maya edits a message, keeps its photo, and branches', async () => {
  resetLocation()
  await bootApp({
    key: storyKey,
    keyMeta: limitedKey,
    viewport: desktop,
    timings: { flushMs: 40 },
  })
  I.init({ canvasElement: document.body, userEvent: keyboard })
  await expect.poll(() => field()?.placeholder ?? '').toContain(modelLabel)
  await repo.putAttachment({
    id: photo.id,
    dataUrl: 'data:image/png;base64,aaaa',
  })
  activeChat().draft.attachments.set([photo])

  mockChatStream(script('Hello', 'gen-e1'))
  await sendDraft(sketch)
  await expect.poll(() => rows('assistant')[0]?.textContent ?? '').toContain('Hello')
  const userRow = () => rows('user')[0]
  const scroller = thread()
  if (!scroller) throw new Error('missing thread')
  expect(scroller.getAttribute('data-following')).toBe('true')
  const scrollTop = scroller.scrollTop

  namedButton(userRow(), 'Edit')?.click()
  await expect.poll(() => editor()).toBeTruthy()
  expect(scroller.scrollTop).toBe(scrollTop)
  expect(scroller.getAttribute('data-following')).toBe('false')
  expect(editorField()?.value).toBe(sketch)
  expect(editor()?.textContent).toContain(photo.name)
  expect(namedButton(editor(), 'Save & send')?.disabled).toBe(true)
  expect(namedButton(editor(), 'Cancel')).toBeTruthy()
  await shoot('F-12b', 'save-disabled', editor())

  editorField()!.value = ''
  editorField()!.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.poll(() => namedButton(editor(), 'Save & send')?.disabled).toBe(true)
  editorField()!.value = sketch
  editorField()!.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.poll(() => namedButton(editor(), 'Save & send')?.disabled).toBe(true)

  editorField()!.focus()
  editorField()!.value = northSketch
  editorField()!.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.poll(() => namedButton(editor(), 'Save & send')?.disabled).toBe(false)
  expect(editor()?.textContent).toContain(photo.name)
  await shoot('F-12b', 'editing', editor())

  await I.click(button(/^Cancel$/))
  await expect.poll(() => editor()).toBeNull()
  expect(userRow()?.textContent).toContain(sketch)
  expect(ui.editing()).toBeNull()

  namedButton(userRow(), 'Edit')?.click()
  await expect.poll(() => editorField()?.value).toBe(sketch)
  editorField()!.value = 'Discard me'
  editorField()!.dispatchEvent(new Event('input', { bubbles: true }))
  editorField()!.focus()
  await keyboard.keyboard('{Escape}')
  await expect.poll(() => editor()).toBeNull()
  expect(userRow()?.textContent).toContain(sketch)
  expect(ui.editing()).toBeNull()

  setDraft('')
  await keyboard.keyboard('{ArrowUp}')
  await expect.poll(() => ui.editing()).toBe(userRow()?.getAttribute('data-message-id'))
  expect(editorField()?.value).toBe(sketch)
  await I.click(button(/^Cancel$/))
  await expect.poll(() => editor()).toBeNull()

  setDraft('not empty')
  await keyboard.keyboard('{ArrowUp}')
  await settle()
  expect(ui.editing()).toBeNull()
  expect(editor()).toBeNull()
  setDraft('')

  mockChatStream({ hang: true, chunks: [] })
  await sendDraft(lamp)
  await expect.poll(() => rows('user')[1]?.textContent ?? '').toContain(lamp)
  await expect
    .poll(() => document.querySelector('[data-state="processing"]'))
    .toBeTruthy()
  expect(namedButton(userRow(), 'Edit')?.disabled).toBe(true)
  setDraft('')
  await keyboard.keyboard('{ArrowUp}')
  await settle()
  expect(ui.editing()).toBeNull()
  expect(editor()).toBeNull()
  namedButton(userRow(), 'Edit')?.click()
  expect(editor()).toBeNull()
  await I.click(button('Stop'))
  await expect
    .poll(() => document.body.textContent ?? '')
    .toContain('Stopped before any reply')
  await expect.poll(() => namedButton(userRow(), 'Edit')?.disabled).toBe(false)

  mockChatStream(script(fresh, 'gen-e2', 2_000))
  namedButton(userRow(), 'Edit')?.click()
  await expect.poll(() => editorField()?.value).toBe(sketch)
  editorField()!.value = northSketch
  editorField()!.dispatchEvent(new Event('input', { bubbles: true }))
  await expect.poll(() => namedButton(editor(), 'Save & send')?.disabled).toBe(false)
  const beforeEdit = bodies().length
  await I.click(button('Save & send'))
  await expect.poll(() => bodies().length).toBe(beforeEdit + 1)
  const edited = bodies().at(-1)!
  expect(edited.messages?.at(-1)?.role).toBe('user')
  expect(edited.messages?.some((message) => message.role === 'assistant')).toBe(false)
  expect(JSON.stringify(edited.messages)).toContain(northSketch)
  expect(JSON.stringify(edited.messages)).toContain('data:image/png;base64,aaaa')
  expect(JSON.stringify(edited.messages)).not.toContain('Hello')
  await expect.poll(() => versionText(rows('user')[0])).toBe('2/2')
  expect(thread()?.textContent ?? '').not.toContain(lamp)
  await shoot('F-12b', 'sending', rows('user')[0])

  await expect
    .poll(() => rows('assistant')[0]?.textContent ?? '', { timeout: 8_000 })
    .toContain(fresh)
  expect(versionText(rows('user')[0])).toBe('2/2')
  const userPrevious = () => namedButton(rows('user')[0], 'Previous version')
  const userNext = () => namedButton(rows('user')[0], 'Next version')
  expect(userPrevious()?.disabled).toBe(false)
  expect(userNext()?.disabled).toBe(true)
  await shoot('F-12b', 'branched', rows('user')[0])

  userPrevious()?.click()
  await expect.poll(() => rows('user')[0]?.textContent ?? '').toContain(sketch)
  await expect.poll(() => thread()?.textContent ?? '').toContain(lamp)
  expect(versionText(rows('user')[0])).toBe('1/2')

  userNext()?.click()
  await expect.poll(() => rows('user')[0]?.textContent ?? '').toContain(northSketch)
  namedButton(rows('user')[0], 'Edit')?.click()
  await expect.poll(() => editor()?.textContent ?? '').toContain(photo.name)
  namedButton(editor(), `Remove ${photo.name}`)?.click()
  await expect.poll(() => editor()?.textContent ?? '').not.toContain(photo.name)
  await expect.poll(() => namedButton(editor(), 'Save & send')?.disabled).toBe(false)
  const beforeRemoval = bodies().length
  mockChatStream(script('Without the photo.', 'gen-e3'))
  await I.click(button('Save & send'))
  await expect.poll(() => bodies().length).toBe(beforeRemoval + 1)
  const removed = bodies().at(-1)!
  expect(removed.messages?.at(-1)).toEqual({
    role: 'user',
    content: northSketch,
  })
  expect(JSON.stringify(removed.messages)).not.toContain('data:image/png')
  await expect.poll(() => versionText(rows('user')[0])).toBe('3/3')

  await expect.poll(() => location.pathname).toMatch(/^\/c\//)
  const chatId = location.pathname.split('/').pop() ?? ''
  await expect.poll(async () => {
    const stored = await repo.listMessages(chatId)
    return stored.filter((message) => message.role === 'user').length >= 3
  }).toBe(true)
  await reloadApp()
  openChat(chatId)
  await expect
    .poll(() => rows('user')[0]?.textContent ?? '', { timeout: 8_000 })
    .toContain(northSketch)
  namedButton(rows('user')[0], 'Previous version')?.click()
  await expect.poll(() => rows('user')[0]?.textContent ?? '').toContain(northSketch)
  namedButton(rows('user')[0], 'Previous version')?.click()
  await expect.poll(() => rows('user')[0]?.textContent ?? '').toContain(sketch)
  await expect.poll(() => thread()?.textContent ?? '').toContain(lamp)
}, 40_000)
