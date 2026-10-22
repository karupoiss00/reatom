import type { Meta, StoryObj } from '@storybook/html'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { button, createActor, role } from '../../../.storybook/helpers'
import { getAdminRoot } from '../../testing/admin-root'
import { renderChatStory } from './boot'

const I = createActor()

const meta = {
  title: 'Integration/Chat',
  globals: { viewport: { value: 'chat', isRotated: false } },
  parameters: { layout: 'fullscreen' },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

function chunk(
  content: string,
  finish: 'stop' | 'error' | null = null,
  error?: { code: number; message: string },
) {
  return {
    id: 'gen-admin',
    object: 'chat.completion.chunk',
    created: 1710000000,
    model: 'meta-llama/llama-3.3-8b-instruct:free',
    choices: [
      {
        index: 0,
        delta: content === '' ? {} : { content },
        finish_reason: finish,
      },
    ],
    ...(error ? { error } : {}),
  }
}

function adminUi() {
  return within(getAdminRoot())
}

/**
 * The admin renders a window of rows inside the floating panel, so assertions
 * on one record filter for it first.
 */
function filterAdmin(field: 'Name' | 'Value', value: string) {
  const search = adminUi().getByRole('searchbox', { name: field })
  if (!(search instanceof HTMLInputElement)) throw new Error('Missing search')
  search.value = value
  search.dispatchEvent(new Event('input', { bubbles: true }))
}

function hiddenAbortCount(): number {
  const label =
    adminUi().getByRole('button', { name: 'Aborted and suspense' })
      .textContent ?? ''
  const match = label.match(/(\d+)/)
  return match ? Number(match[1]) : 0
}

async function boot(canvas: HTMLElement) {
  await waitFor(
    () => {
      const root = canvas.querySelector('[data-testid="chat-story-root"]')
      expect(root).toBeInstanceOf(HTMLElement)
      expect((root as HTMLElement).dataset.ready).toBe('1')
    },
    { timeout: 20_000 },
  )
  await I.see(role('textbox', 'Message').wait())
}

function chatRoot(): HTMLElement {
  const roots = document.querySelectorAll('[data-testid="chat-story-root"]')
  const root = roots[roots.length - 1]
  if (!(root instanceof HTMLElement)) throw new Error('Missing chat story')
  return root
}

function composer(): HTMLElement {
  const composers = [
    ...chatRoot().querySelectorAll('[data-slot="Composer"]'),
  ].filter(
    (node): node is HTMLElement =>
      node instanceof HTMLElement && node.getClientRects().length > 0,
  )
  const current = composers[composers.length - 1]
  if (!current) throw new Error('Missing composer')
  return current
}

async function send(message: string) {
  const field = composer().querySelector('textarea[aria-label="Message"]')
  if (!(field instanceof HTMLTextAreaElement)) {
    throw new Error('Missing composer')
  }
  field.focus()
  field.value = message
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await waitFor(() => {
    const button = composer().querySelector('[data-send][data-mode="send"]')
    expect(button).toBeInstanceOf(HTMLButtonElement)
    expect((button as HTMLButtonElement).disabled).toBe(false)
    expect(button?.getAttribute('data-muted')).toBe('false')
  })
  const sendButton = composer().querySelector('[data-send][data-mode="send"]')
  if (!(sendButton instanceof HTMLButtonElement))
    throw new Error('Missing Send')
  sendButton.click()
}

async function clickExactModel(id: string) {
  const field = document.querySelector('[data-slot="ModelPicker"] input')
  if (!(field instanceof HTMLInputElement))
    throw new Error('Missing model search')
  field.focus()
  field.value = id
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  const selector = `[data-model-id="${CSS.escape(id)}"] [role="option"]`
  await waitFor(() => {
    expect(document.querySelector(selector)).toBeInstanceOf(HTMLElement)
  })
  const option = document.querySelector(selector)
  if (!(option instanceof HTMLElement)) throw new Error(`Missing ${id}`)
  option.click()
}

async function clickStop() {
  await waitFor(() => {
    expect(
      chatRoot().querySelector('[data-send][data-mode="stop"]'),
    ).toBeInstanceOf(HTMLButtonElement)
  })
  const buttons = [
    ...chatRoot().querySelectorAll('[data-send][data-mode="stop"]'),
  ].filter(
    (node): node is HTMLButtonElement => node instanceof HTMLButtonElement,
  )
  const stopButton = buttons[buttons.length - 1] ?? buttons[0]
  if (!stopButton) throw new Error('Missing Stop')
  for (const button of buttons) button.click()
}

function pressAdmin(key: string) {
  const root = getAdminRoot()
  const target = root.querySelector<HTMLElement>('[role="treegrid"]') ?? root
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    }),
  )
}

