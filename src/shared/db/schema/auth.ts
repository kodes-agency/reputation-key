import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core'

// ─── Better Auth tables ────────────────────────────────────────────
// Column names must be camelCase to match Better Auth's defaults.
// Use `pnpm auth:migrate` to manage auth tables through the pinned Better Auth
// runtime.
//
// This file is a READ-ONLY mirror: the Better Auth schema track is the
// authority for these tables, and the semantic drift test
// (src/shared/db/migration-verification.test.ts) verifies this mirror
// column-by-column against the migrated database. Column types, nullability,
// and defaults below must match what the pinned runtime actually creates
// (timestamptz; defaults only where Better Auth sets them).

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('emailVerified').notNull(),
  image: text('image'),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
  updatedAt: timestamptz('updatedAt').notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamptz('expiresAt').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  activeOrganizationId: text('activeOrganizationId'),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
  updatedAt: timestamptz('updatedAt').notNull(),
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
  accessTokenExpiresAt: timestamptz('accessTokenExpiresAt'),
  refreshTokenExpiresAt: timestamptz('refreshTokenExpiresAt'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
  updatedAt: timestamptz('updatedAt').notNull(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamptz('expiresAt').notNull(),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
  updatedAt: timestamptz('updatedAt').notNull().defaultNow(),
})

// ─── Organization plugin tables ────────────────────────────────────
// Read-only Drizzle definitions for querying. Migrations are managed by
// `pnpm auth:migrate` (Better Auth schema API) — NOT by drizzle-kit.
// Column names are camelCase to match Better Auth's defaults.
// These tables are excluded from drizzle.config.ts (see schema/migratable.ts).

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  organizationId: text('organizationId').notNull(),
  role: text('role').notNull(),
  createdAt: timestamptz('createdAt').notNull(),
})

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  logo: text('logo'),
  createdAt: timestamptz('createdAt').notNull(),
  metadata: text('metadata'),
  // Additional fields from org-schema.ts (managed by Better Auth)
  contactEmail: text('contactEmail'),
})

// Custom role definitions (Better Auth organizationRole). Read-only Drizzle mirror —
// migrations are managed by `pnpm auth:migrate`, not drizzle-kit. `permission` holds the
// JSON permission statement ({ resource: action[] }); the app pairs each role with its
// data_scope via organization_role_policy (dac.schema.ts) to resolve effective permissions.
export const organizationRole = pgTable('organizationRole', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId').notNull(),
  role: text('role').notNull(),
  permission: text('permission').notNull(),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
  updatedAt: timestamptz('updatedAt'),
})

// Organization invitations (Better Auth). Read-only Drizzle mirror — migrations managed
// by `pnpm auth:migrate`. `role` is nullable (custom roles); `propertyIds` is a
// JSON-stringified array consumed on accept. Used by the app-owned acceptInvitation txn.
export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organizationId').notNull(),
  email: text('email').notNull(),
  role: text('role'),
  status: text('status').notNull(),
  expiresAt: timestamptz('expiresAt').notNull(),
  propertyIds: text('propertyIds'),
  inviterId: text('inviterId').notNull(),
  createdAt: timestamptz('createdAt').notNull().defaultNow(),
})
