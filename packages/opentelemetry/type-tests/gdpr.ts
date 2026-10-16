/**
 * `reatomGDPR` is part of `test:types` so strict checking covers the consent
 * form, not only its runtime tests. `fields.*` are defined booleans, and the
 * form is a legal `connectWebAnalytics` consent value. A checkbox object
 * without `snapshot` is not.
 */
import { atom } from '@reatom/core'
import { reatomGDPR } from '../src/gdpr/index.ts'
import { reatomOpentelemetry } from '../src/index.ts'
import { connectWebAnalytics } from '../src/web-analytics/index.ts'

const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

const consent = reatomGDPR({ name: 'consent', otel })

export const analytics = connectWebAnalytics(otel, { consent })

consent.fields.analytics.change(true)
consent.fields.diagnostics.change(false)
consent.fields.marketing.change(false)

const saved = consent.snapshot()
if (saved) {
  const analyticsAllowed: boolean = saved.categories.analytics
  const diagnosticsAllowed: boolean = saved.categories.diagnostics
  const marketingAllowed: boolean = saved.categories.marketing
  void analyticsAllowed
  void diagnosticsAllowed
  void marketingAllowed
}

const custom = reatomGDPR({
  name: 'custom',
  categories: { experiments: false },
})
custom.fields.experiments.change(true)
custom.fields.analytics.change(false)

const flag = atom(false, 'consent.flag')
connectWebAnalytics(otel, { consent: flag })
connectWebAnalytics(otel, { consent: { analytics: flag } })
connectWebAnalytics(otel, {
  consent: {
    fields: { analytics: consent.fields.analytics },
    snapshot: consent.snapshot,
  },
})

connectWebAnalytics(otel, {
  // @ts-expect-error live checkboxes without a submitted snapshot are not consent
  consent: { fields: { analytics: consent.fields.analytics } },
})