const slowReply = {
  chunks: [
    { delayMs: 200, data: chunk('Hello') },
    { delayMs: 2_500, data: chunk(' there') },
    { data: chunk('', 'stop') },
  ],
}

export const StreamingReplyInProgress: Story = {
  name: 'Streaming reply in progress',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      mock.mockChatStream(slowReply)
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    await send('Say hello')
    await waitFor(
      () => {
        expect(adminUi().getByRole('row', { name: 'In progress' })).toBeTruthy()
      },
      { timeout: 8_000 },
    )
    adminUi().getByRole('row', { name: 'In progress' }).click()
    await waitFor(
      () => {
        expect(adminUi().queryByRole('row', { name: 'In progress' })).toBeNull()
        const selected = getAdminRoot().querySelector(
          '[role="row"][aria-selected="true"]',
        )
        expect(selected?.getAttribute('aria-label') ?? '').not.toBe('')
        expect(selected?.getAttribute('aria-label')).not.toBe('In progress')
      },
      { timeout: 8_000 },
    )
  },
}

export const StopGenerationShowsAnAbort: Story = {
  name: 'Stop generation shows an abort',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      mock.mockChatStream({ hang: true, chunks: [{ data: chunk('...') }] })
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    adminUi().getByRole('button', { name: 'Clear' }).click()
    const hiddenBefore = hiddenAbortCount()
    await send('Keep going')
    await clickStop()
    await waitFor(
      () => {
        expect(hiddenAbortCount()).toBeGreaterThan(hiddenBefore)
        expect(
          getAdminRoot().querySelector('[data-outcome="abort"]'),
        ).toBeNull()
      },
      { timeout: 8_000 },
    )
    filterAdmin('Name', 'chat.engine.stop')
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toContain('chat.engine.stop')
    })
    filterAdmin('Name', '')
    filterAdmin('Value', 'abort')
    adminUi().getByRole('button', { name: 'Aborted and suspense' }).click()
    adminUi().getByRole('button', { name: 'Expand all' }).click()
    await waitFor(() => {
      expect(
        getAdminRoot().querySelector('[data-outcome="abort"]'),
      ).toBeInstanceOf(HTMLElement)
    })
  },
}

export const NetworkAnd402Errors: Story = {
  name: 'Network and 402 errors',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      mock.mockChatStreams([
        { networkError: true },
        {
          status: 402,
          body: {
            error: {
              code: 402,
              message: 'Insufficient credits',
              metadata: { limit_source: 'openrouter_credits' },
            },
          },
        },
      ])
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    adminUi().getByRole('button', { name: 'Errors' }).click()
    await send('First fails on the network')
    await waitFor(
      () => {
        expect(getAdminRoot().textContent).toContain('Connection lost')
      },
      { timeout: 8_000 },
    )
    await send('Then the key is out of credits')
    await waitFor(
      () => {
        expect(document.body.innerText).toContain('OpenRouter credits')
      },
      { timeout: 8_000 },
    )
    await waitFor(() => {
      const rows = [
        ...getAdminRoot().querySelectorAll('[data-outcome="error"]'),
      ]
      expect(rows.length).toBeGreaterThan(0)
      const text = rows.map((row) => row.textContent ?? '').join('\n')
      expect(text).toContain('Connection lost')
      expect(text).toContain("You're out of OpenRouter credits.")
    })
    const width = adminUi().getByRole('slider', {
      name: 'Timeline name width',
    }) as HTMLInputElement
    const firstLabel = getAdminRoot().querySelector('[data-gantt-label]')!
    width.value = '180'
    width.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() =>
      expect(firstLabel.getBoundingClientRect().width).toBe(180),
    )
    const initialWidth = firstLabel.getBoundingClientRect().width
    width.value = '420'
    width.dispatchEvent(new Event('input', { bubbles: true }))
    await waitFor(() => {
      expect(firstLabel.getBoundingClientRect().width).toBeGreaterThan(
        initialWidth,
      )
      const messages = [
        ...getAdminRoot().querySelectorAll<HTMLElement>(
          '[data-testid="gantt-error-message"]',
        ),
      ]
      expect(messages.length).toBeGreaterThan(1)
      for (const message of messages) {
        const rect = message.getBoundingClientRect()
        const labelRect =
          message.previousElementSibling!.getBoundingClientRect()
        expect(rect.top).toBeGreaterThanOrEqual(labelRect.bottom)
        expect(rect.width).toBeGreaterThan(120)
        expect(rect.height).toBeGreaterThan(0)
      }
    })
    const errorRow = getAdminRoot().querySelector('[data-outcome="error"]')
    if (errorRow instanceof HTMLElement) errorRow.click()
    await waitFor(() => {
      expect(adminUi().getByRole('alert').textContent).toMatch(
        /Connection lost/,
      )
    })
  },
}

