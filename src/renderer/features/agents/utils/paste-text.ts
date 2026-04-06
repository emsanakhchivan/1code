import { toast } from "sonner"

// Threshold for auto-converting large pasted text to a file (5KB)
// Text larger than this will be saved as a file attachment instead of pasted inline
export const LARGE_PASTE_THRESHOLD = 5_000

// Maximum characters allowed for paste (10KB of text)
// ContentEditable elements become extremely slow with large text content,
// causing browser/system freeze. 50KB still causes noticeable lag on some systems.
// For larger content, users should attach it as a file instead.
const MAX_PASTE_LENGTH = 10_000

// Threshold for showing "very large" warning (1MB+)
const VERY_LARGE_THRESHOLD = 1_000_000

// Callback type for adding large pasted text as a file
export type AddPastedTextFn = (text: string) => Promise<void>

// Mention ID prefixes - copied from agents-mentions-editor.tsx to avoid circular imports
const MENTION_PREFIXES = {
  FILE: "file:",
  FOLDER: "folder:",
  SKILL: "skill:",
  AGENT: "agent:",
  TOOL: "tool:",
} as const

// FileMentionOption type - minimal version for paste handling
interface FileMentionOption {
  id: string
  label: string
  path: string
  repository: string
  type?: "file" | "folder" | "skill" | "agent" | "tool"
}

// Create icon element for mention chip (simplified version)
function createFileIcon(filename: string, type?: string): HTMLElement {
  const iconSpan = document.createElement("span")
  iconSpan.className = "flex-shrink-0"

  // Simple file/folder icons using text symbols
  if (type === "folder") {
    iconSpan.textContent = "📁"
  } else if (type === "skill") {
    iconSpan.textContent = "⚡"
  } else if (type === "agent") {
    iconSpan.textContent = "🤖"
  } else if (type === "tool") {
    iconSpan.textContent = "🔧"
  } else {
    // File icon - could be enhanced with extension-specific icons
    iconSpan.textContent = "📄"
  }

  return iconSpan
}

// Create styled mention chip for paste insertion
function createMentionNode(option: FileMentionOption): HTMLSpanElement {
  const span = document.createElement("span")
  span.setAttribute("contenteditable", "false")
  span.setAttribute("data-mention-id", option.id)
  span.setAttribute("data-mention-type", option.type || "file")
  span.className =
    "inline-flex items-center gap-1 px-[6px] py-[1px] rounded-[4px] text-sm align-middle bg-black/[0.04] dark:bg-white/[0.08] text-foreground/80"

  // Create icon element
  const iconElement = createFileIcon(option.label, option.type)
  span.appendChild(iconElement)

  const label = document.createElement("span")
  label.textContent = option.label
  span.appendChild(label)

  return span
}

// Parse mention ID to create FileMentionOption
function parseMentionId(id: string): FileMentionOption | null {
  if (id.startsWith(MENTION_PREFIXES.FILE) || id.startsWith(MENTION_PREFIXES.FOLDER)) {
    const parts = id.split(":")
    if (parts.length >= 3) {
      const type = parts[0] as "file" | "folder"
      const repo = parts[1]
      const path = parts.slice(2).join(":")
      const name = path.split("/").pop() || path
      return { id, label: name, path, repository: repo, type }
    }
  }
  if (id.startsWith(MENTION_PREFIXES.SKILL)) {
    const skillName = id.slice(MENTION_PREFIXES.SKILL.length)
    return { id, label: skillName, path: "", repository: "", type: "skill" }
  }
  if (id.startsWith(MENTION_PREFIXES.AGENT)) {
    const agentName = id.slice(MENTION_PREFIXES.AGENT.length)
    return { id, label: agentName, path: "", repository: "", type: "agent" }
  }
  if (id.startsWith(MENTION_PREFIXES.TOOL)) {
    const toolPath = id.slice(MENTION_PREFIXES.TOOL.length)
    if (toolPath.startsWith("mcp__")) {
      const parts = toolPath.split("__")
      const toolName = parts.length >= 3 ? parts.slice(2).join("__") : toolPath
      const displayName = toolName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
        .trim()
      return { id, label: displayName, path: toolPath, repository: "", type: "tool" }
    }
    return { id, label: toolPath, path: toolPath, repository: "", type: "tool" }
  }
  return null
}

/**
 * Insert text with mentions at the current cursor position in a contentEditable element.
 * Parses @[mention:id] patterns and converts them to styled mention chips.
 * Truncates large text to prevent browser freeze.
 *
 * @param text - The text to insert (may contain @[mention:id] patterns)
 * @param editableElement - The contentEditable element (used for size calculation)
 */
