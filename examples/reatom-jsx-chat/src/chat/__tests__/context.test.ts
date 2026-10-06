import { describe, expect, test } from 'vitest'

import { createDefaultChatSettings } from '../../storage/records'
import type { ErrorInfo } from '../../errors/types'
import type { ChatSettings } from '../../storage/types'
import {
  citationsScript,
  encryptedReasoningScript,
  midStreamErrorScript,
  plainTextScript,
  reasoningScript,
  refusalScript,
} from '../../testing/fixtures/sse'
import { assembleContext } from '../context'
import { groupLabel } from '../group'
import { chunkToEvents } from '../parse'
import { buildChatRequest } from '../request'
import { chatTitle } from '../title'
import { buildPath } from '../tree'
import {
  assistantMessage,
  claudeSonnet,
  gpt4oMini,
  userMessage,
} from './fixtures'

const noAttachment = () => undefined

const errorCard = {
  kind: 'provider-disconnected',
  code: 502,
  title: 'The provider disconnected mid-reply (502).',
  sentence: '',
  primary: { id: 'retry', label: 'Retry' },
  secondary: [],
  retryAfterSec: null,
  notice: false,
  details: { code: 502, message: 'Provider disconnected', requestId: null },
} satisfies ErrorInfo

const settingsWith = (patch: Partial<ChatSettings> = {}): ChatSettings => ({
  ...createDefaultChatSettings(),
  ...patch,
})

const strictPrivacy = { denyDataCollection: true, zdr: false }

describe('R-3 context policy', () => {
  test('When the prompt is set, messages[0] is { role: "system", content: <prompt> }. When it is empty, no system message is sent.', () => {
    const path = [userMessage('u1', null, 'Hi')]
    expect(
      assembleContext({
        path,
        systemPrompt: 'Answer briefly, in British English',
        requestModel: gpt4oMini.id,
        attachment: noAttachment,
      }),
    ).toEqual([
      { role: 'system', content: 'Answer briefly, in British English' },
      { role: 'user', content: 'Hi' },
    ])
    expect(
      assembleContext({
        path,
        systemPrompt: '   ',
        requestModel: gpt4oMini.id,
        attachment: noAttachment,
      }),
    ).toEqual([{ role: 'user', content: 'Hi' }])
  })

  test('A Stopped, Interrupted, or Connection-lost assistant reply is included verbatim in the next manual send', () => {
    for (const status of ['stopped', 'interrupted', 'connection-lost'] as const) {
      const path = [
        userMessage('u1', null, 'Tell me a story'),
        assistantMessage('a1', 'u1', 'Once upon a', { status }),
        userMessage('u2', 'a1', 'Go on'),
      ]
      expect(
        assembleContext({
          path,
          systemPrompt: '',
          requestModel: gpt4oMini.id,
          attachment: noAttachment,
        }),
      ).toEqual([
        { role: 'user', content: 'Tell me a story' },
        { role: 'assistant', content: 'Once upon a' },
        { role: 'user', content: 'Go on' },
      ])
    }
  })

  test('Error cards and notices are never sent.', () => {
    const path = [
      userMessage('u1', null, 'First'),
      assistantMessage('a1', 'u1', '', { status: 'error', error: errorCard }),
      userMessage('u2', 'a1', 'Second'),
      assistantMessage('a2', 'u2', 'Partial', {
        status: 'error',
        error: errorCard,
      }),
      userMessage('u3', 'a2', 'Third'),
      assistantMessage('a3', 'u3', '', {
        status: 'refused',
        refusal: "I can't help with that request.",
      }),
      userMessage('u4', 'a3', 'Fourth'),
    ]
    const wire = assembleContext({
      path,
      systemPrompt: '',
      requestModel: gpt4oMini.id,
      attachment: noAttachment,
    })
    expect(wire).toEqual([
      { role: 'user', content: 'First' },
      { role: 'user', content: 'Second' },
      { role: 'assistant', content: 'Partial' },
      { role: 'user', content: 'Third' },
      { role: 'user', content: 'Fourth' },
    ])
    expect(JSON.stringify(wire)).not.toContain('disconnected')
    expect(JSON.stringify(wire)).not.toContain("can't help")
  })

  test('Retry and Regenerate end the request at that turn\'s user message and omit every assistant version of that turn.', () => {
    const path = [
      userMessage('u1', null, 'Question'),
      assistantMessage('a1', 'u1', 'Version one'),
    ]
    expect(
      assembleContext({
        path,
        systemPrompt: '',
        requestModel: gpt4oMini.id,
        endAtUserId: 'u1',
        attachment: noAttachment,
      }),
    ).toEqual([{ role: 'user', content: 'Question' }])
  })

  test('reasoning_details are sent back only for assistant messages whose stored model id equals the request\'s model.', () => {
    const details = [{ type: 'reasoning.text', text: 'think' }]
    const path = [
      userMessage('u1', null, 'Hi'),
      assistantMessage('a1', 'u1', 'Hello', {
        model: gpt4oMini.id,
        reasoning: {
          text: 'think',
          details,
          startedAt: 1,
          endedAt: 2,
          hiddenByProvider: false,
          stoppedWhileThinking: false,
        },
      }),
      userMessage('u2', 'a1', 'More'),
    ]
    const sameModel = assembleContext({
      path,
      systemPrompt: '',
      requestModel: gpt4oMini.id,
      attachment: noAttachment,
    })
    expect(sameModel[1]).toEqual({
      role: 'assistant',
      content: 'Hello',
      reasoningDetails: details,
    })
    const otherModel = assembleContext({
      path,
      systemPrompt: '',
      requestModel: claudeSonnet.id,
      attachment: noAttachment,
    })
    expect(otherModel[1]).toEqual({ role: 'assistant', content: 'Hello' })
  })

  test('user attachments become image_url and file parts', () => {
    const path = [
      userMessage('u1', null, 'Describe', {
        attachments: [
          { id: 'img', kind: 'image', name: 'a.png', mime: 'image/png', size: 3 },
          { id: 'doc', kind: 'pdf', name: 'a.pdf', mime: 'application/pdf', size: 3 },
        ],
      }),
    ]
    const blobs = new Map([
      ['img', { id: 'img', dataUrl: 'data:image/png;base64,AAA' }],
      ['doc', { id: 'doc', dataUrl: 'data:application/pdf;base64,BBB' }],
    ])
    expect(
      assembleContext({
        path,
        systemPrompt: '',
        requestModel: gpt4oMini.id,
        attachment: (id) => blobs.get(id),
      }),
    ).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe' },
          { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAA' } },
          {
            type: 'file',
            file: { filename: 'a.pdf', fileData: 'data:application/pdf;base64,BBB' },
          },
        ],
      },
    ])
  })
})

