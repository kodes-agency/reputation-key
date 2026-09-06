import { and, eq, gt } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  recentActivityEntries,
  recentActivityActorLabelRedactions,
  recentActivityReplayFacts,
  type RecentActivityReplayFactRow,
} from '#/shared/db/schema/activity.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import {
  recentActivityEntryId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type {
  ActivityDeliveryOutcome,
  ActivityDeliveryStore,
} from '../ports/activity-delivery-store.port'
import type { RecentActivityEntry } from '../domain/types'
import type {
  ProjectableRecentActivityReplayFact,
  RecentActivityReplayFact,
} from '../domain/recent-activity-replay-fact'
import { withRedactedRecentActivityActor } from '../domain/constructors'

type ActivityTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export const valuesForActivityEntry = (
  entry: RecentActivityEntry,
  id = entry.id as string,
) => ({
  id,
  actorId: entry.actorId as string,
  actorName: entry.actorName,
  actorAvatarUrl: entry.actorAvatarUrl,
  actorRole: entry.actorRole,
  action: entry.action,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId,
  propertyId: entry.propertyId as string | null,
  organizationId: entry.organizationId as string,
  payload: entry.payload,
  source: entry.source,
  eventId: entry.eventId,
  createdAt: entry.createdAt,
})

export const updateValuesForActivityEntry = (entry: RecentActivityEntry) => ({
  actorId: entry.actorId as string,
  actorName: entry.actorName,
  actorAvatarUrl: entry.actorAvatarUrl,
  actorRole: entry.actorRole,
  action: entry.action,
  resourceType: entry.resourceType,
  resourceId: entry.resourceId,
  propertyId: entry.propertyId as string | null,
  payload: entry.payload,
  source: entry.source,
  createdAt: entry.createdAt,
})

export const valuesForReplayFact = (fact: RecentActivityReplayFact) => ({
  replayKey: fact.replayKey,
  projectionId: fact.projectionId as string | null,
  sourceKind: fact.sourceKind,
  disposition: fact.disposition,
  sourceEventId: fact.sourceEventId,
  sourceEventType: fact.sourceEventType,
  sourceEventVersion: fact.sourceEventVersion,
  sourceContext: fact.sourceContext,
  sourceAggregateId: fact.sourceAggregateId,
  organizationId: fact.organizationId as string,
  propertyId: fact.propertyId as string | null,
  actorSubjectId: fact.actorSubjectId as string | null,
  actorLabelRedactedAt: fact.actorLabelRedactedAt,
  action: fact.action,
  resourceType: fact.resourceType,
  resourceId: fact.resourceId,
  transitionPayload: fact.payload,
  source: fact.source,
  sourceOccurredAt: fact.sourceOccurredAt,
})

const payloadFromRow = (
  row: RecentActivityReplayFactRow,
): ProjectableRecentActivityReplayFact['payload'] => {
  const value = row.transitionPayload
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Recent Activity replay payload is invalid')
  }
  const payload = value as Record<string, unknown>
  const optionalValue = (key: string): string | null => {
    const item = payload[key]
    if (item === null || item === undefined) return null
    if (typeof item !== 'string') {
      throw new Error('Recent Activity replay transition value is invalid')
    }
    return item
  }
  if (typeof payload.subject !== 'string') {
    throw new Error('Recent Activity replay subject is invalid')
  }
  const bulkId = optionalValue('bulkId')
  return {
    subject: payload.subject,
    from: optionalValue('from'),
    to: optionalValue('to'),
    detail: optionalValue('detail'),
    ...(bulkId ? { bulkId } : {}),
  }
}

