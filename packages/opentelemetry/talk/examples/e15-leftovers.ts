import { atom, computed, log } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: null,
  serviceName: 'shop-web',
})

const prices = atom([10, 20], 'cart.prices')
export const cartTotal = computed(
  () => prices().reduce((sum, price) => sum + price, 0),
  'cart.total',
)

cartTotal.subscribe((total) => log.label('cart total', total))
