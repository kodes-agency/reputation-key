// Capturing EmailSenderPort — records notification email instead of sending it.
//
// This is the local/test implementation selected by runtime composition when
// outbound email must remain network-free. It lives beside the other
// notification infrastructure adapters because production wiring imports it;
// `shared/testing` is reserved for test and simulation consumers.

import type {
  EmailSenderPort,
  EmailSendRequest,
} from '../../application/ports/email-sender.port'
import type { NotificationDeliveryOutcome } from '../../domain/notification-delivery-policy'

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
  clock: () => Date
  /** Drive rejection/retry branches without a live provider. */
  outcome?: (params: EmailSendRequest) => NotificationDeliveryOutcome | undefined
}>

export const createCapturingEmailSender = (
  options: CapturingEmailSenderOptions,
): CapturingEmailSender => {
  const clock = options.clock
  const captured: CapturedEmail[] = []
  let sequence = 0

  const sender: EmailSenderPort = {
    async send(params: EmailSendRequest): Promise<NotificationDeliveryOutcome> {
      const forced = options.outcome?.(params)
      const capturedAt = clock()
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
