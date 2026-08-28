import { and, asc, count, eq, gt, gte, isNull, lte, max, min, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  recentActivityEntries,
  recentActivityActorLabelRedactions,
  recentActivityReplayFacts,
} from '#/shared/db/schema/activity.schema'
import { RECENT_ACTIVITY_REPLAY_RETENTION_MS } from '../domain/recent-activity-replay-fact'
import type { ActivityRecoveryStore } from '../ports/activity-recovery-store.port'
import {
  replayFactFromRow,
  updateValuesForActivityEntry,
  valuesForActivityEntry,
} from './activity-delivery-store'

const withinRetainedWindow = (observedAt: Date) =>
  and(
    eq(recentActivityReplayFacts.disposition, 'projectable'),
    gte(
      recentActivityReplayFacts.sourceOccurredAt,
      new Date(observedAt.getTime() - RECENT_ACTIVITY_REPLAY_RETENTION_MS),
    ),
    lte(recentActivityReplayFacts.sourceOccurredAt, observedAt),
  )

const projectionJoin = () =>
  and(
    eq(recentActivityEntries.organizationId, recentActivityReplayFacts.organizationId),
    or(
      eq(recentActivityEntries.id, recentActivityReplayFacts.projectionId),
      and(
        eq(recentActivityEntries.eventId, recentActivityReplayFacts.sourceEventId),
        sql`${recentActivityReplayFacts.sourceEventId} IS NOT NULL`,
      ),
    ),
  )

const actorPrivacyJoin = (observedAt: Date) =>
  and(
    eq(
      recentActivityActorLabelRedactions.organizationId,
      recentActivityReplayFacts.organizationId,
    ),
    eq(
      recentActivityActorLabelRedactions.actorSubjectId,
      recentActivityReplayFacts.actorSubjectId,
    ),
    gt(recentActivityActorLabelRedactions.expiresAt, observedAt),
  )

const assertObservationTime = (value: Date): void => {
  if (Number.isNaN(value.getTime())) {
    throw new Error('Recent Activity recovery observation time is invalid')
  }
}

export const createActivityRecoveryStore = (db: Database): ActivityRecoveryStore => ({
  listMissing: async ({ observedAt, after, limit }) => {
    assertObservationTime(observedAt)
    const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
    const cursor = after
      ? or(
          gt(recentActivityReplayFacts.sourceOccurredAt, after.sourceOccurredAt),
          and(
            eq(recentActivityReplayFacts.sourceOccurredAt, after.sourceOccurredAt),
            gt(recentActivityReplayFacts.replayKey, after.replayKey),
          ),
        )
      : undefined
    const rows = await db
      .select()
      .from(recentActivityReplayFacts)
      .leftJoin(recentActivityEntries, projectionJoin())
      .leftJoin(recentActivityActorLabelRedactions, actorPrivacyJoin(observedAt))
      .where(
        and(withinRetainedWindow(observedAt), cursor, isNull(recentActivityEntries.id)),
      )
      .orderBy(
        asc(recentActivityReplayFacts.sourceOccurredAt),
        asc(recentActivityReplayFacts.replayKey),
      )
      .limit(boundedLimit)
    return rows.map(
      ({
        recent_activity_replay_facts: row,
        recent_activity_actor_label_redactions: redaction,
      }) => {
        const fact = replayFactFromRow(row)
        if (fact.disposition !== 'projectable') {
          throw new Error('Obsolete Recent Activity fact entered the rebuild set')
        }
        return redaction
          ? {
              ...fact,
              actorSubjectId: null,
              actorLabelRedactedAt: redaction.redactedAt,
            }
          : fact
      },
    )
  },

  restoreProjection: async ({ fact, entry }) =>
    db.transaction(async (tx) => {
      if (entry.eventId === null) {
        throw new Error('Recent Activity rebuild entry has no recovery event key')
      }
      const eventId = entry.eventId
      const inserted = await tx
        .insert(recentActivityEntries)
        .values(valuesForActivityEntry(entry, fact.projectionId as string))
        .onConflictDoNothing()
        .returning({ id: recentActivityEntries.id })
      if (inserted[0]) return 'applied' as const

      const byProjectionId = await tx
        .select({
          id: recentActivityEntries.id,
          eventId: recentActivityEntries.eventId,
          organizationId: recentActivityEntries.organizationId,
        })
        .from(recentActivityEntries)
        .where(eq(recentActivityEntries.id, fact.projectionId as string))
        .limit(1)
      const bySourceEvent = byProjectionId[0]
        ? []
        : await tx
            .select({
              id: recentActivityEntries.id,
              eventId: recentActivityEntries.eventId,
              organizationId: recentActivityEntries.organizationId,
            })
            .from(recentActivityEntries)
            .where(
              and(
                eq(recentActivityEntries.eventId, eventId),
                eq(recentActivityEntries.organizationId, entry.organizationId as string),
              ),
            )
            .limit(1)
      const existing = byProjectionId[0] ?? bySourceEvent[0]
      if (
        !existing ||
        existing.organizationId !== (entry.organizationId as string) ||
        (existing.eventId !== null && existing.eventId !== eventId)
      ) {
        throw new Error('Recent Activity rebuild collided with another projection')
      }
      await tx
        .update(recentActivityEntries)
        .set(updateValuesForActivityEntry(entry))
        .where(eq(recentActivityEntries.id, existing.id))
      return 'duplicate' as const
    }),

  readGap: async ({ observedAt }) => {
    assertObservationTime(observedAt)
    return db.transaction(
      async (snapshot) => {
        const [missing] = await snapshot
          .select({
            missingCount: count(recentActivityReplayFacts.replayKey),
            oldestMissingAt: min(recentActivityReplayFacts.sourceOccurredAt),
          })
          .from(recentActivityReplayFacts)
          .leftJoin(recentActivityEntries, projectionJoin())
          .where(and(withinRetainedWindow(observedAt), isNull(recentActivityEntries.id)))
        const [authority] = await snapshot
          .select({
            replayFactCount: count(recentActivityReplayFacts.replayKey),
            legacySnapshotCount: sql<number>`count(*) FILTER (WHERE ${recentActivityReplayFacts.sourceKind} = 'legacy_projection_snapshot')`,
            newestSourceAt: max(recentActivityReplayFacts.sourceOccurredAt),
          })
          .from(recentActivityReplayFacts)
          .where(withinRetainedWindow(observedAt))
        return {
          missingCount: missing?.missingCount ?? 0,
          oldestMissingAt: missing?.oldestMissingAt ?? null,
          newestSourceAt: authority?.newestSourceAt ?? null,
          replayFactCount: authority?.replayFactCount ?? 0,
          legacySnapshotCount: Number(authority?.legacySnapshotCount ?? 0),
        }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )
  },
})
