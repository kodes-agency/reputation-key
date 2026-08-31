// Notification email renderers — the seam the email jobs call.
//
// Contract (ratified; the jobs code against these exact signatures):
//   renderNotificationEmail(input) -> { subject, html, text }
//   renderDigestEmail(input)       -> { subject, html, text }
//
// Both are SYNCHRONOUS. Rendering an email is pure formatting, not I/O, and the
// jobs treat it that way; see `#/shared/email/render-document` for why that
// rules out react-email's async `render()`.
//
// Copy is NOT written here. Every sentence comes from `renderNotification()` in
// `domain/notification-templates`, so the urgent email, the digest row and the
// in-app row cannot disagree. This module owns three things the domain has no
// business knowing: the subject line, the HTML layout, and the plain-text twin.

import type { RenderedNotification } from '../../domain/notification-templates'
import {
  absoluteUrl,
  composeText,
  EMAIL_SIGNATURE,
  originOf,
  type RenderedEmail,
} from '#/shared/email'
import { renderDigestEmailHtml, type DigestEmailGroup } from './digest-email'
import { toPlainFacts } from './notification-facts'
import { renderUrgentEmailHtml } from './urgent-email'

export type { RenderedEmail }

/**
 * Gmail truncates around 70 characters on desktop and closer to 35 on a phone,
 * so the decision-bearing words have to be at the front and the line has to
 * end on a word.
 */
const SUBJECT_LIMIT = 60

const clipSubject = (subject: string): string => {
  if (subject.length <= SUBJECT_LIMIT) return subject
  const head = subject.slice(0, SUBJECT_LIMIT - 1)
  const lastSpace = head.lastIndexOf(' ')
  return `${(lastSpace > SUBJECT_LIMIT / 2 ? head.slice(0, lastSpace) : head).trimEnd()}…`
}

const preferencesLine = (preferencesUrl: string): string =>
  `Manage notification preferences: ${preferencesUrl}`

export type NotificationEmailInput = Readonly<{
  rendered: RenderedNotification
  /** Absolute deep link to the item this notification is about. */
  actionUrl: string
  /** Null only for mandatory mail, which has no off switch. */
  preferencesUrl: string | null
  priority: 'urgent' | 'normal'
}>

/**
 * A single notification as an email.
 *
 * The subject IS the rendered title: the domain already leads with the decision
 * and names the property ("Approve a reply at Riverside Hotel"), which is
 * exactly what a subject line needs. Appending a brand suffix would only push
 * the property out of the mobile preview — the sender name carries the brand.
 */
export const renderNotificationEmail = (input: NotificationEmailInput): RenderedEmail => {
  const { rendered, actionUrl, preferencesUrl } = input
  return {
    subject: clipSubject(rendered.title),
    html: renderUrgentEmailHtml({
      rendered,
      actionUrl,
      priority: input.priority,
      ...(preferencesUrl === null ? {} : { preferencesUrl }),
    }),
    text: composeText(
      rendered.title,
      rendered.body,
      toPlainFacts(rendered.summary),
      `${rendered.actionLabel}: ${actionUrl}`,
      preferencesUrl === null ? '' : preferencesLine(preferencesUrl),
      EMAIL_SIGNATURE,
    ),
  }
}

export type DigestEmailInput = Readonly<{
  recipientName: string | null
  /** Already localised by the caller — this module never formats a date. */
  dateLabel: string
  groups: ReadonlyArray<DigestEmailGroup>
  preferencesUrl: string
}>

/** "7 updates across 3 properties" / "1 update at Riverside Hotel". */
const digestHeadline = (groups: ReadonlyArray<DigestEmailGroup>): string => {
  const items = groups.reduce((total, group) => total + group.items.length, 0)
  if (items === 0) return 'No new updates'
  const noun = items === 1 ? 'update' : 'updates'
  const first = groups.find((group) => group.items.length > 0)
  return groups.length === 1 && first !== undefined
    ? `${items} ${noun} at ${first.propertyName}`
    : `${items} ${noun} across ${groups.length} properties`
}

/**
 * The digest's primary button needs an inbox URL, which the ratified input does
 * not carry. Rather than widen the contract for a value the caller has already
 * given us, derive it from the origin of a URL we were handed. Falls back to an
 * item link's origin, then to no button at all — every row still links out.
 */
const inboxUrlFrom = (
  preferencesUrl: string,
  groups: ReadonlyArray<DigestEmailGroup>,
): string | null => {
  const origin =
    originOf(preferencesUrl) ??
    originOf(groups.flatMap((group) => group.items)[0]?.actionUrl ?? '')
  return origin === null ? null : absoluteUrl(origin, '/inbox')
}

const digestGroupText = (group: DigestEmailGroup): string =>
  [
    group.propertyName,
    ...group.items.map(({ rendered, actionUrl }) =>
      [
        `- ${rendered.title}`,
        toPlainFacts(rendered.summary) === ''
          ? `  ${rendered.body}`
          : `  ${toPlainFacts(rendered.summary)}`,
        `  ${rendered.actionLabel}: ${actionUrl}`,
      ].join('\n'),
    ),
  ].join('\n')

/** The daily digest: one email, grouped by property, one link per row. */
export const renderDigestEmail = ({
  recipientName,
  dateLabel,
  groups,
  preferencesUrl,
}: DigestEmailInput): RenderedEmail => {
  const headline = digestHeadline(groups)
  const inboxUrl = inboxUrlFrom(preferencesUrl, groups)
  return {
    subject: clipSubject(`${headline} — ${dateLabel}`),
    html: renderDigestEmailHtml({
      recipientName,
      dateLabel,
      headline,
      groups,
      preferencesUrl,
      inboxUrl,
    }),
    text: composeText(
      recipientName === null ? 'Hi there,' : `Hi ${recipientName},`,
      `${headline} — ${dateLabel}`,
      ...groups.map(digestGroupText),
      inboxUrl === null ? null : `Open inbox: ${inboxUrl}`,
      preferencesLine(preferencesUrl),
      EMAIL_SIGNATURE,
    ),
  }
}
