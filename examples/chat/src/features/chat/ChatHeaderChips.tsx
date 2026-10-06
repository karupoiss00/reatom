import { ui } from '../../app/ui'
import { providers } from '../../catalog/providers'
import type { RoutingSettings } from '../../storage/types'
import { Chip } from '../../ui'
import type { ChatSlotProps } from '../slots'
import { promptSaveFailed } from '../settings/chat/PromptSection'

const openPrompt = () => ui.chatSettings.set('prompt')
const openRouting = () => ui.chatSettings.set('routing')

const providerLabel = (slug: string) => {
  const known = providers.data().find((provider) => provider.slug === slug)
  if (known) return known.name
  return slug.charAt(0).toUpperCase() + slug.slice(1)
}

const routingChipLabel = (routing: RoutingSettings) => {
  if (
    routing.mode !== 'only' ||
    routing.allowFallbacks ||
    routing.providers.length === 0
  ) {
    return null
  }
  const names = routing.providers.map(providerLabel)
  if (names.length === 1) return `Routing: ${names[0]} only`
  return `Routing: ${names.join(', ')} only`
}

export const ChatHeaderChips = ({ chat }: ChatSlotProps) => (
  <div data-slot="ChatHeaderChips" css="display: contents;">
    {() => {
      if (promptSaveFailed(chat.id)) {
        return (
          <Chip
            icon="warning"
            data-prompt-chip="unsaved"
            on:click={openPrompt}
          >
            Not saved
          </Chip>
        )
      }
      if (chat.settings().systemPrompt.trim().length === 0) return null
      return (
        <Chip
          icon="compose"
          selected={true}
          data-prompt-chip="set"
          on:click={openPrompt}
        >
          System prompt
        </Chip>
      )
    }}
    {() => {
      const label = routingChipLabel(chat.settings().routing)
      if (!label) return null
      return (
        <Chip icon="settings" data-routing-chip="" on:click={openRouting}>
          {label}
        </Chip>
      )
    }}
  </div>
)
