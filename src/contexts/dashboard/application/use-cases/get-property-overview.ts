import type { AttentionSignalsPort } from '../ports/attention-signals.port'
import type { AttentionSignals, DashboardData } from '../../domain/types'
import type { GetDashboardData, GetDashboardDataInput } from './get-dashboard-data'
import { attentionSignalsFrom } from './get-attention-signals'

export type PropertyOverviewData = Readonly<{
  dashboard: DashboardData
  signals: AttentionSignals
}>

export type GetPropertyOverviewInput = GetDashboardDataInput &
  Readonly<{ slaHours: number }>

export type GetPropertyOverview = (
  input: GetPropertyOverviewInput,
) => Promise<PropertyOverviewData>

export const getPropertyOverview =
  (deps: {
    getDashboardData: GetDashboardData
    attention: AttentionSignalsPort
  }): GetPropertyOverview =>
  async (input) => {
    const { slaHours, ...dashboardInput } = input
    const [dashboard, counts] = await Promise.all([
      deps.getDashboardData(dashboardInput),
      deps.attention.getAttentionCounts(input.organizationId, input.propertyId, slaHours),
    ])

    return {
      dashboard,
      signals: attentionSignalsFrom(counts, {
        currentAverage: dashboard.kpis.avgRating.value,
        currentCount: dashboard.kpis.reviews.value,
        priorAverage: dashboard.kpis.avgRating.priorValue,
        priorCount: dashboard.kpis.reviews.priorValue,
      }),
    }
  }
