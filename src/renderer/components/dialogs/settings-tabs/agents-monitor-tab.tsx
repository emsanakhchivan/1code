import { useMemo, useState } from "react"
import { trpc } from "../../../lib/trpc"
import { cn } from "../../../lib/utils"
import { Loader2 } from "lucide-react"

// Time range filter options
type TimeRange = "today" | "7days" | "30days" | "all"

const TIME_RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7days", label: "7 Days" },
  { value: "30days", label: "30 Days" },
  { value: "all", label: "All Time" },
]

// Helper to get date range
function getDateRange(range: TimeRange): { startDate?: Date; endDate?: Date } {
  const now = new Date()
  const endDate = now

  switch (range) {
    case "today":
      return {
        startDate: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
        endDate,
      }
    case "7days":
      return {
        startDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        endDate,
      }
    case "30days":
      return {
        startDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        endDate,
      }
    case "all":
    default:
      return {} // No date filter
  }
}

// Format large numbers with K, M, B suffixes
function formatNumber(num: number | null | undefined): string {
  if (num === null || num === undefined) return "0"
  if (num >= 1_000_000_000) {
    return (num / 1_000_000_000).toFixed(1) + "B"
  }
  if (num >= 1_000_000) {
    return (num / 1_000_000).toFixed(1) + "M"
  }
  if (num >= 1_000) {
    return (num / 1_000).toFixed(1) + "K"
  }
  return num.toLocaleString()
}

// Format cost from cents to USD
function formatCost(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "$0.00"
  const dollars = cents / 100
  if (dollars >= 1000) {
    return "$" + dollars.toLocaleString(undefined, { maximumFractionDigits: 0 })
  }
  return "$" + dollars.toFixed(2)
}

// Time range selector component
function TimeRangeSelector({
  value,
  onChange,
}: {
  value: TimeRange
  onChange: (range: TimeRange) => void
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 text-muted-foreground">
      {TIME_RANGE_OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium ring-offset-background transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-50",
            value === option.value
              ? "bg-background text-foreground shadow-sm"
              : "hover:text-foreground"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

// Summary card component
function SummaryCard({
  label,
  value,
  subValue,
  className,
}: {
  label: string
  value: string
  subValue?: string
  className?: string
}) {
  return (
    <div className={cn("bg-muted/50 rounded-lg p-4", className)}>
      <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="text-2xl font-semibold">{value}</div>
      {subValue && (
        <div className="text-xs text-muted-foreground mt-1">{subValue}</div>
      )}
    </div>
  )
}

// Model row component
function ModelRow({
  modelId,
  modelProvider,
  modelProfileName,
  inputTokens,
  outputTokens,
  totalTokens,
  messageCount,
  totalCostCents,
}: {
  modelId: string
  modelProvider?: string | null
  modelProfileName?: string | null
  inputTokens: number
  outputTokens: number
  totalTokens: number
  messageCount: number
  totalCostCents?: number | null
}) {
  // Generate display name
  const displayName = modelProfileName || modelId

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      <td className="py-3 px-4">
        <div className="flex flex-col">
          <span className="font-medium text-sm">{displayName}</span>
          {modelProfileName && (
            <span className="text-xs text-muted-foreground">{modelId}</span>
          )}
          {modelProvider && (
            <span className="text-xs text-muted-foreground capitalize">
              {modelProvider}
            </span>
          )}
        </div>
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm">
        {formatNumber(inputTokens)}
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm">
        {formatNumber(outputTokens)}
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm font-medium">
        {formatNumber(totalTokens)}
      </td>
      <td className="py-3 px-4 text-right font-mono text-sm">
        {messageCount.toLocaleString()}
      </td>
      {totalCostCents !== undefined && (
        <td className="py-3 px-4 text-right font-mono text-sm">
          {formatCost(totalCostCents)}
        </td>
      )}
    </tr>
  )
}

// Empty state component
function EmptyState({ timeRange }: { timeRange: TimeRange }) {
  const timeRangeLabel = TIME_RANGE_OPTIONS.find(o => o.value === timeRange)?.label || "selected period"

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-muted-foreground mb-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="h-12 w-12 mx-auto mb-4 opacity-50"
        >
          <path
            d="M3 3V21H21"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path d="M7 16V12" strokeLinecap="round" />
          <path d="M11 16V8" strokeLinecap="round" />
          <path d="M15 16V11" strokeLinecap="round" />
          <path d="M19 16V6" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-muted-foreground">
        No usage data for {timeRangeLabel.toLowerCase()}
      </p>
      <p className="text-xs text-muted-foreground mt-1 max-w-sm">
        {timeRange === "all"
          ? "Start a chat to see your token usage statistics here."
          : "Try selecting a different time range or start a new chat."}
      </p>
    </div>
  )
}

// Loading state component
function LoadingState() {
  return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )
}

