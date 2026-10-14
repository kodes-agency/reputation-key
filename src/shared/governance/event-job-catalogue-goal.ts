// The Goal families of the event/job catalogue, in their own module so the
// catalogue (a file at the length limit) does not carry them: the monthly
// results of Goal Programs, the Property Google rating goal's notice facts and
// the two recurring Goal jobs.
//
// Plain job rows rather than the catalogue's `job()` factory: the factory lives
// in the catalogue, which imports this module, and the retry defaults it bakes
// in are written out here instead. Only the row type is shared, and that
// import is erased at build time.

import type { JobFamilyRow } from './event-job-catalogue'
import { durable, ev, type EventFamilyRow } from './event-job-catalogue-rows'

const ACTIVITY_OUTBOX = 'src/contexts/feed/infrastructure/activity-outbox-consumers.ts'
const NOTIFICATION_GOAL_OUTBOX =
  'src/contexts/feed/infrastructure/goal-outbox-consumers.ts'
const NOTIFICATION_RATING_GOAL_OUTBOX =
  'src/contexts/feed/infrastructure/rating-goal-notice-consumers.ts'

export const GOAL_ROWS: ReadonlyArray<EventFamilyRow> = [
  ev('goal.monthly_result.closed', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-goal-monthly-result-closed', NOTIFICATION_GOAL_OUTBOX),
  ]),
  ev('goal.monthly_result.reconciled', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
  ]),
  ev('goal.monthly_result.revised', [
    durable('activity.recent-activity', ACTIVITY_OUTBOX),
    durable('notification.on-goal-monthly-result-revised', NOTIFICATION_GOAL_OUTBOX),
  ]),
  // One fact per notice a Property's Google rating goal raises (ADR 0067).
  ev('goal.rating_goal.transitioned', [
    durable('notification.on-rating-goal-transitioned', NOTIFICATION_RATING_GOAL_OUTBOX),
  ]),
]

export const GOAL_BACKGROUND_JOB_ROWS: ReadonlyArray<JobFamilyRow> = [
  {
    jobName: 'goal-program.maintain',
    queue: 'background',
    processor:
      'src/contexts/reporting/infrastructure/jobs/goal-program-maintenance.job.ts',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 300_000,
    schedule: 'every:3600000',
    capability: 'goal.use',
    action: 'system:goal.maintain',
    registration: 'enabled',
  },
  // Daily: a rating goal's pace window slides without a new fact from Google,
  // so Below pace is found here (ADR 0067 decision 6).
  {
    jobName: 'rating-goal.evaluate',
    queue: 'background',
    processor: 'src/contexts/reporting/infrastructure/jobs/rating-goal-evaluation.job.ts',
    retryAttempts: 3,
    retryBackoff: 'exponential:30000',
    timeoutMs: 300_000,
    schedule: 'every:86400000,offset:7200000',
    capability: 'goal.use',
    action: 'system:goal.evaluate_rating_goals',
    registration: 'enabled',
  },
]
