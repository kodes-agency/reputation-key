// Inbox context — Drizzle implementation of the bounded actor directory.
//
// Reads `member` INNER JOIN `user`, fenced to one Organization. The join is the
// fence: a user id that is not a current member of this Organization produces
// no row, so a caller can never turn a foreign id into a name by asking nicely.
// Only `user.name` is selected — email is deliberately never read, because the
// caller's fallback must be an opaque placeholder, not a contact address.

import { and, eq, inArray } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member, user } from '#/shared/db/schema/auth'
import { trace } from '#/shared/observability/trace'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'
import {
  MAX_INBOX_ACTOR_DIRECTORY_BATCH,
  type InboxActorDirectory,
} from '../../application/ports/inbox-actor-directory.port'
import { inboxError } from '../../domain/errors'

export const createInboxActorDirectoryAdapter = (db: Database): InboxActorDirectory =>
  Object.freeze({
    resolveDisplayNames: async (
      organizationId: OrganizationId,
      userIds: readonly UserId[],
    ): Promise<ReadonlyMap<UserId, string>> => {
      // Deduplicate before bounding: a 200-entry history routinely names the
      // same three managers, and that must not count against the batch cap.
      const unique = [...new Set(userIds)].sort()
      if (unique.length === 0) return new Map()
      if (unique.length > MAX_INBOX_ACTOR_DIRECTORY_BATCH) {
        throw inboxError('invalid_input', 'Actor directory batch is too large', {
          requested: unique.length,
          maximum: MAX_INBOX_ACTOR_DIRECTORY_BATCH,
        })
      }

      return trace('inboxActorDirectory.resolveDisplayNames', async () => {
        const rows = await db
          .select({ userId: member.userId, name: user.name })
          .from(member)
          .innerJoin(user, eq(user.id, member.userId))
          .where(
            and(
              eq(member.organizationId, organizationId),
              inArray(member.userId, unique as string[]),
            ),
          )
        const resolved = new Map<UserId, string>()
        for (const row of rows) {
          const displayName = row.name.trim()
          // An empty name is not a display name. Leaving it out keeps "unknown"
          // a single, unambiguous state for every caller.
          if (displayName.length === 0) continue
          resolved.set(toUserId(row.userId), displayName)
        }
        return resolved
      })
    },
  })
