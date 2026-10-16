import { reatomRoute } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

export const goodsRoute = reatomRoute({ path: 'goods/:id' }, 'goods')

export const quickViewRoute = goodsRoute
  .reatomRoute({ path: 'quick-view' }, 'goods.quickView')
  .extend(otel.withOTel({ boundary: false }))
