import { useEffect } from "react"
import { useSetAtom } from "jotai"
import {
  addStreamingChatAtom,
  removeStreamingChatAtom,
} from "../../../lib/atoms"
import {
  setStreamingAtomSync,
  useStreamingStatusStore,
} from "../stores/streaming-status-store"

/**
 * Hook to initialize the Zustand-to-Jotai sync bridge for streaming status.
 *
 * Call this at the app root level (App.tsx) to ensure streaming state
 * changes in Zustand are synced to Jotai atoms efficiently.
 *
 * This enables state partitioning where streaming chats remain active
 * even when not being viewed, preventing React from re-rendering them
 * during message sync for other chats.
 *
 * ARCHITECTURE:
 * - Zustand store (streaming-status-store) manages streaming status per subChatId
 * - Jotai atoms (streamingChatIdsAtom) track the set of currently streaming chats
 * - This hook registers a callback that Zustand calls directly on state changes
 * - This is more efficient than a useEffect that iterates ALL statuses on every change
 */
export function useStreamingAtomSync() {
  const addStreaming = useSetAtom(addStreamingChatAtom)
  const removeStreaming = useSetAtom(removeStreamingChatAtom)

  useEffect(() => {
    // Register sync callback with Zustand store
    // This callback is called directly from setStatus on state changes
    setStreamingAtomSync((chatId, isStreaming) => {
      if (isStreaming) {
        addStreaming(chatId)
      } else {
        removeStreaming(chatId)
      }
    })

    // Initial sync: Populate Jotai atom with existing streaming chats
    // This handles the case where chats were streaming before this hook mounted
    const statuses = useStreamingStatusStore.getState().statuses
    for (const [subChatId, status] of Object.entries(statuses)) {
      const isStreaming = status === "streaming" || status === "submitted"
      if (isStreaming) {
        addStreaming(subChatId)
      } else {
        removeStreaming(subChatId)
      }
    }

    // Cleanup: Unregister callback on unmount
    return () => {
      setStreamingAtomSync(null)
    }
  }, [addStreaming, removeStreaming])
}