import {
  atom,
  computed,
  peek,
  withChangeHook,
  withComputed,
} from '@reatom/core'

import { globalPrivacy } from '../../../storage/prefs'
import type { PrivacySettings } from '../../../storage/types'
import { Banner, Button, Switch } from '../../../ui'
import type { ChatSlotProps } from '../../slots'

const accountCopy =
  "OpenRouter itself doesn't store prompts unless you opt in on your OpenRouter account."

const webSearchWarning = 'Web search may not work with zero data retention'

const sectionStyles = `
  display: grid;
  align-content: start;
  gap: var(--space-5);
  min-width: 0;
  max-width: 36rem;
`

const noteStyles = `
  margin: 0;
  color: var(--text-muted);
  font-size: var(--text-sm);
  line-height: var(--leading-snug);
  text-wrap: pretty;
`

const privacyAtoms = (
  name: string,
  read: () => PrivacySettings,
  write: (next: PrivacySettings) => void,
) => {
  const current = peek(read)
  const denyTraining = atom(current.denyDataCollection, `${name}.deny`).extend(
    withComputed(() => read().denyDataCollection),
    withChangeHook((denyDataCollection) => {
      const privacy = read()
      if (privacy.denyDataCollection === denyDataCollection) return
      write({ ...privacy, denyDataCollection })
    }),
  )
  const zeroRetention = atom(current.zdr, `${name}.zdr`).extend(
    withComputed(() => read().zdr),
    withChangeHook((zdr) => {
      const privacy = read()
      if (privacy.zdr === zdr) return
      write({ ...privacy, zdr })
    }),
  )
  return { denyTraining, zeroRetention }
}

export const PrivacySection = ({ chat }: ChatSlotProps) => {
  const name = `features.settings.chatPrivacy.${chat.id}`
  const effective = computed(
    () => chat.settings().privacyOverride ?? globalPrivacy(),
    `${name}.effective`,
  )
  const { denyTraining, zeroRetention } = privacyAtoms(
    name,
    effective,
    (privacy) => {
      chat.updateSettings({ privacyOverride: privacy })
    },
  )
  const warning = computed(
    () => effective().zdr && chat.settings().webSearch,
    `${name}.webSearchWarning`,
  )

  return (
    <section
      data-slot="PrivacySection"
      aria-label="Privacy"
      css={sectionStyles}
    >
      <div
        css={`
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-2) var(--space-3);
          min-width: 0;
        `}
      >
        <p
          data-privacy-source=""
          css={`
            margin: 0;
            min-width: 0;
            font-family: var(--font-display);
            font-size: var(--text-lg);
            font-weight: var(--weight-medium);
            line-height: var(--leading-tight);
            letter-spacing: var(--tracking-display);
          `}
        >
          {() =>
            chat.settings().privacyOverride
              ? 'Custom for this chat'
              : 'Using global privacy'
          }
        </p>
        {() =>
          chat.settings().privacyOverride ? (
            <Button
              variant="ghost"
              size="sm"
              on:click={() => chat.updateSettings({ privacyOverride: null })}
            >
              Use global privacy
            </Button>
          ) : null
        }
      </div>
      <div css="display: grid; gap: var(--space-2); min-width: 0;">
        <Switch
          label="Exclude providers that may train on my data"
          checked={denyTraining}
        />
        <Switch label="Zero data retention only" checked={zeroRetention} />
      </div>
      <p css={noteStyles}>{accountCopy}</p>
      {() =>
        warning() ? (
          <Banner tone="warning" title={webSearchWarning} />
        ) : null
      }
    </section>
  )
}
