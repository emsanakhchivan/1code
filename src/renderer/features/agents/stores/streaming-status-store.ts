import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"
import { useEffect } from "react"
import { useAtom } from "jotai"
import {
  streamingChatIdsAtom,
  addStreamingChatAtom,
  removeStreamingChatAtom,
} from "../../../lib/atoms"

export type StreamingStatus = "ready" | "streaming" | "submitted" | "error"

interface StreamingStatusState {
  // Map: subChatId -> streaming status
  statuses: Record<string, StreamingStatus>

  // Actions
  setStatus: (subChatId: string, status: StreamingStatus) => void
  getStatus: (subChatId: string) => StreamingStatus
  isStreaming: (subChatId: string) => boolean
  clearStatus: (subChatId: string) => void

  // Get all sub-chats that are ready (not streaming)
  getReadySubChats: () => string[]
}

export const useStreamingStatusStore = create<StreamingStatusState>()(
  subscribeWithSelector((set, get) => ({
    statuses: {},

    setStatus: (subChatId, status) => {
      const prevStatus = get().statuses[subChatId]
      const wasStreaming =
        prevStatus === "streaming" || prevStatus === "submitted"
      const nowStreaming = status === "streaming" || status === "submitted"

      set((state) => ({
        statuses: {
          ...state.statuses,
          [subChatId]: status,
        },
      }))

      // Sync documentation: streaming state changes
      if (!wasStreaming && nowStreaming) {
        // Chat started streaming - will be synced to stream-active atom via useSyncStreamingToAtom
      }
      if (wasStreaming && !nowStreaming) {
        // Chat stopped streaming - will be removed from stream-active atom
      }
    },

    getStatus: (subChatId) => {
      return get().statuses[subChatId] ?? "ready"
    },

    isStreaming: (subChatId) => {
      const status = get().statuses[subChatId] ?? "ready"
      return status === "streaming" || status === "submitted"
    },

    clearStatus: (subChatId) => {
      set((state) => {
        const newStatuses = { ...state.statuses }
        delete newStatuses[subChatId]
        return { statuses: newStatuses }
      })
    },

    getReadySubChats: () => {
      const { statuses } = get()
      return Object.entries(statuses)
        .filter(([_, status]) => status === "ready")
        .map(([subChatId]) => subChatId)
    },
  }))
)

/**
 * Hook to sync Zustand streaming status store with Jotai atoms.
 * Call this at the app root level to keep the stream-active set in sync.
 *
 * This enables state partitioning where streaming chats remain active
 * even when not being viewed, preventing React from re-rendering them
 * during message sync for other chats.
 */
export const useSyncStreamingToAtom = () => {
  const [, setAddStreaming] = useAtom(addStreamingChatAtom)
  const [, setRemoveStreaming] = useAtom(removeStreamingChatAtom)
  const statuses = useStreamingStatusStore((state) => state.statuses)

  useEffect(() => {
    // Sync current streaming status to atom
    for (const [subChatId, status] of Object.entries(statuses)) {
      const isStreaming =
        status === "streaming" || status === "submitted"
      if (isStreaming) {
        setAddStreaming(subChatId)
      } else {
        setRemoveStreaming(subChatId)
      }
    }
  }, [statuses, setAddStreaming, setRemoveStreaming])
}
