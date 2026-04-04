import { memo, useState } from "react"
import { useAtom } from "jotai"
import { motion, AnimatePresence } from "motion/react"
import { AlertCircle, X, ChevronDown, ChevronUp, Copy } from "lucide-react"
import { toast } from "sonner"
import { subChatErrorsAtom, clearErrorForSubChat } from "../atoms"

export const ErrorInfoBanner = memo(function ErrorInfoBanner({
  subChatId,
}: {
  subChatId: string
}) {
  const [errors, setErrors] = useAtom(subChatErrorsAtom)
  const error = errors.get(subChatId)
  const [isExpanded, setIsExpanded] = useState(false)

  if (!error) return null

  const handleDismiss = () => {
    clearErrorForSubChat(setErrors, subChatId)
  }

  const handleCopy = () => {
    const errorDetails = [
      `Error: ${error.message}`,
      `Category: ${error.category}`,
      `SubChat ID: ${error.subChatId}`,
      `Timestamp: ${new Date(error.timestamp).toISOString()}`,
      error.debugInfo ? `Debug Info: ${JSON.stringify(error.debugInfo, null, 2)}` : null,
    ].filter(Boolean).join("\n")

    navigator.clipboard.writeText(errorDetails)
    toast.success("Error details copied")
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, height: 0, marginBottom: 0 }}
        animate={{ opacity: 1, height: "auto", marginBottom: 16 }}
        exit={{ opacity: 0, height: 0, marginBottom: 0 }}
        className="px-2"
      >
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg overflow-hidden">
          {/* Header - always visible */}
          <div className="flex items-center gap-2 p-3">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span className="text-sm font-medium text-destructive truncate flex-1">
              {error.title}
            </span>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-destructive/20 rounded transition-colors"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              {isExpanded ? (
                <ChevronUp className="h-4 w-4 text-destructive" />
              ) : (
                <ChevronDown className="h-4 w-4 text-destructive" />
              )}
            </button>
            <button
              onClick={handleCopy}
              className="p-1 hover:bg-destructive/20 rounded transition-colors"
              title="Copy error details"
            >
              <Copy className="h-4 w-4 text-destructive" />
            </button>
            <button
              onClick={handleDismiss}
              className="p-1 hover:bg-destructive/20 rounded transition-colors"
              title="Dismiss"
            >
              <X className="h-4 w-4 text-destructive" />
            </button>
          </div>

          {/* Expanded content */}
          <AnimatePresence>
            {isExpanded && (
              <motion.div
                initial={{ height: 0 }}
                animate={{ height: "auto" }}
                exit={{ height: 0 }}
                className="border-t border-destructive/20 overflow-hidden"
              >
                <div className="p-3 text-sm text-destructive/80">
                  <p className="whitespace-pre-wrap">{error.message}</p>
                  {error.debugInfo && (
                    <pre className="mt-2 text-xs text-muted-foreground overflow-x-auto bg-destructive/5 p-2 rounded">
                      {JSON.stringify(error.debugInfo, null, 2)}
                    </pre>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  )
})