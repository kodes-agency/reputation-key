import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  guestDestinationActionReceipts,
  guestQualifiedScanReceipts,
  guestQualifiedScans,
  scanEvents,
} from '#/shared/db/schema/guest.schema'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type { GuestObservationStore } from '../application/ports/guest-observation-store.port'
import { scanEventToRow } from './mappers/guest.mapper'
import { primaryStaffAttributionEquals } from '#/shared/domain/primary-staff-attribution'

const qualifiedScanAttributionPredicate = (
  attribution: Parameters<typeof primaryStaffAttributionEquals>[0],
) =>
  attribution
    ? and(
        eq(
          guestQualifiedScans.attributedStaffParticipantId,
          attribution.staffParticipantId,
        ),
        eq(
          guestQualifiedScans.attributedStaffParticipationId,
          attribution.staffParticipationId,
        ),
        eq(
          guestQualifiedScans.attributionResponsibilityId,
          attribution.portalResponsibilityId,
        ),
        eq(guestQualifiedScans.staffAttributionEffectiveFrom, attribution.effectiveFrom),
        attribution.effectiveTo
          ? eq(guestQualifiedScans.staffAttributionEffectiveTo, attribution.effectiveTo)
          : isNull(guestQualifiedScans.staffAttributionEffectiveTo),
      )
    : and(
        isNull(guestQualifiedScans.attributedStaffParticipantId),
        isNull(guestQualifiedScans.attributedStaffParticipationId),
        isNull(guestQualifiedScans.attributionResponsibilityId),
        isNull(guestQualifiedScans.staffAttributionEffectiveFrom),
        isNull(guestQualifiedScans.staffAttributionEffectiveTo),
      )

