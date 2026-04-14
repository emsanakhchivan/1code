"use client"

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useEffect,
  useCallback,
  useTransition,
  type ReactNode,
} from "react"
import { Chat, useChat } from "@ai-sdk/react"
import { useSetAtom } from "jotai"
import { syncMessagesWithStatusAtom } from "../stores/message-store"
import { getChunkQueue, clearChunkQueue, type Chunk } from "../../workers/chunk-queue"
import { useMessageParserWorker, type ParseResult } from "../../hooks/useMessageParserWorker"

// ============================================================================
// BATCHED MESSAGE SYNC
// ============================================================================
// Buffer for accumulating parsed messages before flushing to Jotai store.
// This reduces main thread work by:
// 1. Parsing chunks in a web worker (off main thread)
// 2. Buffering parsed results for 100ms before updating Jotai atoms
// 3. Using startTransition for non-blocking updates
// ============================================================================
//
// Two buffer strategies:
// 1. useBatchedMessageSync: For raw chunk handling via worker pipeline
// 2. useBatchedJotaiSync: For buffering useChat messages before Jotai sync
// ============================================================================

// Module-level buffer for parsed messages per chat (worker pipeline)
const messageBuffer = new Map<string, unknown[]>()
// Module-level buffer for useChat messages per chat (Jotai sync)
const jotaiSyncBuffer = new Map<string, { messages: any[]; status: string }>()
const BUFFER_FLUSH_INTERVAL = 100 // ms

/**
 * Hook for batched message synchronization with worker-based parsing.
 *
 * This hook provides:
 * - Chunk queue with backpressure handling
 * - Web worker-based JSON parsing (off main thread)
 * - Buffered state updates with 100ms flush interval
 * - Non-blocking updates using startTransition
 *
 * @param chatId - The chat ID to sync messages for
 * @returns handleChunk function to process incoming raw chunks
 *
 * @example
 * ```tsx
 * const { handleChunk } = useBatchedMessageSync(chatId);
 *
 * // Process streaming chunks
 * stream.on('data', (chunk) => handleChunk(chunk.toString()));
 * ```
 */
export function useBatchedMessageSync(chatId: string) {
  const [, startTransition] = useTransition()

  // Worker callback ref for stable closure
  const onWorkerResult = useCallback((result: ParseResult) => {
    if (!result.error) {
      // Buffer parsed messages
      const buffer = messageBuffer.get(result.chatId) || []
      buffer.push(...result.parsed)
      messageBuffer.set(result.chatId, buffer)
    }
  }, [])

  const { parseChunks } = useMessageParserWorker(onWorkerResult)

  // Flush buffer periodically using startTransition for non-blocking updates
  // TODO: Wire flush to Jotai atoms once raw chunk pipeline is integrated
  // (currently useChat handles streaming internally, so raw chunks aren't available)
  useEffect(() => {
    const flushInterval = setInterval(() => {
      const buffer = messageBuffer.get(chatId)
      if (buffer && buffer.length > 0) {
        startTransition(() => {
          // Placeholder: will write buffered parsed messages to Jotai atoms
          // when raw chunk streaming is integrated outside useChat
          messageBuffer.set(chatId, [])
        })
      }
    }, BUFFER_FLUSH_INTERVAL)

    return () => clearInterval(flushInterval)
  }, [chatId, startTransition])

  // Cleanup chunk queue on unmount
  useEffect(() => {
    return () => {
      clearChunkQueue(chatId)
      messageBuffer.delete(chatId)
    }
  }, [chatId])

  // Process incoming chunks through queue + worker
  const handleChunk = useCallback(
    (rawChunk: string) => {
      const queue = getChunkQueue(chatId)
      const success = queue.push({
        chatId,
        raw: rawChunk,
        timestamp: Date.now(),
      })

      if (!success) {
        // Queue full - backpressure, need to handle
        console.warn("Chunk queue full for", chatId)
      }

      // Send batch to worker when queue has enough chunks
      if (queue.size() >= 5) {
        const batch = queue.popBatch(5)
        parseChunks({
          chunks: batch.map((c: Chunk) => ({ chatId: c.chatId, raw: c.raw })),
          chatId,
        })
      }
    },
    [chatId, parseChunks]
  )

  // Flush remaining chunks on demand
  const flushRemaining = useCallback(() => {
    const queue = getChunkQueue(chatId)
    if (queue.size() > 0) {
      const batch = queue.popBatch(queue.size())
      parseChunks({
        chunks: batch.map((c: Chunk) => ({ chatId: c.chatId, raw: c.raw })),
        chatId,
      })
    }
  }, [chatId, parseChunks])

  return { handleChunk, flushRemaining }
}

/**
 * Hook for batched Jotai sync from useChat messages.
 *
 * This hook buffers messages from useChat and flushes them to Jotai
 * every 100ms using startTransition, reducing the number of atom updates
 * during high-frequency streaming.
 *
 * @param chatId - The chat ID to sync messages for
 * @returns bufferMessages function to add messages to buffer
 */
