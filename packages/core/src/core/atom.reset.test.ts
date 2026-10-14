// use `vitest` instead of `test` only in this test file
import { beforeEach, describe, expect, test } from 'vitest'

import { catalog } from 'test'

import { wrap } from '../methods'
import { type AbortError, isAbort, sleep } from '../utils'
import { clearStack, context } from './atom'

clearStack()

const root = context.start()

beforeEach(() => {
  root.run(context.reset)
})

describe('context.reset', () => {
  test('first', () =>
    root.run(() => {
      expect(catalog.page()).toBe(0)

      catalog.page.set(1)
      expect(catalog.page()).toBe(1)
    }))

  test('second', () =>
    root.run(() => {
      expect(catalog.page()).toBe(0)

      catalog.page.set(1)
      expect(catalog.page()).toBe(1)
    }))

  test('wrap abort', async () =>
    root.run(async () => {
      const wrappedPromise = wrap(sleep(10))

      context.reset()

      const error = await wrappedPromise.catch((e) => e)
      expect(isAbort(error)).toBe(true)
      expect((error as AbortError).message).includes('context reset')
    }))
})
