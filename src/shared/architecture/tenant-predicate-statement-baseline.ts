// S12 — the recorded callables that run an unrestricted tenant statement beside
// a restricted one.
//
// The tenant-predicate canary judges every statement of a repository callable.
// The registry (tenant-predicate-exemptions.ts) answers for the callables in
// which NO statement is restricted to a tenant value. This file answers for the
// rest: a callable that restricts one statement to its tenant and runs another
// that is not, usually a write by id after a scoped read. These were in the
// tree when the rule became per-statement and have not been reviewed one by
// one; the count per callable is recorded so that no new one can join them.
//
// The canary fails when a callable outside this list has such a statement, when
// a listed count grows, and when a listed count is higher than what is found.
// So the list only shrinks: give the statement its tenant predicate, then lower
// or remove the entry. Do not add an entry to get a change through. A statement
// that crosses tenants on purpose belongs in a callable of its own, registered
// in tenant-predicate-exemptions.ts with its reason.
//
// Key: `<file>#<symbol>`. Value: its unrestricted tenant statements, summed
// where a file declares the symbol more than once.

import type { CallableReport } from './tenant-predicate-constraint'

export const UNRESTRICTED_STATEMENT_BASELINE: Readonly<Record<string, number>> = {
  'src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts#settleEphemeralReply': 1,
  'src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts#storeAnalysis': 1,
  'src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts#storeTrendReport': 3,
  'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts#applyAuthorizationLifecycle': 1,
  'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts#approveAssistedReplay': 1,
  'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts#catchUp': 1,
  'src/contexts/ai/infrastructure/adapters/ai-review-analysis-enrollment.adapter.ts#reconcile': 2,
  'src/contexts/ai/infrastructure/adapters/property-processing-profile.adapter.ts#refreshForAi': 1,
  'src/contexts/feed/infrastructure/activity-recovery-store.ts#restoreProjection': 2,
  'src/contexts/feed/infrastructure/operational-action-history-store.ts#readReadiness': 1,
  'src/contexts/feed/infrastructure/operational-action-history-store.ts#redactSubject': 1,
  'src/contexts/feed/infrastructure/recent-activity-privacy-store.ts#redactActorLabels': 2,
  'src/contexts/feed/infrastructure/repositories/notification-digest-batch.repository.ts#settleAccepted': 1,
  'src/contexts/feed/infrastructure/repositories/notification-digest-batch.repository.ts#settleRejected': 1,
  'src/contexts/feed/infrastructure/repositories/notification-digest-batch.repository.ts#settleSuperseded': 1,
  'src/contexts/feed/infrastructure/repositories/notification-digest-batch.repository.ts#suppressAndClose': 1,
  'src/contexts/guest/infrastructure/guest-observation-store.ts#retractQualifiedScan': 1,
  'src/contexts/inbox/infrastructure/feedback-handling.store.ts#correctOutcome': 1,
  'src/contexts/inbox/infrastructure/feedback-handling.store.ts#markHandled': 1,
  'src/contexts/inbox/infrastructure/inbox-command-store.ts#closeCycleOnObservedReply': 1,
  'src/contexts/inbox/infrastructure/inbox-command-store.ts#openNextFeedbackCycleOnResubmission': 1,
  'src/contexts/inbox/infrastructure/inbox-command-store.ts#reopenCycleOnDeletedReply': 1,
  'src/contexts/inbox/infrastructure/inbox-command-store.ts#updateStatus': 1,
  'src/contexts/inbox/infrastructure/inbox-escalation-history.ts#readInboxEscalationHistory': 1,
  'src/contexts/inbox/infrastructure/response-target.store.ts#cancelResponseTargetForCycle': 2,
  'src/contexts/inbox/infrastructure/response-target.store.ts#completeGoogleReviewTarget': 2,
  'src/contexts/inbox/infrastructure/response-target.store.ts#stopPrivateFeedbackTarget': 2,
  'src/contexts/integration/infrastructure/repositories/google-disconnect-revoke.repository.ts#acquireDispatch': 1,
  'src/contexts/portal/infrastructure/portal-command-store.ts#applyPortalHealthMutation': 2,
  'src/contexts/portal/infrastructure/portal-health-reconciliation-store.ts#reconcile': 2,
  'src/contexts/portal/infrastructure/portal-page-edits.ts#foldIntoOpenRow': 1,
  'src/contexts/portal/infrastructure/repositories/portal-experience.repository.ts#saveHeroAltText': 1,
  'src/contexts/portal/infrastructure/repositories/portal-health.repository.ts#transition': 2,
  'src/contexts/property/infrastructure/property-erase-command-store.ts#transition': 1,
  'src/contexts/reporting/infrastructure/repositories/current-google-reputation-snapshot.repository.ts#applyVerifiedSnapshot': 1,
  'src/contexts/review/infrastructure/ai-suggested-draft-store.ts#accept': 3,
  'src/contexts/review/infrastructure/google-reply-observation-store.ts#confirmReplyOnGoogle': 1,
  'src/contexts/review/infrastructure/google-reply-observation-store.ts#supersedeExternalCurrentAttempt': 1,
  'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts#commitPage': 1,
  'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts#finishConfirmationScan': 1,
  'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts#finishMainScan': 2,
  'src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts#sweepExpiredTombstones': 2,
  'src/contexts/review/infrastructure/repositories/source-content-lifecycle-store.repository.ts#applyLifecycleBatch': 1,
}

export type BaselineDrift = Readonly<{
  /** Not in the baseline: restrict the statement, do not list the callable. */
  unlisted: readonly string[]
  /** Listed, and found with more unrestricted statements than recorded. */
  grown: readonly string[]
  /** Listed with more than is found: lower the count, or remove the entry. */
  shrunk: readonly string[]
}>

/**
 * Per `<file>#<symbol>`, the unrestricted tenant statements of the callables
 * that also run a restricted one. A callable with no restricted statement is
 * the registry's business, not this count's.
 */
export function unrestrictedBesideRestricted(
  reports: ReadonlyMap<string, readonly CallableReport[]>,
): ReadonlyMap<string, number> {
  const found = new Map<string, number>()
  for (const [file, callables] of reports) {
    for (const report of callables) {
      const unrestricted = report.tenantStatements - report.restrictedStatements
      if (report.restrictedStatements === 0 || unrestricted === 0) continue
      const key = `${file}#${report.symbol}`
      found.set(key, (found.get(key) ?? 0) + unrestricted)
    }
  }
  return found
}

export function baselineDrift(
  found: ReadonlyMap<string, number>,
  baseline: Readonly<Record<string, number>>,
): BaselineDrift {
  const recorded = new Map(Object.entries(baseline))
  const listed = [...recorded.keys()].sort()
  return {
    unlisted: [...found.keys()].filter((key) => !recorded.has(key)).sort(),
    grown: listed.filter((key) => (found.get(key) ?? 0) > (recorded.get(key) ?? 0)),
    shrunk: listed.filter((key) => (found.get(key) ?? 0) < (recorded.get(key) ?? 0)),
  }
}
