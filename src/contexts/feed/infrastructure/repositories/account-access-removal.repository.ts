// Feed notification surface — the one user-scoped notification read.
//
// Everything else in this context is organization-scoped (CONTEXT.md invariant
// 2), and this read is a deliberate, narrow exception, not a widening of any
// existing one.
//
// The reason: `account.organization_access_removed` is stored in the
// Organization the reader can no longer open, and removing them deletes their
// sessions. Nobody ever saw the notice. When they sign in again they land on
// `/unavailable`, which told them their workspace "isn't ready" — the copy for
// somebody waiting on a first invitation.
//
// What keeps it narrow:
//   - the caller is the subject. The server function resolves the user from
//     the session and never accepts a user id from the browser;
//   - one type, the one that is about the caller's own account;
//   - the answer is an instant, nothing else. No Organization id or name, no
//     actor, no row id — a removed member must not learn more about a
//     workspace by being removed from it than they knew while inside it.

import { and, desc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { notifications } from '#/shared/db/schema/notification.schema'
import type { UserId } from '#/shared/domain/ids'
import { unbrand } from '#/shared/domain/ids'

/** What the reader is told about their own removal: when it happened. */
export type AccountAccessRemoval = Readonly<{ removedAt: Date }>

export type AccountAccessRemovalReader = Readonly<{
  /** The caller's most recent access-removal notice, or null if there is none. */
  findLatestForUser: (userId: UserId) => Promise<AccountAccessRemoval | null>
}>

export const ACCESS_REMOVED_NOTIFICATION_TYPE = 'account.organization_access_removed'

export const createAccountAccessRemovalReader = (
  db: Database,
): AccountAccessRemovalReader => ({
  findLatestForUser: async (userId) => {
    const rows = await db
      .select({ createdAt: notifications.createdAt })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, unbrand(userId)),
          eq(notifications.type, ACCESS_REMOVED_NOTIFICATION_TYPE),
        ),
      )
      // Someone may have been removed from more than one Organization over
      // time, and only the latest removal explains why they are here now.
      .orderBy(desc(notifications.createdAt))
      .limit(1)
    return rows[0] ? { removedAt: rows[0].createdAt } : null
  },
})
