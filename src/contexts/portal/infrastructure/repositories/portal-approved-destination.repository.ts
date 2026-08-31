import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalApprovedDestinations, portalLinks } from '#/shared/db/schema/portal.schema'
import {
  organizationId,
  portalApprovedDestinationId,
  propertyId,
  unbrand,
  userId,
} from '#/shared/domain/ids'
import type { PortalApprovedDestinationRepository } from '../../application/ports/portal-approved-destination.repository'
import {
  PORTAL_DESTINATION_VALIDATION_VERSION,
  type PortalApprovedDestination,
} from '../../domain/approved-destination'
import { trace } from '#/shared/observability/trace'
import { lockPortalPublicationProperty } from '../portal-publication-serialization'
import { recordPortalPendingContentChange } from '../portal-pending-content-changes'
import type { Tx } from '#/shared/outbox/commit'
import { emitAfterCommit, insertOutboxRow } from '#/shared/outbox/commit'
import type { EventBus } from '#/shared/events/event-bus'
import { portalApprovedDestinationUpdated } from '../../domain/events'

type DestinationRow = typeof portalApprovedDestinations.$inferSelect

async function recordDestinationPending(tx: Tx, row: DestinationRow): Promise<void> {
  const linked = await tx
    .select({ portalId: portalLinks.portalId })
    .from(portalLinks)
    .where(
      and(
        eq(portalLinks.organizationId, row.organizationId),
        eq(portalLinks.propertyId, row.propertyId),
        eq(portalLinks.destinationId, row.id),
      ),
    )
  await recordPortalPendingContentChange(tx, {
    organizationId: row.organizationId,
    propertyId: row.propertyId,
    portalIds: [...new Set(linked.map((link) => link.portalId))],
    kind: 'approved_destination',
    key: row.id,
    sourceVersion: `${row.approvalState}:${row.updatedAt.toISOString()}`,
    changedAt: row.updatedAt,
  })
}

