import type {
  InboxItemReplyState,
  ReplyPublicationFailureClass,
  ReplyPublicationState,
  ReplyStatus,
} from '#/contexts/inbox/application/public-api'
import { isUncertainReplyStillChecked } from '#/shared/domain/reply-queue-stage'
import { POLLED_PUBLICATION_STATES } from './inbox-cache-policy'

/**
 * `ambiguous` is the uncertain send RepKey is still reading Google about;
 * `ambiguous_stopped` is the same uncertainty after the automatic reads ended.
 * The two need different words, and no status or publication state alone names
 * the second one (it is `terminal` + last error class `ambiguous`).
 */
type ReplyCopyKey =
  ReplyStatus | ReplyPublicationState | ReplyPublicationFailureClass | 'ambiguous_stopped'

/**
 * The reply state a chip is chosen from. `reconcileDueAt` is optional because a
 * hand-built or pre-D8 snapshot may not carry it; a row without it can only be
 * read as "no automatic check scheduled", which is the reading that asks a
 * person to look rather than one that tells them nothing needs doing. It is
 * widened to a string because a detail reply read back from the router's
 * serialized cache can carry the due time as one, and the inbox row type
 * (`InboxItemReplyState.reconcileDueAt: Date | null`) is omitted first so the
 * widening does not intersect down to `Date` again.
 */
export type ReplyCopyState = Omit<InboxItemReplyState, 'reconcileDueAt'> &
  Readonly<{ reconcileDueAt?: Date | string | null }>

type ReplyStateCopy = Readonly<{
  badge: string | null
  showInRow: boolean
  description: string | ((publicationAttempts: number) => string) | null
}>

/**
 * The reply vocabulary itself (plan row 14): sentence case, and one word list
 * that the thread message's chip and the inbox row both read from, so the two
 * surfaces describing the same reply can no longer disagree — the row used to
 * say `Queued for Google` while the detail said `Confirmed on Google`.
 *
 * Keyed by what the word MEANS rather than by a status, because several states
 * share one word: `approved`, `requested`, `authorized`, `sending` and
 * `pending_observation` all read `Waiting for Google`. A manager is waiting on
 * Google in every one of them; which stage the publication machine is in is
 * the description's job, not the chip's.
 */
export const REPLY_CHIP_WORDS = {
  awaitingApproval: 'Awaiting approval',
  waitingForGoogle: 'Waiting for Google',
  liveOnGoogle: 'Live on Google',
  notPublished: 'Not published',
  /**
   * An ambiguous publication whose automatic reads have ENDED: Google may well
   * have taken the reply and RepKey could not verify it, so the word asks a
   * person for a read rather than assert an outcome. While the reads continue
   * the same publication reads `Waiting for Google` — nobody needs to act yet.
   */
  needsCheck: 'Needs a check',
  rejected: 'Rejected',
  /**
   * A reply status this bundle cannot classify, which only version skew
   * produces: the server has shipped a status this client predates. Nothing
   * about the reply's publication can be read from it, so the word says
   * nothing about Google and asks for no check. Only the thread message uses
   * it; the inbox row still reads such a reply through `resolveReplyStateCopy`,
   * whose publication fields decide its word.
   */
  statusUnavailable: 'Status unavailable',
} as const

const waitingForGoogle: ReplyStateCopy = {
  badge: REPLY_CHIP_WORDS.waitingForGoogle,
  showInRow: true,
  description:
    'Your confirmation is recorded. RepKey will start publishing this reply shortly.',
}

/**
 * The attempts sentence says only what every retryable failure shares. The
 * class covers a request refused before it left RepKey, an answered 429, and
 * the never-dispatched settlement (`classifyPublicationFailure`,
 * `settleNeverDispatchedAttempt`), whose check toast says the reply never
 * reached Google. "Google did not accept the update" claimed Google received
 * it, and "when the connection is stable" blamed a cause none of them proves.
 */
const notPublished: ReplyStateCopy = {
  badge: REPLY_CHIP_WORDS.notPublished,
  showInRow: true,
  description: (publicationAttempts) =>
    publicationAttempts === 0
      ? 'RepKey could not start publishing before the recovery deadline. No Google update was attempted, so it is safe to try again.'
      : `RepKey stopped after ${publicationAttempts} ${
          publicationAttempts === 1 ? 'attempt' : 'attempts'
        }, and nothing was published to Google, so it is safe to try again.`,
}

/**
 * The one reply-state vocabulary used by detail badges/descriptions and list
 * chips. `draft` deliberately has no row chip because it is private WIP;
 * `published` deliberately has no row chip because the row is about to close.
 */
