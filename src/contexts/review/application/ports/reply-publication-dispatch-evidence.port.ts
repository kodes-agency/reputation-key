// Positive evidence about whether one reply publication attempt could have
// reached Google. It is the ONLY input that may move an uncertain attempt
// toward "safe to send again": absence of the reply on a Google read never is,
// because Google can accept a reply and not echo it.
//
// Why a permit row is evidence: the egress gateway calls `fetch` only after
// `start_google_execution_permit` starts an `authorization_execution_permits`
// row, and for `property.publish_reply` that start requires
// `authorization_vector->>'replyId'`, `'publicationCycle'` and
// `'publicationAttemptNumber'` to match a `sending` attempt
// (src/shared/db/db-constructs.sql, the `reviews.reply` branch of the start
// predicate). No such row, once no in-flight call can still create one, means
// no request for that attempt left RepKey.

import type { OrganizationId, ReplyId } from '#/shared/domain/ids'

export type ReplyDispatchEvidence =
  'possibly_dispatched' | 'never_dispatched' | 'too_recent'

export type ReplyDispatchEvidenceInput = Readonly<{
  organizationId: OrganizationId
  replyId: ReplyId
  publicationCycle: number
  attemptNumber: number
  /** `reply_publication_attempts.created_at` for this exact cycle/attempt. */
  attemptStartedAt: Date
  now: Date
}>

export type ReplyPublicationDispatchEvidencePort = Readonly<{
  findDispatchEvidence(input: ReplyDispatchEvidenceInput): Promise<ReplyDispatchEvidence>
}>

// The application layer may not import `shared/auth` or Integration
// infrastructure, so the three bounds are restated here with their sources.
// `reply-publication-dispatch-evidence.test.ts` (Review infrastructure) pins the
// two permit deadlines to the exported constants so they cannot drift silently.

/** AUTHORIZATION_PERMIT_START_DEADLINE_MS, src/shared/auth/authorization-execution-permit.ts:46 — an admitted permit that has not started by then is fenced. */
export const REPLY_PERMIT_START_DEADLINE_MS = 10_000
/** AUTHORIZATION_PERMIT_OPERATION_DEADLINE_MS (authorization-execution-permit.ts:47), and `v_now + interval '30 seconds'` in start_google_execution_permit (db-constructs.sql:2387). */
export const REPLY_PERMIT_OPERATION_DEADLINE_MS = 30_000
/** PROVIDER_DEADLINE_MS, src/contexts/integration/infrastructure/adapters/google-provider-adapter.ts:15 — the executor's own call deadline; the gateway refuses to fetch once it has passed. */
export const REPLY_PROVIDER_CALL_DEADLINE_MS = 15_000
/**
 * Floor for the window. Both instants are application clocks, possibly on
 * different replicas: the attempt's start is `reply_publication_attempts.created_at`,
 * which the claiming worker captures BEFORE its claim transaction takes the
 * truth-scope lock (reply-command-store.ts markPublicationSending `at`), so lock
 * wait and clock skew both come off the window; `now` is the checker's clock. A
 * worker can also stall between the claim and permit admission. The derived 55 s
 * leaves no room for any of that; five minutes does.
 */
export const REPLY_DISPATCH_EVIDENCE_MIN_WINDOW_MS = 5 * 60_000

/**
 * How long after an attempt starts RepKey waits before treating "no permit" as
 * worth settling. It is a likelihood filter, not the guarantee: no deadline
 * bounds claim → permit admission (the job awaits the provider-call
 * authorization, binding reads and token fetch before the 15 s executor
 * deadline even starts, google-review-api.adapter.ts
 * authorizeReplyPublicationProviderCall), so a stalled worker can be admitted
 * after any window. What makes a settle safe is the lock: the settle re-reads
 * the permits under the attempt row lock that permit admission shares
 * (reply-publication-dispatch-evidence.ts). The window keeps an attempt that is
 * normally still on its way — executor call (15 s once started) → permit
 * started (≤ 10 s) → fetch finished (≤ 30 s) — from being judged at all.
 */
export const REPLY_DISPATCH_EVIDENCE_WINDOW_MS = Math.max(
  REPLY_DISPATCH_EVIDENCE_MIN_WINDOW_MS,
  REPLY_PROVIDER_CALL_DEADLINE_MS +
    REPLY_PERMIT_START_DEADLINE_MS +
    REPLY_PERMIT_OPERATION_DEADLINE_MS,
)
