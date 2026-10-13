import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals, DashboardData } from '../../domain/dashboard-types'
import type { GetDashboardData, GetDashboardDataInput } from './get-dashboard-data'
import { attentionSignalsFrom } from './get-attention-signals'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  requireDashboardPropertyAccess,
  type DashboardPropertyAccess,
} from '../dashboard-property-access'

export type PropertyOverviewData = Readonly<{
  dashboard: DashboardData
  signals: AttentionSignals
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
  }): GetPropertyOverview =>
  async (input, ctx) => {
    // Before the parallel reads: the attention counts are read beside the
    // dashboard, so its own authorize step would not stop them.
    await requireDashboardPropertyAccess(deps.propertyAccess, ctx, {
      organizationId: input.organizationId,
      propertyIds: [input.propertyId],
    })
    const now = deps.clock()
    const [dashboard, counts, targetCounts] = await Promise.all([
      deps.getDashboardData(input, ctx),
      deps.attention.getAttentionCounts(input.organizationId, input.propertyId),
      deps.inboxTargets.getGoogleReviewTargetCountsByProperty({
        organizationId: input.organizationId,
        propertyIds: [input.propertyId],
        now,
      }),
    ])

    return {
      dashboard,
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
