import type { Admin } from '../../index'
import { InspectorPanel } from '../components/InspectorPanel'
import { StateExplorer } from '../components/StateExplorer'
import { SplitPane } from '../design-system'

export interface StateScreenProps {
  admin: Admin
}

export const StateScreen = ({ admin }: StateScreenProps) => {
  return (
    <div
      data-reatom-name="StateScreen"
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <SplitPane
        ratio={admin.view.stateSplitRatio}
        left={<StateExplorer admin={admin} />}
        right={
          <aside
            css={`
              height: 100%;
              min-height: 0;
              overflow: hidden;
            `}
          >
            <InspectorPanel admin={admin} />
          </aside>
        }
        minLeft={250}
        minRight={280}
        defaultRatio={0.42}
      />
    </div>
  )
}
