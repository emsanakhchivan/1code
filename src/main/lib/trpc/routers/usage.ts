import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, tokenUsage } from "../../db"
import { eq, desc, sql, and, gte, lte } from "drizzle-orm"

/**
 * Usage Router
 * Provides token usage analytics and monitoring data
 */
export const usageRouter = router({
  /**
   * Get aggregated usage summary grouped by model
   * Returns total tokens, messages, and costs per model
   */
  getModelSummary: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const { projectId, startDate, endDate } = input || {}

      // Build filter conditions
      const conditions = []
      if (projectId) {
        conditions.push(eq(tokenUsage.projectId, projectId))
      }
      if (startDate) {
        conditions.push(gte(tokenUsage.createdAt, startDate))
      }
      if (endDate) {
        conditions.push(lte(tokenUsage.createdAt, endDate))
      }

      const query = db
        .select({
          modelId: tokenUsage.modelId,
          modelProvider: tokenUsage.modelProvider,
          modelProfileName: tokenUsage.modelProfileName,
          totalInputTokens: sql<number>`SUM(${tokenUsage.inputTokens})`,
          totalOutputTokens: sql<number>`SUM(${tokenUsage.outputTokens})`,
          totalCacheReadTokens: sql<number>`SUM(${tokenUsage.cacheReadTokens})`,
          totalCacheWriteTokens: sql<number>`SUM(${tokenUsage.cacheWriteTokens})`,
          totalTokens: sql<number>`SUM(${tokenUsage.totalTokens})`,
          messageCount: sql<number>`COUNT(*)`,
          totalCostCents: sql<number>`SUM(${tokenUsage.costUsd})`,
          avgDurationMs: sql<number>`AVG(${tokenUsage.durationMs})`,
        })
        .from(tokenUsage)
        .groupBy(
          tokenUsage.modelId,
          tokenUsage.modelProvider,
          tokenUsage.modelProfileName,
        )
        .orderBy(desc(sql`SUM(${tokenUsage.totalTokens})`))

      if (conditions.length > 0) {
        const result = await query.where(and(...conditions)).all()
        return result
      }

      return await query.all()
    }),

  /**
   * Get daily activity data for activity heatmap
   * Returns token counts and message counts per day
   */
  getDailyActivity: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          year: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const year = input?.year || new Date().getFullYear()
      const startDate = new Date(year, 0, 1)
      const endDate = new Date(year, 11, 31, 23, 59, 59)

      const conditions = [
        gte(tokenUsage.createdAt, startDate),
        lte(tokenUsage.createdAt, endDate),
      ]

      if (input?.projectId) {
        conditions.push(eq(tokenUsage.projectId, input.projectId))
      }

      const result = await db
        .select({
          date: sql<string>`date(${tokenUsage.createdAt})`,
          totalTokens: sql<number>`SUM(${tokenUsage.totalTokens})`,
          messageCount: sql<number>`COUNT(*)`,
          inputTokens: sql<number>`SUM(${tokenUsage.inputTokens})`,
          outputTokens: sql<number>`SUM(${tokenUsage.outputTokens})`,
        })
        .from(tokenUsage)
        .where(and(...conditions))
        .groupBy(sql`date(${tokenUsage.createdAt})`)
        .all()

      return result
    }),

  /**
   * Get overall usage totals
   * Returns summary statistics for the dashboard
   */
  getTotals: publicProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          startDate: z.coerce.date().optional(),
          endDate: z.coerce.date().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const { projectId, startDate, endDate } = input || {}

      const conditions = []
      if (projectId) {
        conditions.push(eq(tokenUsage.projectId, projectId))
      }
      if (startDate) {
        conditions.push(gte(tokenUsage.createdAt, startDate))
      }
      if (endDate) {
        conditions.push(lte(tokenUsage.createdAt, endDate))
      }

      const query = db
        .select({
          totalInputTokens: sql<number>`SUM(${tokenUsage.inputTokens})`,
          totalOutputTokens: sql<number>`SUM(${tokenUsage.outputTokens})`,
          totalCacheReadTokens: sql<number>`SUM(${tokenUsage.cacheReadTokens})`,
          totalCacheWriteTokens: sql<number>`SUM(${tokenUsage.cacheWriteTokens})`,
          totalTokens: sql<number>`SUM(${tokenUsage.totalTokens})`,
          totalMessages: sql<number>`COUNT(*)`,
          totalCostCents: sql<number>`SUM(${tokenUsage.costUsd})`,
          uniqueModels: sql<number>`COUNT(DISTINCT ${tokenUsage.modelId})`,
        })
        .from(tokenUsage)

      if (conditions.length > 0) {
        const result = await query.where(and(...conditions)).get()
        return result
      }

      return await query.get()
    }),

  /**
   * Get time series data for token usage charts
   * Returns aggregated data by hour, day, or week
   */
  getTimeSeries: publicProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        modelId: z.string().optional(),
        startDate: z.coerce.date(),
        endDate: z.coerce.date(),
        granularity: z.enum(["hour", "day", "week"]).default("day"),
      }),
    )
    .query(async ({ input }) => {
      const db = getDatabase()
      const { projectId, modelId, startDate, endDate, granularity } = input

      const conditions = [
        gte(tokenUsage.createdAt, startDate),
        lte(tokenUsage.createdAt, endDate),
      ]

      if (projectId) {
        conditions.push(eq(tokenUsage.projectId, projectId))
      }
      if (modelId) {
        conditions.push(eq(tokenUsage.modelId, modelId))
      }

      // Determine the date truncation based on granularity
      let dateTrunc: string
      switch (granularity) {
        case "hour":
          dateTrunc = `strftime('%Y-%m-%d %H:00', ${tokenUsage.createdAt})`
          break
        case "week":
          dateTrunc = `strftime('%Y-W%W', ${tokenUsage.createdAt})`
          break
        case "day":
        default:
          dateTrunc = `date(${tokenUsage.createdAt})`
      }

      const result = await db
        .select({
          date: sql<string>`${dateTrunc}`,
          totalInputTokens: sql<number>`SUM(${tokenUsage.inputTokens})`,
          totalOutputTokens: sql<number>`SUM(${tokenUsage.outputTokens})`,
          totalTokens: sql<number>`SUM(${tokenUsage.totalTokens})`,
          messageCount: sql<number>`COUNT(*)`,
        })
        .from(tokenUsage)
        .where(and(...conditions))
        .groupBy(sql`${dateTrunc}`)
        .orderBy(sql`${dateTrunc}`)
        .all()

      return result
    }),

  /**
   * Record a new token usage entry
   * Called internally when a message completes
   */
  record: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        chatId: z.string(),
        projectId: z.string().nullable().optional(),
        modelId: z.string(),
        modelProvider: z.string().nullable().optional(),
        modelProfileId: z.string().nullable().optional(),
        modelProfileName: z.string().nullable().optional(),
        inputTokens: z.number().default(0),
        outputTokens: z.number().default(0),
        cacheReadTokens: z.number().default(0),
        cacheWriteTokens: z.number().default(0),
        totalTokens: z.number().default(0),
        costUsd: z.number().nullable().optional(),
        durationMs: z.number().nullable().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()

      const result = await db
        .insert(tokenUsage)
        .values({
          subChatId: input.subChatId,
          chatId: input.chatId,
          projectId: input.projectId ?? null,
          modelId: input.modelId,
          modelProvider: input.modelProvider ?? null,
          modelProfileId: input.modelProfileId ?? null,
          modelProfileName: input.modelProfileName ?? null,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cacheReadTokens: input.cacheReadTokens,
          cacheWriteTokens: input.cacheWriteTokens,
          totalTokens: input.totalTokens,
          costUsd: input.costUsd ? Math.round(input.costUsd * 100) : null,
          durationMs: input.durationMs ?? null,
        })
        .returning()
        .get()

      return result
    }),
})