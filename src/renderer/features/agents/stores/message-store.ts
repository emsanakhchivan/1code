"use client"

import { atom } from "jotai"
import { atomFamily } from "jotai/utils"
import { appStore } from "../../../lib/jotai-store"
import { agentChatStore } from "./agent-chat-store"
import { clearSubChatAtoms } from "../atoms"
import { streamingChatIdsAtom } from "../../../lib/atoms/streaming-state"

// Types
export interface MessagePart {
  type: string
  text?: string
  toolCallId?: string
  state?: string
  input?: any
  output?: any
  result?: any
  [key: string]: any
}

export interface Message {
  id: string
  role: "user" | "assistant" | "system"
  parts?: MessagePart[]
  metadata?: any
  createdAt?: Date
}

// ============================================================================
// MESSAGE STORE - OPTIMIZED ARCHITECTURE
// ============================================================================
// Key insight: Jotai atomFamily creates INDEPENDENT atoms for each key.
// When we use atomFamily with primitive atoms (not derived), each message
// has its own atom that can be updated without affecting other messages.
//
// Architecture:
// - messageAtomFamily: atomFamily<messageId, Message | null> - INDEPENDENT atoms per message
// - messageIdsAtom: string[] - ordered list of message IDs for rendering
// - messageRolesAtom: Map<messageId, role> - cached roles for grouping (avoids reading all messages)
// - lastMessageIdAtom: derived atom for the last message ID
// - streamingMessageIdAtom: ID of currently streaming message (or null)
//
// During streaming:
// - Only the streaming message's atom is updated
// - Other message atoms remain unchanged → no re-renders
// ============================================================================

// Per-message atom family - each message has its own INDEPENDENT atom
// Key format: "<subChatId>:::<messageId>".
// This guarantees full per-chat isolation even when message IDs overlap across chats.
export const getPerChatMessageKey = (subChatId: string, messageId: string) =>
  `${subChatId}:::${messageId}`

// This is the key optimization: updating one message doesn't affect others.
export const messageAtomFamily = atomFamily((_messageKey: string) =>
  atom<Message | null>(null)
)

// Track active message IDs per subChat for cleanup
const activeMessageIdsByChat = new Map<string, Set<string>>()

// LRU Cache Eviction - Track access times and evict oldest when limit exceeded
const MAX_ACTIVE_CHATS = 20
const lastAccessTimeByChat = new Map<string, number>()

// Track chat access time for LRU eviction
export function touchChatAccess(subChatId: string) {
  lastAccessTimeByChat.set(subChatId, Date.now())

  // Memory leak verification: warn and auto-evict if exceeding threshold
  const activeChatCount = activeMessageIdsByChat.size
  if (activeChatCount > MAX_ACTIVE_CHATS + 10) {
    console.warn(
      `[MessageStore] Memory threshold exceeded: ${activeChatCount} active chats (limit: ${MAX_ACTIVE_CHATS}). Auto-evicting...`
    )
    evictLeastRecentlyUsed(subChatId)
  }
}

// Evict least recently used caches, protecting active/split/streaming chats
// CRITICAL: Streaming chats must NEVER be evicted even if not viewed recently
export function evictLeastRecentlyUsed(currentSubChatId: string, protectedIds: string[] = []) {
  const keys = Array.from(activeMessageIdsByChat.keys())

  // Get stream-active chats from global atom - these are protected
  const streamingIds = appStore.get(streamingChatIdsAtom)
  const viewActive = appStore.get(viewActiveChatIdAtom)

  // Protected: current chat + view-active + all stream-active + explicit protected
  const keepSet = new Set([
    currentSubChatId,
    viewActive,
    ...streamingIds,
    ...protectedIds
  ].filter(Boolean) as string[])

  if (keys.length <= MAX_ACTIVE_CHATS) return

  // Sort by last access time (oldest first)
  const toEvict = keys
    .filter(k => !keepSet.has(k))
    .sort((a, b) => (lastAccessTimeByChat.get(a) || 0) - (lastAccessTimeByChat.get(b) || 0))
    .slice(0, keys.length - MAX_ACTIVE_CHATS)

  for (const subChatId of toEvict) {
    // CRITICAL: First abort any active stream via transport.cleanup()
    // agentChatStore.delete() calls chat?.transport?.cleanup?.() which:
    // 1. Aborts active fetch requests
    // 2. Cleans up event listeners
    // 3. Prevents orphaned streams from writing to deleted caches
    agentChatStore.delete(subChatId)
    // Then clear Jotai atom caches
    clearSubChatCaches(subChatId)
    lastAccessTimeByChat.delete(subChatId)
  }
}

// Ordered list of message IDs (for rendering order)
export const messageIdsAtom = atom<string[]>([])

// Message roles cache - updated only when messages are added/removed
// This avoids reading all message atoms just to check roles
const messageRolesAtom = atom<Map<string, "user" | "assistant" | "system">>(new Map())

// Per-subChat atoms for split-pane rendering. Each pane reads only its own IDs/roles.
export const messageIdsPerChatAtom = atomFamily((_subChatId: string) =>
  atom<string[]>([])
)

const messageRolesPerChatAtom = atomFamily((_subChatId: string) =>
  atom<Map<string, "user" | "assistant" | "system">>(new Map())
)

// Currently streaming message ID (null if not streaming)
export const streamingMessageIdAtom = atom<string | null>(null)

// ============================================================================
// VIEW-ACTIVE TRACKING - State Partitioning for Performance
// ============================================================================
// Key optimization: Only sync view-active or stream-active chats.
// Background tabs have sync paused to prevent cascade updates.
//

// View-active tracking: which chat the user is currently viewing
export const viewActiveChatIdAtom = atom<string | null>(null)

// Combined: check if chat should sync (view-active OR stream-active)
// Use this to determine whether a chat needs message sync operations
// TODO: This atom is defined for future use when viewActiveChatIdAtom is properly set.
// Currently, sync decisions are made inline in syncMessagesWithStatusAtom using updateGlobal as fallback.
// Once viewActiveChatIdAtom has a proper setter, this atom can be used for declarative sync checks.
export const shouldSyncChatAtom = atomFamily((chatId: string) =>
  atom((get) => {
    const viewActive = get(viewActiveChatIdAtom)
    const streamingIds = get(streamingChatIdsAtom)

    // Sync if: view-active OR stream-active
    return viewActive === chatId || streamingIds.has(chatId)
  })
)

