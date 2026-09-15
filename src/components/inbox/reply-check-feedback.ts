// What "Check Google again" says once it has an answer (plan D7).
//
// Before this, the check went through `retryPublishFn`, a read that did not
// confirm the reply threw `invalid_transition`, and the button swallowed the
// rejection (`onCheck().catch(() => undefined)`), so a click that found
// nothing looked exactly like a click that did nothing. The check now returns a
// result (`check-reply-publication.ts`), and every outcome is said once, in one
// of two places: a toast when the view changes by itself (the reply went live,
// or it never left and can be published again), or the status line under the
// actions when the reply stays where it was and only the manager's knowledge
// changed.

import { toast } from 'sonner'
import {
  actionErrorMessage,
  type ActionMutationOptions,
} from '#/components/hooks/use-action-mutation'
import type {
  ReplyPublicationCheckOutcome,
  ReplyPublicationCheckResult,
} from '#/contexts/review/application/public-api'
import { isServerFunctionError } from '#/shared/auth/server-function-error'
import type { InboxReplyCacheChange } from './inbox-cache-policy'

export const REPLY_CHECK_COPY = {
  live: 'Your reply is live on Google.',
  neverSent: "This reply never reached Google. It's safe to publish it again.",
  notShowing: "This reply isn't showing there.",
  checksAgain: 'RepKey checks again automatically.',
  unreadable: "Google shows a reply RepKey can't read, so it will keep checking.",
  unreadableStopped:
    "Google shows a reply RepKey can't read, so RepKey can't confirm this one. Look at the review on Google.",
  differentReply:
    'Google shows a different reply on this review, so RepKey stopped publishing this one.',
  reviewMissing: 'Google no longer returns this review.',
  cancelled: 'Publishing was cancelled.',
} as const

/** The fields of a reply that decide whether a status line still describes it. */
export type ReplyCheckLineSubject = Readonly<{
  id: string
  status: string
  /** Absent on a Google-observed reply, which has no publication machine. */
  publicationState?: string | null
  reconcileDueAt?: Date | string | null
}>

/**
 * The reply state a status line was written for. Every sentence on the line is
 * about the reply's publication (`isn't showing there`, `checks again
 * automatically`, `can't confirm this one`), so it holds only while the reply's
 * status, publication state and whether automatic checks continue are
 * unchanged: a poll that confirms the reply or ends the ladder makes it false.
 * The due time's VALUE is left out — the sweep moves it on every rung, and the
 * line says nothing about when.
 */
export function replyCheckLineKey(reply: ReplyCheckLineSubject): string {
  const checksContinue =
    reply.reconcileDueAt !== null && reply.reconcileDueAt !== undefined
  return [reply.id, reply.status, reply.publicationState ?? '', checksContinue].join('|')
}

export type ReplyCheckFeedback =
  | Readonly<{ kind: 'toast'; tone: 'success' | 'info'; message: string }>
  | Readonly<{ kind: 'status'; message: string }>

type FormatTime = (at: Date | string) => string

/**
 * The viewer's locale at short time style — `2:05 PM`, `14:05`. `locale` is for
 * tests only; the product passes nothing so the browser decides. A server fn
 * delivers a `Date` as a string on some paths, so both are accepted.
 */
export function formatCheckTime(at: Date | string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(at))
}

const checkedAt = (result: ReplyPublicationCheckResult, formatTime: FormatTime) =>
  `Checked Google at ${formatTime(result.checkedAt)}.`

const STATUS_LINE: Readonly<
  Record<
    Exclude<ReplyPublicationCheckOutcome, 'live_on_google' | 'never_sent'>,
    (result: ReplyPublicationCheckResult, formatTime: FormatTime) => string
  >
> = {
  not_on_google: (result, formatTime) =>
    [
      checkedAt(result, formatTime),
      REPLY_CHECK_COPY.notShowing,
      ...(result.nextAutomaticCheckAt ? [REPLY_CHECK_COPY.checksAgain] : []),
    ].join(' '),
  // `unreadable` reschedules nothing (reconcile-reply-publication.ts), so for
  // terminal ambiguity there is no next check to promise: the description
  // above already says RepKey stopped checking, and this line must not
  // contradict it.
  unreadable_on_google: (result, formatTime) =>
    `${checkedAt(result, formatTime)} ${
      result.nextAutomaticCheckAt
        ? REPLY_CHECK_COPY.unreadable
        : REPLY_CHECK_COPY.unreadableStopped
    }`,
  different_reply_on_google: () => REPLY_CHECK_COPY.differentReply,
  review_missing_on_google: () => REPLY_CHECK_COPY.reviewMissing,
  cancelled: () => REPLY_CHECK_COPY.cancelled,
}

