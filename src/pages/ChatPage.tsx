import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { useSearchParams } from 'react-router'
import {
  Hammer,
  HandHelping,
  MessageCircle,
  Notebook,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { api, apiBase } from '../api/client.ts'
import { replyFromApi } from '../chat/reply.ts'
import {
  createTextMessage,
  type ChatCard,
  type ChatMessage,
  type MessageContent,
} from '../chat/message.ts'
import { RelayMark } from '../components/RelayMark.tsx'
import { ExchangeCard } from '../components/ExchangeCard.tsx'
import { NearbyLendersCard } from '../components/NearbyLendersCard.tsx'
import { ToolChecklistCard } from '../components/ToolChecklistCard.tsx'
import { sphereClass } from '../data/sectionSpheres.ts'
import { readStoredRadius } from '../data/searchRadius.ts'
import { useActivityFeed } from '../state/activityFeedStore.ts'
import { useCurrentResident } from '../state/currentResidentStore.ts'
import { useShelfResident } from '../state/shelfResidentStore.ts'
import {
  readSampleListingsPreference,
  resolveSampleListingsOn,
} from '../data/sampleListings.ts'
import { sameCity } from '../data/cityMatch.ts'

const chatDraftKey = (shelfId: string) => `relay:chat:draft:${shelfId}`
const chatTranscriptKey = (shelfId: string) => `relay:chat:transcript:${shelfId}`

function readChatStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key) ?? sessionStorage.getItem(key)
    if (!raw) return null
    // Migrate older session-only transcripts into localStorage so they survive reloads.
    if (!localStorage.getItem(key) && sessionStorage.getItem(key)) {
      localStorage.setItem(key, raw)
    }
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

function writeChatStore(key: string, value: unknown): void {
  const body = JSON.stringify(value)
  try {
    localStorage.setItem(key, body)
  } catch {
    /* private browsing / quota */
  }
  try {
    sessionStorage.setItem(key, body)
  } catch {
    /* private browsing / quota */
  }
}

function restoreMessages(shelfId: string): ChatMessage[] {
  const saved = readChatStore<ChatMessage[]>(chatTranscriptKey(shelfId))
  if (!Array.isArray(saved)) return []
  // Drop in-flight "thinking" bubbles so a refresh does not leave them stuck.
  return saved.filter(
    (message) =>
      !(message.content.type === 'text' && message.content.tone === 'pending'),
  )
}

const RelayCatCharacter = lazy(async () => {
  const mod = await import('../components/RelayCatCharacter.tsx')
  return { default: mod.RelayCatCharacter }
})

const examples: {
  kicker: string
  text: string
  icon: LucideIcon
  sphere: 'sky' | 'mint' | 'leaf'
}[] = [
  {
    kicker: 'A project',
    text: "I'm building a bookshelf this weekend.",
    icon: Hammer,
    sphere: 'sky',
  },
  {
    kicker: 'Something needed',
    text: 'I need 20 notebooks Saturday morning for a school supply drive.',
    icon: Notebook,
    sphere: 'mint',
  },
  {
    kicker: 'To lend',
    text: 'I have a ladder to lend.',
    icon: HandHelping,
    sphere: 'leaf',
  },
]

const inputMaxHeight = 136

