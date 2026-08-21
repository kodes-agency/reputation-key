// Capturing EmailSenderPort — records notification email instead of sending it.
//
// Why this exists: `bootstrap.ts` used to construct the real Resend adapter
// unconditionally, so a local or test boot with a syntactically valid key would
// happily mail real inboxes, and a boot without a key would only fail at the
// first send (deep inside a BullMQ job) rather than at wiring time. The only
// other fake in this directory, `in-memory-email-sender.ts`, is typed to
// `InvitationEmailParams` and therefore covers just the identity path.
//
// This is a real port implementation, not a stub: it returns a well-formed
// `accepted` outcome with a deterministic provider message id, so the whole
// downstream state machine (markAccepted → provider webhook → recordProviderState)
// is exercisable without a network.

import type {
  EmailSenderPort,
  EmailSendRequest,
} from '#/contexts/notification/application/ports/email-sender.port'
import type { NotificationDeliveryOutcome } from '#/contexts/notification/domain/notification-delivery-policy'

export type CapturedEmail = EmailSendRequest &
  Readonly<{ providerMessageId: string; capturedAt: Date }>

export type CapturingEmailSender = EmailSenderPort &
  Readonly<{
    /** Everything "sent" since the last `clear()`, oldest first. */
    readonly captured: ReadonlyArray<CapturedEmail>
    /** The most recent capture, or undefined when nothing was sent. */
    readonly last: CapturedEmail | undefined
    clear: () => void
  }>

export type CapturingEmailSenderOptions = Readonly<{
  /** Injected so captures are deterministic under a fake clock. */
  clock?: () => Date
  /**
   * Force a rejection instead of acceptance — used to drive the retry and
   * suppression branches of the delivery jobs without a live provider.
   */
  outcome?: (params: EmailSendRequest) => NotificationDeliveryOutcome | undefined
}>

export function createCapturingEmailSender(
  options: CapturingEmailSenderOptions = {},
): CapturingEmailSender {
  const clock = options.clock ?? (() => new Date())
  const captured: CapturedEmail[] = []
  let sequence = 0

  const sender: EmailSenderPort = {
    async send(params: EmailSendRequest): Promise<NotificationDeliveryOutcome> {
      const forced = options.outcome?.(params)
      const capturedAt = clock()
      // Deterministic and unique: the digest and urgent paths both key their
      // queue rows off the returned id, so a shared constant would collapse
      // distinct rows onto one provider message.
      sequence += 1
      const providerMessageId =
        forced?.kind === 'accepted' ? forced.providerMessageId : `captured-${sequence}`
      captured.push({ ...params, providerMessageId, capturedAt })
      return forced ?? { kind: 'accepted', providerMessageId, acceptedAt: capturedAt }
    },
  }

  return Object.defineProperties(sender as CapturingEmailSender, {
    captured: { get: () => [...captured] },
    last: { get: () => captured.at(-1) },
    clear: {
      value: () => {
        captured.length = 0
      },
    },
  })
}
