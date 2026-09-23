import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

/**
 * Outbound transactional-mail seam for the Feed notification surface.
 *
 * `text` is REQUIRED, not optional: an HTML-only operational email is a
 * deliverability defect (spam scoring) and unreadable in a plain-text client,
 * and every renderer in `infrastructure/email/render.ts` already produces a
 * hand-composed plain-text twin. Making it required means the type system,
 * not a reviewer, catches an HTML-only send.
 *
 * `headers` carries the RFC 8058 one-click unsubscribe pair
 * (`List-Unsubscribe` + `List-Unsubscribe-Post`) that ADR 0046 r.7 requires on
 * every non-mandatory email. It stays a generic bag rather than a named field
 * so the port does not have to grow for the next required header.
 *
 * `replyTo` is named rather than left to `headers` because it is a routing
 * decision, not a label: a message whose copy asks the reader to answer must
 * land in a monitored mailbox, while the From address stays the product's
 * sending identity (EMAIL_FROM), which is what SPF/DKIM are aligned for.
 * Absent for the mail nobody should answer, which is almost all of it.
 */
export type EmailSenderPort = Readonly<{
  send(
    params: Readonly<{
      to: string
      subject: string
      html: string
      text: string
      idempotencyKey: string
      headers?: Readonly<Record<string, string>>
      replyTo?: string
    }>,
  ): Promise<NotificationDeliveryOutcome>
}>

/** The `send` input, named so jobs and fakes can share one type. */
export type EmailSendRequest = Parameters<EmailSenderPort['send']>[0]
