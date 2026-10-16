import { action, atom, withAsync, wrap } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const otel = reatomOpentelemetry({
  name: 'crm',
  endpoint: 'https://crm.example/otel',
  serviceName: 'crm-web',
  filter: (target) => target.name.startsWith('search.'),
})
export const analytics = connectWebAnalytics(otel, {
  consent: true,
  navigation: 'navigation-api',
})

export const searchQuery = atom('', 'search.query')
export const runSearch = action(async () => {
  const response = await wrap(
    fetch(`/api/search?q=${encodeURIComponent(searchQuery())}`),
  )
  return (await wrap(response.json())) as string[]
}, 'search.run').extend(withAsync())
