import type { JSX } from '@reatom/jsx'

import { visuallyHidden } from './mixins'

export const VisuallyHidden = ({
  children,
  ...rest
}: JSX.IntrinsicElements['span']) => (
  <span {...rest} css={visuallyHidden}>
    {children}
  </span>
)