// Chat status atom
export const chatStatusAtom = atom<string>("ready")

// Global rollback state - prevents multiple rollbacks across all chats
export const isRollingBackAtom = atom<boolean>(false)

// Current subChatId - used to isolate caches per chat
export const currentSubChatIdAtom = atom<string>("default")

// Last message ID - derived (uses stable messageIdsAtom)
export const lastMessageIdAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  return ids.length > 0 ? ids[ids.length - 1] : null
})

// ============================================================================
// SELECTORS
// ============================================================================

// Check if a specific message is the last one
export const isLastMessageAtomFamily = atomFamily((messageId: string) =>
  atom((get) => get(lastMessageIdAtom) === messageId)
)

// Per-subchat version for split panes.
// Key format: "subChatId:messageId"
export const isLastMessagePerChatAtomFamily = atomFamily((key: string) => {
  const sepIdx = key.indexOf(":")
  const subChatId = key.slice(0, sepIdx)
  const messageId = key.slice(sepIdx + 1)
  return atom((get) => {
    const ids = get(messageIdsPerChatAtom(subChatId))
    return ids.length > 0 && ids[ids.length - 1] === messageId
  })
})

// Check if a specific message is currently streaming
export const isMessageStreamingAtomFamily = atomFamily((messageId: string) =>
  atom((get) => {
    const streamingId = get(streamingMessageIdAtom)
    const lastId = get(lastMessageIdAtom)
    // A message is streaming if it's the last message and there's active streaming
    return messageId === lastId && streamingId === messageId
  })
)

// ============================================================================
// TEXT PART ATOMS - For IsolatedTextPart optimization
// ============================================================================
// Problem: When IsolatedTextPart subscribes to messageAtomFamily, ALL text parts
// of that message re-render when ANY part changes (even tool parts).
//
// Solution: Create a derived atom that extracts ONLY the specific text part.
// This way, a text part only re-renders when ITS text changes, not when
// other parts of the same message change.

// Cache for text part content to return stable references
const textPartCache = new Map<string, string>()

export const textPartAtomFamily = atomFamily((key: string) => {
  // Key format: "<messageKey>:<partIndex>".
  // messageKey can include ":" so split from the end.
  const sepIdx = key.lastIndexOf(":")
  const messageKey = key.slice(0, sepIdx)
  const partIndexStr = key.slice(sepIdx + 1)
  const partIndex = parseInt(partIndexStr!, 10)

  return atom((get) => {
    const message = get(messageAtomFamily(messageKey))
    const parts = message?.parts || []
    const part = parts[partIndex]
    const text = part?.type === "text" ? (part.text || "") : ""

    // Return cached value if text hasn't changed (stable reference)
    const cached = textPartCache.get(key)
    if (cached === text) {
      return cached
    }

    textPartCache.set(key, text)
    return text
  })
})

// ============================================================================
// MESSAGE PARTS STRUCTURE - For AssistantMessageItem optimization
// ============================================================================
// Problem: AssistantMessageItem subscribes to the whole message object.
// When ANY part changes (including text content), the whole component re-renders,
// causing all IsolatedTextPart children to re-render.
//
// Solution: Create an atom that returns only the STRUCTURE of parts (types, states,
// toolCallIds) without text content. This way AssistantMessageItem only re-renders
// when the structure changes (new part added, tool state changed), not when text
// content streams in.

interface PartStructure {
  type: string
  toolCallId?: string
  state?: string
  // For tools we need input to determine rendering
  inputJson?: string
  // For tool results
  hasOutput?: boolean
  hasResult?: boolean
  hasError?: boolean
  // For text parts - whether text is non-empty (without including actual text)
  hasText?: boolean
}

interface MessageStructure {
  id: string
  role: "user" | "assistant" | "system"
  partsStructure: PartStructure[]
  metadata?: any
}

// Cache for message structure
const messageStructureCache = new Map<string, MessageStructure>()

export const messageStructureAtomFamily = atomFamily((messageKey: string) =>
  atom((get) => {
    const message = get(messageAtomFamily(messageKey))
    if (!message) return null

    // Build structure without text content
    const partsStructure: PartStructure[] = (message.parts || []).map((part: any) => {
      const structure: PartStructure = {
        type: part.type,
      }
      if (part.toolCallId) structure.toolCallId = part.toolCallId
      if (part.state) structure.state = part.state
      // For tools, include input as JSON for comparison
      if (part.input) structure.inputJson = JSON.stringify(part.input)
      if (part.output !== undefined) structure.hasOutput = true
      if (part.result !== undefined) structure.hasResult = true
      if (part.error !== undefined || part.errorText !== undefined) structure.hasError = true
      // For text parts, track whether text is non-empty (without including actual text)
      if (part.type === "text") structure.hasText = !!part.text?.trim()
      return structure
    })

    const newStructure: MessageStructure = {
      id: message.id,
      role: message.role,
      partsStructure,
      metadata: message.metadata,
    }

    // Check if structure changed
    const cached = messageStructureCache.get(messageKey)
    if (cached) {
      // Compare structures
      if (
        cached.id === newStructure.id &&
        cached.role === newStructure.role &&
        cached.partsStructure.length === newStructure.partsStructure.length &&
        cached.partsStructure.every((p, i) => {
          const n = newStructure.partsStructure[i]
          return (
            p.type === n?.type &&
            p.toolCallId === n?.toolCallId &&
            p.state === n?.state &&
            p.inputJson === n?.inputJson &&
            p.hasOutput === n?.hasOutput &&
            p.hasResult === n?.hasResult &&
            p.hasError === n?.hasError &&
            p.hasText === n?.hasText
          )
        }) &&
        // Shallow compare metadata (for usage tracking)
        cached.metadata === message.metadata
      ) {
        return cached
      }
    }

    messageStructureCache.set(messageKey, newStructure)
    return newStructure
  })
)

// ============================================================================
// USER MESSAGE IDS - For IsolatedMessagesSection
// ============================================================================
// Uses a cache to return stable reference when IDs haven't changed
// Cache is per-subChatId to avoid collisions between different chats