export function AgentsMonitorTab() {
  // Time range state
  const [timeRange, setTimeRange] = useState<TimeRange>("all")

  // Calculate date range for query
  const dateRange = useMemo(() => getDateRange(timeRange), [timeRange])

  // Fetch usage data with date filter
  const { data: totals, isLoading: isTotalsLoading } = trpc.usage.getTotals.useQuery({
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
  })

  const { data: modelSummary, isLoading: isSummaryLoading } =
    trpc.usage.getModelSummary.useQuery({
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    })

  const isLoading = isTotalsLoading || isSummaryLoading
  const hasData = totals && (totals.totalMessages || 0) > 0

  // Calculate percentage of input vs output
  const inputPercent = useMemo(() => {
    if (!totals?.totalInputTokens || !totals?.totalTokens) return 0
    return Math.round((totals.totalInputTokens / totals.totalTokens) * 100)
  }, [totals])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1.5">
          <h3 className="text-sm font-semibold text-foreground">Monitor</h3>
          <p className="text-xs text-muted-foreground">
            Track your token usage across all models
          </p>
        </div>

        {/* Time Range Selector */}
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : !hasData ? (
        <EmptyState timeRange={timeRange} />
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              label="Total Tokens"
              value={formatNumber(totals?.totalTokens)}
              subValue={`${formatNumber(totals?.totalInputTokens)} input / ${formatNumber(totals?.totalOutputTokens)} output`}
            />
            <SummaryCard
              label="Input Tokens"
              value={formatNumber(totals?.totalInputTokens)}
              subValue={`${inputPercent}% of total`}
            />
            <SummaryCard
              label="Output Tokens"
              value={formatNumber(totals?.totalOutputTokens)}
              subValue={`${100 - inputPercent}% of total`}
            />
            <SummaryCard
              label="Total Cost"
              value={formatCost(totals?.totalCostCents)}
              subValue={`${totals?.uniqueModels || 0} model${(totals?.uniqueModels || 0) !== 1 ? "s" : ""}`}
            />
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">Messages</div>
              <div className="text-lg font-semibold">
                {(totals?.totalMessages || 0).toLocaleString()}
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">
                Cache Read
              </div>
              <div className="text-lg font-semibold">
                {formatNumber(totals?.totalCacheReadTokens)}
              </div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3">
              <div className="text-xs text-muted-foreground mb-1">
                Cache Write
              </div>
              <div className="text-lg font-semibold">
                {formatNumber(totals?.totalCacheWriteTokens)}
              </div>
            </div>
          </div>

          {/* Model Breakdown */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-foreground">
              Model Breakdown
            </h4>

            {modelSummary && modelSummary.length > 0 ? (
              <div className="bg-background rounded-lg border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        <th className="py-2.5 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Model
                        </th>
                        <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Input
                        </th>
                        <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Output
                        </th>
                        <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Total
                        </th>
                        <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Messages
                        </th>
                        <th className="py-2.5 px-4 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                          Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {modelSummary.map((model, index) => (
                        <ModelRow
                          key={`${model.modelId}-${index}`}
                          modelId={model.modelId}
                          modelProvider={model.modelProvider}
                          modelProfileName={model.modelProfileName}
                          inputTokens={model.totalInputTokens || 0}
                          outputTokens={model.totalOutputTokens || 0}
                          totalTokens={model.totalTokens || 0}
                          messageCount={model.messageCount || 0}
                          totalCostCents={model.totalCostCents}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No model data available
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}