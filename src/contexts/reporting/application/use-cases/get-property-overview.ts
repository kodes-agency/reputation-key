import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals, DashboardData } from '../../domain/dashboard-types'
import type { GetDashboardData, GetDashboardDataInput } from './get-dashboard-data'
import { attentionSignalsFrom } from './get-attention-signals'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  requirePropertyOverviewAccess,
  type DashboardPropertyAccess,
} from '../dashboard-property-access'
import type { ReadGoogleNumbers } from '../google-numbers-read'
import type { GoogleNumbersView } from '../../domain/google-numbers'

export type PropertyOverviewData = Readonly<{
  dashboard: DashboardData
  signals: AttentionSignals
  /**
   * Google's own rating and review count (decision 16): the Rating tile's
   * headline, never RepKey's average. Null when Google never sent numbers for
   * the Property's current binding.
   */
  google: GoogleNumbersView | null
}>

export type GetPropertyOverviewInput = GetDashboardDataInput

export type GetPropertyOverview = (
  input: GetPropertyOverviewInput,
  ctx: AuthContext,
) => Promise<PropertyOverviewData>

export const getPropertyOverview =
  (deps: {
    getDashboardData: GetDashboardData
    propertyAccess: DashboardPropertyAccess
    attention: AttentionSignalsPort
    inboxTargets: Pick<InboxPublicApi, 'getGoogleReviewTargetCountsByProperty'>
    clock: () => Date
    googleNumbers: ReadGoogleNumbers
  }): GetPropertyOverview =>
  async (input, ctx) => {
    // Before the parallel reads: the attention counts are read beside the
    // dashboard, so its own authorize step would not stop them. They also ask
    // more than the dashboard does (`dashboard.fleet_read`).
    await requirePropertyOverviewAccess(deps.propertyAccess, ctx, {
      organizationId: input.organizationId,
      propertyIds: [input.propertyId],
    })
    const now = deps.clock()
    const [dashboard, counts, targetCounts, google] = await Promise.all([
      deps.getDashboardData(input, ctx),
      deps.attention.getAttentionCounts(input.organizationId, input.propertyId),
      deps.inboxTargets.getGoogleReviewTargetCountsByProperty({
        organizationId: input.organizationId,
        propertyIds: [input.propertyId],
        now,
      }),
      deps.googleNumbers(input.organizationId, input.propertyId, now),
    ])

    return {
      dashboard,
      google,
      signals: attentionSignalsFrom(
        {
          ...counts,
          overdue: targetCounts.get(input.propertyId)?.overdueCount ?? 0,
        },
        {
          currentAverage: dashboard.kpis.avgRating.value,
          currentCount: dashboard.kpis.reviews.value,
          priorAverage: dashboard.kpis.avgRating.priorValue,
          priorCount: dashboard.kpis.reviews.priorValue,
        },
      ),
    }
  }
