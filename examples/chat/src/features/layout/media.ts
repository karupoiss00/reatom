import { reatomMediaQuery } from '@reatom/core'

export const compactLayoutQuery = '(max-width: 760px)'

export const compactLayout = reatomMediaQuery(compactLayoutQuery, 'layout.compact')
