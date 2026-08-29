import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { metricCurrentGoogleReputationSnapshots } from '#/shared/db/schema/metric.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type {
  CurrentGoogleReputationSnapshotStore,
  VerifiedGoogleReputationSnapshotFact,
} from '../../application/ports/current-google-reputation-snapshot.port'

export const CURRENT_GOOGLE_REPUTATION_CONSUMER =
  'metric.current-google-reputation' as const

const aggregatesMatch = (
  current: typeof metricCurrentGoogleReputationSnapshots.$inferSelect,
  incoming: VerifiedGoogleReputationSnapshotFact,
): boolean =>
  current.organizationId === incoming.organizationId &&
  current.propertyId === incoming.propertyId &&
  current.sourceEpoch === incoming.sourceEpoch &&
  current.sourceRunId === incoming.runId &&
  current.sourceEventId === incoming.eventId &&
  current.reviewCount === incoming.reviewCount &&
  current.averageRating === incoming.averageRating &&
  current.evaluatedAt.getTime() === incoming.evaluatedAt.getTime()

type SnapshotTx = Parameters<Parameters<Database['transaction']>[0]>[0]

/** Close out this consumer's receipt without applying the fact. */
async function markReceipt(
  tx: SnapshotTx,
  eventId: string,
  status: 'duplicate' | 'obsolete',
): Promise<void> {
  await tx
    .update(eventConsumerReceipts)
    .set({ status })
    .where(
      and(
        eq(eventConsumerReceipts.eventId, eventId),
        eq(eventConsumerReceipts.consumerName, CURRENT_GOOGLE_REPUTATION_CONSUMER),
      ),
    )
}

/**
 * Compare an incoming fact with the stored snapshot. Throws when the two are
 * contradictory rather than merely ordered.
 */
function decideAgainstCurrentSnapshot(
  current: typeof metricCurrentGoogleReputationSnapshots.$inferSelect,
  incoming: VerifiedGoogleReputationSnapshotFact,
): 'apply' | 'duplicate' | 'obsolete' {
  if (current.organizationId !== incoming.organizationId) {
    throw new Error('Current Google snapshot tenant attribution drifted')
  }
  if (current.sourceEventId === incoming.eventId) {
    if (!aggregatesMatch(current, incoming)) {
      throw new Error('Replayed Google snapshot payload drifted')
    }
    return 'duplicate'
  }
  if (current.sourceRunId === incoming.runId) {
    throw new Error('One verified Google snapshot run emitted conflicting facts')
  }
  if (
    incoming.sourceEpoch < current.sourceEpoch ||
    (incoming.sourceEpoch === current.sourceEpoch &&
      incoming.evaluatedAt.getTime() < current.evaluatedAt.getTime())
  ) {
    return 'obsolete'
  }
  if (
    incoming.sourceEpoch === current.sourceEpoch &&
    incoming.evaluatedAt.getTime() === current.evaluatedAt.getTime()
  ) {
    throw new Error('Verified Google snapshot version is ambiguous')
  }
  return 'apply'
}

export const createCurrentGoogleReputationSnapshotRepository = (
  db: Database,
): CurrentGoogleReputationSnapshotStore => ({
  applyVerifiedSnapshot: async (input) =>
    db.transaction(async (tx) => {
      const reserved = await tx
        .insert(eventConsumerReceipts)
        .values({
          eventId: input.eventId,
          consumerName: CURRENT_GOOGLE_REPUTATION_CONSUMER,
          status: 'applied',
        })
        .onConflictDoNothing()
        .returning({ eventId: eventConsumerReceipts.eventId })
      if (reserved.length === 0) return 'duplicate'

      const propertyRows = await tx
        .select({ sourceEpoch: properties.sourceEpoch })
        .from(properties)
        .where(
          and(
            eq(properties.organizationId, input.organizationId),
            eq(properties.id, input.propertyId),
          ),
        )
        .for('update')
      const property = propertyRows[0]
      if (property == null || input.sourceEpoch < property.sourceEpoch) {
        await markReceipt(tx, input.eventId, 'obsolete')
        return 'obsolete'
      }
      if (input.sourceEpoch > property.sourceEpoch) {
        throw new Error('Verified Google snapshot source epoch is ahead of Property')
      }

      const currentRows = await tx
        .select()
        .from(metricCurrentGoogleReputationSnapshots)
        .where(eq(metricCurrentGoogleReputationSnapshots.propertyId, input.propertyId))
        .for('update')
      const current = currentRows[0]
      if (current) {
        const decision = decideAgainstCurrentSnapshot(current, input)
        if (decision !== 'apply') {
          await markReceipt(tx, input.eventId, decision)
          return decision
        }
      }

      await tx
        .insert(metricCurrentGoogleReputationSnapshots)
        .values({
          propertyId: input.propertyId,
          organizationId: input.organizationId,
          sourceEpoch: input.sourceEpoch,
          sourceRunId: input.runId,
          sourceEventId: input.eventId,
          reviewCount: input.reviewCount,
          averageRating: input.averageRating,
          evaluatedAt: input.evaluatedAt,
          updatedAt: input.evaluatedAt,
        })
        .onConflictDoUpdate({
          target: metricCurrentGoogleReputationSnapshots.propertyId,
          set: {
            organizationId: input.organizationId,
            sourceEpoch: input.sourceEpoch,
            sourceRunId: input.runId,
            sourceEventId: input.eventId,
            reviewCount: input.reviewCount,
            averageRating: input.averageRating,
            evaluatedAt: input.evaluatedAt,
            updatedAt: input.evaluatedAt,
          },
        })
      return 'applied'
    }),

  getCurrentOnGoogle: async (orgId, propertyIdValue) => {
    const rows = await db
      .select({
        organizationId: metricCurrentGoogleReputationSnapshots.organizationId,
        propertyId: metricCurrentGoogleReputationSnapshots.propertyId,
        reviewCount: metricCurrentGoogleReputationSnapshots.reviewCount,
        averageRating: metricCurrentGoogleReputationSnapshots.averageRating,
        evaluatedAt: metricCurrentGoogleReputationSnapshots.evaluatedAt,
      })
      .from(metricCurrentGoogleReputationSnapshots)
      .innerJoin(
        properties,
        and(
          eq(properties.id, metricCurrentGoogleReputationSnapshots.propertyId),
          eq(
            properties.organizationId,
            metricCurrentGoogleReputationSnapshots.organizationId,
          ),
          eq(properties.sourceEpoch, metricCurrentGoogleReputationSnapshots.sourceEpoch),
        ),
      )
      .where(
        and(
          eq(metricCurrentGoogleReputationSnapshots.organizationId, orgId),
          eq(metricCurrentGoogleReputationSnapshots.propertyId, propertyIdValue),
        ),
      )
      .limit(1)
    const row = rows[0]
    return row
      ? {
          semantics: 'current_on_google',
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          reviewCount: row.reviewCount,
          averageRating: row.averageRating,
          verifiedAt: row.evaluatedAt,
        }
      : null
  },
})