export function useBatchedJotaiSync(chatId: string) {
  const [, startTransition] = useTransition()
  const syncMessages = useSetAtom(syncMessagesWithStatusAtom)

  // Buffer messages from useChat
  const bufferMessages = useCallback(
    (messages: any[], status: string) => {
      // Store in buffer - will be flushed periodically
      jotaiSyncBuffer.set(chatId, { messages, status })
    },
    [chatId]
  )

  // Flush buffer to Jotai every 100ms using startTransition
  useEffect(() => {
    const flushInterval = setInterval(() => {
      const buffer = jotaiSyncBuffer.get(chatId)
      if (buffer && buffer.messages.length > 0) {
        startTransition(() => {
          // Sync buffered messages to Jotai
          syncMessages({
            messages: buffer.messages,
            status: buffer.status,
            subChatId: chatId,
            updateGlobal: true,
          })
        })
      }
    }, BUFFER_FLUSH_INTERVAL)

    return () => clearInterval(flushInterval)
  }, [chatId, syncMessages, startTransition])

  // Cleanup buffer on unmount
  useEffect(() => {
    return () => {
      jotaiSyncBuffer.delete(chatId)
    }
  }, [chatId])

  // Force flush on status change (e.g., streaming -> ready)
  // Deliberately NOT using startTransition here: when streaming ends,
  // the final state must be synchronously committed to avoid displaying
  // stale/incomplete messages to the user.
  const forceFlush = useCallback(() => {
    const buffer = jotaiSyncBuffer.get(chatId)
    if (buffer) {
      syncMessages({
        messages: buffer.messages,
        status: buffer.status,
        subChatId: chatId,
        updateGlobal: true,
      })
      jotaiSyncBuffer.delete(chatId)
    }
  }, [chatId, syncMessages])

  return { bufferMessages, forceFlush }
}

// ============================================================================
// CHAT DATA SYNC (LAYER 1)
// ============================================================================
// This component's ONLY job is to:
// 1. Call useChat() to get messages and status
// 2. Sync them to Jotai store
// 3. Provide chat actions (sendMessage, stop, regenerate) via context
//
// It WILL re-render on every streaming chunk (330+ times), but:
// - It does NO expensive computations
// - It renders ONLY children (which are memoized)
// - All message rendering is done by isolated components that subscribe to atoms
// ============================================================================

// Context for chat actions (sendMessage, stop, regenerate)
interface ChatActionsContextValue {
  sendMessage: ReturnType<typeof useChat>["sendMessage"]
  stop: ReturnType<typeof useChat>["stop"]
  regenerate: ReturnType<typeof useChat>["regenerate"]
  status: string
}

const ChatActionsContext = createContext<ChatActionsContextValue | null>(null)

export function useChatActions() {
  const context = useContext(ChatActionsContext)
  if (!context) {
    throw new Error("useChatActions must be used within ChatDataSync")
  }
  return context
}

// Props
interface ChatDataSyncProps {
  chat: Chat<any>
  subChatId: string
  streamId?: string | null
  children: ReactNode
}

export function ChatDataSync({
  chat,
  subChatId,
  streamId,
  children,
}: ChatDataSyncProps) {
  // Call useChat - this causes re-renders on every chunk
  const { messages, sendMessage, status, stop, regenerate } = useChat({
    id: subChatId,
    chat,
    resume: !!streamId,
    experimental_throttle: 50,
  })

  // Use batched Jotai sync for reduced atom updates during streaming
  const { bufferMessages, forceFlush } = useBatchedJotaiSync(subChatId)

  // Track previous status to detect streaming completion
  const prevStatusRef = useRef(status)

  // Buffer messages instead of immediate sync - reduces Jotai updates
  // from every render (330+) to every 100ms (~10 during a 1s stream)
  useLayoutEffect(() => {
    bufferMessages(messages, status)

    // Force flush when streaming ends to ensure final state is captured
    // This handles the case where the buffer hasn't flushed yet but
    // we need the final messages visible immediately
    const prevStatus = prevStatusRef.current
    prevStatusRef.current = status

    if (
      (prevStatus === "streaming" || prevStatus === "submitted") &&
      status !== "streaming" &&
      status !== "submitted"
    ) {
      // Streaming ended - force immediate flush
      forceFlush()
    }
  }, [messages, status, subChatId, bufferMessages, forceFlush])

  // Stable refs for actions to prevent context recreation
  const actionsRef = useRef<ChatActionsContextValue>({
    sendMessage,
    stop,
    regenerate,
    status,
  })

  // Update refs (no re-render triggered)
  actionsRef.current.sendMessage = sendMessage
  actionsRef.current.stop = stop
  actionsRef.current.regenerate = regenerate
  actionsRef.current.status = status

  // Memoized context value - only recreate when status changes
  // (actions are accessed via ref, so they're always current)
  const contextValue = useRef<ChatActionsContextValue>({
    get sendMessage() {
      return actionsRef.current.sendMessage
    },
    get stop() {
      return actionsRef.current.stop
    },
    get regenerate() {
      return actionsRef.current.regenerate
    },
    get status() {
      return actionsRef.current.status
    },
  }).current

  return (
    <ChatActionsContext.Provider value={contextValue}>
      {children}
    </ChatActionsContext.Provider>
  )
}
