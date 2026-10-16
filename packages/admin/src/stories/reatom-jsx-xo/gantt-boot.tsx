import { mount } from '@reatom/jsx'

import { registerStoryCleanup } from '../../testing/storybook-runtime'
import { connectLiveAdmin } from '../harness/live'

function installEnvironmentMocks(): () => void {
  const originalVibrateDescriptor = Object.getOwnPropertyDescriptor(
    Navigator.prototype,
    'vibrate',
  )
  Object.defineProperty(Navigator.prototype, 'vibrate', {
    value: () => false,
    configurable: true,
    writable: true,
  })
  return () => {
    if (originalVibrateDescriptor) {
      Object.defineProperty(
        Navigator.prototype,
        'vibrate',
        originalVibrateDescriptor,
      )
      return
    }
    Reflect.deleteProperty(Navigator.prototype, 'vibrate')
  }
}

export type XoLayout = 'wide' | 'narrow' | 'empty'

export function renderXoGantt(layout: XoLayout = 'wide'): HTMLDivElement {
  const storyRoot = document.createElement('div')
  storyRoot.dataset.testid = 'xo-story-root'
  storyRoot.style.width = layout === 'narrow' ? '560px' : '100%'
  storyRoot.style.maxWidth = '100%'
  storyRoot.style.minHeight = '100vh'

  const ready = (async () => {
    const restoreEnvironment = installEnvironmentMocks()
    const { host, appRoot } = connectLiveAdmin()
    if (layout === 'empty') storyRoot.append(host)
    else storyRoot.append(appRoot, host)
    registerStoryCleanup(() => {
      restoreEnvironment()
    })
    if (layout === 'empty') return

    let unmountApp = () => {}
    registerStoryCleanup(() => {
      try {
        unmountApp()
      } catch {
        appRoot.replaceChildren()
      }
    })
    const footer = await import('./src/components/Footer')
    footer.repositoryStarCountResource.reset()
    const model = await import('./src/model')
    model.playWithComputer.set(false)
    model.resetGame()
    await import('./src/setup')
    const { App } = await import('./src/App')
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
