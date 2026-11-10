// Rights executors for Review and Inbox: the manager-authored replies, reply
// library and Response Target policy an Organization holds, exported for an
// access or closure request and purged at closure, or, for a Property request,
// what that one Property holds.
//
// The SQL and its allowlists live in the lifecycle stores; these wrappers only
// adapt them to the executor contract. Closure never calls Google: a reply
// already sent to the provider blocks the purge until it is reconciled.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import type {
  BackupErasureLedgerEntry,
  BackupErasureReplayer,
} from '#/shared/db/lifecycle/backup-erasure-ledger'
import {
  closeInbox,
  closeInboxInTx,
  inboxClosureRefusal,
  INBOX_RIGHTS_TABLES,
  readInboxRightsExport,
  readInboxRightsReport,
  type InboxRightsTarget,
} from '#/shared/db/lifecycle/inbox-rights-store'
import {
  closeReview,
  closeReviewInTx,
  reviewClosureRefusal,
  REVIEW_RIGHTS_TABLES,
  type ReviewRightsTarget,
  readReviewRightsExport,
  readReviewRightsReport,
} from '#/shared/db/lifecycle/review-rights-store'
import {
  requireReplyScopeEffects,
  type ReplyScopeEffects,
} from '#/shared/db/reply-scope-effects'
import type { RightsExecutor } from './rights-executor'
import type { RightsRequestPlan } from './rights-request-command'

export const REVIEW_RIGHTS_EXPORT_PATH = 'review/rights-export.json'
export const INBOX_RIGHTS_EXPORT_PATH = 'inbox/rights-export.json'

export type ReviewInboxRightsDeps = Readonly<{
  db: Database
  now?: () => Date
}>

/** Closing Review writes Replies, so the Reply writer's effects are handed in. */
export type ReviewRightsDeps = ReviewInboxRightsDeps &
  Readonly<{ replyEffects?: ReplyScopeEffects }>

function inboxTarget(plan: RightsRequestPlan): InboxRightsTarget {
  return plan.scope === 'property' && plan.propertyId
    ? { organizationId: plan.organizationId, propertyId: plan.propertyId }
    : plan.organizationId
}

function exportFile(path: string, payload: unknown) {
  return [{ path, bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8') }]
}

/** The Organization id, or the Organization and Property a property request names. */
function reviewTarget(plan: RightsRequestPlan): ReviewRightsTarget {
  return plan.scope === 'property' && plan.propertyId
    ? { organizationId: plan.organizationId, propertyId: plan.propertyId }
    : plan.organizationId
}

export function createReviewRightsExecutor(deps: ReviewRightsDeps): RightsExecutor {
  const now = deps.now ?? (() => new Date())
  return Object.freeze({
    name: 'review',
    scopes: ['access', 'organization', 'property'] as const,
    tables: REVIEW_RIGHTS_TABLES,
    journalContexts: ['review'] as const,
    async preflight(plan) {
      if (plan.scope === 'property' && !plan.propertyId) {
        return { ok: false, error: '--property is required' }
      }
      const refusal = await reviewClosureRefusal(
        deps.db,
        requireReplyScopeEffects(deps.replyEffects),
        reviewTarget(plan),
        now(),
      )
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) => readReviewRightsReport(deps.db, reviewTarget(plan), now()),
    async exportFiles(plan) {
      return exportFile(
        REVIEW_RIGHTS_EXPORT_PATH,
        await readReviewRightsExport(deps.db, plan.organizationId),
      )
    },
    async apply(plan) {
      if (plan.scope === 'property' && !plan.propertyId) {
        return { ok: false, error: '--property is required' }
      }
      const outcome = await closeReview(
        deps.db,
        requireReplyScopeEffects(deps.replyEffects),
        reviewTarget(plan),
        now(),
      )
      return outcome.ok
        ? {
            ok: true,
            lines: [`deleted=${outcome.deleted} scrubbed=${outcome.scrubbed}`],
          }
        : outcome
    },
  })
}

export function createInboxRightsExecutor(deps: ReviewInboxRightsDeps): RightsExecutor {
  const now = deps.now ?? (() => new Date())
  return Object.freeze({
    name: 'inbox',
    scopes: ['access', 'organization', 'property'] as const,
    tables: INBOX_RIGHTS_TABLES,
    journalContexts: ['inbox'] as const,
    async preflight(plan) {
      if (plan.scope === 'property' && !plan.propertyId) {
        return { ok: false, error: '--property is required' }
      }
      const refusal = await inboxClosureRefusal(deps.db, inboxTarget(plan))
      return refusal ? { ok: false, error: refusal } : { ok: true }
    },
    report: (plan) => readInboxRightsReport(deps.db, inboxTarget(plan)),
    async exportFiles(plan) {
      return exportFile(
        INBOX_RIGHTS_EXPORT_PATH,
        await readInboxRightsExport(deps.db, plan.organizationId),
      )
    },
    async apply(plan) {
      if (plan.scope === 'property' && !plan.propertyId) {
        return { ok: false, error: '--property is required' }
      }
      const outcome = await closeInbox(deps.db, inboxTarget(plan), now())
      return outcome.ok ? { ok: true, lines: [`deleted=${outcome.deleted}`] } : outcome
    },
  })
}

const SUBJECT_CLASSES = ['organization', 'property'] as const

/** The Organization, or the Property a journal entry names. */
function entryTarget(
  entry: BackupErasureLedgerEntry,
): ReviewRightsTarget & InboxRightsTarget {
  if (entry.subjectClass !== 'property') return entry.organizationId
  if (!entry.propertyId) throw new Error('journal entry has no Property')
  return { organizationId: entry.organizationId, propertyId: entry.propertyId }
}

/** Re-erase Review data in a restored cell, one replayer per journaled subject class. */
export function createReviewRightsReplayers(
  deps: ReviewRightsDeps,
): ReadonlyArray<BackupErasureReplayer> {
  const now = deps.now ?? (() => new Date())
  return SUBJECT_CLASSES.map((subjectClass) => ({
    context: 'review' as const,
    subjectClass,
    async reErase(tx, entry) {
      const outcome = await closeReviewInTx(
        tx,
        requireReplyScopeEffects(deps.replyEffects),
        entryTarget(entry),
        now(),
      )
      if (!outcome.ok) throw new Error(outcome.error)
      return outcome.deleted + outcome.scrubbed
    },
  }))
}

/** Re-erase Inbox data in a restored cell, one replayer per journaled subject class. */
export function createInboxRightsReplayers(
  deps: ReviewInboxRightsDeps,
): ReadonlyArray<BackupErasureReplayer> {
  const now = deps.now ?? (() => new Date())
  return SUBJECT_CLASSES.map((subjectClass) => ({
    context: 'inbox' as const,
    subjectClass,
    async reErase(tx, entry) {
      const outcome = await closeInboxInTx(tx, entryTarget(entry), now())
      if (!outcome.ok) throw new Error(outcome.error)
      return outcome.deleted
    },
  }))
}
