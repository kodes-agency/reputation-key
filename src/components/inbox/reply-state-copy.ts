import type {
  InboxItemReplyState,
  ReplyPublicationFailureClass,
  ReplyPublicationState,
  ReplyStatus,
} from '#/contexts/inbox/application/public-api'
import { POLLED_PUBLICATION_STATES } from './inbox-cache-policy'

type ReplyCopyKey = ReplyStatus | ReplyPublicationState | ReplyPublicationFailureClass

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
   * An ambiguous publication is the one publish failure that is NOT `Not
   * published`: Google may well have taken the reply and RepKey could not
   * verify it, so the word must ask for a read rather than assert an outcome.
   */
  needsCheck: 'Needs a check',
  rejected: 'Rejected',
} as const

const waitingForGoogle: ReplyStateCopy = {
  badge: REPLY_CHIP_WORDS.waitingForGoogle,
  showInRow: true,
  description:
    'Your confirmation is recorded. RepKey will start publishing this reply shortly.',
}

const notPublished: ReplyStateCopy = {
  badge: REPLY_CHIP_WORDS.notPublished,
  showInRow: true,
  description: (publicationAttempts) =>
    publicationAttempts === 0
      ? 'RepKey could not start publishing before the recovery deadline. No Google update was attempted, so it is safe to try again.'
      : `RepKey stopped after ${publicationAttempts} ${
          publicationAttempts === 1 ? 'attempt' : 'attempts'
        }. Google did not accept the update, so it is safe to try again when the connection is stable.`,
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
  sending: {
    badge: REPLY_CHIP_WORDS.waitingForGoogle,
    showInRow: true,
    description:
      'RepKey is sending this reply to Google. It will keep checking until the exact reply is confirmed live.',
  },
  pending_observation: {
    badge: REPLY_CHIP_WORDS.waitingForGoogle,
    showInRow: true,
    description:
      'Google accepted the update. RepKey is checking until this exact reply is confirmed live.',
  },
  terminal: notPublished,
  ambiguous: {
    badge: REPLY_CHIP_WORDS.needsCheck,
    showInRow: true,
    description:
      'Google may have accepted this reply, but RepKey could not verify it. To avoid posting twice, RepKey will only check Google—it will not send this reply again.',
  },
  cancelled: notPublished,
  // A provider rejection is still "not published" to the manager reading the
  // chip; what Google said about it is the description's business.
  terminal_rejection: {
    badge: REPLY_CHIP_WORDS.notPublished,
    showInRow: true,
    description:
      'Google rejected this update before it could be published. Check the Google Business Profile connection and permissions, then try again.',
  },
  retryable: notPublished,
}

export function approvedReplyStateCopy(publicationState: string | null): ReplyStateCopy {
  return publicationState && Object.hasOwn(POLLED_PUBLICATION_STATES, publicationState)
    ? REPLY_STATE_COPY[publicationState as ReplyPublicationState]
    : REPLY_STATE_COPY.approved
}

export function resolveReplyStateCopy(state: InboxItemReplyState): ReplyStateCopy {
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
    return REPLY_STATE_COPY.ambiguous
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
  state: InboxItemReplyState | null | undefined,
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
