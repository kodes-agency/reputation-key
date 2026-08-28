import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalHealthIntervals } from '#/shared/db/schema/portal.schema'
import { organizationId, portalId, propertyId, unbrand } from '#/shared/domain/ids'
import type { PortalHealthRepository } from '../../application/ports/portal-health.repository'
import type { PortalHealthInterval } from '../../domain/portal-health'
import { portalError } from '../../domain/errors'
import { trace } from '#/shared/observability/trace'

const VALID_STATUS = new Set(['healthy', 'degraded', 'unavailable'])
const VALID_REASON = new Set([
  'operational',
  'publication_draft',
  'publication_disabled',
  'publication_archived',
  'property_unavailable',
  'publication_snapshot_unavailable',
  'public_address_unavailable',
  'responsibility_needed',
  'google_destination_awaiting_refresh',
  'google_destination_unavailable',
])

function fromRow(row: typeof portalHealthIntervals.$inferSelect): PortalHealthInterval {
  if (!VALID_STATUS.has(row.status) || !VALID_REASON.has(row.reason)) {
    throw portalError(
      'publication_snapshot_unavailable',
      'Stored Portal Health is invalid',
    )
  }
  return {
    id: row.id,
    organizationId: organizationId(row.organizationId),
    propertyId: propertyId(row.propertyId),
    portalId: portalId(row.portalId),
    status: row.status as PortalHealthInterval['status'],
    reason: row.reason as PortalHealthInterval['reason'],
    sourceVersion: row.sourceVersion,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    observedAt: row.observedAt,
  }
}

export const createPortalHealthRepository = (db: Database): PortalHealthRepository => ({
  transition: (input) =>
    trace('portalHealth.transition', async () => {
      return db.transaction(async (tx) => {
        await tx.execute(sql`
          SELECT id FROM portals
          WHERE organization_id = ${unbrand(input.organizationId)}
            AND property_id = ${unbrand(input.propertyId)}
            AND id = ${unbrand(input.portalId)}
          FOR UPDATE
        `)
        const [current] = await tx
          .select()
          .from(portalHealthIntervals)
          .where(
            and(
              eq(portalHealthIntervals.organizationId, unbrand(input.organizationId)),
              eq(portalHealthIntervals.propertyId, unbrand(input.propertyId)),
              eq(portalHealthIntervals.portalId, unbrand(input.portalId)),
              isNull(portalHealthIntervals.effectiveTo),
            ),
          )
          .limit(1)
        if (
          current &&
          current.status === input.health.status &&
          current.reason === input.health.reason
        ) {
          const [observed] = await tx
            .update(portalHealthIntervals)
            .set({
              sourceVersion: input.sourceVersion,
              observedAt:
                input.observedAt < current.observedAt
                  ? current.observedAt
                  : input.observedAt,
            })
            .where(eq(portalHealthIntervals.id, current.id))
            .returning()
          if (!observed) throw new Error('Portal Health observation was not saved')
          return fromRow(observed)
        }
        const effectiveFrom =
          current && input.effectiveAt <= current.effectiveFrom
            ? new Date(current.effectiveFrom.getTime() + 1)
            : input.effectiveAt
        if (current) {
          await tx
            .update(portalHealthIntervals)
            .set({ effectiveTo: effectiveFrom })
            .where(eq(portalHealthIntervals.id, current.id))
        }
        const [inserted] = await tx
          .insert(portalHealthIntervals)
          .values({
            id: input.id,
            organizationId: unbrand(input.organizationId),
            propertyId: unbrand(input.propertyId),
            portalId: unbrand(input.portalId),
            status: input.health.status,
            reason: input.health.reason,
            sourceVersion: input.sourceVersion,
            effectiveFrom,
            effectiveTo: null,
            observedAt:
              input.observedAt < effectiveFrom ? effectiveFrom : input.observedAt,
          })
          .returning()
        if (!inserted) throw new Error('Portal Health interval was not saved')
        return fromRow(inserted)
      })
    }),

  getCurrent: (orgId, propertyIdValue, portalIdValue) =>
    trace('portalHealth.getCurrent', async () => {
      const [row] = await db
        .select()
        .from(portalHealthIntervals)
        .where(
          and(
            eq(portalHealthIntervals.organizationId, unbrand(orgId)),
            eq(portalHealthIntervals.propertyId, unbrand(propertyIdValue)),
            eq(portalHealthIntervals.portalId, unbrand(portalIdValue)),
            isNull(portalHealthIntervals.effectiveTo),
          ),
        )
        .limit(1)
      return row ? fromRow(row) : null
    }),

  listHistory: (orgId, propertyIdValue, portalIdValue, requestedLimit) =>
    trace('portalHealth.listHistory', async () => {
      const limit = Number.isSafeInteger(requestedLimit)
        ? Math.min(100, Math.max(1, requestedLimit))
        : 25
      const rows = await db
        .select()
        .from(portalHealthIntervals)
        .where(
          and(
            eq(portalHealthIntervals.organizationId, unbrand(orgId)),
            eq(portalHealthIntervals.propertyId, unbrand(propertyIdValue)),
            eq(portalHealthIntervals.portalId, unbrand(portalIdValue)),
          ),
        )
        .orderBy(desc(portalHealthIntervals.effectiveFrom))
        .limit(limit)
      return rows.map(fromRow)
    }),
})