export const replayFactFromRow = (
  row: RecentActivityReplayFactRow,
): RecentActivityReplayFact => {
  const sourceKind = row.sourceKind
  if (sourceKind !== 'durable_fact' && sourceKind !== 'legacy_projection_snapshot') {
    throw new Error('Recent Activity replay source kind is invalid')
  }
  const sourceFields = {
    replayKey: row.replayKey,
    sourceKind,
    sourceEventId: row.sourceEventId,
    sourceEventType: row.sourceEventType,
    sourceEventVersion: row.sourceEventVersion,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    organizationId: organizationId(row.organizationId),
    propertyId: row.propertyId ? propertyId(row.propertyId) : null,
    sourceOccurredAt: row.sourceOccurredAt,
  } as const
  if (row.disposition === 'obsolete') {
    return {
      ...sourceFields,
      disposition: 'obsolete',
      projectionId: null,
      actorSubjectId: null,
      actorLabelRedactedAt: null,
      action: null,
      resourceType: null,
      resourceId: null,
      payload: null,
      source: null,
    }
  }
  if (
    row.disposition !== 'projectable' ||
    row.projectionId === null ||
    row.action === null ||
    row.resourceType === null ||
    row.resourceId === null ||
    (row.source !== 'web' && row.source !== 'import')
  ) {
    throw new Error('Recent Activity replay projection fields are invalid')
  }
  return {
    ...sourceFields,
    disposition: 'projectable',
    projectionId: recentActivityEntryId(row.projectionId),
    actorSubjectId: row.actorSubjectId ? userId(row.actorSubjectId) : null,
    actorLabelRedactedAt: row.actorLabelRedactedAt,
    action: row.action as ProjectableRecentActivityReplayFact['action'],
    resourceType: row.resourceType as ProjectableRecentActivityReplayFact['resourceType'],
    resourceId: row.resourceId,
    payload: payloadFromRow(row),
    source: row.source,
  }
}

/** Source identity and disposition — the fields every fact carries. */
const sameReplaySourceAuthority = (
  stored: RecentActivityReplayFact,
  incoming: RecentActivityReplayFact,
): boolean =>
  stored.replayKey === incoming.replayKey &&
  stored.sourceKind === incoming.sourceKind &&
  stored.sourceEventId === incoming.sourceEventId &&
  stored.sourceEventType === incoming.sourceEventType &&
  stored.sourceEventVersion === incoming.sourceEventVersion &&
  stored.sourceContext === incoming.sourceContext &&
  stored.sourceAggregateId === incoming.sourceAggregateId &&
  stored.organizationId === incoming.organizationId &&
  stored.propertyId === incoming.propertyId &&
  stored.sourceOccurredAt.getTime() === incoming.sourceOccurredAt.getTime() &&
  stored.disposition === incoming.disposition

/**
 * A redacted stored fact keeps its authority when the actor label is gone;
 * otherwise both sides must agree on the actor and neither may be redacted.
 */
const sameReplayActorAuthority = (
  stored: ProjectableRecentActivityReplayFact,
  incoming: ProjectableRecentActivityReplayFact,
): boolean =>
  stored.actorLabelRedactedAt
    ? stored.actorSubjectId === null
    : stored.actorSubjectId === incoming.actorSubjectId &&
      incoming.actorLabelRedactedAt === null

/** Projection fields — only present once both facts are projectable. */
const sameReplayProjectionAuthority = (
  stored: ProjectableRecentActivityReplayFact,
  incoming: ProjectableRecentActivityReplayFact,
): boolean =>
  sameReplayActorAuthority(stored, incoming) &&
  stored.action === incoming.action &&
  stored.resourceType === incoming.resourceType &&
  stored.resourceId === incoming.resourceId &&
  stored.source === incoming.source &&
  stored.payload.subject === incoming.payload.subject &&
  stored.payload.from === incoming.payload.from &&
  stored.payload.to === incoming.payload.to &&
  stored.payload.detail === incoming.payload.detail &&
  (stored.payload.bulkId ?? null) === (incoming.payload.bulkId ?? null)

const sameReplayAuthority = (
  stored: RecentActivityReplayFact,
  incoming: RecentActivityReplayFact,
): boolean => {
  if (!sameReplaySourceAuthority(stored, incoming)) return false
  // Dispositions are already known equal, so an obsolete pair matches outright
  // and the remaining pair is projectable on both sides.
  if (stored.disposition === 'obsolete' || incoming.disposition === 'obsolete') {
    return stored.disposition === incoming.disposition
  }
  return sameReplayProjectionAuthority(stored, incoming)
}