const userMessageIdsCacheByChat = new Map<string, string[]>()
export const userMessageIdsAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  const roles = get(messageRolesAtom)
  const subChatId = get(currentSubChatIdAtom)
  const newUserIds = ids.filter((id) => roles.get(id) === "user")

  // Return cached array if content is the same
  const cached = userMessageIdsCacheByChat.get(subChatId)
  if (
    cached &&
    newUserIds.length === cached.length &&
    newUserIds.every((id, i) => id === cached[i])
  ) {
    return cached
  }

  userMessageIdsCacheByChat.set(subChatId, newUserIds)
  return newUserIds
})

// Per-subchat version for split panes
const userMessageIdsPerChatCache = new Map<string, string[]>()
export const userMessageIdsPerChatAtom = atomFamily((subChatId: string) =>
  atom((get) => {
    const ids = get(messageIdsPerChatAtom(subChatId))
    const roles = get(messageRolesPerChatAtom(subChatId))
    const newUserIds = ids.filter((id) => roles.get(id) === "user")

    const cached = userMessageIdsPerChatCache.get(subChatId)
    if (
      cached &&
      newUserIds.length === cached.length &&
      newUserIds.every((id, i) => id === cached[i])
    ) {
      return cached
    }

    userMessageIdsPerChatCache.set(subChatId, newUserIds)
    return newUserIds
  })
)

// ============================================================================
// MESSAGE GROUPS - For rendering structure
// ============================================================================

type MessageGroupType = { userMsgId: string; assistantMsgIds: string[] }
const messageGroupsCacheByChat = new Map<string, MessageGroupType[]>()

export const messageGroupsAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  const roles = get(messageRolesAtom)
  const subChatId = get(currentSubChatIdAtom)

  const groups: MessageGroupType[] = []
  let currentGroup: MessageGroupType | null = null

  for (const id of ids) {
    const role = roles.get(id)
    if (!role) continue

    if (role === "user") {
      if (currentGroup) {
        groups.push(currentGroup)
      }
      currentGroup = { userMsgId: id, assistantMsgIds: [] }
    } else if (currentGroup && role === "assistant") {
      currentGroup.assistantMsgIds.push(id)
    }
  }

  if (currentGroup) {
    groups.push(currentGroup)
  }

  // Check if groups structurally match cached
  const cachedMessageGroups = messageGroupsCacheByChat.get(subChatId) ?? []
  if (groups.length === cachedMessageGroups.length) {
    let allMatch = true
    for (let i = 0; i < groups.length; i++) {
      const newGroup = groups[i]
      const cachedGroup = cachedMessageGroups[i]
      if (
        newGroup.userMsgId !== cachedGroup?.userMsgId ||
        newGroup.assistantMsgIds.length !== cachedGroup?.assistantMsgIds.length ||
        !newGroup.assistantMsgIds.every((id, j) => id === cachedGroup?.assistantMsgIds[j])
      ) {
        allMatch = false
        break
      }
    }
    if (allMatch) {
      return cachedMessageGroups
    }
  }

  messageGroupsCacheByChat.set(subChatId, groups)
  return groups
})

// Per-subchat message groups for split panes
function buildMessageGroups(ids: string[], roles: Map<string, string>): MessageGroupType[] {
  const groups: MessageGroupType[] = []
  let currentGroup: MessageGroupType | null = null

  for (const id of ids) {
    const role = roles.get(id)
    if (!role) continue

    if (role === "user") {
      if (currentGroup) groups.push(currentGroup)
      currentGroup = { userMsgId: id, assistantMsgIds: [] }
    } else if (currentGroup && role === "assistant") {
      currentGroup.assistantMsgIds.push(id)
    }
  }

  if (currentGroup) groups.push(currentGroup)
  return groups
}

const messageGroupsPerChatCache = new Map<string, MessageGroupType[]>()
const messageGroupsPerChatAtom = atomFamily((subChatId: string) =>
  atom((get) => {
    const ids = get(messageIdsPerChatAtom(subChatId))
    const roles = get(messageRolesPerChatAtom(subChatId))
    const groups = buildMessageGroups(ids, roles as Map<string, string>)

    const cached = messageGroupsPerChatCache.get(subChatId) ?? []
    if (groups.length === cached.length) {
      let allMatch = true
      for (let i = 0; i < groups.length; i++) {
        const newGroup = groups[i]
        const cachedGroup = cached[i]
        if (
          newGroup?.userMsgId !== cachedGroup?.userMsgId ||
          newGroup?.assistantMsgIds.length !== cachedGroup?.assistantMsgIds.length ||
          !newGroup?.assistantMsgIds.every((id, j) => id === cachedGroup?.assistantMsgIds[j])
        ) {
          allMatch = false
          break
        }
      }
      if (allMatch) {
        return cached
      }
    }

    messageGroupsPerChatCache.set(subChatId, groups)
    return groups
  })
)

// ============================================================================
// ASSISTANT IDS FOR USER MESSAGE - For IsolatedMessageGroup
// ============================================================================

// Per-subchat versions for split panes
// Key format: "subChatId:userMsgId"
const assistantIdsPerChatCache = new Map<string, string[]>()
export const assistantIdsPerChatAtomFamily = atomFamily((key: string) => {
  const sepIdx = key.indexOf(":")
  const subChatId = key.slice(0, sepIdx)
  const userMsgId = key.slice(sepIdx + 1)
  return atom((get) => {
    const groups = get(messageGroupsPerChatAtom(subChatId))
    const group = groups.find((g) => g.userMsgId === userMsgId)
    const newIds = group?.assistantMsgIds ?? []
    const cached = assistantIdsPerChatCache.get(key)

    if (
      cached &&
      cached.length === newIds.length &&
      cached.every((id, i) => id === newIds[i])
    ) {
      return cached
    }

    assistantIdsPerChatCache.set(key, newIds)
    return newIds
  })
})

export const isLastUserMessagePerChatAtomFamily = atomFamily((key: string) => {
  const sepIdx = key.indexOf(":")
  const subChatId = key.slice(0, sepIdx)
  const userMsgId = key.slice(sepIdx + 1)
  return atom((get) => {
    const userIds = get(userMessageIdsPerChatAtom(subChatId))
    return userIds[userIds.length - 1] === userMsgId
  })
})

