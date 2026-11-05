import type {
  FleetCursorAnchor,
  FleetOverviewProjectionPort,
  FleetOverviewProjectionRow,
  FleetProjectionScope,
} from '../ports/fleet-overview-projection.port'
import type {
  FleetEntry,
  FleetOverviewData,
  FleetRatingGoal,
} from '../../domain/dashboard-types'
import { googleNumbersView, ratingGoalOffered } from '../../domain/google-numbers'
import type { OrganizationId } from '#/shared/domain/ids'
import { propertyId } from '#/shared/domain/ids'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
import { dashboardError } from '../../domain/dashboard-errors'

export type GetFleetOverviewInput = Readonly<{
  organizationId: OrganizationId
  scope: FleetProjectionScope
  goalReadEnabled: boolean
  cursor?: string
}>

export type GetFleetOverviewDeps = Readonly<{
  projection: FleetOverviewProjectionPort
  resolveAccessiblePropertyIds(
    organizationId: OrganizationId,
    scope: FleetProjectionScope,
  ): Promise<readonly import('#/shared/domain/ids').PropertyId[] | null>
  clock: () => Date
  inboxTargets: Pick<InboxPublicApi, 'getGoogleReviewTargetCountsByProperty'>
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

/** The list's Google goal cell, from the stored goal; never a live evaluation. */
function fleetRatingGoal(row: FleetOverviewProjectionRow): FleetRatingGoal {
  if (row.ratingGoal !== null) {
    return {
      kind: 'set',
      mode: row.ratingGoal.mode,
      target: row.ratingGoal.targetTenths / 10,
      status: row.ratingGoal.lastStatus,
    }
  }
  return {
    kind: 'none',
    offered: ratingGoalOffered({
      propertyActive: row.lifecycleActive,
      googleReviewCount: row.google?.reviewCount ?? null,
    }),
  }
}

export const getFleetOverview =
  (deps: GetFleetOverviewDeps): GetFleetOverview =>
  async (input) => {
    const { organizationId, scope, goalReadEnabled } = input
    const now = deps.clock()
    const accessiblePropertyIds = await deps.resolveAccessiblePropertyIds(
      organizationId,
      scope,
    )
    const projection = await deps.projection.read({
      organizationId,
      accessiblePropertyIds,
      goalReadEnabled,
      cursor: decodeFleetCursor(input.cursor),
      now,
    })
    const targetCounts = await deps.inboxTargets.getGoogleReviewTargetCountsByProperty({
      organizationId,
      propertyIds: projection.rows.map((row) => row.propertyId),
      now,
    })

    const entries: FleetEntry[] = projection.rows.map((row) => {
      const attentionSignals: FleetEntry['attentionSignals'] = {
        overdue: targetCounts.get(row.propertyId)?.overdueCount ?? 0,
        itemsToTriage: row.itemsToTriage,
        goalsBehindPace: row.goalsBehindPace,
        escalated: row.escalated,
        needsAttention: row.needsAttention,
      }
      return {
        propertyId: row.propertyId,
        name: row.name,
        slug: row.slug,
        timezone: row.timezone,
        attentionSignals,
        totalAttention: row.needsAttention,
        google: googleNumbersView(row.google, row.google?.bindingActive ?? false, now),
        ratingGoal: goalReadEnabled ? fleetRatingGoal(row) : null,
      }
    })

    return {
      entries,
      totals: projection.summary,
      nextCursor: projection.nextAnchor ? encodeFleetCursor(projection.nextAnchor) : null,
    }
  }