export function insertTextAtCursor(text: string, editableElement: Element): void {
  // Check existing content size to prevent exceeding total limit
  const existingLength = editableElement?.textContent?.length || 0
  const availableSpace = Math.max(0, MAX_PASTE_LENGTH - existingLength)

  // Truncate based on available space (not just paste size)
  let textToInsert = text
  const effectiveLimit = Math.min(text.length, availableSpace)

  if (text.length > effectiveLimit) {
    textToInsert = text.slice(0, effectiveLimit)
    // Show toast warning to user
    const originalKB = Math.round(text.length / 1024)

    if (availableSpace === 0) {
      // No space left at all
      toast.warning("Cannot paste: input is full", {
        description: "Please clear some text or attach content as a file instead.",
      })
      return
    } else if (text.length > VERY_LARGE_THRESHOLD) {
      const originalMB = (text.length / 1_000_000).toFixed(1)
      toast.warning(`Text truncated`, {
        description: `Original text was ${originalMB}MB. Please attach as a file instead.`,
      })
    } else {
      const truncatedKB = Math.round(effectiveLimit / 1024)
      toast.warning(`Text truncated to ${truncatedKB}KB`, {
        description: `Original text was ${originalKB}KB. Consider attaching as a file instead.`,
      })
    }
  }

  // Check if text contains mention patterns
  const regex = /@\[([^\]]+)\]/g
  const hasMentions = regex.test(textToInsert)

  if (!hasMentions) {
    // No mentions - insert as plain text using execCommand (preserves undo history)
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand("insertText", false, textToInsert)
    return
  }

  // Has mentions - need to insert DOM nodes manually
  // Get selection for cursor position
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    // Fallback: insert as plain text
    // eslint-disable-next-line deprecation/deprecation
    document.execCommand("insertText", false, textToInsert)
    return
  }

  const range = sel.getRangeAt(0)
  range.collapse(true)

  // Reset regex for iteration
  regex.lastIndex = 0
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(textToInsert)) !== null) {
    // Insert text before this mention
    if (match.index > lastIndex) {
      const textBefore = textToInsert.slice(lastIndex, match.index)
      const textNode = document.createTextNode(textBefore)
      range.insertNode(textNode)
      range.setStartAfter(textNode)
      range.collapse(true)
    }

    // Parse and insert mention
    const id = match[1]
    const option = parseMentionId(id)

    if (option) {
      const mentionNode = createMentionNode(option)
      range.insertNode(mentionNode)
      range.setStartAfter(mentionNode)
      range.collapse(true)

      // Add space after mention
      const spaceNode = document.createTextNode(" ")
      range.insertNode(spaceNode)
      range.setStartAfter(spaceNode)
      range.collapse(true)
    } else {
      // Unknown mention format - insert as text
      const mentionText = document.createTextNode(`@[${id}]`)
      range.insertNode(mentionText)
      range.setStartAfter(mentionText)
      range.collapse(true)
    }

    lastIndex = match.index + match[0].length
  }

  // Insert remaining text after last mention
  if (lastIndex < textToInsert.length) {
    const textAfter = textToInsert.slice(lastIndex)
    const textNode = document.createTextNode(textAfter)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
  }

  // Update selection
  sel.removeAllRanges()
  sel.addRange(range)
}

/**
 * Handle paste event for contentEditable elements.
 * Extracts images and passes them to handleAddAttachments.
 * For large text (>LARGE_PASTE_THRESHOLD), saves as a file attachment.
 * For smaller text, pastes as plain text only (prevents HTML).
 *
 * @param e - The clipboard event
 * @param handleAddAttachments - Callback to handle image attachments
 * @param addPastedText - Optional callback to save large text as a file
 */
export function handlePasteEvent(
  e: React.ClipboardEvent,
  handleAddAttachments: (files: File[]) => void,
  addPastedText?: AddPastedTextFn,
): void {
  const files = Array.from(e.clipboardData.items)
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean) as File[]

  if (files.length > 0) {
    e.preventDefault()
    handleAddAttachments(files)
  } else {
    // Paste as plain text only (prevents HTML from being pasted)
    const text = e.clipboardData.getData("text/plain")
    if (text) {
      e.preventDefault()

      // Large text: save as file attachment instead of pasting inline
      if (text.length > LARGE_PASTE_THRESHOLD && addPastedText) {
        addPastedText(text)
        return
      }

      // Get the contentEditable element
      const target = e.currentTarget as HTMLElement
      const editableElement =
        target.closest('[contenteditable="true"]') || target
      insertTextAtCursor(text, editableElement)
    }
  }
}
