import { Icon } from '../design-system/Icon'
import { kindTokens, tokens } from '../design-system/tokens'
import type { RecordKindName } from './recordKind'

const kindColorCss = `
  color: ${tokens.text2};
  &[data-kind='action'] { color: ${kindTokens.action}; }
  &[data-kind='atom'] { color: ${kindTokens.atom}; }
  &[data-kind='computed'] { color: ${kindTokens.computed}; }
  &[data-kind='effect'] { color: ${kindTokens.effect}; }
  &[data-kind='log'] { color: ${kindTokens.log}; }
  &[data-kind='mount'],
  &[data-kind='route'],
  &[data-kind='framework'] { color: ${kindTokens.other}; }
  [data-admin-colors='false'] & { color: ${tokens.text2}; }
`

const kindMarkCss = `
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
  ${kindColorCss}
  [aria-pressed='true'] & { color: inherit; }
  & [data-kind-glyph] { display: flex; }
  & [data-kind-swatch] {
    display: none;
    width: 6px;
    height: 6px;
    border-radius: var(--admin-radius-2);
    background: currentColor;
  }
  [data-admin-icons='false'] & [data-kind-glyph] { display: none; }
  [data-admin-icons='false']:not([data-admin-colors='false']) & [data-kind-swatch] {
    display: block;
  }
  [data-admin-icons='false'][data-admin-colors='false'] & { display: none; }
`

export const KindSwatch = ({ kind }: { kind: RecordKindName }) => (
  <span
    data-kind-chip=""
    data-kind={kind}
    aria-hidden="true"
    css={`
      display: inline-block;
      width: 6px;
      height: 6px;
      flex: 0 0 6px;
      border-radius: var(--admin-radius-2);
      background: currentColor;
      ${kindColorCss}
    `}
  />
)

export const KindMark = ({ kind }: { kind: RecordKindName }) => (
  <span data-kind-mark="" data-kind={kind} aria-hidden="true" css={kindMarkCss}>
    <span data-kind-glyph="">
      <Icon name={kind} />
    </span>
    <span data-kind-swatch="" />
  </span>
)
