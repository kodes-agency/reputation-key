import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals, DashboardData } from '../../domain/types'
import type { GetDashboardData, GetDashboardDataInput } from './get-dashboard-data'
import { attentionSignalsFrom } from './get-attention-signals'
import type { InboxPublicApi } from '#/contexts/inbox/application/public-api'

export type PropertyOverviewData = Readonly<{
  dashboard: DashboardData
  signals: AttentionSignals
}>

export type GetPropertyOverviewInput = GetDashboardDataInput

export type GetPropertyOverview = (
  input: GetPropertyOverviewInput,
) => Promise<PropertyOverviewData>

export const getPropertyOverview =
  (deps: {
    getDashboardData: GetDashboardData
    attention: AttentionSignalsPort
    inboxTargets: Pick<InboxPublicApi, 'getGoogleReviewTargetCountsByProperty'>
    clock: () => Date
  }): GetPropertyOverview =>
  async (input) => {
    const now = deps.clock()
    const [dashboard, counts, targetCounts] = await Promise.all([
      deps.getDashboardData(input),
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