describe('request builder', () => {
  test('With default chat settings, the body contains only model, messages, stream: true, and the F-19 privacy fields', () => {
    const request = buildChatRequest({
      modelId: gpt4oMini.id,
      model: gpt4oMini,
      messages: [{ role: 'user', content: 'Hi' }],
      settings: settingsWith(),
      globalPrivacy: strictPrivacy,
    })
    expect(request).toEqual({
      model: 'openai/gpt-4o-mini',
      messages: [{ role: 'user', content: 'Hi' }],
      stream: true,
      provider: { dataCollection: 'deny' },
    })
  })

  test('With ZDR on, the body has provider.zdr: true. With "Exclude…" off, data_collection is absent.', () => {
    const request = buildChatRequest({
      modelId: gpt4oMini.id,
      model: gpt4oMini,
      messages: [{ role: 'user', content: 'Hi' }],
      settings: settingsWith({
        privacyOverride: { denyDataCollection: false, zdr: true },
      }),
      globalPrivacy: strictPrivacy,
    })
    expect(request.provider).toEqual({ zdr: true })
  })

  test('sends only supported parameters, reasoning only as { effort }, never reasoning_effort', () => {
    const settings = settingsWith({
      params: { temperature: 0.4, topP: 0.9, maxTokens: 300, reasoningEffort: 'high' },
    })
    const forMini = buildChatRequest({
      modelId: gpt4oMini.id,
      model: gpt4oMini,
      messages: [{ role: 'user', content: 'Hi' }],
      settings,
      globalPrivacy: strictPrivacy,
    })
    expect(forMini.temperature).toBe(0.4)
    expect(forMini).not.toHaveProperty('topP')
    expect(forMini).not.toHaveProperty('maxTokens')
    expect(forMini.reasoning).toEqual({ effort: 'high' })
    expect(forMini).not.toHaveProperty('reasoningEffort')

    const forSonnet = buildChatRequest({
      modelId: claudeSonnet.id,
      model: claudeSonnet,
      messages: [{ role: 'user', content: 'Hi' }],
      settings: settingsWith({ params: { reasoningEffort: 'xhigh' } }),
      globalPrivacy: strictPrivacy,
    })
    expect(forSonnet).not.toHaveProperty('reasoning')

    const unknownModel = buildChatRequest({
      modelId: 'custom/model',
      model: null,
      messages: [{ role: 'user', content: 'Hi' }],
      settings,
      globalPrivacy: strictPrivacy,
    })
    expect(Object.keys(unknownModel).sort()).toEqual(
      ['messages', 'model', 'provider', 'stream'].sort(),
    )
  })

  test('overrides pick the model and never add an :online suffix', () => {
    const request = buildChatRequest({
      modelId: gpt4oMini.id,
      model: claudeSonnet,
      messages: [{ role: 'user', content: 'Hi' }],
      settings: settingsWith({ webSearch: true }),
      globalPrivacy: strictPrivacy,
      overrides: { model: claudeSonnet.id, maxTokens: 900 },
    })
    expect(request.model).toBe(claudeSonnet.id)
    expect(request.maxTokens).toBe(900)
    expect(String(request.model)).not.toContain(':online')
    expect(request.tools).toEqual([{ type: 'openrouter:web_search' }])
  })

  test('never builds a request with an empty model id', () => {
    expect(() =>
      buildChatRequest({
        modelId: '  ',
        model: null,
        messages: [{ role: 'user', content: 'Hi' }],
        settings: settingsWith(),
        globalPrivacy: strictPrivacy,
      }),
    ).toThrow()
  })
})

