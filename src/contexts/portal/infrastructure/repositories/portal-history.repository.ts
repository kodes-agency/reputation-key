import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { portalAddressDownloads, portalTokens } from '#/shared/db/schema/portal.schema'
import { unbrand } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type {
  PortalCodeDownloadRow,
  PortalCodeIssuanceRow,
  PortalCodeRevocationRow,
  PortalHistoryPage,
  PortalHistoryRepository,
  PortalPublicationEventRow,
} from '../../application/ports/portal-history.repository'
import { historyBoundCondition, historyIdOrder } from '../portal-history-bound'

const MAX_SOURCE_ROWS = 100

const clamp = (page: PortalHistoryPage): number =>
  Number.isSafeInteger(page.limit)
    ? Math.min(MAX_SOURCE_ROWS, Math.max(1, page.limit))
    : 21

export const createPortalHistoryRepository = (db: Database): PortalHistoryRepository => ({
  listPublicationEvents: (orgId, propertyIdValue, portalIdValue, page) =>
    trace('portalHistory.listPublicationEvents', async () => {
      const a = portalPublicationActivations
      const idText = sql`${a.id}::text`
      const rows = await db
        .select({
          activationId: a.id,
          version: portalPublicationSnapshots.version,
          kind: a.kind,
          activatedBy: a.activatedBy,
          activatedAt: a.activatedAt,
        })
        .from(a)
        .innerJoin(
          portalPublicationSnapshots,
          and(
            eq(portalPublicationSnapshots.organizationId, a.organizationId),
            eq(portalPublicationSnapshots.propertyId, a.propertyId),
            eq(portalPublicationSnapshots.portalId, a.portalId),
            eq(portalPublicationSnapshots.id, a.snapshotId),
          ),
        )
        .where(
          and(
            eq(a.organizationId, unbrand(orgId)),
            eq(a.propertyId, unbrand(propertyIdValue)),
            eq(a.portalId, unbrand(portalIdValue)),
            historyBoundCondition(a.activatedAt, idText, page.bound),
          ),
        )
        .orderBy(desc(a.activatedAt), desc(historyIdOrder(idText)))
        .limit(clamp(page))
      return rows.map((row): PortalPublicationEventRow => ({
        ...row,
        kind: row.kind === 'rollback' ? 'rollback' : 'publish',
      }))
    }),

  listCodeIssuances: (orgId, propertyIdValue, portalIdValue, page) =>
    trace('portalHistory.listCodeIssuances', async () => {
      const t = portalTokens
      const scope = and(
        eq(t.organizationId, unbrand(orgId)),
        eq(t.propertyId, unbrand(propertyIdValue)),
        eq(t.portalId, unbrand(portalIdValue)),
      )
      const idText = sql`${t.id}::text`
      const issued = await db
        .select({
          tokenId: t.id,
          version: t.version,
          issuedAt: t.issuedAt,
          issuedBy: t.issuedBy,
        })
        .from(t)
        .where(and(scope, historyBoundCondition(t.issuedAt, idText, page.bound)))
        .orderBy(desc(t.issuedAt), desc(historyIdOrder(idText)))
        .limit(clamp(page))
      const previousVersions = [
        ...new Set(issued.filter((row) => row.version > 1).map((row) => row.version - 1)),
      ]
      const predecessors =
        previousVersions.length === 0
          ? []
          : await db
              .select({
                version: t.version,
                revokedAt: t.revokedAt,
                gracePeriodEnds: t.gracePeriodEnds,
              })
              .from(t)
              .where(and(scope, inArray(t.version, previousVersions)))
      const byVersion = new Map(predecessors.map((row) => [row.version, row]))
      return issued.map((row): PortalCodeIssuanceRow => {
        const previous = byVersion.get(row.version - 1)
        return {
          ...row,
          predecessor: previous
            ? { revokedAt: previous.revokedAt, gracePeriodEnds: previous.gracePeriodEnds }
            : null,
        }
      })
    }),

  listCodeDownloads: (orgId, propertyIdValue, portalIdValue, page) =>
    trace('portalHistory.listCodeDownloads', async () => {
      const d = portalAddressDownloads
      const idText = sql`${d.id}::text`
      const rows = await db
        .select({
          downloadId: d.id,
          version: portalTokens.version,
          downloadedBy: d.downloadedBy,
          purpose: d.purpose,
          downloadedAt: d.downloadedAt,
        })
        .from(d)
        .innerJoin(
          portalTokens,
          and(
            eq(portalTokens.organizationId, d.organizationId),
            eq(portalTokens.propertyId, d.propertyId),
            eq(portalTokens.portalId, d.portalId),
            eq(portalTokens.id, d.portalTokenId),
          ),
        )
        .where(
          and(
            eq(d.organizationId, unbrand(orgId)),
            eq(d.propertyId, unbrand(propertyIdValue)),
            eq(d.portalId, unbrand(portalIdValue)),
            historyBoundCondition(d.downloadedAt, idText, page.bound),
          ),
        )
        .orderBy(desc(d.downloadedAt), desc(historyIdOrder(idText)))
        .limit(clamp(page))
      return rows.map((row): PortalCodeDownloadRow => ({
        ...row,
        purpose: row.purpose === 'copy' ? 'copy' : 'download',
      }))
    }),

  listCodeRevocations: (orgId, propertyIdValue, portalIdValue, page) =>
    trace('portalHistory.listCodeRevocations', async () => {
      const t = portalTokens
      const rows = await db
        .select({
          revokedAt: t.revokedAt,
          revokedBy: sql<string | null>`min(${t.revokedBy})`,
          reason: sql<string | null>`min(${t.revokedReason})`,
        })
        .from(t)
        .where(
          and(
            eq(t.organizationId, unbrand(orgId)),
            eq(t.propertyId, unbrand(propertyIdValue)),
            eq(t.portalId, unbrand(portalIdValue)),
            isNotNull(t.revokedAt),
            historyBoundCondition(t.revokedAt, null, page.bound),
          ),
        )
        .groupBy(t.revokedAt)
        .orderBy(desc(t.revokedAt))
        .limit(clamp(page))
      return rows.flatMap((row): PortalCodeRevocationRow[] =>
        row.revokedAt === null ? [] : [{ ...row, revokedAt: row.revokedAt }],
      )
    }),
})
