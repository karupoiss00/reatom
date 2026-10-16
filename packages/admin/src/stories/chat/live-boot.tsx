import { mount } from '@reatom/jsx'

import { registerStoryCleanup } from '../../testing/storybook-runtime'
import { connectLiveAdmin } from '../harness/live'

/**
 * Live OpenRouter boot. No fetch mock. The key is applied only when the story
 * already read it on the Node side; this module never logs it.
 */
export function renderLiveChat(
  seed: (place: (key: string) => void) => Promise<void>,
): HTMLDivElement {
  const storyRoot = document.createElement('div')
  storyRoot.dataset.testid = 'live-chat-root'
  storyRoot.style.width = '100%'
  storyRoot.style.height = '100vh'

  const ready = (async () => {
    const env = await import('chat-app/testing/env')
    await env.resetBrowserState()
    const { host, appRoot } = connectLiveAdmin()
    appRoot.style.height = '100%'
    appRoot.style.overflow = 'auto'
    storyRoot.append(appRoot, host)
    let unmountApp = () => {}
    registerStoryCleanup(() => {
      try {
        unmountApp()
      } catch {
        appRoot.replaceChildren()
      }
    })
    const keyStore = await import('chat-app/auth/keyStore')
    await seed((key) => {
      keyStore.placeKey(key, false)
    })
    const bootModule = await import('chat-app/app/boot')
    await bootModule.boot()
    const { App } = await import('chat-app/App')
    unmountApp = mount(appRoot, <App />).unmount
  })()

  void ready
    .then(() => {
      storyRoot.dataset.ready = '1'
    })
    .catch((error: unknown) => {
      storyRoot.dataset.ready = 'error'
      storyRoot.dataset.error =
        error instanceof Error ? error.message : 'boot failed'
    })
  return storyRoot
}
