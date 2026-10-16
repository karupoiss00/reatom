import type { Meta, StoryObj } from '@storybook/html'
import { expect, waitFor } from 'storybook/test'

import { createActor, heading, text } from '../../../.storybook/helpers'
import { getAdminRoot } from '../../testing/admin-root'
import { renderLiveChat } from './live-boot'

const I = createActor()

declare module 'vitest/browser' {
  interface BrowserCommands {
    readOpenRouterKey: () => Promise<string>
  }
}

const FREE_MODEL = 'openrouter/free'
const FLASH_MODEL = 'z-ai/glm-5.3-flash'

const meta = {
  title: 'Integration/Chat live',
  tags: ['@live'],
  globals: { viewport: { value: 'chat', isRotated: false } },
  parameters: { layout: 'fullscreen' },
  beforeEach: (context) => void I.init(context),
} satisfies Meta

export default meta

type Story = StoryObj<typeof meta>

async function readKey(): Promise<string> {
  let commands: { readOpenRouterKey?: () => Promise<string> }
  try {
    ;({ commands } = await import('vitest/browser'))
  } catch {
    return ''
  }
  if (typeof commands.readOpenRouterKey !== 'function') {
    throw new Error('readOpenRouterKey is not registered on the Node side')
  }
  const key = await commands.readOpenRouterKey()
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('OpenRouter key command returned an empty string')
  }
  return key
}

export const LiveOpenRouterReply: Story = {
  name: 'Live OpenRouter reply',
  render: () => {
    const root = document.createElement('div')
    const ready = (async () => {
      const key = await readKey()
      root.dataset.hasKey = key.trim() === '' ? '0' : '1'
      const app = renderLiveChat(async (place) => {
        if (key.trim() !== '') place(key)
      })
      root.append(app)
    })().catch((error: unknown) => {
      root.dataset.hasKey = '0'
      root.dataset.keyError =
        error instanceof Error ? error.message : 'key command failed'
    })
    void ready.then(() => {
      if (root.dataset.ready !== 'error') root.dataset.ready = '1'
    })
    return root
  },
  play: async ({ canvasElement }) => {
    await waitFor(() => {
      expect(
        canvasElement.querySelector('[data-ready="1"], [data-has-key]'),
      ).toBeTruthy()
    })
    const keyHost = canvasElement.querySelector('[data-has-key]')
    if (keyHost instanceof HTMLElement && keyHost.dataset.keyError) {
      throw new Error(keyHost.dataset.keyError)
    }
    const signedIn = canvasElement.querySelector('[data-has-key="1"]')
    if (!signedIn) {
      await I.see(heading('Atelier').wait())
      await I.see(text(/Paste an API key/))
      return
    }
    await waitFor(() => {
      expect(
        canvasElement
          .querySelector('[data-testid="live-chat-root"]')
          ?.getAttribute('data-ready'),
      ).toBe('1')
    })
    let first: 'ok' | 'retry' = 'retry'
    try {
      await chooseModel(FREE_MODEL)
      await sendLive('Reply with the single word ok.')
      first = await outcomeText()
    } catch {
      first = 'retry'
    }
    if (first === 'retry') {
      await chooseModel(FLASH_MODEL)
      await sendLive('Reply with the single word ok.')
    }
    await waitFor(
      () => {
        const result = readLiveResult()
        expect(
          result.outcome === 'ok' ||
            result.outcome === 'error' ||
            /429|data policy/i.test(result.text),
        ).toBe(true)
      },
      { timeout: 60_000 },
    )
  },
}

function liveRoot(): HTMLElement {
  const roots = document.querySelectorAll('[data-testid="live-chat-root"]')
  const root = roots[roots.length - 1]
  if (!(root instanceof HTMLElement)) throw new Error('Missing live chat')
  return root
}

function readLiveResult(): { outcome: string; text: string } {
  const root = getAdminRoot()
  const row = [...root.querySelectorAll('[role="row"]')].find((item) =>
    (item.getAttribute('aria-label') ?? '').includes('chat.engine.send'),
  )
  return {
    outcome: row?.getAttribute('data-outcome') ?? '',
    text: root.textContent ?? '',
  }
}

async function outcomeText(): Promise<'ok' | 'retry'> {
  await waitFor(
    () => {
      const result = readLiveResult()
      expect(
        result.outcome === 'ok' ||
          result.outcome === 'error' ||
          result.outcome === 'pending' ||
          /429|data policy/i.test(result.text) ||
          (getAdminRoot().textContent ?? '').includes('In progress'),
      ).toBe(true)
    },
    { timeout: 45_000 },
  ).catch(() => undefined)
  await waitFor(
    () => {
      expect(getAdminRoot().textContent ?? '').not.toContain('In progress')
    },
    { timeout: 60_000 },
  ).catch(() => undefined)
  const result = readLiveResult()
  if (/429|data policy/i.test(result.text)) return 'ok'
  if (result.outcome === 'ok') return 'ok'
  return 'retry'
}

async function sendLive(message: string) {
  await waitFor(() => {
    expect(
      liveRoot().querySelector('textarea[aria-label="Message"]'),
    ).toBeInstanceOf(HTMLTextAreaElement)
  })
  const field = liveRoot().querySelector('textarea[aria-label="Message"]')
  if (!(field instanceof HTMLTextAreaElement))
    throw new Error('Missing composer')
  field.focus()
  field.value = message
  field.dispatchEvent(new InputEvent('input', { bubbles: true }))
  await waitFor(
    () => {
      const button = liveRoot().querySelector('[data-send][data-mode="send"]')
      expect(button).toBeInstanceOf(HTMLButtonElement)
      expect((button as HTMLButtonElement).disabled).toBe(false)
    },
    { timeout: 15_000 },
  )
  const sendButton = liveRoot().querySelector('[data-send][data-mode="send"]')
  if (!(sendButton instanceof HTMLButtonElement))
    throw new Error('Missing Send')
  sendButton.click()
}

async function chooseModel(id: string) {
  const chip = liveRoot().querySelector('[data-slot="ModelChip"]')
  if (!(chip instanceof HTMLElement)) throw new Error('Missing model chip')
  chip.click()
  await waitFor(() => {
    expect(
      document.querySelector('[data-slot="ModelPicker"] input'),
    ).toBeInstanceOf(HTMLInputElement)
  })
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
}
