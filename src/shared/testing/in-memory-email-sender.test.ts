// In-memory email sender — tests for recording emails.

import { describe, it, expect } from 'vitest'
import { createInMemoryEmailSender } from './in-memory-email-sender'

describe('createInMemoryEmailSender', () => {
  it('records sent emails', async () => {
    const send = createInMemoryEmailSender()
    await send({
      email: 'guest@example.com',
      invitedByUsername: 'Alice',
      organizationName: 'Acme Hotels',
      inviteLink: 'https://app.example.com/invite/abc',
    })

    expect(send.sentEmails).toHaveLength(1)
    expect(send.sentEmails[0].email).toBe('guest@example.com')
    expect(send.sentEmails[0].organizationName).toBe('Acme Hotels')
  })

  it('records multiple emails in order', async () => {
    const send = createInMemoryEmailSender()
    await send({
      email: 'a@example.com',
      invitedByUsername: 'Admin',
      organizationName: 'Org',
      inviteLink: 'https://app/invite/1',
    })
    await send({
      email: 'b@example.com',
      invitedByUsername: 'Admin',
      organizationName: 'Org',
      inviteLink: 'https://app/invite/2',
    })

    expect(send.sentEmails).toHaveLength(2)
    expect(send.sentEmails[0].email).toBe('a@example.com')
    expect(send.sentEmails[1].email).toBe('b@example.com')
  })

  it('clear() resets recorded emails', async () => {
    const send = createInMemoryEmailSender()
    await send({
      email: 'x@example.com',
      invitedByUsername: 'Admin',
      organizationName: 'Org',
      inviteLink: 'https://app/invite/x',
    })
    expect(send.sentEmails).toHaveLength(1)

    send.clear()
    expect(send.sentEmails).toHaveLength(0)
  })
})
