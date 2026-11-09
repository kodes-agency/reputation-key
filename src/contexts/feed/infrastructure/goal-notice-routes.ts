import type { ConsumerRegistry } from '#/shared/outbox'
import {
  handleAiGuestVoiceSummaryReady,
  handleAiReviewUrgentDetected,
  handleNotificationGoalMonthlyResultClosed,
  handleNotificationGoalMonthlyResultRevised,
  handleRatingGoalTransitioned,
  type AiGuestVoiceSummaryNoticeConsumerDeps,
  type AiUrgentReviewNoticeConsumerDeps,
  type GoalNotificationConsumerDeps,
  type RatingGoalNoticeConsumerDeps,
} from '../notify/goals.server'

export function registerGoalNotificationConsumer(
  registry: ConsumerRegistry,
  deps: GoalNotificationConsumerDeps,
): void {
  const { registerConsumer } = registry
  registerConsumer({
    eventType: 'goal.monthly_result.closed',
    consumerName: 'notification.on-goal-monthly-result-closed',
    module: 'notification.goal-outbox-consumers',
    handler: (event) => handleNotificationGoalMonthlyResultClosed(deps, event),
  })
  registerConsumer({
    eventType: 'goal.monthly_result.revised',
    consumerName: 'notification.on-goal-monthly-result-revised',
    module: 'notification.goal-outbox-consumers',
    handler: (event) => handleNotificationGoalMonthlyResultRevised(deps, event),
  })
}

export function registerRatingGoalNoticeConsumer(
  registry: ConsumerRegistry,
  deps: RatingGoalNoticeConsumerDeps,
): void {
  // Literals kept mechanically discoverable by the governance catalogues.
  registry.registerConsumer({
    eventType: 'goal.rating_goal.transitioned',
    consumerName: 'notification.on-rating-goal-transitioned',
    module: 'notification.rating-goal-notice-consumers',
    handler: (event) => handleRatingGoalTransitioned(deps, event),
  })
}

export function registerAiUrgentReviewNoticeConsumer(
  registry: ConsumerRegistry,
  deps: AiUrgentReviewNoticeConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'ai.review_analysis.urgent_detected',
    consumerName: 'notification.on-ai-review-urgent-detected',
    module: 'notification.ai-urgent-review-notice-consumers',
    handler: (event) => handleAiReviewUrgentDetected(deps, event),
  })
}

export function registerAiGuestVoiceSummaryNoticeConsumer(
  registry: ConsumerRegistry,
  deps: AiGuestVoiceSummaryNoticeConsumerDeps,
): void {
  registry.registerConsumer({
    eventType: 'ai.guest_voice_summary.ready',
    consumerName: 'notification.on-ai-guest-voice-summary-ready',
    module: 'notification.ai-guest-voice-summary-notice-consumers',
    handler: (event) => handleAiGuestVoiceSummaryReady(deps, event),
  })
}
