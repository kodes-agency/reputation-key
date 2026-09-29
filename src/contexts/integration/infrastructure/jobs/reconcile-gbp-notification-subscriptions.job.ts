// Daily GBP push reconciliation job.
//
// One run per day re-asserts the Pub/Sub subscription of every GBP account an
// active connection is bound to (see
// `../../application/use-cases/reconcile-gbp-notification-subscriptions`).
// This module is the queue seam plus one content-free summary line.
//
// Cadence: `every:86400000` with no offset. BullMQ runs an interval scheduler
// the moment it is first installed, so the deploy that introduces it (or a
// Queue Redis that lost it) repairs every account right after the worker
// boots; later boots keep the pending run. Accounts imported with push working
// are subscribed by the import itself, so a day is only the bound on repairing
// what that path missed and on following a changed GBP_PUBSUB_TOPIC.
//
// The tenant-cross schedule is only the enumeration boundary: each
// organization is decided again by `authorizeScope` (capability and suspension)
// before any Google call, and job data carries no authority.
//
// Failures: a lasting refusal (Google's 403, a denied binding) is logged and
// left to the next day. A transient one (coordination or quota refusal, a
// permit fenced at start, a 5xx, an organization whose backfill threw) is
// logged, then fails the run so the queue retries it: 5 attempts, exponential
// from 60s — long enough for the per-minute quota buckets to refill, and about
// a quarter of an hour in all, which also covers a worker that booted before
// the web deploy applied the permit-start migration. A retry costs one read
// per account already settled. A policy outage throws from `authorizeScope`.
// Organizations the run's deadline left unstarted are reported and wait for
// the next day.

import type { Job } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { OrganizationId } from '#/shared/domain/ids'
import { trace } from '#/shared/observability/trace'
import type { ReconcileGbpNotificationSubscriptions } from '../../application/use-cases/reconcile-gbp-notification-subscriptions'

export const JOB_NAME = 'reconcile-gbp-notification-subscriptions' as const
const SUMMARY_MESSAGE = 'GBP notification subscriptions reconciled'

/**
 * No organization starts after this much of a run. The catalogue timeout is
 * 600s and the timeout does not cancel the handler, so the margin keeps one
 * run from overlapping its own retry.
 */
export const RUN_BUDGET_MS = 480_000

export const createReconcileGbpNotificationSubscriptionsHandler =
  (
    deps: Readonly<{
      reconcile: ReconcileGbpNotificationSubscriptions
      authorizeScope: (organizationId: OrganizationId) => Promise<boolean>
      nowMs: () => number
      logger: Pick<LoggerPort, 'info' | 'warn'>
    }>,
  ) =>
  async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const summary = await deps.reconcile({
        authorizeOrganization: (organizationId) => deps.authorizeScope(organizationId),
        deadlineAtMs: deps.nowMs() + RUN_BUDGET_MS,
      })
      if (summary.status === 'topic_unset') {
        deps.logger.info(
          { job: JOB_NAME, envVar: 'GBP_PUBSUB_TOPIC' },
          'GBP notification subscription reconciliation skipped — no Pub/Sub topic configured',
        )
        return
      }
      // Counts and codes only: no organization, connection, account or topic.
      const fields = {
        job: JOB_NAME,
        organizations: summary.organizations,
        organizationsDenied: summary.organizationsDenied,
        organizationsFailed: summary.organizationsFailed,
        organizationsDeferred: summary.organizationsDeferred,
        connections: summary.connections,
        candidates: summary.candidates,
        connectionOutcomes: summary.connectionOutcomes,
        unsettledConnections: summary.unsettledConnections,
        accountsSubscribed: summary.accounts.subscribed,
        accountsAlreadySubscribed: summary.accounts.alreadySubscribed,
        accountsFailed: summary.accounts.failed,
        failureCodes: summary.accounts.failureCodes,
      }
      const needsAttention =
        summary.accounts.failed > 0 ||
        summary.unsettledConnections > 0 ||
        summary.organizationsFailed > 0 ||
        summary.organizationsDeferred > 0
      if (needsAttention) {
        deps.logger.warn(fields, SUMMARY_MESSAGE)
      } else {
        deps.logger.info(fields, SUMMARY_MESSAGE)
      }
      if (summary.retry) {
        throw new Error(
          'GBP notification subscription reconciliation incomplete — retrying',
        )
      }
    })