export const createAtomicGuestObservationStore = (
  db: Database,
): GuestObservationStore => {
  return {
    commitScan: (scan, fact) =>
      trace('guest.observationStore.commitScan', async () => {
        if (scan.sessionId === null) {
          throw new Error('new guest observations require a live session pseudonym')
        }
        const sessionId = scan.sessionId
        const outcome = await db.transaction(async (tx) => {
          // The legacy table has no session uniqueness constraint. Serialize
          // this logical anchor without deleting/guessing historical duplicate
          // rows; a later audited migration can add the physical constraint.
          const anchor = `${scan.organizationId}:${scan.portalId}:${sessionId}`
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`,
          )
          const existing = await tx
            .select({ id: scanEvents.id })
            .from(scanEvents)
            .where(
              and(
                eq(scanEvents.organizationId, scan.organizationId),
                eq(scanEvents.portalId, scan.portalId),
                eq(scanEvents.sessionId, sessionId),
              ),
            )
            .limit(1)
          if (existing.length > 0) return 'duplicate' as const
          await tx.insert(scanEvents).values(scanEventToRow(scan))
          await insertOutboxRow(tx, fact)
          return 'applied' as const
        })
        return outcome
      }),

    commitQualifiedScan: (scan, sessionId, fact) =>
      trace('guest.observationStore.commitQualifiedScan', async () => {
        if (
          !sessionId.trim() ||
          scan.id !== fact.qualifiedScanId ||
          scan.sourceEventId !== fact.eventId ||
          scan.organizationId !== fact.organizationId ||
          scan.propertyId !== fact.propertyId ||
          scan.portalId !== fact.portalId ||
          scan.portalGroupId !== fact.portalGroupId ||
          scan.accessArtifactId !== fact.accessArtifactId ||
          scan.occurredAt.getTime() !== fact.occurredAt.getTime() ||
          !primaryStaffAttributionEquals(scan.staffAttribution, fact.staffAttribution)
        ) {
          throw new Error('Qualified Scan does not match its durable fact')
        }
        const outcome = await db.transaction(async (tx) => {
          const anchor = `qualified-scan:${scan.organizationId}:${scan.portalId}:${sessionId}`
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${anchor}, 0))`,
          )
          await tx
            .delete(guestQualifiedScanReceipts)
            .where(
              and(
                eq(guestQualifiedScanReceipts.organizationId, scan.organizationId),
                eq(guestQualifiedScanReceipts.portalId, scan.portalId),
                eq(guestQualifiedScanReceipts.sessionId, sessionId),
                lte(guestQualifiedScanReceipts.expiresAt, scan.occurredAt),
              ),
            )
          const [existing] = await tx
            .select({ id: guestQualifiedScanReceipts.id })
            .from(guestQualifiedScanReceipts)
            .where(
              and(
                eq(guestQualifiedScanReceipts.organizationId, scan.organizationId),
                eq(guestQualifiedScanReceipts.portalId, scan.portalId),
                eq(guestQualifiedScanReceipts.sessionId, sessionId),
                gt(guestQualifiedScanReceipts.expiresAt, scan.occurredAt),
              ),
            )
            .limit(1)
          if (existing) return 'duplicate' as const
          await tx.insert(guestQualifiedScans).values({
            id: scan.id,
            organizationId: scan.organizationId,
            propertyId: scan.propertyId,
            portalId: scan.portalId,
            portalGroupId: scan.portalGroupId,
            accessArtifactId: scan.accessArtifactId,
            sourceEventId: scan.sourceEventId,
            occurredAt: scan.occurredAt,
            attributedStaffParticipantId:
              scan.staffAttribution?.staffParticipantId ?? null,
            attributedStaffParticipationId:
              scan.staffAttribution?.staffParticipationId ?? null,
            attributionResponsibilityId:
              scan.staffAttribution?.portalResponsibilityId ?? null,
            staffAttributionEffectiveFrom: scan.staffAttribution?.effectiveFrom ?? null,
            staffAttributionEffectiveTo: scan.staffAttribution?.effectiveTo ?? null,
          })
          await tx.insert(guestQualifiedScanReceipts).values({
            organizationId: scan.organizationId,
            propertyId: scan.propertyId,
            portalId: scan.portalId,
            sessionId,
            qualifiedScanId: scan.id,
            createdAt: scan.occurredAt,
            expiresAt: new Date(scan.occurredAt.getTime() + 24 * 60 * 60 * 1000),
          })
          await insertOutboxRow(tx, fact, { recordedAt: scan.occurredAt })
          return 'applied' as const
        })
        return outcome
      }),

    retractQualifiedScan: (fact) =>
      trace('guest.observationStore.retractQualifiedScan', async () => {
        const outcome = await db.transaction(async (tx) => {
          const [updated] = await tx
            .update(guestQualifiedScans)
            .set({ retractedAt: fact.occurredAt })
            .where(
              and(
                eq(guestQualifiedScans.id, fact.qualifiedScanId),
                eq(guestQualifiedScans.organizationId, fact.organizationId),
                eq(guestQualifiedScans.propertyId, fact.propertyId),
                eq(guestQualifiedScans.portalId, fact.portalId),
                fact.portalGroupId === null
                  ? isNull(guestQualifiedScans.portalGroupId)
                  : eq(guestQualifiedScans.portalGroupId, fact.portalGroupId),
                eq(guestQualifiedScans.accessArtifactId, fact.accessArtifactId),
                eq(guestQualifiedScans.sourceEventId, fact.supersedesSourceEventId),
                qualifiedScanAttributionPredicate(fact.staffAttribution),
                isNull(guestQualifiedScans.retractedAt),
              ),
            )
            .returning({ id: guestQualifiedScans.id })
          if (!updated) {
            const [duplicate] = await tx
              .select({ id: guestQualifiedScans.id })
              .from(guestQualifiedScans)
              .where(
                and(
                  eq(guestQualifiedScans.id, fact.qualifiedScanId),
                  eq(guestQualifiedScans.sourceEventId, fact.supersedesSourceEventId),
                  qualifiedScanAttributionPredicate(fact.staffAttribution),
                  isNotNull(guestQualifiedScans.retractedAt),
                ),
              )
              .limit(1)
            if (duplicate) return 'duplicate' as const
            throw new Error('Qualified Scan correction source is unavailable')
          }
          await insertOutboxRow(tx, fact, { recordedAt: fact.occurredAt })
          return 'applied' as const
        })
        return outcome
      }),

    commitReviewLinkClick: (action, fact) =>
      trace('guest.observationStore.commitReviewLinkClick', async () => {
        if (
          action.sessionId.trim().length === 0 ||
          action.expiresAt.getTime() <= action.occurredAt.getTime()
        ) {
          throw new Error('qualified destination action requires a live session')
        }
        if (
          action.organizationId !== fact.organizationId ||
          action.propertyId !== fact.propertyId ||
          action.portalId !== fact.portalId ||
          action.destinationId !== fact.linkId ||
          action.destinationKind !== fact.destinationKind ||
          action.occurredAt.getTime() !== fact.occurredAt.getTime()
        ) {
          throw new Error('qualified destination action does not match its fact')
        }
        const outcome = await db.transaction(async (tx) => {
          const inserted = await tx
            .insert(guestDestinationActionReceipts)
            .values({
              organizationId: action.organizationId,
              propertyId: action.propertyId,
              portalId: action.portalId,
              sessionId: action.sessionId,
              destinationId: action.destinationId,
              destinationKind: action.destinationKind,
              expiresAt: action.expiresAt,
              createdAt: action.occurredAt,
            })
            .onConflictDoNothing({
              target: [
                guestDestinationActionReceipts.organizationId,
                guestDestinationActionReceipts.portalId,
                guestDestinationActionReceipts.sessionId,
                guestDestinationActionReceipts.destinationKind,
                guestDestinationActionReceipts.destinationId,
              ],
            })
            .returning({ id: guestDestinationActionReceipts.id })
          if (inserted.length === 0) return 'duplicate' as const
          await insertOutboxRow(tx, fact, { recordedAt: action.occurredAt })
          return 'applied' as const
        })
        return outcome
      }),
  }
}
