import { context } from '@reatom/core'
import { mount } from '@reatom/jsx'
import { expect } from 'vitest'
import { page } from 'vitest/browser'

import { App } from '../App'
import { boot } from '../app/boot'
import type { Timings } from '../app/timings'
import { writeStoredKey } from '../auth/keyStore'
import { sessionMode } from '../auth/session'
import { initStorage } from '../storage'
import { resetBrowserState } from './env'
import { catalogModels } from './fixtures/models'
import {
  installOpenRouterMock,
  mockKey,
  mockModels,
  resetOpenRouterMock,
} from './openrouter-mock'
import { seedChats, type SeedChatSpec } from './seed'

export interface BootAppOptions {
  key?: string
  remember?: boolean
  seed?: readonly SeedChatSpec[]
  models?: readonly object[]
  keyMeta?: object
  viewport?: { width: number; height: number }
  timings?: Partial<Timings>
}

let unmountAppTree: (() => void) | null = null

export const unmountApp = () => {
  unmountAppTree?.()
  unmountAppTree = null
}

export const slot = (name: string) =>
  document.querySelector<HTMLElement>(`[data-slot="${name}"]`)

export const bootApp = async (options: BootAppOptions = {}) => {
  unmountApp()
  await resetBrowserState()
  context.reset()
  resetOpenRouterMock()
  installOpenRouterMock()
  mockModels(options.models ?? catalogModels)
  if (options.keyMeta !== undefined) mockKey(options.keyMeta)
  if (options.viewport) {
    await page.viewport(options.viewport.width, options.viewport.height)
  }
  if (options.key) writeStoredKey(options.key, options.remember !== false)
  document.body.replaceChildren()
  const root = document.createElement('div')
  root.id = 'app'
  document.body.append(root)
  unmountAppTree = mount(root, <App />).unmount
  await initStorage()
  if (options.seed && options.seed.length > 0) await seedChats(options.seed)
  await boot(options.timings ? { timings: options.timings } : {})
  await expect.poll(() => sessionMode()).not.toBe('booting')
}
