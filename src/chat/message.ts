import type { ApiNearbyLender, ApiProjectTool, ApiWindow } from '../api/types.ts'
import type { ExchangeDraft } from '../data/exchanges.ts'

export type ChatAuthor = 'user' | 'relay'

export type TextContent = {
  type: 'text'
  text: string
  /** Pending while the API answers; error when it could not be reached. */
  tone?: 'pending' | 'error'
}

/** Interactive project checklist rendered inside the thread. */
export type ToolChecklistCard = {
  type: 'tool-checklist'
  title: string
  summary: string
  projectId: string
  window: ApiWindow | null
  tools: ApiProjectTool[]
}

/** Need or offer read from a plain sentence, ready to edit before matching. */
export type ExchangeCard = {
  type: 'exchange'
  title: string
  summary: string
  draft: ExchangeDraft
  /** The API's pending request, published when the resident confirms. */
  requestId: string
}

/** Closest neighbors (and, optionally, demo listings) lending an item. */
export type NearbyLendersChatCard = {
  type: 'nearby-lenders'
  item: { id: string; name: string }
  radiusMiles: number
  includeDemo: boolean
  lenders: ApiNearbyLender[]
  summary: string
}

export type ChatCard = ToolChecklistCard | ExchangeCard | NearbyLendersChatCard

export type CardContent = {
  type: 'card'
  card: ChatCard
}

export type MessageContent = TextContent | CardContent

export type ChatMessage = {
  id: string
  author: ChatAuthor
  content: MessageContent
}

export function createTextMessage(
  author: ChatAuthor,
  text: string,
  tone?: TextContent['tone'],
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    author,
    content: tone ? { type: 'text', text, tone } : { type: 'text', text },
  }
}

export function createCardMessage(author: ChatAuthor, card: ChatCard): ChatMessage {
  return {
    id: crypto.randomUUID(),
    author,
    content: { type: 'card', card },
  }
}
