import { and, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  portalPageEdits,
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { portalAddressDownloads, portalTokens } from '#/shared/db/schema/portal.schema'
import { unbrand } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { trace } from '#/shared/observability/trace'
import type {
  PortalCodeDownloadRow,
  PortalCodeIssuanceRow,
  PortalCodeRevocationRow,
  PortalHistoryPage,
  PortalHistoryRepository,
  PortalPageEditRow,
  PortalPublicationEventRow,
  PortalPublishedVersionRow,
} from '../../application/ports/portal-history.repository'
import { PORTAL_PAGE_EDIT_KINDS } from '../../domain/portal-page-edit'
import { historyBoundCondition, historyIdOrder } from '../portal-history-bound'
import { snapshotFromRow } from './portal-publication.repository'

const MAX_SOURCE_ROWS = 100
/** Versions one read lists; far more than a Portal is ever published. */
const MAX_VERSION_ROWS = 201

const clamp = (page: PortalHistoryPage): number =>
  Number.isSafeInteger(page.limit)
    ? Math.min(MAX_SOURCE_ROWS, Math.max(1, page.limit))
    : 21

export const createPortalHistoryRepository = (
  db: Database,
  logger?: LoggerPort,
): PortalHistoryRepository => ({
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

  listPublishedVersions: (orgId, propertyIdValue, portalIdValue, limit) =>
    trace('portalHistory.listPublishedVersions', async () => {
      const s = portalPublicationSnapshots
      const rows = await db
        .select()
        .from(s)
        .where(
          and(
            eq(s.organizationId, unbrand(orgId)),
            eq(s.propertyId, unbrand(propertyIdValue)),
            eq(s.portalId, unbrand(portalIdValue)),
          ),
        )
        .orderBy(desc(s.version))
        .limit(Math.min(MAX_VERSION_ROWS, Math.max(1, limit)))
      return rows.flatMap((row): PortalPublishedVersionRow[] => {
        const snapshot = snapshotFromRow(row)
        // An immutable snapshot that stops verifying is an integrity problem,
        // not a missing row: say so, since the list will simply skip it.
        if (!snapshot) {
          logger?.warn(
            {
              portalId: row.portalId,
              snapshotId: row.id,
              version: row.version,
            },
            'Portal publication snapshot no longer verifies and is left out of History',
          )
        }
        return snapshot
          ? [
              {
                version: snapshot.version,
                publishedAt: snapshot.createdAt,
                publishedBy: snapshot.createdBy,
                configuration: snapshot.configuration,
              },
            ]
          : []
      })
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
        purpose:
          row.purpose === 'copy' || row.purpose === 'show' ? row.purpose : 'download',
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

  listPageEdits: (orgId, propertyIdValue, portalIdValue, page, since) =>
    trace('portalHistory.listPageEdits', async () => {
      const e = portalPageEdits
      const idText = sql`${e.id}::text`
      const rows = await db
        .select({
          editId: e.id,
          kind: e.changeKind,
          key: e.changeKey,
          actorUserId: e.actorUserId,
          occurredAt: e.occurredAt,
          portalId: e.portalId,
          previousText: e.previousText,
          newText: e.newText,
          editCount: e.editCount,
        })
        .from(e)
        .where(
          and(
            eq(e.organizationId, unbrand(orgId)),
            eq(e.propertyId, unbrand(propertyIdValue)),
            // Filtered here, not after the limit: a row this reader cannot read
            // must not use up a place and make a page look like the last one.
            inArray(e.changeKind, [...PORTAL_PAGE_EDIT_KINDS]),
            or(
              eq(e.portalId, unbrand(portalIdValue)),
              and(isNull(e.portalId), gte(e.occurredAt, since)),
            ),
            historyBoundCondition(e.occurredAt, idText, page.bound),
          ),
        )
        .orderBy(desc(e.occurredAt), desc(historyIdOrder(idText)))
        .limit(clamp(page))
      return rows.flatMap((row): PortalPageEditRow[] => {
        // The WHERE clause already holds the kinds to the list; this narrows the type.
        const kind = PORTAL_PAGE_EDIT_KINDS.find((candidate) => candidate === row.kind)
        if (kind === undefined) return []
        return [
          {
            editId: row.editId,
            kind,
            key: row.key,
            actorUserId: row.actorUserId,
            occurredAt: row.occurredAt,
            propertyWide: row.portalId === null,
            previousText: row.previousText,
            newText: row.newText,
            editCount: row.editCount,
          },
        ]
      })
    }),
})
