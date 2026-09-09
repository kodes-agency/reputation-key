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

const queuedForGoogle: ReplyStateCopy = {
  badge: 'Queued for Google',
  showInRow: true,
  description:
    'Your confirmation is recorded. RepKey will start publishing this reply shortly.',
}

const publishingStopped: ReplyStateCopy = {
  badge: 'Publishing stopped',
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
    badge: 'Awaiting Approval',
    showInRow: true,
    description: null,
  },
  approved: queuedForGoogle,
  published: {
    badge: 'Confirmed on Google',
    showInRow: false,
    description: null,
  },
  rejected: { badge: 'Rejected', showInRow: true, description: null },
  publish_failed: publishingStopped,
  requested: queuedForGoogle,
  authorized: queuedForGoogle,
  sending: {
    badge: 'Sending to Google',
    showInRow: true,
    description:
      'RepKey is sending this reply to Google. It will keep checking until the exact reply is confirmed live.',
  },
  pending_observation: {
    badge: 'Waiting for Google',
    showInRow: true,
    description:
      'Google accepted the update. RepKey is checking until this exact reply is confirmed live.',
  },
  terminal: publishingStopped,
  ambiguous: {
    badge: 'Google status unconfirmed',
    showInRow: true,
    description:
      'Google may have accepted this reply, but RepKey could not verify it. To avoid posting twice, RepKey will only check Google—it will not send this reply again.',
  },
  cancelled: publishingStopped,
  terminal_rejection: {
    badge: 'Google rejected update',
    showInRow: true,
    description:
      'Google rejected this update before it could be published. Check the Google Business Profile connection and permissions, then try again.',
  },
  retryable: publishingStopped,
}

export function approvedReplyStateCopy(publicationState: string | null): ReplyStateCopy {
  return publicationState && Object.hasOwn(POLLED_PUBLICATION_STATES, publicationState)
    ? REPLY_STATE_COPY[publicationState as ReplyPublicationState]
    : REPLY_STATE_COPY.approved
}

function resolveReplyStateCopy(state: InboxItemReplyState): ReplyStateCopy {
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