// Key format: "subChatId:userMsgId" to isolate per chat
const assistantIdsCacheByChat = new Map<string, string[]>()
export const assistantIdsForUserMsgAtomFamily = atomFamily((userMsgId: string) =>
  atom((get) => {
    const groups = get(messageGroupsAtom)
    const subChatId = get(currentSubChatIdAtom)
    const group = groups.find((g) => g.userMsgId === userMsgId)
    const newIds = group?.assistantMsgIds ?? []

    // Return cached array if content is the same
    const cacheKey = `${subChatId}:${userMsgId}`
    const cached = assistantIdsCacheByChat.get(cacheKey)
    if (
      cached &&
      cached.length === newIds.length &&
      cached.every((id, i) => id === newIds[i])
    ) {
      return cached
    }

    assistantIdsCacheByChat.set(cacheKey, newIds)
    return newIds
  })
)

// Is this user message the last one?
export const isLastUserMessageAtomFamily = atomFamily((userMsgId: string) =>
  atom((get) => {
    const userIds = get(userMessageIdsAtom)
    return userIds[userIds.length - 1] === userMsgId
  })
)

// Is this user message the first one? (used to hide rollback button on first message)
export const isFirstUserMessageAtomFamily = atomFamily((userMsgId: string) =>
  atom((get) => {
    const userIds = get(userMessageIdsAtom)
    return userIds[0] === userMsgId
  })
)

type RollbackLookupMessage = {
  role: "user" | "assistant" | "system"
  metadata?: any
  parts?: MessagePart[]
}

function hasCompactToolUsePart(parts?: MessagePart[]): boolean {
  return !!parts?.some((part) => part.type === "tool-Compact")
}

// Shared rollback target lookup used by both UI visibility and rollback action.
export function findRollbackTargetSdkUuidForUserIndex(
  userMsgIndex: number,
  totalMessageCount: number,
  getMessageAt: (index: number) => RollbackLookupMessage | null | undefined,
): string | null {
  if (userMsgIndex <= 0 || totalMessageCount <= 0) return null

  // 1) Pick the first assistant before this user message.
  let targetAssistantIndex = -1
  let targetAssistantMessage: RollbackLookupMessage | null | undefined = null
  for (let i = userMsgIndex - 1; i >= 0; i--) {
    const message = getMessageAt(i)
    if (!message || message.role !== "assistant") continue
    targetAssistantIndex = i
    targetAssistantMessage = message
    break
  }

  if (targetAssistantIndex === -1 || !targetAssistantMessage) return null

  // 2) Any compact after that assistant (up to the end of the dialog) means
  // this assistant is already behind compact and cannot be a rollback target.
  for (let i = targetAssistantIndex; i < totalMessageCount; i++) {
    const message = getMessageAt(i)
    if (!message || message.role !== "assistant") continue
    if (hasCompactToolUsePart(message.parts)) {
      return null
    }
  }

  // 3) No compact after target assistant: allow rollback only if target has SDK UUID.
  const sdkUuid = (targetAssistantMessage.metadata as any)?.sdkMessageUuid
  return typeof sdkUuid === "string" && sdkUuid.length > 0 ? sdkUuid : null
}

// Per-subchat rollback target for split panes.
// Key format: "subChatId:userMsgId"
export const rollbackTargetPerChatAtomFamily = atomFamily((key: string) => {
  const sepIdx = key.indexOf(":")
  const subChatId = key.slice(0, sepIdx)
  const userMsgId = key.slice(sepIdx + 1)
  return atom((get) => {
    const ids = get(messageIdsPerChatAtom(subChatId))
    const roles = get(messageRolesPerChatAtom(subChatId))
    const userMsgIndex = ids.indexOf(userMsgId)

    if (userMsgIndex <= 0) return null

    return findRollbackTargetSdkUuidForUserIndex(userMsgIndex, ids.length, (index) => {
      const messageId = ids[index]
      if (!messageId) return null

      const role = roles.get(messageId)
      if (!role) return null

      if (role !== "assistant") {
        return { role }
      }

      return get(messageAtomFamily(getPerChatMessageKey(subChatId, messageId)))
    })
  })
})

// SDK UUID of the assistant message that rollback should target for this user message.
// Returns null when this turn cannot be rolled back.
export const rollbackTargetSdkUuidForUserMsgAtomFamily = atomFamily((userMsgId: string) =>
  atom((get) => {
    const ids = get(messageIdsAtom)
    const roles = get(messageRolesAtom)
    const userMsgIndex = ids.indexOf(userMsgId)

    if (userMsgIndex <= 0) return null

    return findRollbackTargetSdkUuidForUserIndex(userMsgIndex, ids.length, (index) => {
      const messageId = ids[index]
      if (!messageId) return null

      const role = roles.get(messageId)
      if (!role) return null

      if (role !== "assistant") {
        return { role }
      }

      const subChatId = get(currentSubChatIdAtom)
      return get(messageAtomFamily(getPerChatMessageKey(subChatId, messageId)))
    })
  })
)

// ============================================================================
// STREAMING STATUS
// ============================================================================

export const isStreamingAtom = atom((get) => {
  const status = get(chatStatusAtom)
  return status === "streaming" || status === "submitted"
})

// Has any messages
export const hasMessagesAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  return ids.length > 0
})

// ============================================================================
// LAST ASSISTANT MESSAGE - For plan detection
// ============================================================================

// Cache for last assistant message to avoid re-reading on every check
// Keyed by subChatId to isolate per chat
const lastAssistantCacheByChat = new Map<string, { id: string | null; msg: Message | null }>()

export const lastAssistantMessageAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  const roles = get(messageRolesAtom)
  const subChatId = get(currentSubChatIdAtom)

  // Find the last assistant ID
  let lastAssistantId: string | null = null
  for (let i = ids.length - 1; i >= 0; i--) {
    if (roles.get(ids[i]!) === "assistant") {
      lastAssistantId = ids[i]!
      break
    }
  }

  const cached = lastAssistantCacheByChat.get(subChatId)

  if (!lastAssistantId) {
    lastAssistantCacheByChat.set(subChatId, { id: null, msg: null })
    return null
  }

  // If same ID, return cached message
  if (lastAssistantId === cached?.id && cached.msg) {
    // But we need to get fresh message in case it changed during streaming
    const freshMsg = get(messageAtomFamily(getPerChatMessageKey(subChatId, lastAssistantId)))
    if (freshMsg === cached.msg) {
      return cached.msg
    }
    lastAssistantCacheByChat.set(subChatId, { id: lastAssistantId, msg: freshMsg })
    return freshMsg
  }

  // Different ID, get fresh message
  const msg = get(messageAtomFamily(getPerChatMessageKey(subChatId, lastAssistantId)))
  lastAssistantCacheByChat.set(subChatId, { id: lastAssistantId, msg })
  return msg
})