describe('chunk parsing', () => {
  test('reads id, content, finish and usage (cost + is_byok) from wire chunks', () => {
    const events = plainTextScript.flatMap((chunk) => chunkToEvents(chunk.data))
    expect(events).toContainEqual({ kind: 'id', id: plainTextScript[0]!.data.id })
    expect(events).toContainEqual({ kind: 'content', text: 'Hello' })
    expect(events).toContainEqual({ kind: 'finish', reason: 'stop' })
    expect(events).toContainEqual({
      kind: 'usage',
      usage: {
        promptTokens: 10,
        completionTokens: 4,
        reasoningTokens: 0,
        cost: 0.000012,
        isByok: false,
        source: 'usage',
      },
    })
  })

  test('reads reasoning deltas and reasoning_details unchanged', () => {
    const events = reasoningScript.flatMap((chunk) => chunkToEvents(chunk.data))
    expect(events).toContainEqual({ kind: 'reasoning', text: 'think' })
    expect(events).toContainEqual({
      kind: 'reasoning-details',
      details: [{ type: 'reasoning.text', text: 'think' }],
    })
    const encrypted = encryptedReasoningScript.flatMap((chunk) =>
      chunkToEvents(chunk.data),
    )
    expect(encrypted).toContainEqual({
      kind: 'reasoning-details',
      details: [{ type: 'reasoning.encrypted', data: 'ciphertext-fixture' }],
    })
  })

  test('reads camelCase SDK chunks the same way', () => {
    expect(
      chunkToEvents({
        id: 'gen-x',
        choices: [
          {
            delta: { reasoningDetails: [{ type: 'reasoning.text', text: 't' }] },
            finishReason: 'length',
          },
        ],
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          cost: 0.5,
          isByok: true,
          completionTokensDetails: { reasoningTokens: 2 },
        },
      }),
    ).toEqual([
      { kind: 'id', id: 'gen-x' },
      { kind: 'reasoning-details', details: [{ type: 'reasoning.text', text: 't' }] },
      { kind: 'finish', reason: 'length' },
      {
        kind: 'usage',
        usage: {
          promptTokens: 1,
          completionTokens: 2,
          reasoningTokens: 2,
          cost: 0.5,
          isByok: true,
          source: 'usage',
        },
      },
    ])
  })

  test('reads provider, citations and annotations that only the raw wire carries', () => {
    const events = citationsScript.flatMap((chunk) => chunkToEvents(chunk.data))
    expect(events).toContainEqual({ kind: 'provider', name: 'Perplexity' })
    expect(events).toContainEqual({
      kind: 'citations',
      items: [{ url: 'https://example.com/a', title: 'Alpha', domain: 'example.com' }],
    })
  })

  test('reads mid-stream errors and refusals', () => {
    const errorEvents = midStreamErrorScript.flatMap((chunk) =>
      chunkToEvents(chunk.data),
    )
    expect(errorEvents).toContainEqual({
      kind: 'error',
      code: 502,
      message: 'Provider disconnected',
      metadata: { error_type: 'server' },
    })
    expect(errorEvents).toContainEqual({ kind: 'finish', reason: 'error' })
    const refusal = refusalScript.flatMap((chunk) => chunkToEvents(chunk.data))
    expect(refusal).toContainEqual({
      kind: 'refusal',
      text: "I can't help with that request.",
    })
  })
})

