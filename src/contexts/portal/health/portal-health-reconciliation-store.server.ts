import { and, asc, eq, gte, inArray, isNull, or } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalHealthIntervals,
  portalResponsibleManagers,
  portalTokens,
  portals,
} from '#/shared/db/schema/portal.schema'
import { portalPublicationActivations } from '#/shared/db/schema/portal-publication.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { eventConsumerReceipts } from '#/shared/db/schema/outbox.schema'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { trace } from '#/shared/observability/trace'
import type {
  PortalHealthReconciliationInput,
  PortalHealthReconciliationStore,
} from './portal-health-reconciliation-store.port.server'
import { portalHealthChanged } from '../domain/events'
import {
  derivePortalHealth,
  type PortalHealthReason,
  type PortalHealthStatus,
} from '../domain/portal-health'
import {
  isPortalPublicationState,
  type PortalPublicationState,
} from '../domain/portal-publication'

const GOOGLE_DESTINATION_STATES = new Set(['verified', 'awaiting_refresh', 'unavailable'])

function publicationState(value: string): PortalPublicationState {
  if (!isPortalPublicationState(value)) {
    throw new Error(`Stored Portal publication state is invalid: ${value}`)
  }
  return value
}

function googleDestinationState(
  value: string | null | undefined,
): 'verified' | 'awaiting_refresh' | 'unavailable' {
  return GOOGLE_DESTINATION_STATES.has(value ?? '')
    ? (value as 'verified' | 'awaiting_refresh' | 'unavailable')
    : 'unavailable'
}

const laterInstant = (left: Date, right: Date): Date =>
  left.getTime() >= right.getTime() ? left : right

/**
 * Recomputes derived Portal Health from committed dependency state. Receipt,
 * interval transition and identifier-only Health fact are one transaction.
 */