// Has unapproved plan (for approve button)
export const hasUnapprovedPlanAtom = atom((get) => {
  const lastAssistant = get(lastAssistantMessageAtom)
  if (!lastAssistant) return false

  const parts = lastAssistant.parts || []
  for (const part of parts) {
    if (part.type === "tool-invocation" && part.toolName === "ExitPlanMode") {
      if (!part.result) return true
    }
  }
  return false
})

// ============================================================================
// TOKEN DATA - For input area
// ============================================================================

// Cache for token data to avoid full recalculation
// Keyed by subChatId to isolate per chat
type TokenData = {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
  totalTokens: number
  messageCount: number
  totalMessageCount: number
  // Track last message's output tokens to detect when streaming completes
  lastMsgOutputTokens: number
  // Track last message parts signature to detect compact boundary updates
  lastMsgPartsKey: string
}
const tokenDataCacheByChat = new Map<string, TokenData>()

export const messageTokenDataAtom = atom((get) => {
  const ids = get(messageIdsAtom)
  const subChatId = get(currentSubChatIdAtom)

  // Get the last message to check if its tokens changed
  const lastId = ids[ids.length - 1]
  const lastMsg = lastId ? get(messageAtomFamily(getPerChatMessageKey(subChatId, lastId))) : null
  // Note: metadata has flat structure (metadata.outputTokens), not nested (metadata.usage.outputTokens)
  const lastMsgOutputTokens = (lastMsg?.metadata as any)?.outputTokens || 0
  const lastMsgParts = (lastMsg as any)?.parts as Array<{ type?: string; state?: string }> | undefined
  const lastPart = lastMsgParts?.[lastMsgParts.length - 1]
  const lastMsgPartsKey = `${lastMsgParts?.length ?? 0}:${lastPart?.type ?? ""}:${(lastPart as any)?.state ?? ""}`

  const cached = tokenDataCacheByChat.get(subChatId)

  // Cache is valid if:
  // 1. Message count is the same AND
  // 2. Last message's output tokens haven't changed (detects streaming completion)
  if (
    cached &&
    ids.length === cached.totalMessageCount &&
    lastMsgOutputTokens === cached.lastMsgOutputTokens &&
    lastMsgPartsKey === cached.lastMsgPartsKey
  ) {
    return cached
  }

  // Recalculate token data (since last completed compact boundary)
  let startIndex = 0
  for (let i = 0; i < ids.length; i++) {
    const msg = get(messageAtomFamily(getPerChatMessageKey(subChatId, ids[i]!)))
    const parts = (msg as any)?.parts as Array<{ type?: string; state?: string }> | undefined
    if (
      parts?.some(
        (part) =>
          part.type === "tool-Compact" &&
          (part.state === "output-available" || part.state === "result"),
      )
    ) {
      // Include the compact result itself in the token window
      startIndex = i
    }
  }

  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let reasoningTokens = 0
  for (let i = startIndex; i < ids.length; i++) {
    const msg = get(messageAtomFamily(getPerChatMessageKey(subChatId, ids[i]!)))
    const metadata = msg?.metadata as any
    // Note: metadata has flat structure from transform.ts (metadata.inputTokens, metadata.outputTokens)
    // Extended fields like cacheReadInputTokens are not currently in MessageMetadata type
    if (metadata) {
      inputTokens += metadata.inputTokens || 0
      outputTokens += metadata.outputTokens || 0
      // These fields are not in current MessageMetadata but kept for future compatibility
      cacheReadTokens += metadata.cacheReadInputTokens || 0
      cacheWriteTokens += metadata.cacheCreationInputTokens || 0
      reasoningTokens += metadata.reasoningTokens || 0
    }
  }
  const messageCount = Math.max(0, ids.length - startIndex)

  const newTokenData: TokenData = {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
    totalTokens: inputTokens + outputTokens,
    messageCount,
    totalMessageCount: ids.length,
    lastMsgOutputTokens,
    lastMsgPartsKey,
  }

  tokenDataCacheByChat.set(subChatId, newTokenData)
  return newTokenData
})

// ============================================================================
// SYNC WITH STATUS - Main sync function
// ============================================================================
// This is called from useChat to sync messages to the store.
// Key optimization: Only updates atoms for messages that actually changed.
// ============================================================================

// Track previous message state to detect changes
// Key format: "subChatId:msgId" to isolate per chat
//
// NOTE: This is a simplified change detection optimized for streaming performance.
// It only checks the LAST part (partsLength + lastPartText + lastPartState).
// During streaming, only the last part changes, so this is sufficient and fast.
//
// Compare with messages-list.tsx which uses a more thorough check (all parts'
// textLengths[] and partStates[]) for useSyncExternalStore. That approach is
// more comprehensive but slightly slower. Both are correct for their use cases:
// - This (message-store): Jotai atom updates during high-frequency streaming
// - messages-list.tsx: External store subscription for React render triggering
const previousMessageState = new Map<string, {
  partsLength: number
  lastPartText: string | undefined
  lastPartState: string | undefined
  lastPartInputJson: string | undefined
  metadataJson: string | undefined
}>()

function hasMessageChanged(subChatId: string, msgId: string, msg: Message): boolean {
  const cacheKey = `${subChatId}:${msgId}`
  const prev = previousMessageState.get(cacheKey)
  const parts = msg.parts || []
  const lastPart = parts[parts.length - 1]

  const current = {
    partsLength: parts.length,
    lastPartText: lastPart?.text,
    lastPartState: lastPart?.state,
    lastPartInputJson: lastPart?.input ? JSON.stringify(lastPart.input) : undefined,
    // Include metadata in change detection to ensure token usage, costs, etc.
    // appear after stream completion (fixes race condition on fast streams)
    metadataJson: msg.metadata ? JSON.stringify(msg.metadata) : undefined,
  }

  if (!prev) {
    previousMessageState.set(cacheKey, current)
    return true
  }

  const changed =
    prev.partsLength !== current.partsLength ||
    prev.lastPartText !== current.lastPartText ||
    prev.lastPartState !== current.lastPartState ||
    prev.lastPartInputJson !== current.lastPartInputJson ||
    prev.metadataJson !== current.metadataJson

  if (changed) {
    previousMessageState.set(cacheKey, current)
  }

  return changed
}