describe('titles and groups', () => {
  test('Title: the first 60 Unicode graphemes of the first user message, with newlines replaced by spaces.', () => {
    const family = '👨‍👩‍👧‍👦'
    expect(chatTitle(`${family.repeat(70)}`)).toBe(family.repeat(60))
    expect(chatTitle('Line one\nLine two\r\nLine three')).toBe(
      'Line one Line two Line three',
    )
    expect(chatTitle('é'.normalize('NFD').repeat(61))).toBe(
      'é'.normalize('NFD').repeat(60),
    )
  })

  test('Fixture: activity at 2026-10-05T03:30:00Z falls under Yesterday in America/New_York and Today in Asia/Tokyo.', () => {
    const activity = Date.parse('2026-10-05T03:30:00Z')
    const nowAt = Date.parse('2026-10-05T12:00:00Z')
    expect(groupLabel(activity, nowAt, 'America/New_York')).toBe('Yesterday')
    expect(groupLabel(activity, nowAt, 'Asia/Tokyo')).toBe('Today')
  })

  test('2026-09-15T12:00:00Z falls under "September 2026" even with the locale set to ru-RU.', () => {
    const originalLanguage = navigator.language
    expect(typeof originalLanguage).toBe('string')
    const activity = Date.parse('2026-09-15T12:00:00Z')
    const nowAt = Date.parse('2026-11-20T12:00:00Z')
    const resolvedRu = new Intl.DateTimeFormat('ru-RU', {
      month: 'long',
      year: 'numeric',
    }).format(activity)
    expect(resolvedRu).not.toBe('September 2026')
    expect(groupLabel(activity, nowAt, 'Europe/Moscow')).toBe('September 2026')
  })

  test('groups recent activity into Previous 7 days and Previous 30 days', () => {
    const nowAt = Date.parse('2026-10-05T12:00:00Z')
    const day = 24 * 60 * 60 * 1000
    expect(groupLabel(nowAt - 3 * day, nowAt, 'UTC')).toBe('Previous 7 days')
    expect(groupLabel(nowAt - 20 * day, nowAt, 'UTC')).toBe('Previous 30 days')
  })
})

describe('R-5 versions tree', () => {
  test('siblings are versions; the selection picks the shown path', () => {
    const messages = [
      userMessage('u1', null, 'Q'),
      assistantMessage('a1', 'u1', 'one', { createdAt: 2 }),
      assistantMessage('a2', 'u1', 'two', { createdAt: 3 }),
      userMessage('u2', 'a1', 'follow-up', { createdAt: 4 }),
    ]
    const latest = buildPath(messages, {})
    expect(latest.map((node) => node.message.id)).toEqual(['u1', 'a2'])
    expect(latest[1]).toMatchObject({ versions: ['a1', 'a2'], versionIndex: 1 })
    const first = buildPath(messages, { u1: 'a1' })
    expect(first.map((node) => node.message.id)).toEqual(['u1', 'a1', 'u2'])
  })
})
