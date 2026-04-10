"use client"

import { memo, useCallback, useEffect, useMemo, useRef } from "react"
import { useAtomValue } from "jotai"
import { useVirtualizer } from "@tanstack/react-virtual"
import { userMessageIdsPerChatAtom } from "../stores/message-store"
import { IsolatedMessageGroup } from "./isolated-message-group"

// ============================================================================
// VIRTUALIZED MESSAGES SECTION
// ============================================================================
// Replaces IsolatedMessagesSection with virtualized rendering.
// Only renders message groups that are visible in the viewport (+ overscan).
// This reduces DOM nodes from O(N) to O(visible) where N = total messages.
//
// Key design decisions:
// - Uses @tanstack/react-virtual for virtualization
// - Variable-height rows measured dynamically via ResizeObserver
// - Keeps normal document flow (NOT position:absolute) so CSS sticky works
// - Invisible groups render as empty spacer divs with measured heights
// - The last group is ALWAYS rendered (for streaming updates)
// - Overscan of 3 items above/below for smooth scrolling
// ============================================================================

interface VirtualizedMessagesSectionProps {
  subChatId: string
  chatId: string
  isMobile: boolean
  sandboxSetupStatus: "cloning" | "ready" | "error"
  stickyTopClass: string
  sandboxSetupError?: string
  onRetrySetup?: () => void
  onRollback?: (msg: any) => void
  onFork?: (messageId: string) => void
  // Scroll container ref - the parent overflow-y-auto element
  scrollContainerRef: React.RefObject<HTMLElement | null>
  // Components passed from parent - must be stable references
  UserBubbleComponent: React.ComponentType<{
    messageId: string
    textContent: string
    imageParts: any[]
    skipTextMentionBlocks?: boolean
  }>
  ToolCallComponent: React.ComponentType<{
    icon: any
    title: string
    isPending: boolean
    isError: boolean
  }>
  MessageGroupWrapper: React.ComponentType<{ children: React.ReactNode; isLastGroup?: boolean }>
  toolRegistry: Record<string, { icon: any; title: (args: any) => string }>
}

function arePropsEqual(
  prev: VirtualizedMessagesSectionProps,
  next: VirtualizedMessagesSectionProps
): boolean {
  return (
    prev.subChatId === next.subChatId &&
    prev.chatId === next.chatId &&
    prev.isMobile === next.isMobile &&
    prev.sandboxSetupStatus === next.sandboxSetupStatus &&
    prev.stickyTopClass === next.stickyTopClass &&
    prev.sandboxSetupError === next.sandboxSetupError &&
    prev.onRetrySetup === next.onRetrySetup &&
    prev.onRollback === next.onRollback &&
    prev.onFork === next.onFork &&
    prev.scrollContainerRef === next.scrollContainerRef &&
    prev.UserBubbleComponent === next.UserBubbleComponent &&
    prev.ToolCallComponent === next.ToolCallComponent &&
    prev.MessageGroupWrapper === next.MessageGroupWrapper &&
    prev.toolRegistry === next.toolRegistry
  )
}

// Cache measured heights per (subChatId, userMsgId) to survive re-renders
// and provide accurate estimates when items scroll out of view
const measuredHeightCache = new Map<string, number>()

export const VirtualizedMessagesSection = memo(function VirtualizedMessagesSection({
  subChatId,
  chatId,
  isMobile,
  sandboxSetupStatus,
  stickyTopClass,
  sandboxSetupError,
  onRetrySetup,
  onRollback,
  onFork,
  scrollContainerRef,
  UserBubbleComponent,
  ToolCallComponent,
  MessageGroupWrapper,
  toolRegistry,
}: VirtualizedMessagesSectionProps) {
  // Per-subchat selector - split panes render fully independently.
  const userMsgIds = useAtomValue(userMessageIdsPerChatAtom(subChatId))

  // Build cache key for each item
  const getCacheKey = useCallback(
    (index: number) => `${subChatId}:${userMsgIds[index]}`,
    [subChatId, userMsgIds]
  )

  // Estimate size using measured cache, falling back to a default
  const estimateSize = useCallback(
    (index: number) => {
      const key = getCacheKey(index)
      const cached = measuredHeightCache.get(key)
      if (cached) return cached
      // Default estimate: user bubble ~60px + assistant content ~150px
      return 200
    },
    [getCacheKey]
  )

  const virtualizer = useVirtualizer({
    count: userMsgIds.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize,
    overscan: 5,
    // Measure actual sizes for accurate virtualization
    measureElement: (el) => {
      const indexAttr = el.getAttribute("data-index")
      if (indexAttr !== null) {
        const index = parseInt(indexAttr, 10)
        const height = el.getBoundingClientRect().height
        if (height > 0) {
          const key = getCacheKey(index)
          measuredHeightCache.set(key, height)
        }
      }
      return el.getBoundingClientRect().height
    },
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Cleanup cache entries for this subChat when it changes
  useEffect(() => {
    return () => {
      // Don't clear cache on unmount - heights are stable across re-renders
      // Only clear when subChatId changes (handled by key prop on parent)
    }
  }, [subChatId])

  // Always render the last group (for streaming updates)
  const lastUserMsgId = userMsgIds[userMsgIds.length - 1]

  // Determine which indices are visible (including the last one for streaming)
  const visibleIndices = useMemo(() => {
    const indices = new Set(virtualItems.map((item) => item.index))
    // Always include last item for streaming
    if (lastUserMsgId && userMsgIds.length > 0) {
      indices.add(userMsgIds.length - 1)
    }
    return indices
  }, [virtualItems, lastUserMsgId, userMsgIds.length])

  // We render ALL items, but invisible ones are lightweight spacer divs
  // This preserves document flow for CSS sticky and scroll position accuracy
  // while avoiding heavy rendering (markdown, tools, syntax highlighting)
  // for off-screen items.
  return (
    <>
      {userMsgIds.map((userMsgId, index) => {
        const isVisible = visibleIndices.has(index)
        const isLast = userMsgId === lastUserMsgId

        if (isVisible) {
          return (
            <div
              key={userMsgId}
              data-index={index}
              ref={virtualizer.measureElement}
            >
              <IsolatedMessageGroup
                userMsgId={userMsgId}
                subChatId={subChatId}
                chatId={chatId}
                isMobile={isMobile}
                sandboxSetupStatus={sandboxSetupStatus}
                stickyTopClass={stickyTopClass}
                sandboxSetupError={sandboxSetupError}
                onRetrySetup={onRetrySetup}
                onRollback={onRollback}
                onFork={onFork}
                UserBubbleComponent={UserBubbleComponent}
                ToolCallComponent={ToolCallComponent}
                MessageGroupWrapper={MessageGroupWrapper}
                toolRegistry={toolRegistry}
              />
            </div>
          )
        }

        // Off-screen item: lightweight spacer with estimated height
        // This keeps scroll position accurate without rendering heavy content
        const cachedHeight = measuredHeightCache.get(getCacheKey(index))
        const height = cachedHeight || estimateSize(index)

        return (
          <div
            key={userMsgId}
            data-index={index}
            style={{ height }}
            aria-hidden="true"
          />
        )
      })}
    </>
  )
}, arePropsEqual)

// Clear measured heights cache for a specific subChat (call on unmount/cleanup)
export function clearVirtualizedCache(subChatId: string) {
  for (const key of measuredHeightCache.keys()) {
    if (key.startsWith(`${subChatId}:`)) {
      measuredHeightCache.delete(key)
    }
  }
}
