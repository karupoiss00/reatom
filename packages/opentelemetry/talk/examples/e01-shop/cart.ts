import { action, atom } from '@reatom/core'

import type { Product } from './routes'

export type CartLine = { productId: string; price: number; quantity: number }

export const cartLines = atom<CartLine[]>([], 'cart.lines')

export const addToCart = action((product: Product) => {
  cartLines.set((lines) => [
    ...lines,
    { productId: product.id, price: product.price, quantity: 1 },
  ])
}, 'cart.add')
