import { and, asc, count, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  recentActivityEntries,
  recentActivityActorLabelRedactions,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import {
  REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
  SYSTEM_USER_ID,
} from '../domain/constructors'
import type { RecentActivityPrivacyStore } from '../ports/recent-activity-privacy-store.port'

export const createRecentActivityPrivacyStore = (
  db: Database,
): RecentActivityPrivacyStore => ({
  redactActorLabels: async ({
    organizationId,
    actorSubjectId,
    redactedAt,
    expiresAt,
    limit,
  }) =>
    db.transaction(async (tx) => {
      const org = organizationId as string
      const subject = actorSubjectId as string
      await tx
        .insert(recentActivityActorLabelRedactions)
        .values({ organizationId: org, actorSubjectId: subject, redactedAt, expiresAt })
        .onConflictDoUpdate({
          target: [
            recentActivityActorLabelRedactions.organizationId,
            recentActivityActorLabelRedactions.actorSubjectId,
          ],
          set: { redactedAt, expiresAt },
        })

      const replayRows = await tx
        .select({
          replayKey: recentActivityReplayFacts.replayKey,
          projectionId: recentActivityReplayFacts.projectionId,
        })
        .from(recentActivityReplayFacts)
        .where(
          and(
            eq(recentActivityReplayFacts.organizationId, org),
            eq(recentActivityReplayFacts.actorSubjectId, subject),
            isNull(recentActivityReplayFacts.actorLabelRedactedAt),
          ),
        )
        .orderBy(asc(recentActivityReplayFacts.replayKey))
        .limit(limit)

      if (replayRows.length > 0) {
        await tx
          .update(recentActivityReplayFacts)
          .set({ actorSubjectId: null, actorLabelRedactedAt: redactedAt })
          .where(
            inArray(
              recentActivityReplayFacts.replayKey,
              replayRows.map(({ replayKey }) => replayKey),
            ),
          )
      }

      const projectionRows = await tx
        .select({ id: recentActivityEntries.id })
        .from(recentActivityEntries)
        .where(
          and(
            eq(recentActivityEntries.organizationId, org),
            eq(recentActivityEntries.actorId, subject),
          ),
        )
        .orderBy(asc(recentActivityEntries.createdAt), asc(recentActivityEntries.id))
        .limit(limit)

      if (projectionRows.length > 0) {
        await tx
          .update(recentActivityEntries)
          .set({
            actorId: SYSTEM_USER_ID as string,
            actorName: REDACTED_RECENT_ACTIVITY_ACTOR_NAME,
            actorAvatarUrl: null,
            actorRole: 'Staff',
          })
          .where(
            inArray(
              recentActivityEntries.id,
              projectionRows.map(({ id }) => id),
            ),
          )
      }

      const [replayRemaining] = await tx
        .select({ value: count(recentActivityReplayFacts.replayKey) })
        .from(recentActivityReplayFacts)
        .where(
          and(
            eq(recentActivityReplayFacts.organizationId, org),
            eq(recentActivityReplayFacts.actorSubjectId, subject),
          ),
        )
      const [projectionRemaining] = await tx
        .select({ value: count(recentActivityEntries.id) })
        .from(recentActivityEntries)
        .where(
          and(
            eq(recentActivityEntries.organizationId, org),
            eq(recentActivityEntries.actorId, subject),
          ),
        )

      return {
        redacted: projectionRows.length,
        remaining:
          (replayRemaining?.value ?? 0) > 0 || (projectionRemaining?.value ?? 0) > 0,
      }
    }),
})
