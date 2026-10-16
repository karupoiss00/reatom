import './setup'
import './analytics'

import { addToCart } from './cart'
import { checkout } from './checkout'
import { goodsRoute } from './routes'

goodsRoute.go({ id: '42' })

document.querySelector('#add')?.addEventListener('click', () => {
  const product = goodsRoute.loader.data()
  if (product) addToCart(product)
})

document.querySelector('#checkout')?.addEventListener('click', () => {
  checkout().catch(() => {})
})
