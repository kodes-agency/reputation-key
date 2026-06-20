// In-memory email sender — records emails instead of sending via Resend.
// Implements the same function signature injected into the identity context
// so simulations can capture invitation/reset emails for assertions.

import type { InvitationEmailParams } from '#/shared/auth/emails'

// fallow-ignore-next-line unused-type
export type InMemoryEmailSender = ((params: InvitationEmailParams) => Promise<void>) & {
  /** All emails "sent" since the last clear. */
  readonly sentEmails: ReadonlyArray<InvitationEmailParams>
  /** Clear recorded emails. */
  clear: () => void
}

export function createInMemoryEmailSender(): InMemoryEmailSender {
  const sent: InvitationEmailParams[] = []

  const sender = async (params: InvitationEmailParams): Promise<void> => {
    sent.push(params)
  }

  Object.defineProperty(sender, 'sentEmails', {
    get: () => [...sent],
  })
  Object.defineProperty(sender, 'clear', {
    value: () => {
      sent.length = 0
    },
  })

  return sender as InMemoryEmailSender
}
