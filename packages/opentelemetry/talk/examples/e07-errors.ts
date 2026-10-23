import { action } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { withWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
}).extend(withWebAnalytics({ consent: true }))

export const analytics = otel.analytics

export const applyCoupon = action((code: string) => {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new TypeError(`Bad coupon ${code}`)
  return code
}, 'checkout.applyCoupon')

const couponInput = document.querySelector<HTMLInputElement>('#coupon')
couponInput?.addEventListener('change', () => applyCoupon(couponInput.value))
