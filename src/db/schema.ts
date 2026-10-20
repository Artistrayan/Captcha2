import { pgTable, text, timestamp, boolean, integer, jsonb, index, uniqueIndex } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  firebaseUid: text('firebase_uid').notNull().unique(),
  email: text('email').notNull().unique(),
  name: text('name').notNull().default(''),
  role: text('role').notNull().default('USER'), // 'USER' | 'ADMIN'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_email_idx').on(table.email),
  uniqueIndex('users_firebase_uid_idx').on(table.firebaseUid),
]);

export const sites = pgTable('sites', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  siteKey: text('site_key').notNull().unique(), // sc_site_...
  domains: jsonb('domains').$type<string[]>().notNull().default([]),
  secretKeyHash: text('secret_key_hash').notNull(), // SHA-256 hash of secret key
  secretKeyPrefix: text('secret_key_prefix').notNull(), // sc_sec_live_
  maskedSecretKey: text('masked_secret_key').notNull(), // sc_sec_••••••••12ab
  challengeDifficulty: text('challenge_difficulty').notNull().default('MEDIUM'), // 'LOW' | 'MEDIUM' | 'HIGH'
  invisibleEnabled: boolean('invisible_enabled').notNull().default(true),
  rateLimitPerMinute: integer('rate_limit_per_minute').notNull().default(600),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('sites_site_key_idx').on(table.siteKey),
  index('sites_user_id_idx').on(table.userId),
]);

export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  hashedSecret: text('hashed_secret').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => [
  index('api_keys_site_id_idx').on(table.siteId),
]);

export const captchaChallenges = pgTable('captcha_challenges', {
  id: text('id').primaryKey(),
  siteKey: text('site_key').notNull().references(() => sites.siteKey, { onDelete: 'cascade' }),
  challengeType: text('challenge_type').notNull().default('IMAGE_SELECTION'), // 'IMAGE_SELECTION' | 'ODD_ONE_OUT' | 'ROTATION_MATCH'
  prompt: text('prompt').notNull(),
  correctAnswerHash: text('correct_answer_hash').notNull(), // Salted SHA-256 of correct answer - NEVER sent to client
  options: jsonb('options').$type<Array<{ id: string; label: string; icon: string }>>().notNull(),
  token: text('token').notNull().unique(), // One-time client token
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attemptsCount: integer('attempts_count').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(4),
  isConsumed: boolean('is_consumed').notNull().default(false),
  solvedAt: timestamp('solved_at', { withTimezone: true }),
  serverVerifiedAt: timestamp('server_verified_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('captcha_challenges_token_idx').on(table.token),
  index('captcha_challenges_site_key_idx').on(table.siteKey),
]);

export const verificationEvents = pgTable('verification_events', {
  id: text('id').primaryKey(),
  siteKey: text('site_key').notNull(),
  token: text('token').notNull(),
  success: boolean('success').notNull(),
  score: integer('score').notNull().default(100), // 0 to 100
  hostname: text('hostname').notNull().default(''),
  action: text('action').notNull().default('verify'),
  clientIp: text('client_ip').notNull().default(''),
  errorCodes: jsonb('error_codes').$type<string[]>().notNull().default([]),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('verification_events_token_idx').on(table.token),
  index('verification_events_site_key_idx').on(table.siteKey),
]);

export const usageRecords = pgTable('usage_records', {
  id: text('id').primaryKey(),
  siteId: text('site_id').notNull().references(() => sites.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  requestsCount: integer('requests_count').notNull().default(0),
  passedCount: integer('passed_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  challengesIssued: integer('challenges_issued').notNull().default(0),
}, (table) => [
  uniqueIndex('usage_records_site_date_idx').on(table.siteId, table.date),
]);

export const auditLogs = pgTable('audit_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  clientIp: text('client_ip').notNull().default(''),
  userAgent: text('user_agent').notNull().default(''),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_logs_user_id_idx').on(table.userId),
]);



export const supportTickets = pgTable('support_tickets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  category: text('category').notNull().default('general'),
  priority: text('priority').notNull().default('normal'),
  status: text('status').notNull().default('open'),
  messages: jsonb('messages').$type<Array<{ id: string; authorId: string; authorRole: string; body: string; createdAt: string }>>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('support_tickets_user_updated_idx').on(table.userId, table.updatedAt),
  index('support_tickets_status_updated_idx').on(table.status, table.updatedAt),
]);

export type SupportTicket = typeof supportTickets.$inferSelect;

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
export type CaptchaChallenge = typeof captchaChallenges.$inferSelect;
export type VerificationEvent = typeof verificationEvents.$inferSelect;
