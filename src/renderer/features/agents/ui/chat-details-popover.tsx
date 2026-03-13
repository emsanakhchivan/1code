"use client"

import { memo, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, motion } from "motion/react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"

interface ChatDetailsPopoverProps {
  subChatId: string
  chatId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  anchorElement: HTMLElement | null
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(1)}M`
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`
  }
  return tokens.toString()
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`
  }
  const seconds = ms / 1000
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`
  }
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = Math.round(seconds % 60)
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  return `${hours}h ${remainingMinutes}m`
}

export const ChatDetailsPopover = memo(function ChatDetailsPopover({
  subChatId,
  chatId,
  open,
  onOpenChange,
  anchorElement,
}: ChatDetailsPopoverProps) {
  console.log("[ChatDetailsPopover] Render:", { subChatId, chatId, open, hasAnchor: !!anchorElement })

  const { data: stats, isLoading, error } = trpc.chats.getChatStats.useQuery(
    { chatId, subChatId },
    { enabled: open }
  )

  console.log("[ChatDetailsPopover] Query result:", { stats, isLoading, error })

  if (stats) {
    console.log("[ChatDetailsPopover] Stats details:", JSON.stringify(stats, null, 2))
    console.log("[ChatDetailsPopover] Token values:", {
      totalInputTokens: stats.totalInputTokens,
      totalOutputTokens: stats.totalOutputTokens,
      hasInputTokens: stats.totalInputTokens > 0,
      hasOutputTokens: stats.totalOutputTokens > 0,
    })
  }

  const [position, setPosition] = useState({ top: 0, left: 0 })
  const popoverRef = useRef<HTMLDivElement>(null)

  // Calculate position when open or anchor changes
  useEffect(() => {
    if (open && anchorElement) {
      const rect = anchorElement.getBoundingClientRect()
      // Position to the right of the element, vertically centered
      setPosition({
        top: rect.top + rect.height / 2,
        left: rect.right + 8,
      })
    }
  }, [open, anchorElement])

  // Close when clicking outside
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleEscape)
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [open, onOpenChange])

  // Close when anchor element is removed from DOM
  useEffect(() => {
    if (!open) return

    const observer = new MutationObserver(() => {
      if (!document.contains(anchorElement)) {
        onOpenChange(false)
      }
    })

    if (anchorElement) {
      observer.observe(document.body, { childList: true, subtree: true })
    }

    return () => observer.disconnect()
  }, [open, anchorElement, onOpenChange])

  if (!open || !anchorElement) return null

  const content = (
    <div
      ref={popoverRef}
      className="fixed z-[100000] min-w-56 max-w-64 bg-popover border border-border rounded-lg shadow-lg p-3"
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
        transform: "translateY(-50%)",
      }}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-4">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground" />
        </div>
      ) : stats ? (
        <div className="space-y-3">
          {/* Messages section */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Messages
            </div>
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Total</span>
                <span className="font-mono font-medium">{stats.messageCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">User</span>
                <span className="font-mono">{stats.userMessageCount}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Assistant</span>
                <span className="font-mono">{stats.assistantMessageCount}</span>
              </div>
            </div>
          </div>

          {/* Tokens section */}
          {(stats.totalInputTokens > 0 || stats.totalOutputTokens > 0) && (
            <div className="space-y-2 pt-2 border-t border-border/50">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Tokens
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Input</span>
                  <span className="font-mono">{formatTokens(stats.totalInputTokens)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Output</span>
                  <span className="font-mono">{formatTokens(stats.totalOutputTokens)}</span>
                </div>
                <div className="flex justify-between text-xs font-medium pt-1 border-t border-border/30">
                  <span className="text-foreground">Total</span>
                  <span className="font-mono text-foreground">
                    {formatTokens(stats.totalInputTokens + stats.totalOutputTokens)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Tool calls section */}
          {stats.toolCalls > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/50">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Tool calls</span>
                <span className="font-mono">{stats.toolCalls}</span>
              </div>
            </div>
          )}

          {/* Duration section - Total worked time */}
          {stats.totalDurationMs > 0 && (
            <div className="space-y-1 pt-2 border-t border-border/50">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Work time</span>
                <span className="font-mono">{formatDuration(stats.totalDurationMs)}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-xs text-muted-foreground text-center py-4">
          No data available
        </div>
      )}
    </div>
  )

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.15 }}
        >
          {content}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  )
})