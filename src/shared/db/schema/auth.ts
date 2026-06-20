import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// ─── Better Auth tables ────────────────────────────────────────────
// Column names must be camelCase to match Better Auth's defaults.
// Use `pnpm auth:migrate` to manage auth tables (wraps @better-auth/cli).

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('activeOrganizationId'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: timestamp('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamp('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  updatedAt: timestamp('updatedAt').notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expiresAt').notNull(),
  createdAt: timestamp('createdAt').defaultNow(),
  updatedAt: timestamp('updatedAt').defaultNow(),
})

// ─── Organization plugin tables ────────────────────────────────────
// Read-only Drizzle definitions for querying. Migrations are managed by
// `pnpm auth:migrate` (Better Auth CLI) — NOT by drizzle-kit.
// Column names are camelCase to match Better Auth's defaults.
// These tables are excluded from drizzle.config.ts tablesFilter.

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  organizationId: text('organizationId').notNull(),
  role: text('role').notNull(),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
})

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  createdAt: timestamp('createdAt').notNull().defaultNow(),
  // Additional fields from org-schema.ts (managed by Better Auth CLI)
  contactEmail: text('contactEmail'),
  billingCompanyName: text('billingCompanyName'),
  billingAddress: text('billingAddress'),
  billingCity: text('billingCity'),
  billingPostalCode: text('billingPostalCode'),
  billingCountry: text('billingCountry'),
  responseSlaHours: integer('responseSlaHours'),
})
