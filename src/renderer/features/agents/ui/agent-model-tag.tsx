"use client"

import { memo } from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../../../components/ui/hover-card"
import { cn } from "../../../lib/utils"

interface AgentModelTagProps {
  modelId?: string
  modelProvider?: string
  modelProfileName?: string
  isStreaming?: boolean
}

// Map of known model IDs to short display names
const MODEL_SHORT_NAMES: Record<string, string> = {
  // Anthropic Claude models
  "claude-3-7-sonnet": "sonnet",
  "claude-3-7-opus": "opus",
  "claude-3-7-haiku": "haiku",
  "claude-sonnet-4-20250514": "sonnet-4",
  "claude-opus-4-5-20251101": "opus-4",
  "claude-opus-4-20250514": "opus-4",
  "claude-3-5-sonnet": "sonnet-3.5",
  "claude-3-5-haiku": "haiku-3.5",
  "claude-3-opus-20240229": "opus-3",
  "claude-3-sonnet-20240229": "sonnet-3",
  "claude-3-haiku-20240307": "haiku-3",
  // OpenAI models
  "gpt-4": "gpt-4",
  "gpt-4o": "gpt-4o",
  "gpt-4-turbo": "gpt-4-turbo",
  "gpt-3.5-turbo": "gpt-3.5",
  "o1": "o1",
  "o1-preview": "o1-preview",
  "o1-mini": "o1-mini",
  // Other common models
  "glm-5": "glm-5",
  "glm-4": "glm-4",
  "kimi-k2.5": "kimi",
  "deepseek-chat": "deepseek",
  "deepseek-coder": "deepseek-coder",
  "llama-3.1-70b": "llama-3.1",
  "llama-3.2-90b": "llama-3.2",
  "qwen-2.5-72b": "qwen",
  "mistral-large": "mistral",
}

// Extract a short display name from model ID
// Shows the full model name, with smart shortening for known patterns
function getShortModelName(modelId: string | undefined): string {
  if (!modelId) return "model"

  // Check exact match first for known models
  if (MODEL_SHORT_NAMES[modelId]) {
    return MODEL_SHORT_NAMES[modelId]
  }

  // For unknown models, return the full ID
  // This ensures custom models like "kimi-k2.5" show their full name
  return modelId
}

// Get provider display name
function getProviderDisplayName(provider: string | undefined): string {
  switch (provider) {
    case "anthropic":
      return "Anthropic"
    case "openai":
      return "OpenAI"
    case "ollama":
      return "Ollama"
    case "custom":
      return "Custom API"
    default:
      return provider || "Unknown"
  }
}

export const AgentModelTag = memo(function AgentModelTag({
  modelId,
  modelProvider,
  modelProfileName,
  isStreaming = false,
}: AgentModelTagProps) {
  // Don't show during streaming
  if (isStreaming) return null

  // Need at least modelId to show something
  if (!modelId && !modelProfileName) return null

  const modelDisplayName = getShortModelName(modelId)
  const providerName = getProviderDisplayName(modelProvider)

  // Button shows only model name, profile name is shown in hover modal

  return (
    <HoverCard openDelay={400} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          tabIndex={-1}
          className={cn(
            "h-5 px-1.5 flex items-center text-[10px] rounded-md",
            "text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50",
            "transition-[background-color,transform] duration-150 ease-out",
          )}
        >
          <span className="font-mono truncate max-w-[140px]">{modelDisplayName}</span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        sideOffset={4}
        align="end"
        className="w-auto p-2 shadow-sm rounded-lg border-border/50"
      >
        <div className="space-y-1">
          <div className="flex justify-between text-xs gap-4">
            <span className="text-muted-foreground">Model:</span>
            <span className="font-mono text-foreground truncate max-w-[200px]" title={modelId}>
              {modelId || "unknown"}
            </span>
          </div>
          {modelProvider && (
            <div className="flex justify-between text-xs gap-4">
              <span className="text-muted-foreground">Provider:</span>
              <span className="font-mono text-foreground">{providerName}</span>
            </div>
          )}
          {modelProvider === "custom" && modelProfileName && (
            <div className="flex justify-between text-xs gap-4">
              <span className="text-muted-foreground">Profile:</span>
              <span className="font-mono text-foreground">{modelProfileName}</span>
            </div>
          )}
        </div>
      </HoverCardContent>
    </HoverCard>
  )
})