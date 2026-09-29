// Integration context — the daily GBP push reconciliation.
//
// Why this exists: an account is subscribed to Google's Pub/Sub topic only
// when an import item reaches `subscribe`. Accounts imported while push was
// off or broken — every closed-beta-v2 account imported before 2026-09-29,
// when admission refused all notification calls — are never subscribed again,
// and a changed GBP_PUBSUB_TOPIC is never re-pointed. `ops:gbp-subscribe`
// repairs both but cannot reach a database on a private network, so the repair
// has to run inside the worker, on a schedule.
//
// One run walks every organization with an active Google connection, asks
// current policy whether the organization may run Google work (the tenant-cross
// schedule is only the enumeration boundary), and runs the same backfill the
// operator command does. It is idempotent by construction: `subscribe` reads
// each account's setting and writes only when it differs. It is a no-op when no
// topic is configured.
//
// Organizations run one at a time; Google's rate is bounded by the notification
// quota buckets, which refuse an account (`quota_exhausted`) rather than let it
// through. A refusal like that is transient, so the run asks the queue for a
// retry, which costs one read per account already settled; so is a permit
// fenced at start. A lasting refusal (Google's 403, a denied binding) waits
// for the next day. One organization
// failing does not stop the others, and no organization starts after the
// run's deadline, so a run never outlives its job timeout.

import type { OrganizationId } from '#/shared/domain/ids'
import type {
  GbpSubscribeBackfill,
  GbpSubscribeBackfillReport,
  GbpSubscribeConnectionOutcome,
} from './gbp-subscribe-backfill'
import {
  NO_GBP_ACCOUNTS,
  sumGbpAccountTallies,
  type GbpAccountTally,
} from './manage-notifications'

export type GbpNotificationReconciliationSummary =
  | Readonly<{ status: 'topic_unset' }>
  | Readonly<{
      status: 'reconciled'
      /** Organizations holding an active connection. */
      organizations: number
      /** Refused by current policy (capability, suspension): not touched. */
      organizationsDenied: number
      /** Whose backfill threw (e.g. a database error): retried. */
      organizationsFailed: number
      /** Not started because the run reached its deadline. */
      organizationsDeferred: number
      connections: number
      candidates: number
      connectionOutcomes: Readonly<Partial<Record<GbpSubscribeConnectionOutcome, number>>>
      /** Connections that ended neither subscribed nor in an expected skip. */
      unsettledConnections: number
      accounts: GbpAccountTally
      /** A transient failure the queue should retry soon, not tomorrow. */
      retry: boolean
    }>

export type ReconcileGbpNotificationSubscriptions = (
  input: Readonly<{
    /**
     * Current policy for one concrete organization. Throws when policy cannot
     * be read, which fails the run for a queue retry rather than skipping.
     */
    authorizeOrganization: (organizationId: OrganizationId) => Promise<boolean>
    /** No organization starts at or after this instant. */
    deadlineAtMs: number
  }>,
) => Promise<GbpNotificationReconciliationSummary>

/**
 * Connection outcomes that need nobody: the accounts publish, or there is
 * nothing to subscribe yet (no bound account, a connection that cannot call
 * Google until it is active again — the next run takes it then).
 */
const SETTLED_OUTCOMES: ReadonlySet<GbpSubscribeConnectionOutcome> = new Set([
  'subscribed',
  'already_subscribed',
  'skipped_inactive',
  'account_unresolved',
  'connection_inactive',
])

/**
 * Failure codes a retry within minutes can clear. `authorization_changed` is a
 * permit fenced at start: a race with a binding or credential change, or a
 * worker that runs before the web deploy applied the permit-start migration
 * (drizzle/0039) — both clear on their own, and a fence that does not is
 * worth the failed job it becomes.
 */
const TRANSIENT_FAILURE_CODES: ReadonlySet<string> = new Set([
  'coordination_unavailable',
  'authorization_changed',
  'quota_exhausted',
  'in_flight_exhausted',
  'grant_unavailable',
  'deadline_exceeded',
  'transport_error',
  'provider_429',
])

const isTransientFailure = (code: string): boolean =>
  TRANSIENT_FAILURE_CODES.has(code) || /^provider_5\d\d$/u.test(code)

const mergeCounts = (
  reports: ReadonlyArray<GbpSubscribeBackfillReport>,
): Partial<Record<GbpSubscribeConnectionOutcome, number>> => {
  const counts: Partial<Record<GbpSubscribeConnectionOutcome, number>> = {}
  for (const report of reports) {
    for (const [outcome, count] of Object.entries(report.counts) as Array<
      [GbpSubscribeConnectionOutcome, number]
    >) {
      counts[outcome] = (counts[outcome] ?? 0) + count
    }
  }
  return counts
}

const unsettled = (
  counts: Readonly<Partial<Record<GbpSubscribeConnectionOutcome, number>>>,
): number =>
  (Object.entries(counts) as Array<[GbpSubscribeConnectionOutcome, number]>)
    .filter(([outcome]) => !SETTLED_OUTCOMES.has(outcome))
    .reduce((sum, [, count]) => sum + count, 0)

export const createGbpNotificationReconciliation = (
  deps: Readonly<{
    /** False when GBP_PUBSUB_TOPIC is empty. */
    topicConfigured: boolean
    listOrganizations: () => Promise<ReadonlyArray<OrganizationId>>
    backfill: Pick<GbpSubscribeBackfill, 'apply'>
    nowMs: () => number
  }>,
): ReconcileGbpNotificationSubscriptions => {
  return async ({ authorizeOrganization, deadlineAtMs }) => {
    if (!deps.topicConfigured) return { status: 'topic_unset' }

    const organizations = await deps.listOrganizations()
    const reports: GbpSubscribeBackfillReport[] = []
    let organizationsDenied = 0
    let organizationsFailed = 0
    let started = 0
    for (const organization of organizations) {
      if (deps.nowMs() >= deadlineAtMs) break
      started += 1
      if (!(await authorizeOrganization(organization))) {
        organizationsDenied += 1
        continue
      }
      try {
        reports.push(await deps.backfill.apply(organization))
      } catch {
        organizationsFailed += 1
      }
    }

    const connectionOutcomes = mergeCounts(reports)
    const accounts = sumGbpAccountTallies([
      NO_GBP_ACCOUNTS,
      ...reports.map((report) => report.accounts),
    ])
    return {
      status: 'reconciled',
      organizations: organizations.length,
      organizationsDenied,
      organizationsFailed,
      organizationsDeferred: organizations.length - started,
      connections: reports.reduce((sum, report) => sum + report.connections, 0),
      candidates: reports.reduce((sum, report) => sum + report.candidates, 0),
      connectionOutcomes,
      unsettledConnections: unsettled(connectionOutcomes),
      accounts,
      retry:
        organizationsFailed > 0 ||
        Object.keys(accounts.failureCodes).some(isTransientFailure),
    }
  }
}
