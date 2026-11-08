// Rights executors for Review and Inbox: the manager-authored replies, reply
// library and Response Target policy an Organization holds, exported for an
// access or closure request and purged at closure.
//
// The SQL and its allowlists live in the lifecycle stores; these wrappers only
// adapt them to the executor contract. Closure never calls Google: a reply
// already sent to the provider blocks the purge until it is reconciled.

import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import type { Database } from '#/shared/db'
import {
  closeInbox,
  readInboxRightsExport,
  readInboxRightsReport,
} from '#/shared/db/lifecycle/inbox-rights-store'
import {
  closeReview,
  readReviewRightsExport,
  readReviewRightsReport,
} from '#/shared/db/lifecycle/review-rights-store'
import {
  requireReplyScopeEffects,
  type ReplyScopeEffects,
} from '#/shared/db/reply-scope-effects'
import type { RightsExecutor } from './rights-executor'

export const REVIEW_RIGHTS_EXPORT_PATH = 'review/rights-export.json'
export const INBOX_RIGHTS_EXPORT_PATH = 'inbox/rights-export.json'

export type ReviewInboxRightsDeps = Readonly<{
  db: Database
  now?: () => Date
}>

/** Closing Review writes Replies, so the Reply writer's effects are handed in. */
export type ReviewRightsDeps = ReviewInboxRightsDeps &
  Readonly<{ replyEffects?: ReplyScopeEffects }>

function exportFile(path: string, payload: unknown) {
  return [{ path, bytes: Buffer.from(`${canonicalizeRfc8785(payload)}\n`, 'utf8') }]
}

export function createReviewRightsExecutor(deps: ReviewRightsDeps): RightsExecutor {
  const now = deps.now ?? (() => new Date())
  return Object.freeze({
    name: 'review',
    scopes: ['access', 'organization'] as const,
    report: (plan) => readReviewRightsReport(deps.db, plan.organizationId, now()),
    async exportFiles(plan) {
      return exportFile(
        REVIEW_RIGHTS_EXPORT_PATH,
        await readReviewRightsExport(deps.db, plan.organizationId),
      )
    },
    async apply(plan) {
      const outcome = await closeReview(
        deps.db,
        requireReplyScopeEffects(deps.replyEffects),
        plan.organizationId,
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
    scopes: ['access', 'organization'] as const,
    report: (plan) => readInboxRightsReport(deps.db, plan.organizationId),
    async exportFiles(plan) {
      return exportFile(
        INBOX_RIGHTS_EXPORT_PATH,
        await readInboxRightsExport(deps.db, plan.organizationId),
      )
    },
    async apply(plan) {
      const outcome = await closeInbox(deps.db, plan.organizationId, now())
      return outcome.ok ? { ok: true, lines: [`deleted=${outcome.deleted}`] } : outcome
    },
  })
}
