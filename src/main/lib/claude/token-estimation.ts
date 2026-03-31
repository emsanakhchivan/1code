/**
 * Token estimation utilities for context window tracking
 * Based on SDK patterns from @anthropic-ai/claude-code
 */

/**
 * Rough estimation of token count from string content.
 * Uses ~4 characters per token as approximation.
 */
export function roughTokenCountEstimation(
  content: string,
  bytesPerToken: number = 4
): number {
  if (!content) return 0
  return Math.round(content.length / bytesPerToken)
}

/**
 * Returns an estimated bytes-per-token ratio for a given file extension.
 * Dense JSON has many single-character tokens (`{`, `}`, `:`, `,`, `"`)
 * which makes the real ratio closer to 2 rather than the default 4.
 */
export function bytesPerTokenForFileType(fileExtension: string): number {
  switch (fileExtension) {
    case "json":
    case "jsonl":
    case "jsonc":
      return 2
    default:
      return 4
  }
}

/**
 * Estimate tokens for a content block
 */
function roughTokenCountEstimationForBlock(block: any): number {
  if (typeof block === "string") {
    return roughTokenCountEstimation(block)
  }

  if (!block || typeof block !== "object") {
    return 0
  }

  if (block.type === "text") {
    return roughTokenCountEstimation(block.text || "")
  }

  if (block.type === "image" || block.type === "document") {
    // Images and documents use ~2000 tokens as conservative estimate
    return 2000
  }

  if (block.type === "tool_result") {
    // Recursively estimate tool result content
    if (typeof block.content === "string") {
      return roughTokenCountEstimation(block.content)
    }
    if (Array.isArray(block.content)) {
      return block.content.reduce(
        (sum: number, c: any) => sum + roughTokenCountEstimationForBlock(c),
        0
      )
    }
    return 0
  }

  if (block.type === "tool_use") {
    // Tool use includes name + JSON input
    const nameTokens = roughTokenCountEstimation(block.name || "")
    let inputTokens = 0
    try {
      inputTokens = roughTokenCountEstimation(
        JSON.stringify(block.input || {})
      )
    } catch {
      // If stringify fails, use empty
    }
    return nameTokens + inputTokens
  }

  if (block.type === "thinking") {
    return roughTokenCountEstimation(block.thinking || "")
  }

  if (block.type === "redacted_thinking") {
    return roughTokenCountEstimation(block.data || "")
  }

  // For other block types, try to stringify
  try {
    return roughTokenCountEstimation(JSON.stringify(block))
  } catch {
    return 0
  }
}

/**
 * Estimate token count for a single message
 */
export function roughTokenCountEstimationForMessage(message: {
  type: string
  message?: { content?: unknown }
  parts?: any[]
}): number {
  // Handle AI SDK message format (with parts array)
  if (message.parts && Array.isArray(message.parts)) {
    let total = 0
    for (const part of message.parts) {
      if (part.type === "text" && part.text) {
        total += roughTokenCountEstimation(part.text)
      } else if (part.type === "tool-result" && part.result) {
        const result = part.result
        if (typeof result === "string") {
          total += roughTokenCountEstimation(result)
        } else if (typeof result === "object") {
          try {
            total += roughTokenCountEstimation(JSON.stringify(result))
          } catch {
            // Ignore
          }
        }
      }
    }
    return total
  }

  // Handle SDK message format
  if (
    (message.type === "assistant" || message.type === "user") &&
    message.message?.content
  ) {
    const content = message.message.content
    if (typeof content === "string") {
      return roughTokenCountEstimation(content)
    }
    if (Array.isArray(content)) {
      return content.reduce(
        (sum: number, block: any) => sum + roughTokenCountEstimationForBlock(block),
        0
      )
    }
  }

  return 0
}

/**
 * Estimate token count for an array of messages
 */
export function roughTokenCountEstimationForMessages(
  messages: Array<{
    type: string
    message?: { content?: unknown }
    parts?: any[]
  }>
): number {
  if (!messages || messages.length === 0) return 0
  return messages.reduce(
    (sum: number, msg) => sum + roughTokenCountEstimationForMessage(msg),
    0
  )
}

/**
 * Usage type from SDK
 */