// Track synced message count per subChat to enable O(1) diff-only updates.
// After the initial full sync, only the streaming message (last) changes on each tick.
// When message count changes, a full sync is triggered to pick up additions/removals.
const syncProgressByChat = new Map<string, { syncedCount: number }>()

export const syncMessagesWithStatusAtom = atom(
  null,
  (get, set, payload: { messages: Message[]; status: string; subChatId?: string; updateGlobal?: boolean }) => {
    const { messages, status, subChatId, updateGlobal = true } = payload

    const prevSubChatId = get(currentSubChatIdAtom)
    const currentSubChatId = subChatId ?? prevSubChatId

    // --- STATE PARTITIONING: Only sync view-active or stream-active chats ---
    // Background tabs have sync paused to prevent cascade updates.
    // This is a critical optimization to prevent hidden tabs from consuming CPU.
    const viewActive = get(viewActiveChatIdAtom)
    const streamingIds = get(streamingChatIdsAtom)

    // Fallback: updateGlobal indicates this is called from active chat context
    // This ensures active chats sync even when viewActiveChatIdAtom is not yet set
    const shouldSync = updateGlobal || viewActive === currentSubChatId || streamingIds.has(currentSubChatId)
    if (!shouldSync) {
      // Skip sync for background chats - their queries are paused
      // NOTE: We still return without updating atoms. The per-chat atoms will be
      // populated when the user switches to this tab (viewActive changes).
      return
    }

    let globalIdsChanged = false
    let globalRolesChanged = false
    const messageCount = messages.length

    // --- Fast path: streaming with unchanged message count ---
    // After initial sync, only the last message changes (AI SDK mutates in-place
    // during streaming). If the message count hasn't changed, skip the full loop
    // and only update the streaming tail.
    // This changes per-tick complexity from O(N) to O(1) where N = message count.
    const hasCompletedInitialSync = messageCount > 0
      && activeMessageIdsByChat.has(currentSubChatId)
    const progress = syncProgressByChat.get(currentSubChatId) ?? null
    const isAtSteadyState = hasCompletedInitialSync && progress !== null
      && progress.syncedCount === messageCount && messageCount > 0

    if (isAtSteadyState) {
      // Only the last message can change during streaming.
      const lastMsg = messages[messageCount - 1]!
      const messageKey = getPerChatMessageKey(currentSubChatId, lastMsg.id)
      const currentAtomValue = get(messageAtomFamily(messageKey))

      if (hasMessageChanged(currentSubChatId, lastMsg.id, lastMsg) || !currentAtomValue) {
        // OPTIMIZED: Only shallow-clone the message shell + parts array.
        // For the LAST part (which is the only one that changes during streaming),
        // deep-clone its mutable fields (input/output/result/error).
        // For all other parts, reuse existing references — they are stable.
        // This reduces object allocations from O(Parts) to O(1) per streaming tick.
        const parts = lastMsg.parts
        const lastPartIndex = (parts?.length ?? 0) - 1
        const clonedParts = parts?.map((part: any, i: number) => {
          if (i !== lastPartIndex) return part // Stable part — reuse reference
          // Last part changes during streaming — shallow-clone shell + mutable fields
          const { input, output, result, error, ...rest } = part
          return {
            ...rest,
            ...(input !== undefined ? { input: typeof input === 'object' && input !== null ? { ...input } : input } : {}),
            ...(output !== undefined ? { output: typeof output === 'object' && output !== null ? { ...output } : output } : {}),
            ...(result !== undefined ? { result: typeof result === 'object' && result !== null ? { ...result } : result } : {}),
            ...(error !== undefined ? { error: typeof error === 'object' && error !== null ? { ...error } : error } : {}),
          }
        })
        const clonedMsg = { ...lastMsg, parts: clonedParts }
        set(messageAtomFamily(messageKey), clonedMsg)
      }

      // CRITICAL FIX: Ensure per-chat atoms are populated even in steady-state.
      // This handles the case where sync was skipped for a hidden tab during
      // streaming → ready transition, and user returns to find empty messages.
      const perChatIds = get(messageIdsPerChatAtom(currentSubChatId))
      if (perChatIds.length === 0 && messageCount > 0) {
        // Atoms are empty but we have messages - populate them
        const newIds = messages.map((m) => m.id)
        const newRoles = new Map<string, "user" | "assistant" | "system">()
        for (const msg of messages) {
          newRoles.set(msg.id, msg.role)
        }
        set(messageIdsPerChatAtom(currentSubChatId), newIds)
        set(messageRolesPerChatAtom(currentSubChatId), newRoles)

        // Also populate individual message atoms for all messages
        for (const msg of messages) {
          const key = getPerChatMessageKey(currentSubChatId, msg.id)
          const existing = get(messageAtomFamily(key))
          if (!existing) {
            // Recovery path — only shallow-clone, the data came from AI SDK which may
            // mutate in-place, but since we're populating from scratch, a simple spread
            // is sufficient for Jotai to detect the change.
            set(messageAtomFamily(key), {
              ...msg,
              parts: msg.parts?.map((part: any) => {
                const { input, output, result, error, ...rest } = part
                return {
                  ...rest,
                  ...(input !== undefined ? { input: typeof input === 'object' && input !== null ? { ...input } : input } : {}),
                  ...(output !== undefined ? { output: typeof output === 'object' && output !== null ? { ...output } : output } : {}),
                  ...(result !== undefined ? { result: typeof result === 'object' && result !== null ? { ...result } : result } : {}),
                  ...(error !== undefined ? { error: typeof error === 'object' && error !== null ? { ...error } : error } : {}),
                }
              }),
            })
          }
        }

        // CRITICAL: Also update tracking maps so subsequent fast-path checks work correctly
        activeMessageIdsByChat.set(currentSubChatId, new Set(newIds))
        syncProgressByChat.set(currentSubChatId, { syncedCount: messageCount })
      }

      // Global streaming state
      if (updateGlobal) {
        if (status === "streaming" || status === "submitted") {
          set(streamingMessageIdAtom, lastMsg.id)
        } else {
          set(streamingMessageIdAtom, null)
        }
      }
      return
    }

    // --- Full sync path: initial load, new message added/removed, or recovery ---
    if (updateGlobal) {
      // Update current subChatId if provided AND changed
      // Avoid unnecessary set() calls - even though Jotai won't re-render for same primitive,
      // this saves the overhead of the comparison check in subscribers
      if (subChatId && subChatId !== prevSubChatId) {
        set(currentSubChatIdAtom, subChatId)
      }

      // Update status only if changed
      const prevStatus = get(chatStatusAtom)
      if (status !== prevStatus) {
        set(chatStatusAtom, status)
      }
    }

    // Build new IDs list and roles map
    const newIds = messageCount === 0 ? [] : messages.map((m) => m.id)
    const newRoles = new Map<string, "user" | "assistant" | "system">()

    for (const msg of messages) {
      newRoles.set(msg.id, msg.role)
    }

    if (updateGlobal) {
      const currentIds = get(messageIdsAtom)
      const currentRoles = get(messageRolesAtom)

      // Check if IDs changed (new message added or removed)
      globalIdsChanged =
        newIds.length !== currentIds.length ||
        newIds.some((id, i) => id !== currentIds[i])

      if (globalIdsChanged) {
        set(messageIdsAtom, newIds)
      }

      // Check if roles changed
      globalRolesChanged = newRoles.size !== currentRoles.size
      if (!globalRolesChanged) {
        for (const [id, role] of newRoles) {
          if (currentRoles.get(id) !== role) {
            globalRolesChanged = true
            break
          }
        }
      }

      if (globalRolesChanged) {
        set(messageRolesAtom, newRoles)
      }
    }

    // Always update per-subchat atoms so split panes can render independently.
    const perChatIds = get(messageIdsPerChatAtom(currentSubChatId))
    const perChatIdsChanged =
      newIds.length !== perChatIds.length ||
      newIds.some((id, i) => id !== perChatIds[i])

    if (perChatIdsChanged) {
      set(messageIdsPerChatAtom(currentSubChatId), newIds)
    }

    const perChatRoles = get(messageRolesPerChatAtom(currentSubChatId))
    let perChatRolesChanged = newRoles.size !== perChatRoles.size
    if (!perChatRolesChanged) {
      for (const [id, role] of newRoles) {
        if (perChatRoles.get(id) !== role) {
          perChatRolesChanged = true
          break
        }
      }
    }

    if (perChatRolesChanged) {
      set(messageRolesPerChatAtom(currentSubChatId), newRoles)
    }

    // Update individual message atoms ONLY if they changed
    // This is the key optimization - only changed messages trigger re-renders
    // CRITICAL: AI SDK mutates objects in-place, so we MUST create a new reference
    // for Jotai to detect the change (it uses Object.is() for comparison)
    const lastMessageId = newIds[newIds.length - 1] ?? null
    const isStreaming = status === "streaming" || status === "submitted"

    for (const msg of messages) {
      const messageKey = getPerChatMessageKey(currentSubChatId, msg.id)
      const currentAtomValue = get(messageAtomFamily(messageKey))
      const msgChanged = hasMessageChanged(currentSubChatId, msg.id, msg)
      const isLastMessage = msg.id === lastMessageId

      // CRITICAL FIX: Also update if atom is null (not yet populated)
      // Always refresh the last message because AI SDK can mutate non-last parts
      // of the current streaming assistant message without changing the last part.
      if (msgChanged || !currentAtomValue || isLastMessage) {
        // OPTIMIZED: Avoid deep-cloning all parts of all messages.
        // - For non-streaming messages (or non-last during streaming): only shallow-clone
        //   the message shell + parts array. Individual part references are stable
        //   because AI SDK only mutates the streaming (last) message.
        // - For the last/streaming message: shallow-clone each part's shell and only
        //   deep-clone mutable fields (input/output/result/error) that AI SDK mutates.
        // This reduces allocations from O(Messages × Parts) to O(Parts_of_last_msg).
        const isActivelyStreaming = isStreaming && isLastMessage
        const clonedMsg = {
          ...msg,
          parts: msg.parts?.map((part: any) => {
            if (!isActivelyStreaming && !msgChanged) return part // Unchanged non-streaming — reuse
            // Part may have changed — shallow-clone shell + mutable fields
            const { input, output, result, error, ...rest } = part
            return {
              ...rest,
              ...(input !== undefined ? { input: typeof input === 'object' && input !== null ? { ...input } : input } : {}),
              ...(output !== undefined ? { output: typeof output === 'object' && output !== null ? { ...output } : output } : {}),
              ...(result !== undefined ? { result: typeof result === 'object' && result !== null ? { ...result } : result } : {}),
              ...(error !== undefined ? { error: typeof error === 'object' && error !== null ? { ...error } : error } : {}),
            }
          }),
        }
        set(messageAtomFamily(messageKey), clonedMsg)
      }
    }

    // Cleanup removed message atoms to prevent memory leaks
    const newIdsSet = new Set(newIds)
    const previousIds = activeMessageIdsByChat.get(currentSubChatId) ?? new Set()
    for (const oldId of previousIds) {
      if (!newIdsSet.has(oldId)) {
        // Message was removed - cleanup its atom and caches
        messageAtomFamily.remove(getPerChatMessageKey(currentSubChatId, oldId))
        previousMessageState.delete(`${currentSubChatId}:${oldId}`)
        assistantIdsCacheByChat.delete(`${currentSubChatId}:${oldId}`)
        assistantIdsPerChatCache.delete(`${currentSubChatId}:${oldId}`)
        isLastMessagePerChatAtomFamily.remove(`${currentSubChatId}:${oldId}`)
        assistantIdsPerChatAtomFamily.remove(`${currentSubChatId}:${oldId}`)
        isLastUserMessagePerChatAtomFamily.remove(`${currentSubChatId}:${oldId}`)
        rollbackTargetPerChatAtomFamily.remove(`${currentSubChatId}:${oldId}`)
      }
    }

    // Update active IDs tracking and sync progress
    activeMessageIdsByChat.set(currentSubChatId, newIdsSet)
    syncProgressByChat.set(currentSubChatId, { syncedCount: messageCount })

    // Legacy global streaming state: update only for active pane.
    if (updateGlobal) {
      if (status === "streaming" || status === "submitted") {
        const lastId = newIds[newIds.length - 1] ?? null
        set(streamingMessageIdAtom, lastId)
      } else {
        set(streamingMessageIdAtom, null)
      }
    }

  }
)