export const HangingRequestStaysInProgress: Story = {
  name: 'Hanging request stays in progress',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      mock.mockChatStream({
        hang: true,
        chunks: [{ data: chunk('still thinking') }],
      })
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    await send('Do not finish')
    await I.see(button('Stop').wait())
    await waitFor(() => {
      expect(adminUi().getByRole('row', { name: 'In progress' })).toBeTruthy()
    })
    const inProgressRow = adminUi().getByRole('row', { name: 'In progress' })
    expect(inProgressRow.getAttribute('aria-description')).toContain(
      'in progress',
    )
    expect(inProgressRow.querySelector('[data-gantt-status]')).toBeTruthy()
    expect(
      adminUi().queryByRole('row', { name: 'chat.engine.send' }),
    ).toBeNull()
  },
}

export const CompareTwoModels: Story = {
  name: 'Compare two models',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      const ok = {
        chunks: [{ data: chunk('North light') }, { data: chunk('', 'stop') }],
      }
      const failed = {
        status: 503,
        body: {
          error: {
            code: 503,
            message: 'No endpoints available matching your request',
          },
        },
      }
      mock.mockChatStreamFor('meta-llama/llama-3.3-8b-instruct:free', ok)
      mock.mockChatStreamFor('openai/o3-mini', failed)
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    const chip = document.querySelector('[data-slot="ModelChip"]')
    if (!(chip instanceof HTMLElement)) throw new Error('Missing model chip')
    chip.click()
    await waitFor(() => {
      expect(
        document.querySelector('[aria-label="Compare models"]'),
      ).toBeInstanceOf(HTMLElement)
    })
    const compare = document.querySelector('[aria-label="Compare models"]')
    if (!(compare instanceof HTMLElement)) throw new Error('Missing compare')
    compare.click()
    await clickExactModel('meta-llama/llama-3.3-8b-instruct:free')
    await clickExactModel('openai/o3-mini')
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
    await waitFor(() => {
      expect(document.querySelector('dialog[open]')).toBeNull()
    })
    await send('Compare the north light')
    filterAdmin('Name', 'chat.engine.compareSend')
    await waitFor(() => {
      expect(getAdminRoot().textContent).toContain('chat.engine.compareSend')
    })
    adminUi().getByRole('button', { name: 'Expand all' }).click()
    await waitFor(() => {
      const outcomes = [
        ...getAdminRoot().querySelectorAll('[role="row"][data-outcome]'),
      ].map((row) => row.getAttribute('data-outcome'))
      expect(outcomes).toContain('ok')
    })
    adminUi().getByRole('button', { name: 'Mount logs' }).click()
    filterAdmin('Name', 'features.compare.column*')
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toMatch(
        /features\.compare\.column#[^\s.]+\.content/,
      )
    })
    filterAdmin('Name', 'features.errors.card*')
    await waitFor(() => {
      expect(getAdminRoot().textContent ?? '').toContain('features.errors.card')
    })
  },
}

export const EscInTheAdminKeepsTheStream: Story = {
  name: 'Esc in the admin keeps the stream',
  render: () =>
    renderChatStory(async () => {
      const mock = await import('chat-app/testing/openrouter-mock')
      mock.mockChatStream({
        hang: true,
        chunks: [{ data: chunk('streaming') }],
      })
    }),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    await send('Do not stop')
    await I.see(button('Stop').wait())
    await waitFor(() => {
      expect(adminUi().getByRole('row', { name: 'In progress' })).toBeTruthy()
    })
    pressAdmin('Escape')
    await I.see(button('Stop'))
    expect(adminUi().getByRole('row', { name: 'In progress' })).toBeTruthy()
  },
}

export const TypingInAdminSearchStaysInTheAdmin: Story = {
  name: 'Typing / and ? in admin search stays in the admin',
  render: () => renderChatStory(() => undefined),
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    const search = adminUi().getByRole('searchbox', { name: 'Name' })
    await userEvent.click(search)
    await userEvent.type(search, '/?')
    expect((search as HTMLInputElement).value).toBe('/?')
    expect(adminUi().queryByRole('dialog', { name: 'Help' })).toBeNull()
    expect(document.querySelector('dialog[open]')).toBeNull()
  },
}