export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  iterations?: Array<{
    input_tokens: number
    output_tokens: number
  }>
}

/**
 * Get token count from usage object including cache tokens
 */
export function getTokenCountFromUsage(usage: Usage): number {
  return (
    usage.input_tokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    usage.output_tokens
  )
}

/**
 * Get final context tokens from usage, handling server-side tool loops (iterations)
 *
 * When the server runs tool loops (e.g., WebSearch), the top-level usage
 * represents the aggregate across all iterations. The iterations array contains
 * per-iteration usage data. For context window tracking, we want the final
 * iteration's context size.
 */
export function finalContextTokensFromUsage(usage: Usage): number {
  // Check for server-side tool loops
  if (usage.iterations && usage.iterations.length > 0) {
    const lastIteration = usage.iterations[usage.iterations.length - 1]
    return lastIteration.input_tokens + lastIteration.output_tokens
  }

  // No iterations - use top-level usage (input + output, excluding cache)
  // Cache tokens are not part of context window in the same way
  return usage.input_tokens + usage.output_tokens
}

/**
 * Calculate current context window size with estimation for new messages.
 *
 * This is the CANONICAL function for measuring context size when checking
 * thresholds (autocompact, session memory init, etc.). Uses the last API
 * response's token count (input + output + cache) plus estimates for any
 * messages added since.
 *
 * @param messages - Array of messages (can be empty if lastUsage is provided)
 * @param lastUsage - Usage object from last API response
 * @param lastUsageMessageIndex - Index of the message that contains the usage (for estimation slice)
 * @returns Estimated total context tokens
 */
export function tokenCountWithEstimation(
  messages: Array<{
    type: string
    message?: { content?: unknown }
    parts?: any[]
  }>,
  lastUsage: Usage | null,
  lastUsageMessageIndex?: number
): number {
  if (lastUsage) {
    // Get base tokens from usage (includes iterations handling)
    const usageTokens = getTokenCountFromUsage(lastUsage)

    // Estimate tokens for messages added after the usage-bearing message
    const startIndex =
      lastUsageMessageIndex !== undefined ? lastUsageMessageIndex + 1 : 0
    const newMessages = messages.slice(startIndex)

    if (newMessages.length > 0) {
      return usageTokens + roughTokenCountEstimationForMessages(newMessages)
    }

    return usageTokens
  }

  // No usage data - estimate all messages
  return roughTokenCountEstimationForMessages(messages)
}

/**
 * Model context window limits (in tokens)
 */
export const MODEL_CONTEXT_LIMITS: Record<string, number> = {
  // Claude 4.x series
  "claude-opus-4-6": 200_000,
  "claude-opus-4-5": 200_000,
  "claude-opus-4-1": 200_000,
  "claude-opus-4": 200_000,
  "claude-sonnet-4-6": 200_000,
  "claude-sonnet-4-5": 200_000,
  "claude-sonnet-4": 200_000,
  "claude-haiku-4-5": 200_000,
  // Claude 3.x series
  "claude-3-7-sonnet": 200_000,
  "claude-3-5-sonnet": 200_000,
  "claude-3-5-haiku": 200_000,
  "claude-3-opus": 200_000,
  "claude-3-sonnet": 200_000,
  "claude-3-haiku": 200_000,
  // Default
  default: 200_000,
}

/**
 * Get context limit for a model
 */
export function getContextLimitForModel(modelId: string | undefined): number {
  if (!modelId) return MODEL_CONTEXT_LIMITS.default

  // Normalize model ID (remove date suffix, lowercase)
  const normalized = modelId.toLowerCase().split("-").slice(0, 4).join("-")

  // Check for 1M context suffix
  if (modelId.includes("[1m]")) {
    return 1_000_000
  }
  if (modelId.includes("[2m]")) {
    return 2_000_000
  }

  // Look up in table
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_LIMITS)) {
    if (normalized.includes(key) || key.includes(normalized)) {
      return limit
    }
  }

  return MODEL_CONTEXT_LIMITS.default
}

/**
 * Calculate context usage percentage
 */
export function calculateContextPercentage(
  currentTokens: number,
  modelId: string | undefined
): number {
  const limit = getContextLimitForModel(modelId)
  return Math.min(100, Math.round((currentTokens / limit) * 100))
}