export const REPLY_STATE_COPY: Readonly<Record<ReplyCopyKey, ReplyStateCopy>> = {
  draft: { badge: null, showInRow: false, description: null },
  pending_approval: {
    badge: REPLY_CHIP_WORDS.awaitingApproval,
    showInRow: true,
    description: null,
  },
  approved: waitingForGoogle,
  published: {
    badge: REPLY_CHIP_WORDS.liveOnGoogle,
    showInRow: false,
    description: null,
  },
  rejected: { badge: REPLY_CHIP_WORDS.rejected, showInRow: true, description: null },
  publish_failed: notPublished,
  requested: waitingForGoogle,
  authorized: waitingForGoogle,
  // Neither in-flight sentence may say "until confirmed": an uncertain send
  // waits out a 15-minute grace and then an automatic read ladder that ENDS
  // after 72 hours (`AMBIGUOUS_RECONCILE_LADDER_MS`,
  // `reply-publication-workflow.ts`). Nor may `sending` say "sent": the row is
  // claimed BEFORE the provider call (publish-reply.job.ts header), and D4
  // settles an attempt with no `reviews.reply` permit as never dispatched — so
  // a `sending` row can be one that never left RepKey.
  sending: {
    badge: REPLY_CHIP_WORDS.waitingForGoogle,
    showInRow: true,
    description:
      'RepKey is publishing this reply to Google and checking that it appears. Google can take a few minutes.',
  },
  pending_observation: {
    badge: REPLY_CHIP_WORDS.waitingForGoogle,
    showInRow: true,
    description:
      'Google accepted this reply. RepKey is checking that it appears, which can take a few minutes.',
  },
  terminal: notPublished,
  ambiguous: {
    badge: REPLY_CHIP_WORDS.waitingForGoogle,
    showInRow: true,
    description:
      "Google hasn't shown this reply yet. RepKey keeps checking automatically and won't send it twice.",
  },
  ambiguous_stopped: {
    badge: REPLY_CHIP_WORDS.needsCheck,
    showInRow: true,
    description:
      "RepKey couldn't confirm this reply on Google and has stopped checking automatically. It won't send it twice. Check Google again, or look at the review on Google.",
  },
  cancelled: notPublished,
  // `terminal_rejection` is both a request Google refused (an answered 4xx)
  // and one RepKey refused before sending it (`not_sent` + `malformed_request`,
  // `classifyPublicationFailure`). The sentence says only what both share.
  terminal_rejection: {
    badge: REPLY_CHIP_WORDS.notPublished,
    showInRow: true,
    description:
      "This reply couldn't be published, and nothing was posted to Google. Check the Google Business Profile connection, then try again.",
  },
  retryable: notPublished,
}

export function approvedReplyStateCopy(publicationState: string | null): ReplyStateCopy {
  return publicationState && Object.hasOwn(POLLED_PUBLICATION_STATES, publicationState)
    ? REPLY_STATE_COPY[publicationState as ReplyPublicationState]
    : REPLY_STATE_COPY.approved
}

/**
 * RepKey is still reading Google on its own about an uncertain send: the
 * sweep walks only `publication_state = 'ambiguous'` rows with a due time, and
 * clears the due time when the ladder ends (`CONTEXT.md`, reconcile-ambiguous-
 * publications). It IS the queue's rule (`isUncertainReplyStillChecked`, which
 * files the reply under Waiting for Google), not a copy of it, so the chip and
 * the queue cannot drift apart.
 */
export function isCheckingGoogleAutomatically(
  state: Pick<ReplyCopyState, 'status' | 'publicationState' | 'reconcileDueAt'>,
): boolean {
  return isUncertainReplyStillChecked(state)
}

export function resolveReplyStateCopy(state: ReplyCopyState): ReplyStateCopy {
  if (
    state.status === 'draft' ||
    state.status === 'pending_approval' ||
    state.status === 'published' ||
    state.status === 'rejected'
  ) {
    return REPLY_STATE_COPY[state.status]
  }
  if (state.status === 'approved') {
    return approvedReplyStateCopy(state.publicationState)
  }
  if (
    state.publicationState === 'ambiguous' ||
    state.publicationLastErrorClass === 'ambiguous'
  ) {
    return isCheckingGoogleAutomatically(state)
      ? REPLY_STATE_COPY.ambiguous
      : REPLY_STATE_COPY.ambiguous_stopped
  }
  if (state.publicationLastErrorClass === 'terminal_rejection') {
    return REPLY_STATE_COPY.terminal_rejection
  }
  if (state.publicationLastErrorClass === 'retryable') {
    return REPLY_STATE_COPY.retryable
  }
  return REPLY_STATE_COPY.publish_failed
}

export function replyStateRowLabel(
  state: ReplyCopyState | null | undefined,
): string | null {
  if (!state) return null
  const copy = resolveReplyStateCopy(state)
  return copy.showInRow ? copy.badge : null
}

export function replyStateDescription(
  copy: ReplyStateCopy,
  publicationAttempts = 0,
): string | null {
  return typeof copy.description === 'function'
    ? copy.description(publicationAttempts)
    : copy.description
}
