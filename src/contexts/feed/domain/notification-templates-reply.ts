import type { NotificationPayload } from './notification-payload'
import type { RenderedNotification } from './notification-templates'

type RendererCopy = Omit<RenderedNotification, 'detail'> & Readonly<{ detail?: string }>

const atProperty = (p: NotificationPayload): string =>
  p.propertyName === undefined ? '' : ` at ${p.propertyName}`

const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

const factsAt = (p: NotificationPayload, ...parts: ReadonlyArray<string>): string =>
  [p.propertyName ?? '', ...parts].filter((part) => part !== '').join(' · ')

export const renderReplyApproved = (p: NotificationPayload): RendererCopy => ({
  title: `Your reply was approved${atProperty(p)}`,
  body: 'It is queued to publish to Google.',
  actionLabel: 'View reply',
  summary: factsAt(p, 'review'),
})

/**
 * The approver's reason never enters a notification (ADR 0030); only whether
 * there is one does. The flag outranks a quoted reason, which only historical
 * rows carry, because a coalesced row's flag describes the latest rejection.
 * With neither, the copy must not claim the reason is there or missing.
 */
const rejectionReasonBody = (p: NotificationPayload): string => {
  if (p.hasModerationReason === true) {
    return 'The approver left a reason. Open the reply to read it, then edit and resubmit.'
  }
  if (p.hasModerationReason === false) {
    return 'It was sent back without a reason. Edit it and resubmit.'
  }
  if (p.moderationReason !== undefined) {
    return sentence(`Reason: ${p.moderationReason}`, 'Edit it and resubmit.')
  }
  return 'Open it to see any note from the approver, then edit and resubmit.'
}

export const renderReplyRejected = (p: NotificationPayload): RendererCopy => {
  const body = rejectionReasonBody(p)
  const knowsReason =
    p.hasModerationReason !== undefined || p.moderationReason !== undefined
  return {
    title: `Your reply needs changes${atProperty(p)}`,
    body,
    detail: knowsReason ? body : '',
    actionLabel: 'Edit reply',
    summary: factsAt(p, 'review'),
  }
}

export const renderReplyPublished = (p: NotificationPayload): RendererCopy => ({
  title: `Your reply is live on Google${atProperty(p)}`,
  body: 'Guests can see it now. No further action needed.',
  actionLabel: 'View reply',
  summary: factsAt(p, 'review'),
})

/** The shared close of a notice that asks the reader to look, not to act. */
const SEE_WHERE = 'Open it to see where it stands.'

// `not_sent` includes an answered 429, so it says nothing was posted, as the
// Inbox's "Not published" copy does, not that nothing reached Google.
const PUBLISH_FAILURE_BODIES = {
  not_sent: 'Nothing was posted to Google, so it is safe to try again.',
  refused: 'Nothing was posted to Google. Check the Google connection, then try again.',
  unconfirmed: "RepKey won't send it twice. Open it to check.",
} as const

const RECONNECT_FIRST =
  'Google needs reconnecting first. An account admin can reconnect it in Settings, then retry — the draft is saved.'

// A connection waiting for a fresh consent refuses every retry, and the
// author may not be the one allowed to reconnect it, so the copy says who can.
const renderReplyPublishNeedsReconnect = (p: NotificationPayload): RendererCopy => ({
  title: `Reply not published${atProperty(p)}`,
  body: RECONNECT_FIRST,
  detail: RECONNECT_FIRST,
  actionLabel: 'Open reply',
  summary: factsAt(p, 'review', 'reconnect Google'),
})

/**
 * One fact covers every way a publication ends without a confirmed live
 * reply, and Google never saw most of them, so the copy follows the outcome
 * and never says Google rejected it. A reply that may be live gets no retry;
 * neither does a row too old to say. When the remedy is reconnecting Google,
 * that cause decides the copy instead: a retry alone cannot succeed. It can
 * reach a responsible manager instead of the author, so it never says "your".
 */
export const renderReplyPublishFailed = (p: NotificationPayload): RendererCopy => {
  if (p.publishFailureCause === 'google_reauthorization_required') {
    return renderReplyPublishNeedsReconnect(p)
  }
  const outcome = p.publishOutcome
  const state = outcome === 'unconfirmed' ? 'not confirmed' : 'not published'
  const cause = outcome === undefined ? '' : PUBLISH_FAILURE_BODIES[outcome]
  return {
    title: `Reply ${state}${outcome === 'unconfirmed' ? ' on Google' : ''}${atProperty(p)}`,
    body: cause === '' ? 'Open the reply to see where it stands.' : cause,
    detail: cause,
    actionLabel:
      outcome === 'not_sent' || outcome === 'refused' ? 'Retry publish' : 'View reply',
    summary: factsAt(p, 'review', state),
  }
}

/**
 * A reply RepKey stopped on its way to Google. Each cause takes a different
 * next step, so the cause decides the whole sentence: reconnect, nothing to
 * do here, write a new reply, or just look. A disconnect or a policy stop
 * only ever cancels a cycle that never went out, so only those say so; a
 * guest edit or a different live reply can stop one Google may already hold,
 * so neither claims it was not sent. The title never says "your" — the same
 * notice goes to the approvers who have to act on it.
 *
 * `source_changed` does not say "approved". A guest edit also returns to
 * draft a reply that was still awaiting approval, and one whose publication
 * had failed (Review CONTEXT, Model), so its sentence names what all three
 * have in common: the reply was written before the guest changed the review.
 *
 * `ai_draft_withdrawn` is the one cause that leaves no draft behind: the AI
 * draft purge removed an unedited AI reply that was awaiting approval or
 * confirmed but not dispatched. So it says the draft is gone, not "returned".
 * The fact does not say why the purge ran, so the copy states the rule every
 * reason falls under: such a draft is publishable only for a few minutes, and
 * only while what it was written from stays the same. Naming the changes alone
 * would be false for a draft whose time simply ran out.
 */
const PUBLICATION_CANCELLATION_BODIES = {
  disconnect:
    'The Google connection was disconnected before it went out. The draft is saved: reconnect Google, then approve it again.',
  policy:
    'This property can no longer publish to Google, so it was never sent. The draft is saved.',
  source_changed:
    'The guest changed their review, so RepKey stopped the reply that was written before the change. Open it to check what Google shows, then reply to the new review.',
  provider_truth:
    'A different reply is live on Google, so this one is not. Open it to check.',
  ai_draft_withdrawn:
    'An AI draft nobody edited can only be published within minutes of being written, and only while the review, the property and its AI settings stay the same. That window closed, so nothing was posted to Google and RepKey removed the draft. Write a new reply.',
} as const

export const renderReplyPublicationCancelled = (p: NotificationPayload): RendererCopy => {
  const cause = p.publicationCancellationCause
  const why = cause === undefined ? '' : PUBLICATION_CANCELLATION_BODIES[cause]
  const draftRemoved = cause === 'ai_draft_withdrawn'
  return {
    title: `${draftRemoved ? 'AI draft removed' : 'Reply returned to draft'}${atProperty(p)}`,
    body: why === '' ? SEE_WHERE : why,
    detail: why,
    actionLabel:
      cause === 'source_changed' || draftRemoved ? 'Open review' : 'Open reply',
    summary: factsAt(
      p,
      'review',
      draftRemoved ? 'AI draft removed' : 'returned to draft',
    ),
  }
}
