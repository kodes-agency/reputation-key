import type {
  FleetCursorAnchor,
  FleetOverviewProjectionPort,
  FleetProjectionScope,
} from '../ports/fleet-overview-projection.port'
import type { AttentionSignals, FleetEntry, FleetOverviewData } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import type { TimeRangePreset } from '../dto/dashboard.dto'
import { computeTrend, isRatingDrop, priorPeriodDates, slaCutoff } from '../utils'
import { dashboardError } from '../../domain/errors'

export type GetFleetOverviewInput = Readonly<{
  organizationId: OrganizationId
  scope: FleetProjectionScope
  portalReadEnabled: boolean
  goalReadEnabled: boolean
  slaHours: number
  startDate: Date
  endDate: Date
  timeRange: TimeRangePreset
  cursor?: string
}>

export type GetFleetOverviewDeps = Readonly<{
  projection: FleetOverviewProjectionPort
  resolveAccessiblePropertyIds(
    organizationId: OrganizationId,
    scope: FleetProjectionScope,
  ): Promise<readonly import('#/shared/domain/ids').PropertyId[] | null>
  clock: () => Date
}>

export type GetFleetOverview = (
  input: GetFleetOverviewInput,
) => Promise<FleetOverviewData>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function encodeFleetCursor(anchor: FleetCursorAnchor): string {
  return Buffer.from(
    JSON.stringify({ n: anchor.lowerName, i: anchor.propertyId }),
    'utf8',
  ).toString('base64url')
}

export function decodeFleetCursor(cursor: string | undefined): FleetCursorAnchor | null {
  if (!cursor) return null
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      n?: unknown
      i?: unknown
    }
    if (
      typeof value.n !== 'string' ||
      value.n.length > 100 ||
      typeof value.i !== 'string' ||
      !UUID.test(value.i)
    ) {
      throw new Error('invalid shape')
    }
    return { lowerName: value.n, propertyId: propertyId(value.i) }
  } catch {
    throw dashboardError('invalid_input', 'Invalid fleet cursor')
  }
}

export const getFleetOverview =
  (deps: GetFleetOverviewDeps): GetFleetOverview =>
  async (input) => {
    const {
      organizationId,
      scope,
      portalReadEnabled,
      goalReadEnabled,
      slaHours,
      startDate,
      endDate,
      timeRange,
    } = input
    const now = deps.clock()
    // priorPeriodDates returns null for 'all' (no prior window). The fleet
    // projection port requires concrete bounds, so this path keeps the
    // historical self-comparison until FleetOverviewQuery admits an absent
    // prior period — same defect class as the portal-analytics fix.
    const { priorStartDate, priorEndDate } = priorPeriodDates(
      timeRange,
      startDate,
      endDate,
    ) ?? { priorStartDate: startDate, priorEndDate: endDate }
    const accessiblePropertyIds = await deps.resolveAccessiblePropertyIds(
      organizationId,
      scope,
    )
    const projection = await deps.projection.read({
      organizationId,
      accessiblePropertyIds,
      portalReadEnabled,
      goalReadEnabled,
      cursor: decodeFleetCursor(input.cursor),
      startDate,
      endDate,
      priorStartDate,
      priorEndDate,
      now,
      slaCutoff: slaCutoff(now, slaHours),
    })

    const entries: FleetEntry[] = projection.rows.map((row) => {
      const ratingDrop = isRatingDrop(row.avgRating, row.priorAvgRating)
      const attentionSignals: AttentionSignals = {
        unanswered: row.unanswered,
        newFeedback: row.newFeedback,
        goalsBehindPace: row.goalsBehindPace,
        ratingDrop,
        escalated: row.escalated,
      }
      return {
        propertyId: row.propertyId,
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        avgRating: row.avgRating,
        avgRatingTrend: computeTrend(row.avgRating, row.priorAvgRating),
        reviewCount: row.reviewCount,
        feedbackCount: row.feedbackCount,
        scanCount: row.scanCount,
        reviewEvidence: row.reviewEvidence,
        scanEvidence: row.scanEvidence,
        feedbackEvidence: row.feedbackEvidence,
        attentionSignals,
        totalAttention:
          row.unanswered +
          row.newFeedback +
          row.goalsBehindPace +
          (ratingDrop ? 1 : 0) +
          row.escalated,
      }
    })

    return {
      entries,
      totals: projection.summary,
      nextCursor: projection.nextAnchor ? encodeFleetCursor(projection.nextAnchor) : null,
    }
  }
