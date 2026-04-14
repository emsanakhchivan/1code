import { create } from "zustand"
import { subscribeWithSelector } from "zustand/middleware"

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

// ============================================================================
// ZUSTAND-TO-JOTAI SYNC BRIDGE
// ============================================================================
// This callback-based bridge allows Zustand store changes to sync directly
// to Jotai atoms without requiring React hooks or iterating all statuses.
// The hook useStreamingAtomSync registers this callback at app initialization.

let streamingAtomSync: ((chatId: string, isStreaming: boolean) => void) | null = null

/**
 * Register a callback to sync streaming state changes to Jotai atoms.
 * Called by useStreamingAtomSync hook at app initialization.
 */
export const setStreamingAtomSync = (
  syncFn: ((chatId: string, isStreaming: boolean) => void) | null
) => {
  streamingAtomSync = syncFn
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

      // Direct sync to Jotai atom via callback - only on state change
      if (streamingAtomSync && wasStreaming !== nowStreaming) {
        streamingAtomSync(subChatId, nowStreaming)
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
