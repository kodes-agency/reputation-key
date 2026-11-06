import type { NotificationPayload } from './notification-payload'
import type { RenderedNotification } from './notification-templates'

type RendererCopy = Omit<RenderedNotification, 'detail'> & Readonly<{ detail?: string }>

const atProperty = (p: NotificationPayload): string =>
  p.propertyName === undefined ? '' : ` at ${p.propertyName}`

const sentence = (...parts: ReadonlyArray<string>): string =>
  parts.filter((part) => part !== '').join(' ')

const factsAt = (p: NotificationPayload, ...parts: ReadonlyArray<string>): string =>
  [p.propertyName ?? '', ...parts].filter((part) => part !== '').join(' · ')

const ratedFeedback = (p: NotificationPayload): string =>
  p.guestRating === undefined ? 'feedback' : `${p.guestRating}-star feedback`

// A Low ratings notice says so, and why — the reader's own threshold — but
// never how many stars: a Google review's rating stays in Review's cache
// (ADR 0031), and the Inbox shows it when the item is opened.
const LOW_RATING_REASON = 'It is at or below the rating you asked to hear about.'

export const renderReviewCreated = (p: NotificationPayload): RendererCopy => ({
  title: `${p.lowRating === true ? 'Low-rated' : 'New'} review${atProperty(p)}`,
  body: sentence(
    p.lowRating === true ? LOW_RATING_REASON : '',
    'Open it to read the review and reply.',
  ),
  actionLabel: 'Read review',
  summary: factsAt(p, p.lowRating === true ? 'low-rated review' : 'review'),
})

export const renderReviewUpdated = (p: NotificationPayload): RendererCopy => ({
  title: `Review ${p.lowRating === true ? 'edited to a low rating' : 'updated'}${atProperty(p)}`,
  body: sentence(
    p.lowRating === true
      ? 'The guest changed their review, and it is now at or below the rating you asked to hear about.'
      : 'The guest changed their review.',
    'Open it to check the latest details.',
  ),
  actionLabel: 'Review update',
  summary: factsAt(
    p,
    p.lowRating === true ? 'review edited to a low rating' : 'updated review',
  ),
})

// Always feedback, even when the item lookup failed and left no platform.
// Its rating is RepKey's own (the Portal collected it), so it is shown.
export const renderFeedbackCreated = (p: NotificationPayload): RendererCopy => ({
  title: `${p.lowRating === true ? 'Low-rated' : 'New'} guest feedback${atProperty(p)}`,
  body: sentence(
    p.lowRating === true ? LOW_RATING_REASON : '',
    'Open it to read the feedback.',
  ),
  actionLabel: 'Read feedback',
  summary: factsAt(p, ratedFeedback(p)),
})

/**
 * A Property's Google review history has been imported. This one notice stands
 * in for every review it brought in, so it
 * leads with the two numbers that decide whether anyone has work to do, and
 * sends the reader to the Property's open Inbox queue.
 *
 * A stopped import says what to do instead. `temporary` never reaches a
 * reader (RepKey retries it), but it renders honestly if one ever sees it.
 */
const IMPORT_STOPPED_COPY: Record<
  NonNullable<NotificationPayload['importFailureReason']>,
  string
> = {
  google_authorization: 'Reconnect Google, then import the history again.',
  property_source_changed:
    'This property\u2019s Google location changed. Link it again, then import the history.',
  location_too_large:
    'This location has more reviews than one import can take in. Contact RepKey support.',
  temporary: 'Nothing to do \u2014 RepKey is trying again.',
}

const importedBody = (p: NotificationPayload): string => {
  if (p.importedCount === undefined) return 'Open the inbox to see what came in.'
  const imported = `We imported ${p.importedCount} reviews`
  // An unknown count (the Inbox never settled, or a read failed) is not zero,
  // nor a sign that any are waiting: ADR 0046 drops the second number.
  if (p.unansweredCount === undefined) return `${imported}.`
  return p.unansweredCount === 0
    ? `${imported}. Nothing is waiting for a reply.`
    : `${imported}; ${p.unansweredCount} still need a reply.`
}

export const renderReviewImportFinished = (p: NotificationPayload): RendererCopy => {
  const failed = p.importOutcome === 'failed'
  const body = failed
    ? p.importFailureReason === undefined
      ? 'Open the property to start the import again.'
      : IMPORT_STOPPED_COPY[p.importFailureReason]
    : importedBody(p)
  const hasDetail = failed
    ? p.importFailureReason !== undefined
    : p.importedCount !== undefined
  return {
    title: `${failed ? 'Review history import stopped' : 'Review history imported'}${atProperty(p)}`,
    body,
    detail: hasDetail ? body : '',
    actionLabel: 'Open inbox',
    summary: factsAt(p, failed ? 'review import stopped' : 'review history imported'),
  }
}
