import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import { eq, isNull, sql } from "drizzle-orm"
import { app } from "electron"
import { join } from "path"
import { existsSync, mkdirSync } from "fs"
import * as schema from "./schema"
import { subChats } from "./schema"

let db: ReturnType<typeof drizzle<typeof schema>> | null = null
let sqlite: Database.Database | null = null

/**
 * Get the database path in the app's user data directory
 */
function getDatabasePath(): string {
  const userDataPath = app.getPath("userData")
  const dataDir = join(userDataPath, "data")

  // Ensure data directory exists
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  return join(dataDir, "agents.db")
}

/**
 * Get the migrations folder path
 * Handles both development and production (packaged) environments
 */
function getMigrationsPath(): string {
  if (app.isPackaged) {
    // Production: migrations bundled in resources
    return join(process.resourcesPath, "migrations")
  }
  // Development: from out/main -> apps/desktop/drizzle
  return join(__dirname, "../../drizzle")
}

/**
 * Compute file stats from parsed messages (mirrors chats.ts helper)
 */
function computeFileStats(messagesJson: string): { additions: number; deletions: number; fileCount: number } | null {
  if (!messagesJson || messagesJson === "[]") return null
  try {
    const messages = JSON.parse(messagesJson) as Array<{
      role: string
      parts?: Array<{
        type: string
        input?: { file_path?: string; old_string?: string; new_string?: string; content?: string }
      }>
    }>
    const fileStates = new Map<string, { originalContent: string | null; currentContent: string }>()
    for (const msg of messages) {
      if (msg.role !== "assistant") continue
      for (const part of msg.parts || []) {
        if (part.type === "tool-Edit" || part.type === "tool-Write") {
          const filePath = part.input?.file_path
          if (!filePath) continue
          if (filePath.includes("claude-sessions") || filePath.includes("Application Support")) continue
          const oldString = part.input?.old_string || ""
          const newString = part.input?.new_string || part.input?.content || ""
          const existing = fileStates.get(filePath)
          if (existing) { existing.currentContent = newString } else {
            fileStates.set(filePath, { originalContent: part.type === "tool-Write" ? null : oldString, currentContent: newString })
          }
        }
      }
    }
    let additions = 0, deletions = 0, fileCount = 0
    for (const [, state] of fileStates) {
      const original = state.originalContent || ""
      if (original === state.currentContent) continue
      const oldLines = original ? original.split("\n").length : 0
      const newLines = state.currentContent ? state.currentContent.split("\n").length : 0
      if (!original) { additions += newLines } else { additions += newLines; deletions += oldLines }
      fileCount += 1
    }
    return fileCount > 0 ? { additions, deletions, fileCount } : null
  } catch { return null }
}

/**
 * Compute has_pending_plan from parsed messages (mirrors chats.ts helper)
 */
function computeHasPendingPlan(messagesJson: string, mode: string): boolean {
  if (mode !== "plan") return false
  if (!messagesJson || messagesJson === "[]") return false
  try {
    const messages = JSON.parse(messagesJson) as Array<{
      role: string
      parts?: Array<{ type: string; output?: unknown }>
    }>
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (!msg) continue
      if (msg.role === "assistant" && msg.parts) {
        const exitPlanPart = msg.parts.find((p) => p.type === "tool-ExitPlanMode")
        if (exitPlanPart && exitPlanPart.output !== undefined) return true
      }
    }
    return false
  } catch { return false }
}

/**
 * Backfill pre-computed stats columns (file_stats, has_pending_plan) for existing sub-chats.
 * Runs once after migration, only processes rows where file_stats IS NULL.
 */
function backfillPrecomputedStats(dbInstance: ReturnType<typeof drizzle<typeof schema>>) {
  try {
    // Backfill rows where fileStats IS NULL (migration 0011 columns)
    const rowsMissingFileStats = dbInstance
      .select({ id: subChats.id, messages: subChats.messages, mode: subChats.mode })
      .from(subChats)
      .where(sql`${subChats.fileStats} IS NULL`)
      .all()

    if (rowsMissingFileStats.length > 0) {
      console.log(`[DB] Backfilling file_stats/has_pending_plan for ${rowsMissingFileStats.length} sub-chats...`)
      dbInstance.transaction((tx) => {
        for (const row of rowsMissingFileStats) {
          const fileStats = computeFileStats(row.messages)
          const hasPendingPlan = computeHasPendingPlan(row.messages, row.mode)
          tx.update(subChats)
            .set({
              fileStats: fileStats ? JSON.stringify(fileStats) : null,
              hasPendingPlan,
            })
            .where(eq(subChats.id, row.id))
            .run()
        }
      })
      console.log(`[DB] file_stats/has_pending_plan backfill complete`)
    }

    // Backfill rows where messageCount is NULL or mismatched (migration 0012 column)
    // DEFAULT 0 means existing rows get 0 not NULL, so check both:
    // - messageCount IS NULL (shouldn't happen with DEFAULT, but defensive)
    // - messageCount = 0 but messages JSON is non-empty (pre-backfill state)
    const rowsMissingCount = dbInstance
      .select({ id: subChats.id, messages: subChats.messages })
      .from(subChats)
      .where(sql`${subChats.messageCount} IS NULL OR (${subChats.messageCount} = 0 AND ${subChats.messages} IS NOT NULL AND ${subChats.messages} != '[]' AND ${subChats.messages} != '')`)
      .all()

    if (rowsMissingCount.length > 0) {
      console.log(`[DB] Backfilling message_count for ${rowsMissingCount.length} sub-chats...`)
      dbInstance.transaction((tx) => {
        for (const row of rowsMissingCount) {
          let count = 0
          try {
            const parsed = JSON.parse(row.messages)
            if (Array.isArray(parsed)) count = parsed.length
          } catch { /* keep 0 */ }
          tx.update(subChats)
            .set({ messageCount: count })
            .where(eq(subChats.id, row.id))
            .run()
        }
      })
      console.log(`[DB] message_count backfill complete`)
    }
  } catch (error) {
    // Non-fatal: the columns may not exist yet if migration hasn't run
    console.warn("[DB] Backfill skipped (columns may not exist yet):", error instanceof Error ? error.message : error)
  }
}

/**
 * Initialize the database with Drizzle ORM
 */
export function initDatabase() {
  if (db) {
    return db
  }

  const dbPath = getDatabasePath()
  console.log(`[DB] Initializing database at: ${dbPath}`)

  // Create SQLite connection
  sqlite = new Database(dbPath)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  sqlite.pragma("synchronous = NORMAL")
  sqlite.pragma("busy_timeout = 5000") // Wait up to 5s for locked DB instead of immediate error
  sqlite.pragma("cache_size = -64000") // 64MB page cache for better read performance

  // Create Drizzle instance
  db = drizzle(sqlite, { schema })

  // Run migrations
  const migrationsPath = getMigrationsPath()
  console.log(`[DB] Running migrations from: ${migrationsPath}`)

  try {
    migrate(db, { migrationsFolder: migrationsPath })
    console.log("[DB] Migrations completed")
  } catch (error) {
    console.error("[DB] Migration error:", error)
    throw error
  }

  // Backfill pre-computed stats for existing sub-chats (one-time after migration)
  backfillPrecomputedStats(db)

  return db
}

/**
 * Get the database instance
 */
export function getDatabase() {
  if (!db) {
    return initDatabase()
  }
  return db
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close()
    sqlite = null
    db = null
    console.log("[DB] Database connection closed")
  }
}

// Re-export schema for convenience
export * from "./schema"