// Legacy sync atom (not used, but kept for compatibility)
export const syncMessagesAtom = atom(
  null,
  (get, set, messages: Message[]) => {
    set(syncMessagesWithStatusAtom, { messages, status: get(chatStatusAtom) })
  }
)

// ============================================================================
// CLEANUP - For clearing store when switching chats
// ============================================================================

// Clear all caches for a specific subChat (call when unmounting/switching)
export function clearSubChatCaches(subChatId: string): {
  messageIds: string[]
  toolCallIds: string[]
} {
  const clearedMessageIds: string[] = []
  const clearedToolCallIds = new Set<string>()

  // Clear message atoms
  const activeIds = activeMessageIdsByChat.get(subChatId)
  if (activeIds) {
    for (const id of activeIds) {
      const messageKey = getPerChatMessageKey(subChatId, id)
      const message = appStore.get(messageAtomFamily(messageKey))
      clearedMessageIds.push(id)

      for (const part of message?.parts || []) {
        if (typeof part?.toolCallId === "string" && part.toolCallId.length > 0) {
          clearedToolCallIds.add(part.toolCallId)
        }
      }

      messageAtomFamily.remove(messageKey)
      previousMessageState.delete(`${subChatId}:${id}`)
      assistantIdsCacheByChat.delete(`${subChatId}:${id}`)
      assistantIdsPerChatCache.delete(`${subChatId}:${id}`)
      isLastMessagePerChatAtomFamily.remove(`${subChatId}:${id}`)
      assistantIdsPerChatAtomFamily.remove(`${subChatId}:${id}`)
      isLastUserMessagePerChatAtomFamily.remove(`${subChatId}:${id}`)
      rollbackTargetPerChatAtomFamily.remove(`${subChatId}:${id}`)

      messageStructureCache.delete(messageKey)
      messageStructureAtomFamily.remove(messageKey)

      const partPrefix = `${messageKey}:`
      const textPartKeysToDelete: string[] = []
      for (const key of textPartCache.keys()) {
        if (key.startsWith(partPrefix)) {
          textPartKeysToDelete.push(key)
        }
      }
      for (const key of textPartKeysToDelete) {
        textPartCache.delete(key)
        textPartAtomFamily.remove(key)
      }
    }
    activeMessageIdsByChat.delete(subChatId)
  }

  // Clean up per-chat atomFamily entries (writable primitive atoms that hold actual values)
  messageIdsPerChatAtom.remove(subChatId)
  messageRolesPerChatAtom.remove(subChatId)

  // Clean up messageId-based atomFamily entries for messages in this subChat
  if (activeIds) {
    for (const id of activeIds) {
      isLastMessageAtomFamily.remove(id)
      isMessageStreamingAtomFamily.remove(id)
    }
  }

  // Clean up user-message-specific atomFamily entries
  const userMsgIds = userMessageIdsCacheByChat.get(subChatId)
  if (userMsgIds) {
    for (const userMsgId of userMsgIds) {
      isLastUserMessageAtomFamily.remove(userMsgId)
      isFirstUserMessageAtomFamily.remove(userMsgId)
      rollbackTargetSdkUuidForUserMsgAtomFamily.remove(userMsgId)
    }
    userMessageIdsCacheByChat.delete(subChatId)
  }

  // Clean up sync progress tracking
  syncProgressByChat.delete(subChatId)

  // Clear other caches
  userMessageIdsPerChatCache.delete(subChatId)
  messageGroupsCacheByChat.delete(subChatId)
  messageGroupsPerChatCache.delete(subChatId)
  lastAssistantCacheByChat.delete(subChatId)
  tokenDataCacheByChat.delete(subChatId)

  // CRITICAL: Clear atomFamily entries from atoms/index.ts to prevent memory leaks
  clearSubChatAtoms(subChatId)

  return {
    messageIds: clearedMessageIds,
    toolCallIds: Array.from(clearedToolCallIds),
  }
}