export const createPortalHealthReconciliationStore = (
  db: Database,
  runtime: Readonly<{
    clock: () => Date
    idGen: () => string
  }>,
): PortalHealthReconciliationStore => {
  return {
    reconcile: (input: PortalHealthReconciliationInput) =>
      trace('portal.health.reconcileDependencies', async () => {
        const observedAt = runtime.clock()
        const result = await db.transaction(async (tx) => {
          const reserved = await tx
            .insert(eventConsumerReceipts)
            .values({
              eventId: input.eventId,
              consumerName: input.consumerName,
              status: 'applied',
            })
            .onConflictDoNothing()
            .returning({ eventId: eventConsumerReceipts.eventId })
          if (reserved.length === 0) {
            return { status: 'duplicate' as const, changed: 0 }
          }

          // A shared Property lock prevents a dependency writer from changing
          // the row between this read and the health interval transitions.
          const [property] = await tx
            .select({
              lifecycleState: properties.lifecycleState,
              deletedAt: properties.deletedAt,
              googleReviewDestinationState: properties.googleReviewDestinationState,
            })
            .from(properties)
            .where(
              and(
                eq(properties.organizationId, input.organizationId),
                eq(properties.id, input.propertyId),
              ),
            )
            .limit(1)
            .for('share')

          if (!property) return { status: 'applied' as const, changed: 0 }

          const portalRows = await tx
            .select({ id: portals.id, publicationState: portals.publicationState })
            .from(portals)
            .where(
              and(
                eq(portals.organizationId, input.organizationId),
                eq(portals.propertyId, input.propertyId),
                input.portalId ? eq(portals.id, input.portalId) : undefined,
                isNull(portals.deletedAt),
              ),
            )
            .orderBy(asc(portals.id))
            .for('update')

          // Read after the Portal rows are locked, one statement per fact for
          // all of them, one after another on the transaction's own client.
          const portalIds = portalRows.map((portal) => portal.id)
          const withActivation = new Set<string>()
          const withAddress = new Set<string>()
          const withManager = new Set<string>()
          const currentByPortal = new Map<
            string,
            typeof portalHealthIntervals.$inferSelect
          >()
          if (portalIds.length > 0) {
            const activations = await tx
              .selectDistinct({ portalId: portalPublicationActivations.portalId })
              .from(portalPublicationActivations)
              .where(
                and(
                  eq(portalPublicationActivations.organizationId, input.organizationId),
                  eq(portalPublicationActivations.propertyId, input.propertyId),
                  inArray(portalPublicationActivations.portalId, portalIds),
                  isNull(portalPublicationActivations.deactivatedAt),
                ),
              )
            const addresses = await tx
              .selectDistinct({ portalId: portalTokens.portalId })
              .from(portalTokens)
              .where(
                and(
                  eq(portalTokens.organizationId, input.organizationId),
                  eq(portalTokens.propertyId, input.propertyId),
                  inArray(portalTokens.portalId, portalIds),
                  or(
                    eq(portalTokens.status, 'active'),
                    and(
                      eq(portalTokens.status, 'rotating'),
                      gte(portalTokens.gracePeriodEnds, observedAt),
                    ),
                  ),
                ),
              )
            const managers = await tx
              .selectDistinct({ portalId: portalResponsibleManagers.portalId })
              .from(portalResponsibleManagers)
              .where(
                and(
                  eq(portalResponsibleManagers.organizationId, input.organizationId),
                  eq(portalResponsibleManagers.propertyId, input.propertyId),
                  inArray(portalResponsibleManagers.portalId, portalIds),
                  isNull(portalResponsibleManagers.effectiveTo),
                ),
              )
            const intervals = await tx
              .select()
              .from(portalHealthIntervals)
              .where(
                and(
                  eq(portalHealthIntervals.organizationId, input.organizationId),
                  eq(portalHealthIntervals.propertyId, input.propertyId),
                  inArray(portalHealthIntervals.portalId, portalIds),
                  isNull(portalHealthIntervals.effectiveTo),
                ),
              )
            for (const row of activations) withActivation.add(row.portalId)
            for (const row of addresses) withAddress.add(row.portalId)
            for (const row of managers) withManager.add(row.portalId)
            for (const row of intervals) currentByPortal.set(row.portalId, row)
          }

          let changed = 0
          for (const portal of portalRows) {
            const next = derivePortalHealth({
              publicationState: publicationState(portal.publicationState),
              propertyAvailable:
                property.deletedAt === null && property.lifecycleState === 'active',
              hasActivePublicationSnapshot: withActivation.has(portal.id),
              hasResolvablePublicAddress: withAddress.has(portal.id),
              hasResponsibleManager: withManager.has(portal.id),
              googleDestinationState: googleDestinationState(
                property.googleReviewDestinationState,
              ),
            })
            const open = currentByPortal.get(portal.id)
            if (!open) {
              await tx.insert(portalHealthIntervals).values({
                id: runtime.idGen(),
                organizationId: input.organizationId,
                propertyId: input.propertyId,
                portalId: portal.id,
                status: next.status,
                reason: next.reason,
                sourceVersion: input.sourceVersion,
                effectiveFrom: input.occurredAt,
                effectiveTo: null,
                observedAt: input.occurredAt,
              })
              continue
            }

            if (open.status === next.status && open.reason === next.reason) {
              if (input.occurredAt >= open.observedAt) {
                await tx
                  .update(portalHealthIntervals)
                  .set({
                    sourceVersion: input.sourceVersion,
                    observedAt: input.occurredAt,
                  })
                  .where(eq(portalHealthIntervals.id, open.id))
              }
              continue
            }

            const effectiveFrom =
              input.occurredAt <= open.effectiveFrom
                ? new Date(open.effectiveFrom.getTime() + 1)
                : input.occurredAt
            await tx
              .update(portalHealthIntervals)
              .set({ effectiveTo: effectiveFrom })
              .where(eq(portalHealthIntervals.id, open.id))
            await tx.insert(portalHealthIntervals).values({
              id: runtime.idGen(),
              organizationId: input.organizationId,
              propertyId: input.propertyId,
              portalId: portal.id,
              status: next.status,
              reason: next.reason,
              sourceVersion: input.sourceVersion,
              effectiveFrom,
              effectiveTo: null,
              observedAt: laterInstant(input.occurredAt, effectiveFrom),
            })
            const fact = portalHealthChanged({
              portalId: portalId(portal.id),
              organizationId: organizationId(input.organizationId),
              propertyId: propertyId(input.propertyId),
              previousStatus: open.status as PortalHealthStatus,
              previousReason: open.reason as PortalHealthReason,
              status: next.status,
              reason: next.reason,
              sourceVersion: input.sourceVersion,
              occurredAt: effectiveFrom,
            })
            await insertOutboxRow(tx, fact, { recordedAt: effectiveFrom })
            changed += 1
          }
          return { status: 'applied' as const, changed }
        })

        return result
      }),
  }
}
