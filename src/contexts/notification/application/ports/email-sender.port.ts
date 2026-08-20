import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

export type EmailSenderPort = Readonly<{
  send(
    params: Readonly<{
      to: string
      subject: string
      html: string
      idempotencyKey: string
    }>,
  ): Promise<NotificationDeliveryOutcome>
}>
