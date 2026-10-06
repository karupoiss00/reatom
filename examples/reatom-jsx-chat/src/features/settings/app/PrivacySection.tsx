import {
  atom,
  computed,
  withChangeHook,
  withComputed,
} from '@reatom/core'

import { activeChat } from '../../../chat'
import { globalPrivacy } from '../../../storage/prefs'
import { Banner, Switch } from '../../../ui'

const accountCopy =
  "OpenRouter itself doesn't store prompts unless you opt in on your OpenRouter account."

const webSearchWarning = 'Web search may not work with zero data retention'

const denyTraining = atom(true, 'features.settings.appPrivacy.deny').extend(
  withComputed(() => globalPrivacy().denyDataCollection),
  withChangeHook((denyDataCollection) => {
    const current = globalPrivacy()
    if (current.denyDataCollection === denyDataCollection) return
    globalPrivacy.set({ ...current, denyDataCollection })
  }),
)

const zeroRetention = atom(false, 'features.settings.appPrivacy.zdr').extend(
  withComputed(() => globalPrivacy().zdr),
  withChangeHook((zdr) => {
    const current = globalPrivacy()
    if (current.zdr === zdr) return
    globalPrivacy.set({ ...current, zdr })
  }),
)

const webSearchBlocked = computed(() => {
  const chat = activeChat()
  const privacy = chat.settings().privacyOverride ?? globalPrivacy()
  return privacy.zdr && chat.settings().webSearch
}, 'features.settings.appPrivacy.webSearchWarning')

export const PrivacySection = () => (
  <section
    data-slot="PrivacySection"
    aria-label="Privacy"
    css={`
      display: grid;
      align-content: start;
      gap: var(--space-5);
      min-width: 0;
      max-width: 36rem;
    `}
  >
    <div css="display: grid; gap: var(--space-1); min-width: 0;">
      <h3
        css={`
          margin: 0;
          font-family: var(--font-display);
          font-size: var(--text-lg);
          font-weight: var(--weight-medium);
          line-height: var(--leading-tight);
          letter-spacing: var(--tracking-display);
        `}
      >
        Requests
      </h3>
      <p
        css={`
          margin: 0;
          color: var(--text-muted);
          font-size: var(--text-sm);
          line-height: var(--leading-snug);
          text-wrap: pretty;
        `}
      >
        {accountCopy}
      </p>
    </div>
    <div css="display: grid; gap: var(--space-2); min-width: 0;">
      <Switch
        label="Exclude providers that may train on my data"
        checked={denyTraining}
      />
      <Switch label="Zero data retention only" checked={zeroRetention} />
    </div>
    {() =>
      webSearchBlocked() ? (
        <Banner tone="warning" title={webSearchWarning} />
      ) : null
    }
  </section>
)