// Clear all caches (call on app reset/logout)
export function clearAllCaches() {
  for (const subChatId of activeMessageIdsByChat.keys()) {
    clearSubChatCaches(subChatId)
  }

  // Clear remaining module-level Maps that may have orphaned entries
  previousMessageState.clear()
  lastAccessTimeByChat.clear()
  assistantIdsCacheByChat.clear()
  assistantIdsPerChatCache.clear()
  userMessageIdsCacheByChat.clear()
  userMessageIdsPerChatCache.clear()
  messageGroupsCacheByChat.clear()
  messageGroupsPerChatCache.clear()
  lastAssistantCacheByChat.clear()
  tokenDataCacheByChat.clear()

  const remainingStructureIds = Array.from(messageStructureCache.keys())
  for (const messageId of remainingStructureIds) {
    messageStructureAtomFamily.remove(messageId)
  }
  messageStructureCache.clear()

  const remainingTextPartKeys = Array.from(textPartCache.keys())
  for (const key of remainingTextPartKeys) {
    textPartAtomFamily.remove(key)
  }
  textPartCache.clear()
}

// ============================================================================
// TTS PLAYBACK RATE - For PlayButton
// ============================================================================
// Stored in localStorage and accessible via Jotai atom.
// This allows PlayButton to manage its own state without passing callbacks
// through props (which would break memoization).

export const PLAYBACK_SPEEDS = [1, 2, 3] as const
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number]

// Atom with localStorage persistence
export const ttsPlaybackRateAtom = atom<PlaybackSpeed>(
  // Initial value from localStorage
  (() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("tts-playback-rate")
      if (saved && PLAYBACK_SPEEDS.includes(Number(saved) as PlaybackSpeed)) {
        return Number(saved) as PlaybackSpeed
      }
    }
    return 1
  })()
)

// Write atom that also persists to localStorage
export const setTtsPlaybackRateAtom = atom(
  null,
  (_get, set, rate: PlaybackSpeed) => {
    set(ttsPlaybackRateAtom, rate)
    if (typeof window !== "undefined") {
      localStorage.setItem("tts-playback-rate", String(rate))
    }
  }
)
