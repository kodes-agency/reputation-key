// Portal context — the `portal_look_overrides` rows (ADR 0070).
//
// Reads here; a Portal with no row follows the whole Property look and reads
// as null. Every statement names the Organization, and each one that can also
// name the Property does, so a row of another tenant or another Property is
// never read. The composite foreign keys hold writes to a Portal and to images
// of the same Property.

import { and, count, eq, inArray, isNull, ne } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLookOverrides } from '#/shared/db/schema/portal-look.schema'
import { portals } from '#/shared/db/schema/portal.schema'
import { portalId as toPortalId, unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import { lookSourcesOf, portalLookOverrideOf } from '../../domain/portal-look'
import type { PortalLookRepository } from '../../application/ports/portal-look.repository'

export const createPortalLookRepository = (db: Database): PortalLookRepository => ({
  findForPortal: (organizationIdValue, propertyIdValue, portalIdValue) =>
    trace('portalLook.findForPortal', async () => {
      const [row] = await db
        .select()
        .from(portalLookOverrides)
        .where(
          and(
            eq(portalLookOverrides.organizationId, unbrand(organizationIdValue)),
            eq(portalLookOverrides.propertyId, unbrand(propertyIdValue)),
            eq(portalLookOverrides.portalId, unbrand(portalIdValue)),
          ),
        )
        .limit(1)
      return row === undefined ? null : portalLookOverrideOf(row)
    }),

  listSourcesForPortals: (organizationIdValue, portalIdValues) =>
    trace('portalLook.listSourcesForPortals', async () => {
      if (portalIdValues.length === 0) return []
      const rows = await db
        .select()
        .from(portalLookOverrides)
        .where(
          and(
            eq(portalLookOverrides.organizationId, unbrand(organizationIdValue)),
            inArray(
              portalLookOverrides.portalId,
              portalIdValues.map((id) => unbrand(id)),
            ),
          ),
        )
      return rows.map((row) => ({
        portalId: toPortalId(row.portalId),
        sources: lookSourcesOf(portalLookOverrideOf(row)),
      }))
    }),

  countLivePortals: (organizationIdValue, propertyIdValue) =>
    trace('portalLook.countLivePortals', async () => {
      const [row] = await db
        .select({ total: count() })
        .from(portals)
        .where(
          and(
            eq(portals.organizationId, unbrand(organizationIdValue)),
            eq(portals.propertyId, unbrand(propertyIdValue)),
            isNull(portals.deletedAt),
            ne(portals.publicationState, 'archived'),
          ),
        )
      return row?.total ?? 0
    }),

  savePortalLookPart: () =>
    trace('portalLook.savePortalLookPart', () =>
      Promise.reject(
        new Error(
          'Saving a Portal’s own look is not built yet (per-portal looks write path)',
        ),
      ),
    ),
})
