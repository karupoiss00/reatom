import { registerStoryCleanup } from '../../testing/storybook-runtime'
import { createOtlpAdminApp } from '../../view/otlp'
import type { OtlpAdminOptions } from '../../otlp'

const resource = {
  'service.name': 'clickhouse-story',
}

export function renderClickHouse(
  fetchImpl: OtlpAdminOptions['fetch'],
): HTMLDivElement {
  const storyRoot = document.createElement('div')
  storyRoot.dataset.testid = 'clickhouse-story-root'
  storyRoot.style.width = '100%'
  storyRoot.style.height = '100vh'
  const host = document.createElement('div')
  storyRoot.append(host)
  document.body.append(storyRoot)
  const { unmount } = createOtlpAdminApp(
    host,
    {
      sourceId: 'local',
      resource,
      source: 'live',
      fetch: fetchImpl,
    },
    [],
    { floating: true },
  )
  registerStoryCleanup(() => {
    unmount()
    storyRoot.remove()
  })
  return storyRoot
}
