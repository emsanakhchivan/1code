import { z } from "zod"
import { router, publicProcedure } from "../index"
import { getDatabase, subChats } from "../../db"
import { statsCache } from "../../db/schema/stats-cache"
import { eq, inArray, sql } from "drizzle-orm"

/**
 * Stats Cache Router
 * Provides pre-computed statistics queries for sub-chats
 */
export const statsCacheRouter = router({
  /**
   * Get stats for a single subChat
   */
  get: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const result = await db
        .select()
        .from(statsCache)
        .where(eq(statsCache.subChatId, input.subChatId))
        .limit(1)
      return result[0] ?? null
    }),

  /**
   * Get stats for multiple subChats (for sidebar display)
   */
  getBatch: publicProcedure
    .input(z.object({ subChatIds: z.array(z.string()) }))
    .query(async ({ input }) => {
      if (input.subChatIds.length === 0) return []
      const db = getDatabase()
      return await db
        .select()
        .from(statsCache)
        .where(inArray(statsCache.subChatId, input.subChatIds))
    }),

  /**
   * Get all stats for a chat (all its subChats)
   */
  getForChat: publicProcedure
    .input(z.object({ chatId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabase()
      const subChatList = await db
        .select({ id: subChats.id })
        .from(subChats)
        .where(eq(subChats.chatId, input.chatId))

      const ids = subChatList.map((s) => s.id)
      if (ids.length === 0) return []

      return await db
        .select()
        .from(statsCache)
        .where(inArray(statsCache.subChatId, ids))
    }),

  /**
   * Update stats (called after message save)
   * Uses upsert to create or update the stats row
   */
  update: publicProcedure
    .input(
      z.object({
        subChatId: z.string(),
        fileCount: z.number().optional(),
        pendingPlans: z.number().optional(),
        messageCount: z.number().optional(),
        lastMessagePreview: z.string().optional(),
        tokensUsed: z.number().optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const db = getDatabase()
      const { subChatId, ...updates } = input
      await db
        .insert(statsCache)
        .values({
          subChatId,
          ...updates,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: statsCache.subChatId,
          set: {
            ...updates,
            updatedAt: new Date(),
          },
        })
    }),

  /**
   * Increment message count (atomic operation)
   * Uses single upsert with SQL expression for atomic increment
   */
  incrementMessageCount: publicProcedure
    .input(z.object({ subChatId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabase()
      await db
        .insert(statsCache)
        .values({
          subChatId: input.subChatId,
          messageCount: 1,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: statsCache.subChatId,
          set: {
            messageCount: sql`${statsCache.messageCount} + 1`,
            updatedAt: new Date(),
          },
        })
    }),
})

export type StatsCacheRouter = typeof statsCacheRouter
