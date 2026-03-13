import { index, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { relations } from "drizzle-orm"
import { createId } from "../utils"

// ============ PROJECTS ============
export const projects = sqliteTable("projects", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name").notNull(),
  path: text("path").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  // Git remote info (extracted from local .git)
  gitRemoteUrl: text("git_remote_url"),
  gitProvider: text("git_provider"), // "github" | "gitlab" | "bitbucket" | null
  gitOwner: text("git_owner"),
  gitRepo: text("git_repo"),
  // Custom project icon (absolute path to local image file)
  iconPath: text("icon_path"),
})

export const projectsRelations = relations(projects, ({ many }) => ({
  chats: many(chats),
}))

// ============ CHATS ============
export const chats = sqliteTable("chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
  // Worktree fields (for git isolation per chat)
  worktreePath: text("worktree_path"),
  branch: text("branch"),
  baseBranch: text("base_branch"),
  // PR tracking fields
  prUrl: text("pr_url"),
  prNumber: integer("pr_number"),
}, (table) => [
  index("chats_worktree_path_idx").on(table.worktreePath),
])

export const chatsRelations = relations(chats, ({ one, many }) => ({
  project: one(projects, {
    fields: [chats.projectId],
    references: [projects.id],
  }),
  subChats: many(subChats),
}))

// ============ SUB-CHATS ============
export const subChats = sqliteTable("sub_chats", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  name: text("name"),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  sessionId: text("session_id"), // Claude SDK session ID for resume
  streamId: text("stream_id"), // Track in-progress streams
  mode: text("mode").notNull().default("agent"), // "plan" | "agent"
  messages: text("messages").notNull().default("[]"), // JSON array
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  archivedAt: integer("archived_at", { mode: "timestamp" }),
})

export const subChatsRelations = relations(subChats, ({ one }) => ({
  chat: one(chats, {
    fields: [subChats.chatId],
    references: [chats.id],
  }),
}))

// ============ CLAUDE CODE CREDENTIALS ============
// Stores encrypted OAuth token for Claude Code integration
// DEPRECATED: Use anthropicAccounts for multi-account support
export const claudeCodeCredentials = sqliteTable("claude_code_credentials", {
  id: text("id").primaryKey().default("default"), // Single row, always "default"
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  userId: text("user_id"), // Desktop auth user ID (for reference)
})

// ============ ANTHROPIC ACCOUNTS (Multi-account support) ============
// Stores multiple Anthropic OAuth accounts for quick switching
export const anthropicAccounts = sqliteTable("anthropic_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),
  email: text("email"), // User's email from OAuth (if available)
  displayName: text("display_name"), // User-editable label
  oauthToken: text("oauth_token").notNull(), // Encrypted with safeStorage
  connectedAt: integer("connected_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  desktopUserId: text("desktop_user_id"), // Reference to 21st.dev user
})

// Tracks which Anthropic account is currently active
export const anthropicSettings = sqliteTable("anthropic_settings", {
  id: text("id").primaryKey().default("singleton"), // Single row
  activeAccountId: text("active_account_id"), // References anthropicAccounts.id
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
})

// ============ TOKEN USAGE ============
// Tracks token usage per message for analytics and monitoring
export const tokenUsage = sqliteTable("token_usage", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => createId()),

  // Relations
  subChatId: text("sub_chat_id")
    .notNull()
    .references(() => subChats.id, { onDelete: "cascade" }),
  chatId: text("chat_id")
    .notNull()
    .references(() => chats.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .references(() => projects.id, { onDelete: "set null" }),

  // Model info (for per-model analytics)
  modelId: text("model_id").notNull(),              // "claude-3-7-opus", "glm-5", "kimi-k2.5"
  modelProvider: text("model_provider"),             // "anthropic" | "openai" | "custom" | "ollama"
  modelProfileId: text("model_profile_id"),          // Custom profile ID (if using custom API)
  modelProfileName: text("model_profile_name"),       // Display name: "GLM-5", "Kimi", "OpenRouter"

  // Token counts
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").default(0),
  cacheWriteTokens: integer("cache_write_tokens").default(0),
  totalTokens: integer("total_tokens").notNull().default(0),

  // Cost and performance
  costUsd: integer("cost_usd"),      // In cents (e.g., 125 = $1.25)
  durationMs: integer("duration_ms"),

  // Metadata
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index("token_usage_subchat_idx").on(table.subChatId),
  index("token_usage_chat_idx").on(table.chatId),
  index("token_usage_project_idx").on(table.projectId),
  index("token_usage_model_idx").on(table.modelId),
  index("token_usage_created_idx").on(table.createdAt),
  index("token_usage_provider_idx").on(table.modelProvider),
])

export const tokenUsageRelations = relations(tokenUsage, ({ one }) => ({
  subChat: one(subChats, {
    fields: [tokenUsage.subChatId],
    references: [subChats.id],
  }),
  chat: one(chats, {
    fields: [tokenUsage.chatId],
    references: [chats.id],
  }),
  project: one(projects, {
    fields: [tokenUsage.projectId],
    references: [projects.id],
  }),
}))

// ============ TYPE EXPORTS ============
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Chat = typeof chats.$inferSelect
export type NewChat = typeof chats.$inferInsert
export type SubChat = typeof subChats.$inferSelect
export type NewSubChat = typeof subChats.$inferInsert
export type ClaudeCodeCredential = typeof claudeCodeCredentials.$inferSelect
export type NewClaudeCodeCredential = typeof claudeCodeCredentials.$inferInsert
export type AnthropicAccount = typeof anthropicAccounts.$inferSelect
export type NewAnthropicAccount = typeof anthropicAccounts.$inferInsert
export type AnthropicSettings = typeof anthropicSettings.$inferSelect
export type TokenUsage = typeof tokenUsage.$inferSelect
export type NewTokenUsage = typeof tokenUsage.$inferInsert
