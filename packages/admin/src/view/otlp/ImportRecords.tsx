import type { OtlpAdmin } from '../../otlp'
import { importRecordFile } from '../../otlp/importRecords'
import { controlBase, focusVisible, soft, tokens, type } from '../design-system'

export const ImportRecords = ({
  admin,
  variant = 'ghost',
}: {
  admin: OtlpAdmin
  variant?: 'primary' | 'ghost'
}) => (
  <label
    css={`
      ${controlBase}
      ${focusVisible}
      ${type.ui}
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding-inline: var(--admin-space-8);
      cursor: pointer;
      color: ${tokens.text1};
      background: ${variant === 'primary' ? soft(tokens.accent, 18) : 'transparent'};
      border-color: ${variant === 'primary' ? tokens.accent : tokens.border1};
    `}
  >
    Import
    <input
      aria-label="Import"
      type="file"
      accept="application/json"
      css={`
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
      `}
      on:change={async (event: Event) => {
        const input = event.currentTarget
        if (!(input instanceof HTMLInputElement)) return
        const file = input.files?.[0]
        if (!file) return
        await importRecordFile(admin, file)
        input.value = ''
      }}
    />
  </label>
)
