import type { Admin } from '../../index'
import { FilterEditor } from '../components/FilterEditor'
import { tokens } from '../design-system'

export interface FiltersScreenProps {
  admin: Admin
}

export const FiltersScreen = ({ admin }: FiltersScreenProps) => {
  return (
    <div
      data-reatom-name="FiltersScreen"
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
        background: ${tokens.canvas};
        color: ${tokens.text1};
      `}
    >
      <FilterEditor admin={admin} />
    </div>
  )
}
