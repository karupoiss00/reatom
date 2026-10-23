import { noop, urlAtom } from '@reatom/core'

import type { OtlpAdminOptions, OtlpAdminSource } from '../../otlp'
import { registerStoryCleanup } from '../../testing/storybook-runtime'
import { createOtlpAdminApp } from '../../view/otlp'

export interface OtlpChromeRenderOptions {
  width?: number
  height?: number
  source?: OtlpAdminSource
  fetch?: OtlpAdminOptions['fetch']
  onReady?: (app: ReturnType<typeof createOtlpAdminApp>) => void
}

export function renderOtlpChrome(
  records: readonly unknown[],
  resource: Record<string, unknown>,
  options: OtlpChromeRenderOptions = {},
): HTMLDivElement {
  // Story-only: the Storybook canvas shares the default context. Isolate
  // urlAtom here so play assertions are not rewritten to `/`. Host apps must
  // not copy this — reatomOtlpAdmin already isolates inside ADMIN_FRAME.
  const previousSync = urlAtom.sync()
  const previousCatchLinks = urlAtom.catchLinks()
  urlAtom.sync.set(() => noop)
  urlAtom.catchLinks.set(false)

  const width = options.width
  const height = options.height
  const storyRoot = document.createElement('div')
  storyRoot.dataset.testid = 'otlp-chrome-story-root'
  storyRoot.style.width = width === undefined ? '100%' : `${width}px`
  storyRoot.style.height = height === undefined ? '100vh' : `${height}px`
  storyRoot.style.minWidth = `${width ?? 0}px`
  storyRoot.style.minHeight = height === undefined ? '100vh' : `${height}px`
  storyRoot.style.boxSizing = 'border-box'

  const host = document.createElement('div')
  host.dataset.testid = 'otlp-chrome-host'
  host.style.width = '100%'
  host.style.height = '100%'
  storyRoot.append(host)
  // Story-only: mount while connected so JSX subscriptions attach. Storybook
  // then adopts this node; do not copy this into host apps.
  document.body.append(storyRoot)

  const app = createOtlpAdminApp(
    host,
    {
      sourceId: 'local',
      resource,
      source: options.source ?? 'replay',
      fetch: options.fetch,
    },
    records,
  )

  options.onReady?.(app)
  registerStoryCleanup(() => {
    app.unmount()
    host.replaceChildren()
    storyRoot.remove()
    urlAtom.sync.set(() => previousSync)
    urlAtom.catchLinks.set(previousCatchLinks)
  })

  return storyRoot
}