/**
 * Where one check result is said, and in which words.
 *
 * A status sentence becomes a toast when the returned reply is a `draft`: a
 * superseded or cancelled publication returns the reply to draft
 * (`reply-command-store.ts` cancel → `status: 'draft'`), `resolveReplyView`
 * sends a draft to the composer, and `ReplyMessage` renders nothing for it —
 * so there is no action row left for the line to sit under.
 */
export function replyCheckFeedback(
  result: ReplyPublicationCheckResult,
  formatTime: FormatTime = formatCheckTime,
): ReplyCheckFeedback {
  if (result.outcome === 'live_on_google') {
    return { kind: 'toast', tone: 'success', message: REPLY_CHECK_COPY.live }
  }
  if (result.outcome === 'never_sent') {
    return { kind: 'toast', tone: 'success', message: REPLY_CHECK_COPY.neverSent }
  }
  const message = STATUS_LINE[result.outcome](result, formatTime)
  return result.reply.status === 'draft'
    ? { kind: 'toast', tone: 'info', message }
    : { kind: 'status', message }
}

/**
 * The check's error toast. `actionErrorMessage` shows only 4xx wording, but the
 * one failure a manager can act on here is a 500: `reviewErrorStatus` maps
 * `sync_failed` to 500 (review/server/reply-read.ts), and the check use case
 * rewrites every `sync_failed` it can raise into its own sentence
 * (`check-reply-publication.ts`, GOOGLE_UNREACHABLE) before it reaches the
 * server fn — so that code's message is product copy, not internal state.
 */
export function replyCheckErrorMessage(error: unknown): string {
  if (
    isServerFunctionError(error) &&
    error.name === 'ReviewError' &&
    error.code === 'sync_failed'
  ) {
    return error.message
  }
  return actionErrorMessage(error)
}

type CheckInput = Readonly<{ data: Readonly<{ reviewId: string }> }>

export type ReplyCheckMutationInput = Readonly<{
  /** The review the pane has open NOW — the options are rebuilt every render. */
  reviewId: string
  onReplyChanged: (change: InboxReplyCacheChange) => void
  /** The check with this `reviewId` was refused or failed; its toast is shown. */
  onCheckFailed: (reviewId: string) => void
}>

/**
 * The check mutation's feedback, shared by `useReplyActions` and the stories
 * that drive a real `useActionMutation` through every outcome. The status line
 * is not here: it belongs to the message that renders it
 * (`use-reply-check-run.ts`), keyed by reply.
 *
 * The returned reply always goes to the cache. That is what moves a confirmed
 * reply to Live on Google and a never-sent one to Not published by itself.
 *
 * A Google read takes seconds, and the pane is not remounted when the manager
 * opens another item, so a check can settle through the options of a
 * DIFFERENT item (query-core mutationObserver.ts `setOptions` gives a pending
 * mutation the latest options). Everything here therefore reads the review
 * from the check's own input: the cache write names it, and the outcome toast
 * is said only while that review is still the one open — "Your reply is live
 * on Google." over another guest's review would be about a reply not on screen.
 */
export function replyCheckMutationOptions(
  input: ReplyCheckMutationInput,
): ActionMutationOptions<CheckInput, ReplyPublicationCheckResult> {
  return {
    errorMessage: replyCheckErrorMessage,
    onError: (_error, check) => input.onCheckFailed(check.data.reviewId),
    onSuccess: (result, check) => {
      input.onReplyChanged({
        kind: 'state_changed',
        reply: result.reply,
        reviewId: check.data.reviewId,
      })
      if (check.data.reviewId !== input.reviewId) return
      const feedback = replyCheckFeedback(result)
      if (feedback.kind !== 'toast') return
      if (feedback.tone === 'success') toast.success(feedback.message)
      else toast.info(feedback.message)
    },
  }
}
