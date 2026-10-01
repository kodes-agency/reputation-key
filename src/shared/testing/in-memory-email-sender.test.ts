// In-memory email sender — tests for recording emails.

import { describe, it, expect } from 'vitest'
import type { InvitationEmailParams } from '#/shared/auth/emails'
import { createInMemoryEmailSender } from './in-memory-email-sender'

const invitation = (patch: Partial<InvitationEmailParams>): InvitationEmailParams => ({
  email: 'guest@example.com',
  invitedByUsername: 'Alice',
  organizationName: 'Acme Hotels',
  inviteLink: 'https://app.example.com/accept-invitation?id=abc',
  role: 'PropertyManager',
  propertyNames: ['Acme Downtown'],
  expiresInDays: 7,
  ...patch,
})

describe('createInMemoryEmailSender', () => {
  it('records the whole invitation email, role and Properties included', async () => {
    const send = createInMemoryEmailSender()
    await send(invitation({}))

    expect(send.sentEmails).toEqual([invitation({})])
  })

  it('records multiple emails in order', async () => {
    const send = createInMemoryEmailSender()
    await send(invitation({ email: 'a@example.com' }))
    await send(
      invitation({ email: 'b@example.com', role: 'AccountAdmin', propertyNames: [] }),
    )

    expect(send.sentEmails.map((sent) => [sent.email, sent.role])).toEqual([
      ['a@example.com', 'PropertyManager'],
      ['b@example.com', 'AccountAdmin'],
    ])
  })

  it('clear() resets recorded emails', async () => {
    const send = createInMemoryEmailSender()
    await send(invitation({ email: 'x@example.com' }))
    expect(send.sentEmails).toHaveLength(1)

    send.clear()
    expect(send.sentEmails).toHaveLength(0)
  })
})
