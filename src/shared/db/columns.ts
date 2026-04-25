// Common column definitions for Drizzle schemas.
// Every business table includes createdAt, updatedAt, and optionally deletedAt.
// Per architecture: "Every business table includes: id, organization_id, created_at, updated_at.
// Soft-deletable tables include deleted_at."

import { timestamp } from 'drizzle-orm/pg-core'

/** Standard `created_at` column — non-null timestamp with timezone, defaults to now(). */
export const createdAtColumn = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow()

/** Standard `updated_at` column — non-null timestamp with timezone, defaults to now(). */
export const updatedAtColumn = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()

/** Standard `deleted_at` column — nullable timestamp with timezone. For soft-deletable tables. */
export const deletedAtColumn = () => timestamp('deleted_at', { withTimezone: true })
