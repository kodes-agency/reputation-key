// Metric context — the Portals overview's batched results read.
//
// Answers for every requested Portal in three statements, however many there
// are: the governed sums (per Portal, per group the reading sat under, per
// measure), the unattributed Google-open clicks, and the evidence for every
// family. It counts exactly what a single Portal's Results view counts, through
// the same definitions (portal-analytics-shared.ts) and the same evidence
// statement (portal-analytics-evidence.sql.ts), so a row here can never disagree
// with that Portal's own Results.
//
// Each statement scans its big table once, filtered to the requested Portals,
// and groups before anything is joined. Never join Portal-sized sets to
// `metric_readings` or `outbox_events` here: the Fleet projection went quadratic
// that way.

import type { Database, Tx } from '#/shared/db'
import { metricReadings } from '#/shared/db/schema'
import { and, count, eq, gte, inArray, isNull, lt, sql, type SQL } from 'drizzle-orm'
import { trace } from '#/shared/observability/trace'
import {
  portalGroupId,
  portalId as toPortalId,
  type OrganizationId,
  type PortalId,
  type PropertyId,
} from '#/shared/domain/ids'
import type {
  PortalResultsCell,
  PortalResultsOverviewRepository,
  PortalResultsPortalEvidence,
  PortalResultsWindow,
} from '../../application/ports/portal-results-overview.repository'
import { portalMetricEvidenceSql } from './portal-analytics-evidence.sql'
import {
  PORTAL_DESTINATION_CLICK_KEY,
  countedPortalReadingWhere,
  currentCorrectionTips,
  effectiveValue,
  foldEvidenceRows,
  governedPortalWhere,
  portalEvidenceFamilies,
  withStatementTimeout,
  type EvidenceRow,
} from './portal-analytics-shared'

type Roster = Readonly<{
  /** Lower-cased, the way the database prints a uuid. */
  portalIds: readonly PortalId[]
  propertyIds: readonly PropertyId[]
}>

function windowedScope(
  organizationId: OrganizationId,
  roster: Roster,
  window: PortalResultsWindow,
): SQL | undefined {
  return and(
    eq(metricReadings.organizationId, organizationId),
    inArray(metricReadings.propertyId, [...roster.propertyIds]),
    inArray(metricReadings.portalId, [...roster.portalIds]),
    gte(metricReadings.eventAt, window.startAt),
    lt(metricReadings.eventAt, window.endAt),
  )
}

async function readCells(
  db: Database,
  tx: Tx,
  scope: SQL | undefined,
): Promise<readonly PortalResultsCell[]> {
  const correctionTips = currentCorrectionTips(db)
  const value = effectiveValue(correctionTips)
  const rows = await tx
    .select({
      portalId: metricReadings.portalId,
      groupId: metricReadings.groupId,
      metricKey: metricReadings.metricKey,
      total: sql<number>`SUM(${value})`,
      count: count(value),
    })
    .from(metricReadings)
    .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
    .where(and(governedPortalWhere(scope), countedPortalReadingWhere(value)))
    .groupBy(metricReadings.portalId, metricReadings.groupId, metricReadings.metricKey)
  return rows.flatMap((row) =>
    row.portalId === null
      ? []
      : [
          {
            portalId: toPortalId(row.portalId),
            groupId: row.groupId === null ? null : portalGroupId(row.groupId),
            metricKey: row.metricKey,
            total: Number(row.total ?? 0),
            count: Number(row.count ?? 0),
          },
        ],
  )
}

/** Google-open readings that never recorded which link was opened, per Portal. */
async function readUnattributedClicks(
  db: Database,
  tx: Tx,
  scope: SQL | undefined,
): Promise<ReadonlyMap<string, number>> {
  const correctionTips = currentCorrectionTips(db)
  const value = effectiveValue(correctionTips)
  const rows = await tx
    .select({ portalId: metricReadings.portalId, total: count(value) })
    .from(metricReadings)
    .leftJoin(correctionTips, eq(correctionTips.readingId, metricReadings.id))
    .where(
      and(
        governedPortalWhere(scope),
        eq(metricReadings.metricKey, PORTAL_DESTINATION_CLICK_KEY),
        isNull(metricReadings.portalDestinationKind),
      ),
    )
    .groupBy(metricReadings.portalId)
  return new Map(
    rows.flatMap((row) =>
      row.portalId === null ? [] : [[row.portalId, Number(row.total)]],
    ),
  )
}

export const createPortalResultsOverviewRepository = (
  db: Database,
  clock: () => Date,
): PortalResultsOverviewRepository => ({
  async readWindow({ organizationId, portals, window }) {
    return trace('metric.portalResultsOverview.readWindow', async () => {
      const computedAt = clock()
      if (portals.length === 0) return { computedAt, cells: [], evidence: [] }

      const roster: Roster = {
        portalIds: portals.map((portal) => toPortalId(portal.portalId.toLowerCase())),
        propertyIds: [
          ...new Set(portals.map((portal) => portal.propertyId.toLowerCase())),
        ] as PropertyId[],
      }
      const scope = windowedScope(organizationId, roster, window)
      const { cells, unattributed, evidenceRows } = await withStatementTimeout(
        db,
        async (tx) => ({
          cells: await readCells(db, tx, scope),
          unattributed: await readUnattributedClicks(db, tx, scope),
          evidenceRows: (
            await tx.execute(
              portalMetricEvidenceSql(portalEvidenceFamilies(), {
                organizationId,
                portalIds: roster.portalIds,
                propertyIds: roster.propertyIds,
                startDate: window.startAt,
                endDate: window.endAt,
              }),
            )
          ).rows as EvidenceRow[],
        }),
      )

      const byPortal = foldEvidenceRows(
        evidenceRows,
        roster.portalIds,
        unattributed,
        computedAt,
      )
      const evidence: PortalResultsPortalEvidence[] = portals.map((portal, index) => {
        const found = byPortal.get(roster.portalIds[index] ?? '')
        if (!found) throw new Error('Portal metric evidence is incomplete')
        return { portalId: portal.portalId, evidence: found }
      })
      // The database prints ids lower-cased; hand back the caller's own spelling.
      const spelled = new Map(
        portals.map((portal) => [portal.portalId.toLowerCase(), portal.portalId]),
      )
      return {
        computedAt,
        cells: cells.map((cell) => ({
          ...cell,
          portalId: spelled.get(cell.portalId) ?? cell.portalId,
        })),
        evidence,
      }
    })
  },
})
