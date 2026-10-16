import { action } from '@reatom/core'
import { reatomOpentelemetry } from '@reatom/opentelemetry'
import { connectWebAnalytics } from '@reatom/opentelemetry/web-analytics'

export const otel = reatomOpentelemetry({
  name: 'shop',
  endpoint: 'https://shop.example/otel',
  serviceName: 'shop-web',
})

export const analytics = connectWebAnalytics(otel, { consent: true })

export const applyCoupon = action((code: string) => {
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new TypeError(`Bad coupon ${code}`)
  return code
}, 'checkout.applyCoupon')

const couponInput = document.querySelector<HTMLInputElement>('#coupon')
couponInput?.addEventListener('change', () => applyCoupon(couponInput.value))
