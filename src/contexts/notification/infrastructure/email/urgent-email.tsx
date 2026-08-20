// The single-notification email.
//
// Layout only. Every user-facing sentence arrives pre-rendered in
// `RenderedNotification` from `domain/notification-templates`; this component
// must never compose copy, because a sentence written here would drift from the
// in-app row that renders from the same notification.

import type { RenderedNotification } from '../../domain/notification-templates'
import { EmailLayout, renderEmailDocument } from '#/shared/email'
import {
  EmailButton,
  EmailFallbackUrl,
  EmailHeadline,
  EmailParagraph,
  EmailPill,
} from '#/shared/email/primitives'
import { FactsStrip } from './notification-facts'

export type UrgentNotificationEmailProps = Readonly<{
  rendered: RenderedNotification
  actionUrl: string
  preferencesUrl: string
  priority: 'urgent' | 'normal'
}>

/**
 * Urgency is a small accent pill, not a red banner: DESIGN.md reserves Signal
 * Red for destructive actions and caps accent coverage at 10% of the surface.
 * The reader learns this is urgent from the pill and from the subject line,
 * which is where urgency actually has to survive.
 */
export const UrgentNotificationEmail = ({
  rendered,
  actionUrl,
  preferencesUrl,
  priority,
}: UrgentNotificationEmailProps) => (
  <EmailLayout
    preheader={rendered.summary === '' ? rendered.title : rendered.summary}
    documentTitle={rendered.title}
    whyReceived={
      priority === 'urgent'
        ? 'You received this because immediate email alerts are on for urgent notifications on your account.'
        : 'You received this because email alerts are on for this notification type.'
    }
    preferencesUrl={preferencesUrl}
  >
    {priority === 'urgent' && <EmailPill>Needs attention</EmailPill>}
    <EmailHeadline>{rendered.title}</EmailHeadline>
    {rendered.body !== '' && <EmailParagraph>{rendered.body}</EmailParagraph>}
    <FactsStrip summary={rendered.summary} />
    <EmailButton href={actionUrl}>{rendered.actionLabel}</EmailButton>
    <EmailFallbackUrl href={actionUrl} />
  </EmailLayout>
)

/** JSX-free entry point so `render.ts` can stay a `.ts` module. */
export const renderUrgentEmailHtml = (props: UrgentNotificationEmailProps): string =>
  renderEmailDocument(<UrgentNotificationEmail {...props} />)