function fromRow(row: DestinationRow): PortalApprovedDestination {
  if (row.validationVersion !== PORTAL_DESTINATION_VALIDATION_VERSION) {
    throw new Error('Stored Portal destination validation version is unsupported')
  }
  return {
    id: portalApprovedDestinationId(row.id),
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    normalizedUri: row.normalizedUri,
    hostname: row.hostname,
    sourceType: row.sourceType as PortalApprovedDestination['sourceType'],
    approvalState: row.approvalState as PortalApprovedDestination['approvalState'],
    validationVersion: row.validationVersion,
    requestedBy: userId(row.requestedBy),
    approvedBy: row.approvedBy ? userId(row.approvedBy) : null,
    approvedAt: row.approvedAt,
    disabledAt: row.disabledAt,
    disabledReason: row.disabledReason,
    lastValidatedAt: row.lastValidatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export const createPortalApprovedDestinationRepository = (
  db: Database,
  events: EventBus,
): PortalApprovedDestinationRepository => ({
  request: (input) =>
    trace('portalApprovedDestination.request', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
        const automaticallyApproved =
          input.destination.sourceType === 'recognized' || input.approveCustom
        const inserted = await tx
          .insert(portalApprovedDestinations)
          .values({
            id: unbrand(input.id),
            organizationId: unbrand(input.organizationId),
            propertyId: unbrand(input.propertyId),
            normalizedUri: input.destination.normalizedUri,
            hostname: input.destination.hostname,
            sourceType: input.destination.sourceType,
            approvalState: automaticallyApproved ? 'approved' : 'pending',
            validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
            requestedBy: unbrand(input.requestedBy),
            approvedBy: automaticallyApproved ? unbrand(input.requestedBy) : null,
            approvedAt: automaticallyApproved ? input.at : null,
            disabledAt: null,
            disabledReason: null,
            lastValidatedAt: input.at,
            createdAt: input.at,
            updatedAt: input.at,
          })
          .onConflictDoNothing({
            target: [
              portalApprovedDestinations.organizationId,
              portalApprovedDestinations.propertyId,
              portalApprovedDestinations.normalizedUri,
            ],
          })
          .returning({ id: portalApprovedDestinations.id })
        let changed = inserted.length > 0
        if (input.approveCustom) {
          // A manager may have created the Pending row first. The later
          // AccountAdmin request is the explicit approval and must be able to
          // promote that same governed destination without changing its ID.
          // Disabled/quarantined rows remain terminal and are never revived.
          const promoted = await tx
            .update(portalApprovedDestinations)
            .set({
              approvalState: 'approved',
              approvedBy: unbrand(input.requestedBy),
              approvedAt: input.at,
              lastValidatedAt: input.at,
              updatedAt: input.at,
            })
            .where(
              and(
                eq(
                  portalApprovedDestinations.organizationId,
                  unbrand(input.organizationId),
                ),
                eq(portalApprovedDestinations.propertyId, unbrand(input.propertyId)),
                eq(
                  portalApprovedDestinations.normalizedUri,
                  input.destination.normalizedUri,
                ),
                eq(portalApprovedDestinations.approvalState, 'pending'),
              ),
            )
            .returning({ id: portalApprovedDestinations.id })
          changed = changed || promoted.length > 0
        }
        const [row] = await tx
          .select()
          .from(portalApprovedDestinations)
          .where(
            and(
              eq(
                portalApprovedDestinations.organizationId,
                unbrand(input.organizationId),
              ),
              eq(portalApprovedDestinations.propertyId, unbrand(input.propertyId)),
              eq(
                portalApprovedDestinations.normalizedUri,
                input.destination.normalizedUri,
              ),
            ),
          )
          .limit(1)
        if (!row) throw new Error('Approved destination disappeared after request')
        if (!changed) return { result: fromRow(row), event: null }
        await recordDestinationPending(tx, row)
        const event = portalApprovedDestinationUpdated({
          approvedDestinationId: portalApprovedDestinationId(row.id),
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          approvalState: row.approvalState as PortalApprovedDestination['approvalState'],
          sourceAggregateVersion: row.updatedAt.toISOString(),
          occurredAt: row.updatedAt,
        })
        await insertOutboxRow(tx, event, { recordedAt: row.updatedAt })
        return { result: fromRow(row), event }
      })
      if (committed.event) await emitAfterCommit(events, committed.event)
      return committed.result
    }),

  findById: (orgId, propertyIdValue, id) =>
    trace('portalApprovedDestination.findById', async () => {
      const [row] = await db
        .select()
        .from(portalApprovedDestinations)
        .where(
          and(
            eq(portalApprovedDestinations.organizationId, unbrand(orgId)),
            eq(portalApprovedDestinations.propertyId, unbrand(propertyIdValue)),
            eq(portalApprovedDestinations.id, unbrand(id)),
          ),
        )
        .limit(1)
      return row ? fromRow(row) : null
    }),

  list: (orgId, propertyIdValue) =>
    trace('portalApprovedDestination.list', async () => {
      const rows = await db
        .select()
        .from(portalApprovedDestinations)
        .where(
          and(
            eq(portalApprovedDestinations.organizationId, unbrand(orgId)),
            eq(portalApprovedDestinations.propertyId, unbrand(propertyIdValue)),
          ),
        )
        .orderBy(
          asc(portalApprovedDestinations.hostname),
          asc(portalApprovedDestinations.id),
        )
      return rows.map(fromRow)
    }),

  listApprovedUris: (orgId, propertyIdValue, uris, validatedAfter) =>
    trace('portalApprovedDestination.listApprovedUris', async () => {
      const uniqueUris = [...new Set(uris)]
      if (uniqueUris.length === 0) return []
      const rows = await db
        .select({ normalizedUri: portalApprovedDestinations.normalizedUri })
        .from(portalApprovedDestinations)
        .where(
          and(
            eq(portalApprovedDestinations.organizationId, unbrand(orgId)),
            eq(portalApprovedDestinations.propertyId, unbrand(propertyIdValue)),
            eq(portalApprovedDestinations.approvalState, 'approved'),
            gte(portalApprovedDestinations.lastValidatedAt, validatedAfter),
            inArray(portalApprovedDestinations.normalizedUri, uniqueUris),
          ),
        )
        .orderBy(asc(portalApprovedDestinations.normalizedUri))
      return rows.map((row) => row.normalizedUri)
    }),

  listDueForNetworkRevalidation: (before, limit) =>
    trace('portalApprovedDestination.listDueForNetworkRevalidation', async () => {
      const rows = await db
        .select()
        .from(portalApprovedDestinations)
        .where(
          and(
            inArray(portalApprovedDestinations.approvalState, ['pending', 'approved']),
            lte(portalApprovedDestinations.lastValidatedAt, before),
          ),
        )
        .orderBy(
          asc(portalApprovedDestinations.lastValidatedAt),
          asc(portalApprovedDestinations.id),
        )
        .limit(Math.min(500, Math.max(1, limit)))
      return rows.map(fromRow)
    }),

  recordNetworkValidation: (input) =>
    trace('portalApprovedDestination.recordNetworkValidation', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
        const safe = input.result.outcome === 'safe'
        const at = safe ? input.result.validatedAt : input.result.observedAt
        const [row] = await tx
          .update(portalApprovedDestinations)
          .set(
            safe
              ? { lastValidatedAt: at }
              : {
                  approvalState: 'quarantined',
                  approvedBy: null,
                  approvedAt: null,
                  disabledAt: at,
                  disabledReason: `network_validation:${input.result.reason}`,
                  updatedAt: at,
                },
          )
          .where(
            and(
              eq(
                portalApprovedDestinations.organizationId,
                unbrand(input.organizationId),
              ),
              eq(portalApprovedDestinations.propertyId, unbrand(input.propertyId)),
              eq(portalApprovedDestinations.id, unbrand(input.id)),
              eq(
                portalApprovedDestinations.lastValidatedAt,
                input.expectedLastValidatedAt,
              ),
              inArray(portalApprovedDestinations.approvalState, ['pending', 'approved']),
            ),
          )
          .returning()
        if (!row || safe) {
          return { result: row ? fromRow(row) : null, event: null }
        }
        await recordDestinationPending(tx, row)
        const event = portalApprovedDestinationUpdated({
          approvedDestinationId: portalApprovedDestinationId(row.id),
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          approvalState: 'quarantined',
          sourceAggregateVersion: row.updatedAt.toISOString(),
          occurredAt: row.updatedAt,
        })
        await insertOutboxRow(tx, event, { recordedAt: row.updatedAt })
        return { result: fromRow(row), event }
      })
      if (committed.event) await emitAfterCommit(events, committed.event)
      return committed.result
    }),

  approve: (input) =>
    trace('portalApprovedDestination.approve', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
        const [row] = await tx
          .update(portalApprovedDestinations)
          .set({
            approvalState: 'approved',
            approvedBy: unbrand(input.approvedBy),
            approvedAt: input.at,
            disabledAt: null,
            disabledReason: null,
            lastValidatedAt: input.at,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(
                portalApprovedDestinations.organizationId,
                unbrand(input.organizationId),
              ),
              eq(portalApprovedDestinations.propertyId, unbrand(input.propertyId)),
              eq(portalApprovedDestinations.id, unbrand(input.id)),
              eq(portalApprovedDestinations.approvalState, 'pending'),
            ),
          )
          .returning()
        if (!row) return { result: null, event: null }
        await recordDestinationPending(tx, row)
        const event = portalApprovedDestinationUpdated({
          approvedDestinationId: portalApprovedDestinationId(row.id),
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          approvalState: 'approved',
          sourceAggregateVersion: row.updatedAt.toISOString(),
          occurredAt: row.updatedAt,
        })
        await insertOutboxRow(tx, event, { recordedAt: row.updatedAt })
        return { result: fromRow(row), event }
      })
      if (committed.event) await emitAfterCommit(events, committed.event)
      return committed.result
    }),

  disable: (input) =>
    trace('portalApprovedDestination.disable', async () => {
      const committed = await db.transaction(async (tx) => {
        await lockPortalPublicationProperty(
          tx,
          unbrand(input.organizationId),
          unbrand(input.propertyId),
        )
        const [row] = await tx
          .update(portalApprovedDestinations)
          .set({
            approvalState: 'disabled',
            approvedBy: null,
            approvedAt: null,
            disabledAt: input.at,
            disabledReason: input.reason,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(
                portalApprovedDestinations.organizationId,
                unbrand(input.organizationId),
              ),
              eq(portalApprovedDestinations.propertyId, unbrand(input.propertyId)),
              eq(portalApprovedDestinations.id, unbrand(input.id)),
            ),
          )
          .returning()
        if (!row) return { result: null, event: null }
        await recordDestinationPending(tx, row)
        const event = portalApprovedDestinationUpdated({
          approvedDestinationId: portalApprovedDestinationId(row.id),
          organizationId: organizationId(row.organizationId),
          propertyId: propertyId(row.propertyId),
          approvalState: 'disabled',
          sourceAggregateVersion: row.updatedAt.toISOString(),
          occurredAt: row.updatedAt,
        })
        await insertOutboxRow(tx, event, { recordedAt: row.updatedAt })
        return { result: fromRow(row), event }
      })
      if (committed.event) await emitAfterCommit(events, committed.event)
      return committed.result
    }),
})