export const DebuggerFilterWorkspace: Story = {
  name: 'Debugger filters keep views and controls usable',
  render: StreamingReplyInProgress.render,
  play: async ({ canvasElement }) => {
    await boot(canvasElement)
    const ui = adminUi()
    ui.getByRole('tab', { name: 'State', exact: true }).click()
    filterAdmin('Name', 'zzzz_no_matching_record')
    await waitFor(() =>
      expect(ui.getByText('No matching last-write state')).toBeVisible(),
    )
    ui.getByRole('tab', { name: 'Graph', exact: true }).click()
    await waitFor(() =>
      expect(ui.getByText('No matching cause graph')).toBeVisible(),
    )
    ui.getByRole('button', { name: 'Reset filters' }).click()
    await userEvent.click(
      ui.getByRole('tab', { name: 'Timeline', exact: true }),
    )
    await userEvent.click(ui.getByRole('button', { name: 'Advanced filters' }))
    await waitFor(() =>
      expect(
        ui.getByRole('dialog', { name: 'Advanced filters' }),
      ).toBeVisible(),
    )
    const dialog = ui.getByRole('dialog', { name: 'Advanced filters' })
    const apply = within(dialog).getByRole('button', {
      name: 'Apply expression',
    })
    const reset = within(dialog).getByRole('button', {
      name: 'Reset expression',
    })
    await waitFor(() => {
      const bounds = dialog.getBoundingClientRect()
      for (const control of [apply, reset]) {
        const rect = control.getBoundingClientRect()
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top)
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
      }
    })
    const expression = within(dialog).getByRole('textbox', {
      name: 'Filter expression',
    }) as HTMLInputElement
    const setExpression = (value: string) => {
      expression.value = value
      expression.dispatchEvent(new Event('input', { bubbles: true }))
    }
    setExpression('(')
    await waitFor(() => expect(apply).toBeDisabled())
    setExpression('name:zzzz_no_matching_record')
    await waitFor(() => expect(apply).toBeEnabled())
    await userEvent.click(apply)
    await waitFor(() =>
      expect(
        ui.getByRole('button', {
          name: 'Remove applied expression name:zzzz_no_matching_record',
        }),
      ).toBeTruthy(),
    )
    await userEvent.click(reset)
    await waitFor(() => {
      expect(expression.value).toBe('')
      expect(
        ui.queryByRole('button', {
          name: 'Remove applied expression name:zzzz_no_matching_record',
        }),
      ).toBeNull()
    })
    const host = (getAdminRoot().getRootNode() as ShadowRoot)
      .host as HTMLElement
    const previousStyle = host.getAttribute('style')
    host.style.width = '390px'
    host.style.height = '320px'
    await waitFor(() => {
      const bounds = dialog.getBoundingClientRect()
      for (const control of [apply, reset]) {
        const rect = control.getBoundingClientRect()
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top)
        expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom)
        expect(rect.right).toBeLessThanOrEqual(bounds.right)
      }
    })
    if (previousStyle === null) host.removeAttribute('style')
    else host.setAttribute('style', previousStyle)
    await userEvent.keyboard('{Escape}')
    await waitFor(() =>
      expect(ui.queryByRole('dialog', { name: 'Advanced filters' })).toBeNull(),
    )
    const follow = ui.getByRole('button', { name: 'Follow live' })
    const shell = getAdminRoot().querySelector(
      '[data-reatom-name="DebuggerWorkspace"]',
    )!
    await waitFor(() => {
      expect(follow.getBoundingClientRect().right).toBeLessThanOrEqual(
        shell.getBoundingClientRect().right,
      )
    })
  },
}

export const NarrowStackedFilterDrawers: Story = {
  name: 'Advanced filters stay above the selected frame on narrow shells',
  render: NetworkAnd402Errors.render,
  play: async (context) => {
    await NetworkAnd402Errors.play!(context)
    const root = getAdminRoot()
    const host = (root.getRootNode() as ShadowRoot).host as HTMLElement
    host.style.width = '390px'
    host.style.height = '600px'
    const ui = adminUi()
    await waitFor(() => expect(ui.getByRole('dialog')).toBeVisible())
    // Opening the editor is an external-panel boundary: the frame drawer already
    // covers the filter bar, as when the shell is resized with a selection open.
    ui.getByRole('button', { name: 'Advanced filters' }).click()
    const advanced = await waitFor(() =>
      ui.getByRole('dialog', { name: 'Advanced filters' }),
    )
    const apply = within(advanced).getByRole('button', {
      name: 'Apply expression',
    })
    await waitFor(() => {
      const rect = apply.getBoundingClientRect()
      const hit = (root.getRootNode() as ShadowRoot).elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      )
      expect(apply.contains(hit)).toBe(true)
      expect(root.querySelectorAll('[role="dialog"][inert]').length).toBe(1)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => {
      expect(ui.queryByRole('dialog', { name: 'Advanced filters' })).toBeNull()
      const frame = ui.getByRole('dialog')
      expect(
        frame.contains((root.getRootNode() as ShadowRoot).activeElement),
      ).toBe(true)
    })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(ui.queryByRole('dialog')).toBeNull())
  },
}
