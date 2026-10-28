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
   * headline, never RepKey's average. They have no window, so only the
   * all-time read carries them: null on a windowed read, and when Google never
   * sent numbers for the Property's current binding.
   */
  google: GoogleNumbersView | null
}>

/** The one range whose read carries Google's numbers (the Overview reads two). */
const GOOGLE_NUMBERS_RANGE = 'all'

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
    /** Opens a review in the Inbox: the lookup behind the recent-review links. */
    inboxItems: Pick<InboxPublicApi, 'getReviewInboxItemIds'>
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
    // Each recent review carries the Inbox item that opens it, so its row can
    // link there: one lookup for at most a handful of ids, through the Inbox's
    // own reader (it applies `inbox.read` and `review.read` over the Property,
    // and answers nothing for a review the reader could not open).
    const linkRecentReviews = async (read: DashboardData): Promise<DashboardData> => {
      if (read.recentReviews.length === 0) return read
      const items = await deps.inboxItems.getReviewInboxItemIds(
        {
          propertyId: input.propertyId,
          reviewIds: read.recentReviews.map((review) => review.id),
        },
        ctx,
      )
      return {
        ...read,
        recentReviews: read.recentReviews.map((review) => ({
          ...review,
          inboxItemId: items.get(review.id) ?? null,
        })),
      }
    }
    const now = deps.clock()
    const [dashboard, counts, targetCounts, google] = await Promise.all([
      deps.getDashboardData(input, ctx).then((read) => linkRecentReviews(read)),
      deps.attention.getAttentionCounts(input.organizationId, input.propertyId),
      deps.inboxTargets.getGoogleReviewTargetCountsByProperty({
        organizationId: input.organizationId,
        propertyIds: [input.propertyId],
        now,
      }),
      input.timeRange === GOOGLE_NUMBERS_RANGE
        ? deps.googleNumbers(input.organizationId, input.propertyId, now)
        : null,
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
