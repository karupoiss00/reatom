import type { Computed } from '@reatom/core'
import type { JSX } from '@reatom/jsx'

import type { ChatModel, ThreadNode } from '../chat/types'
import type { AssistantMessage } from '../storage/types'

export interface LayoutSlotProps {
  sidebar: () => JSX.Element
  main: () => JSX.Element
}

export interface ChatSlotProps {
  chat: ChatModel
}

/**
 * `node` keeps one identity per message id for the row's lifetime and tracks
 * that message's latest record, versions, and selection, so slot components
 * read it reactively instead of being re-created on every path change.
 */
export interface NodeSlotProps {
  chat: ChatModel
  node: Computed<ThreadNode>
}

export interface AssistantSlotProps {
  chat: ChatModel
  message: Computed<AssistantMessage>
}

export interface MessageSlotProps {
  message: Computed<AssistantMessage>
}