const applyActorPrivacyFence = async (
  tx: ActivityTransaction,
  incoming: RecentActivityReplayFact,
): Promise<RecentActivityReplayFact> => {
  if (incoming.disposition === 'obsolete' || incoming.actorSubjectId === null) {
    return incoming
  }
  const fence = await tx
    .select({ redactedAt: recentActivityActorLabelRedactions.redactedAt })
    .from(recentActivityActorLabelRedactions)
    .where(
      and(
        eq(
          recentActivityActorLabelRedactions.organizationId,
          incoming.organizationId as string,
        ),
        eq(
          recentActivityActorLabelRedactions.actorSubjectId,
          incoming.actorSubjectId as string,
        ),
        gt(recentActivityActorLabelRedactions.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (!fence[0]) return incoming
  return {
    ...incoming,
    actorSubjectId: null,
    actorLabelRedactedAt: fence[0].redactedAt,
  }
}

const insertReplayAuthority = async (
  tx: ActivityTransaction,
  fact: RecentActivityReplayFact,
): Promise<RecentActivityReplayFact | null> => {
  const inserted = await tx
    .insert(recentActivityReplayFacts)
    .values(valuesForReplayFact(fact))
    .onConflictDoNothing({ target: recentActivityReplayFacts.replayKey })
    .returning()
  return inserted[0] ? replayFactFromRow(inserted[0]) : null
}

const loadReplayAuthority = async (
  tx: ActivityTransaction,
  replayKey: string,
  organizationId: RecentActivityReplayFact['organizationId'],
): Promise<RecentActivityReplayFact> => {
  const rows = await tx
    .select()
    .from(recentActivityReplayFacts)
    .where(
      and(
        eq(recentActivityReplayFacts.replayKey, replayKey),
        eq(recentActivityReplayFacts.organizationId, organizationId),
      ),
    )
    .limit(1)
  if (!rows[0]) {
    throw new Error('Recent Activity replay authority disappeared during capture')
  }
  return replayFactFromRow(rows[0])
}

/**
 * A durable fact supersedes a legacy snapshot, but it must not resurrect
 * identity the stored projection already owns: an existing projection id and an
 * applied actor-label redaction both survive the promotion.
 */
const promotedOverLegacySnapshot = (
  existing: RecentActivityReplayFact,
  incoming: RecentActivityReplayFact,
): RecentActivityReplayFact => {
  if (incoming.disposition !== 'projectable') return incoming
  if (existing.disposition !== 'projectable') return incoming
  return {
    ...incoming,
    projectionId: existing.projectionId,
    actorSubjectId:
      existing.actorLabelRedactedAt !== null ? null : incoming.actorSubjectId,
    actorLabelRedactedAt: existing.actorLabelRedactedAt,
  }
}

const promoteLegacySnapshot = async (
  tx: ActivityTransaction,
  existing: RecentActivityReplayFact,
  incoming: RecentActivityReplayFact,
): Promise<RecentActivityReplayFact> => {
  const rows = await tx
    .update(recentActivityReplayFacts)
    .set(valuesForReplayFact(promotedOverLegacySnapshot(existing, incoming)))
    .where(
      and(
        eq(recentActivityReplayFacts.replayKey, incoming.replayKey),
        eq(recentActivityReplayFacts.organizationId, incoming.organizationId),
      ),
    )
    .returning()
  if (!rows[0]) throw new Error('Recent Activity replay promotion did not apply')
  return replayFactFromRow(rows[0])
}

/**
 * A redelivery can carry a redaction the stored row predates. The redaction is
 * applied to the stored fact first, so a redacted redelivery does not read as
 * an authority conflict, and is written back so it stays durable.
 */
const applyRedeliveredRedaction = async (
  tx: ActivityTransaction,
  existing: RecentActivityReplayFact,
  incoming: RecentActivityReplayFact,
): Promise<RecentActivityReplayFact> => {
  if (
    existing.disposition !== 'projectable' ||
    incoming.disposition !== 'projectable' ||
    existing.actorLabelRedactedAt !== null ||
    incoming.actorLabelRedactedAt === null
  ) {
    return existing
  }
  const redactedExisting: ProjectableRecentActivityReplayFact = {
    ...existing,
    actorSubjectId: null,
    actorLabelRedactedAt: incoming.actorLabelRedactedAt,
  }
  if (!sameReplayAuthority(redactedExisting, incoming)) {
    throw new Error('Recent Activity replay authority conflicts with redelivery')
  }
  await tx
    .update(recentActivityReplayFacts)
    .set({
      actorSubjectId: null,
      actorLabelRedactedAt: incoming.actorLabelRedactedAt,
    })
    .where(
      and(
        eq(recentActivityReplayFacts.replayKey, incoming.replayKey),
        eq(recentActivityReplayFacts.organizationId, incoming.organizationId),
      ),
    )
  return redactedExisting
}

const ensureReplayAuthority = async (
  tx: ActivityTransaction,
  incoming: RecentActivityReplayFact,
): Promise<RecentActivityReplayFact> => {
  const privacyFencedIncoming = await applyActorPrivacyFence(tx, incoming)
  const inserted = await insertReplayAuthority(tx, privacyFencedIncoming)
  if (inserted) return inserted

  const stored = await loadReplayAuthority(
    tx,
    privacyFencedIncoming.replayKey,
    privacyFencedIncoming.organizationId,
  )
  if (
    stored.sourceKind === 'legacy_projection_snapshot' &&
    privacyFencedIncoming.sourceKind === 'durable_fact'
  ) {
    return promoteLegacySnapshot(tx, stored, privacyFencedIncoming)
  }
  const existing = await applyRedeliveredRedaction(tx, stored, privacyFencedIncoming)
  if (!sameReplayAuthority(existing, privacyFencedIncoming)) {
    throw new Error('Recent Activity replay authority conflicts with redelivery')
  }
  return existing
}

export const createActivityDeliveryStore = (db: Database): ActivityDeliveryStore => ({
  applyOnce: async ({ entry, replayFact, eventId, consumerName }) =>
    db.transaction(async (tx): Promise<ActivityDeliveryOutcome> => {
      const canonicalReplay = await ensureReplayAuthority(tx, replayFact)
      if (canonicalReplay.disposition !== 'projectable') {
        throw new Error('Projectable Recent Activity delivery became obsolete')
      }
      const canonicalEntry = canonicalReplay.actorLabelRedactedAt
        ? withRedactedRecentActivityActor(entry)
        : entry

      const inserted = await tx
        .insert(recentActivityEntries)
        .values(
          valuesForActivityEntry(canonicalEntry, canonicalReplay.projectionId as string),
        )
        .onConflictDoNothing({
          target: [recentActivityEntries.eventId, recentActivityEntries.organizationId],
        })
        .returning({ id: recentActivityEntries.id })
      const status = inserted.length === 1 ? 'applied' : 'duplicate'

      if (status === 'duplicate') {
        // A redelivery may find the existing projection. Re-apply the canonical
        // fact so source time and content-minimal fields converge before the
        // shared receipt and Activity replay authority commit.
        await tx
          .update(recentActivityEntries)
          .set(updateValuesForActivityEntry(canonicalEntry))
          .where(
            and(
              eq(recentActivityEntries.eventId, eventId),
              eq(recentActivityEntries.organizationId, entry.organizationId as string),
            ),
          )
      }

      await tx
        .insert(eventConsumerReceipts)
        .values({ eventId, consumerName, status })
        .onConflictDoNothing()
      return status
    }),

  recordObsolete: async ({ replayFact, eventId, consumerName }) =>
    db.transaction(async (tx) => {
      const canonicalReplay = await ensureReplayAuthority(tx, replayFact)
      if (canonicalReplay.disposition !== 'obsolete') {
        throw new Error('Obsolete Recent Activity delivery became projectable')
      }
      await tx
        .delete(recentActivityEntries)
        .where(
          and(
            eq(recentActivityEntries.eventId, eventId),
            eq(recentActivityEntries.organizationId, replayFact.organizationId as string),
          ),
        )
      await tx
        .insert(eventConsumerReceipts)
        .values({ eventId, consumerName, status: 'obsolete' })
        .onConflictDoNothing()
      return 'obsolete' as const
    }),
})
