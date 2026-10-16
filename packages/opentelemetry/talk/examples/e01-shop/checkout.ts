import { action, withAsync, wrap } from '@reatom/core'

import { cartLines, type CartLine } from './cart'
import { otel } from './setup'

type Order = { orderId: string; total: number }

export const createOrder = action(async (lines: CartLine[]) => {
  const traceparent = otel.traceparent()
  const response = await wrap(
    fetch('/api/orders', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(traceparent ? { traceparent } : {}),
      },
      body: JSON.stringify({ lines }),
    }),
  )
  if (!response.ok) throw new Error(`Order failed: HTTP ${response.status}`)
  return (await wrap(response.json())) as Order
}, 'api.createOrder').extend(otel.withOTel({ kind: 'client' }))

export const checkout = action(async () => {
  const order = await wrap(createOrder(cartLines()))
  cartLines.set([])
  return order
}, 'checkout.submit').extend(withAsync())