export function ChatPage() {
  const headingId = useId()
  const shelfId = useShelfResident()
  const [messages, setMessages] = useState<ChatMessage[]>(() => restoreMessages(shelfId))
  const [searchParams, setSearchParams] = useSearchParams()
  const draftParam = searchParams.get('draft')
  const [draft, setDraft] = useState(() => draftParam ?? readChatStore<string>(chatDraftKey(shelfId)) ?? '')
  const [appliedDraftParam, setAppliedDraftParam] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [hasRealNeighbors, setHasRealNeighbors] = useState(false)
  const { refresh } = useActivityFeed()
  const you = useCurrentResident()
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [pondEl, setPondEl] = useState<HTMLDivElement | null>(null)
  const [catMounted] = useState(true)

  const canSend = draft.trim().length > 0
  const announcement = latestRelayAnnouncement(messages)
  const includeDemoListings = resolveSampleListingsOn(
    readSampleListingsPreference(shelfId),
    hasRealNeighbors,
  )

  // `?draft=` prefills the composer (e.g. "Ask in chat" from the Neighborhood page). Adjusting
  // state during render (not an effect) avoids a cascading-render setState-in-effect warning.
  if (draftParam !== null && draftParam !== appliedDraftParam) {
    setAppliedDraftParam(draftParam)
    setDraft(draftParam)
  }

  // Clear the query param and focus the composer once the draft above has been applied.
  useEffect(() => {
    if (appliedDraftParam === null) return
    const next = new URLSearchParams(searchParams)
    next.delete('draft')
    setSearchParams(next, { replace: true })
    inputRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedDraftParam])

  useEffect(() => {
    writeChatStore(chatDraftKey(shelfId), draft)
  }, [draft, shelfId])

  useEffect(() => {
    writeChatStore(chatTranscriptKey(shelfId), messages)
  }, [messages, shelfId])

  useEffect(() => {
    let cancel = false
    void api
      .residents()
      .then((rows) => {
        if (cancel) return
        const city = you.city.trim()
        setHasRealNeighbors(
          rows.some(
            (row) =>
              row.id !== shelfId && (!city || !row.city || sameCity(row.city, city)),
          ),
        )
      })
      .catch(() => {
        if (!cancel) setHasRealNeighbors(false)
      })
    return () => {
      cancel = true
    }
  }, [shelfId, you.city])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = '0px'
    input.style.height = `${Math.min(input.scrollHeight, inputMaxHeight)}px`
  }, [draft])

  useLayoutEffect(() => {
    const log = logRef.current
    if (!log || messages.length === 0) return
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    log.scrollTo({
      top: log.scrollHeight,
      behavior: reduceMotion ? 'auto' : 'smooth',
    })
  }, [messages])

  async function appendExchange(text: string) {
    const trimmed = text.trim()
    if (!trimmed) return
    setEditing(false)
    const pending = createTextMessage('relay', 'Relay is thinking…', 'pending')
    setMessages((current) => [...current, createTextMessage('user', trimmed), pending])

    let reply: ChatMessage
    try {
      const card = await api.chat(shelfId, trimmed, {
        includeDemoListings,
        radiusMiles: readStoredRadius(shelfId),
      })
      reply = replyFromApi(card, trimmed)
    } catch {
      reply = createTextMessage(
        'relay',
        `I could not reach the Relay API at ${apiBase}. Check that the backend is running, then send that again.`,
        'error',
      )
    }
    setMessages((current) => current.map((message) => (message.id === pending.id ? reply : message)))
    void refresh()
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSend) return
    void appendExchange(draft)
    setDraft('')
    inputRef.current?.focus()
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  function startNewChat() {
    setEditing(false)
    setMessages([])
    setDraft('')
    writeChatStore(chatTranscriptKey(shelfId), [])
    writeChatStore(chatDraftKey(shelfId), '')
    inputRef.current?.focus()
  }

  function resetChat() {
    if (messages.length === 0 && !draft.trim() && !editing) return
    if (!window.confirm('Clear this chat thread? You can start a new one afterward.')) return
    startNewChat()
  }

  function editUserMessage(messageId: string) {
    const index = messages.findIndex((message) => message.id === messageId)
    if (index < 0) return
    const target = messages[index]
    if (!target || target.author !== 'user' || target.content.type !== 'text') return
    const text = target.content.text
    // Keep earlier turns. Pull this message (and its Relay reply) out so the user can
    // fix the wording in the composer and send again — do not wipe the whole chat.
    const prior = messages.slice(0, index)
    const following = messages[index + 1]
    const afterReply =
      following && following.author === 'relay' ? index + 2 : index + 1
    const later = messages.slice(afterReply)
    setMessages([...prior, ...later])
    setDraft(text)
    setEditing(true)
    window.requestAnimationFrame(() => {
      const input = inputRef.current
      if (!input) return
      input.focus()
      const end = text.length
      input.setSelectionRange(end, end)
    })
  }

  const showWelcome = messages.length === 0 && !editing

  const lastUserTextId = [...messages]
    .reverse()
    .find((message) => message.author === 'user' && message.content.type === 'text')?.id

  return (
    <section className="chat-page" aria-labelledby={headingId}>
      <div className="chat-pond" ref={setPondEl}>
        <div className={showWelcome ? 'chat-log chat-log-empty' : 'chat-log'} ref={logRef}>
          <header className="chat-welcome">
            <div className="chat-welcome-top">
              <div className="chat-hero-badge">
                <span className="icon-chip sphere-sky">
                  <MessageCircle aria-hidden="true" size={22} />
                </span>
                <div className="grid gap-1">
                  <p className="eyebrow">Talk it through</p>
                  <h1 id={headingId} className="chat-title">
                    Chat (the Robo Cat)
                  </h1>
                </div>
              </div>
              <div className="chat-toolbar" role="group" aria-label="Chat actions">
                <button type="button" className="chat-tool-btn" onClick={startNewChat}>
                  <Plus aria-hidden="true" size={16} />
                  New chat
                </button>
                <button
                  type="button"
                  className="chat-tool-btn"
                  onClick={resetChat}
                  disabled={messages.length === 0 && !draft.trim() && !editing}
                >
                  <RotateCcw aria-hidden="true" size={16} />
                  Reset
                </button>
              </div>
            </div>
            {showWelcome ? (
              <>
                <h2 className="chat-welcome-headline">What are we making happen?</h2>
                <p className="chat-intro">
                  Ask for the closest ladder, start a project, or offer something to lend. A few plain
                  sentences are enough.
                </p>
                <div className="chat-prompts">
                  <p className="chat-prompt-label">Try one</p>
                  <div className="chat-prompt-grid">
                    {examples.map(({ kicker, text, icon: Icon, sphere }) => (
                      <button
                        key={text}
                        type="button"
                        className="chat-prompt"
                        onClick={() => void appendExchange(text)}
                      >
                        <span className={`icon-chip chat-prompt-icon ${sphereClass(sphere)}`}>
                          <Icon aria-hidden="true" size={20} />
                        </span>
                        <span className="chat-prompt-copy">
                          <span className="chat-prompt-kicker">{kicker}</span>
                          <span className="chat-prompt-text">{text}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
            {editing ? (
              <p className="chat-editing-banner" role="status">
                Editing your message — fix it below, then send again.
              </p>
            ) : null}
          </header>
          {messages.length > 0 ? (
            <ol className="chat-thread" aria-label="Conversation">
              {messages.map((message) => (
                <ChatBubble
                  key={message.id}
                  message={message}
                  canEdit={!editing && message.id === lastUserTextId}
                  onEdit={() => editUserMessage(message.id)}
                />
              ))}
            </ol>
          ) : null}
        </div>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <form className="chat-composer" onSubmit={onSubmit}>
          <div className="chat-composer-shell">
            {catMounted ? (
              <Suspense fallback={null}>
                <RelayCatCharacter trackingRoot={pondEl} />
              </Suspense>
            ) : null}
            <div className="chat-composer-main">
              <label className="sr-only" htmlFor="relay-message">
                Message to Relay
              </label>
              <div className="chat-composer-row">
                <textarea
                  ref={inputRef}
                  id="relay-message"
                  className="chat-input"
                  rows={1}
                  value={draft}
                  placeholder={
                    editing
                      ? 'Edit your message, then send'
                      : 'A project, something you need, or something to give away'
                  }
                  enterKeyHint="send"
                  autoComplete="off"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onInputKeyDown}
                />
                <button type="submit" className="chat-send" disabled={!canSend} aria-label="Send message">
                  <Send aria-hidden="true" size={18} />
                </button>
              </div>
              <p className="hint chat-hint">
                {editing
                  ? 'Send to replace that turn. Reset clears the whole chat.'
                  : 'Enter sends. Shift + Enter adds a line.'}
              </p>
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}

function ChatBubble({
  message,
  canEdit = false,
  onEdit,
}: {
  message: ChatMessage
  canEdit?: boolean
  onEdit?: () => void
}) {
  const resident = useCurrentResident()
  const isUser = message.author === 'user'
  const isCard = message.content.type === 'card'

  return (
    <li
      className={[
        'chat-row',
        isUser ? 'chat-row-user' : 'chat-row-relay',
        isCard ? 'chat-row-card' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isUser ? (
        <span className="chat-avatar chat-avatar-user" aria-hidden="true">
          {resident.imageUrl ? (
            <img src={resident.imageUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            resident.initials
          )}
        </span>
      ) : (
        <span className="chat-avatar chat-avatar-relay" aria-hidden="true">
          <RelayMark className="relay-mark" />
        </span>
      )}
      <div
        className={[
          'chat-bubble',
          isUser ? 'chat-bubble-user' : 'chat-bubble-relay',
          isCard ? 'chat-bubble-card' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="chat-bubble-head">
          <p className="chat-speaker">{isUser ? 'You' : 'Relay'}</p>
          {canEdit && onEdit ? (
            <button type="button" className="chat-edit-btn" onClick={onEdit}>
              <Pencil aria-hidden="true" size={14} />
              Edit
            </button>
          ) : null}
        </div>
        <MessageBody content={message.content} />
      </div>
    </li>
  )
}

function MessageBody({ content }: { content: MessageContent }) {
  switch (content.type) {
    case 'text':
      return (
        <p className="chat-text" role={content.tone === 'error' ? 'alert' : undefined}>
          {content.text}
        </p>
      )
    case 'card':
      return <ChatCardSlot card={content.card} />
    default: {
      const unreachable: never = content
      return unreachable
    }
  }
}

function ChatCardSlot({ card }: { card: ChatCard }) {
  switch (card.type) {
    case 'tool-checklist':
      return (
        <ToolChecklistCard
          title={card.title}
          summary={card.summary}
          projectId={card.projectId}
          window={card.window}
          tools={card.tools}
        />
      )
    case 'exchange':
      return <ExchangeCard draft={card.draft} requestId={card.requestId} />
    case 'nearby-lenders':
      return (
        <NearbyLendersCard
          item={card.item}
          radiusMiles={card.radiusMiles}
          includeDemo={card.includeDemo}
          lenders={card.lenders}
          summary={card.summary}
        />
      )
  }
}

function latestRelayAnnouncement(messages: ChatMessage[]) {
  const latest = [...messages].reverse().find((message) => message.author === 'relay')
  if (!latest) return ''
  const relayCount = messages.filter((message) => message.author === 'relay').length
  // Zero-width spaces make an identical reply announce again.
  return `Relay: ${relayAnnouncementText(latest)}${'\u200b'.repeat(relayCount)}`
}

function relayAnnouncementText(message: ChatMessage) {
  switch (message.content.type) {
    case 'text':
      return message.content.text
    case 'card':
      return cardAnnouncementText(message.content.card)
    default: {
      const unreachable: never = message.content
      return unreachable
    }
  }
}

function cardAnnouncementText(card: ChatCard) {
  switch (card.type) {
    case 'nearby-lenders':
      return `${card.item.name}. ${card.summary}`
    default:
      return `${card.title}. ${card.summary}`
  }
}
