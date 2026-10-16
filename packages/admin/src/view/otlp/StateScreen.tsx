import type { OtlpAdmin } from '../../otlp'
import { SplitPane } from '../design-system'
import { OtlpInspector } from './Inspector'
import { StateInspector } from './StateInspector'

export interface OtlpStateScreenProps {
  admin: OtlpAdmin
}

export const OtlpStateScreen = ({ admin }: OtlpStateScreenProps) => {
  return (
    <div
      data-reatom-name="OtlpStateScreen"
      css={`
        height: 100%;
        min-height: 0;
        overflow: hidden;
      `}
    >
      <SplitPane
        ratio={admin.stateSplitRatio}
        left={<StateInspector admin={admin} />}
        right={
          <aside
            css={`
              height: 100%;
              min-height: 0;
              overflow: hidden;
            `}
          >
            <OtlpInspector admin={admin} />
          </aside>
        }
        minLeft={250}
        minRight={280}
        defaultRatio={0.42}
      />
    </div>
  )
}
