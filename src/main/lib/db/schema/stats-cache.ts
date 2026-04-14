import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { subChats } from './index';

export const statsCache = sqliteTable('stats_cache', {
  subChatId: text('sub_chat_id')
    .primaryKey()
    .references(() => subChats.id, { onDelete: 'cascade' }),
  fileCount: integer('file_count').default(0),
  pendingPlans: integer('pending_plans').default(0),
  messageCount: integer('message_count').default(0),
  lastMessagePreview: text('last_message_preview'),
  lastUpdatedAt: integer('last_updated_at', { mode: 'timestamp' }),
  tokensUsed: integer('tokens_used').default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).$defaultFn(
    () => new Date(),
  ),
}, (table) => [
  index('stats_cache_updated_idx').on(table.updatedAt),
]);

export const statsCacheRelations = relations(statsCache, ({ one }) => ({
  subChat: one(subChats, {
    fields: [statsCache.subChatId],
    references: [subChats.id],
  }),
}));

export type StatsCache = typeof statsCache.$inferSelect;
export type NewStatsCache = typeof statsCache.$inferInsert;
