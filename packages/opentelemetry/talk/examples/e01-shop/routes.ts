import { reatomRoute, wrap } from '@reatom/core'

export type Product = { id: string; title: string; price: number }

export const goodsRoute = reatomRoute(
  {
    path: 'goods/:id',
    async loader({ id }) {
      const response = await wrap(fetch(`/api/goods/${id}`))
      return (await wrap(response.json())) as Product
    },
  },
  'goods',
)
