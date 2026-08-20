import { describe, expect, it } from 'vitest'
import type { EmailSendRequest } from '#/contexts/notification/application/ports/email-sender.port'
import { createCapturingEmailSender } from './capturing-email-sender'

const request = (overrides: Partial<EmailSendRequest> = {}): EmailSendRequest => ({
  to: 'manager@example.com',
  subject: 'Approve this reply',
  html: '<p>Approve this reply</p>',
  text: 'Approve this reply',
  idempotencyKey: 'notification-1:email',
  ...overrides,
})

describe('capturing email sender', () => {
  it('captures the full send request including the plain-text twin and headers', async () => {
    const sender = createCapturingEmailSender({ clock: () => new Date('2026-08-21T09:00:00Z') })

    await sender.send(
      request({
        headers: {
          'List-Unsubscribe': '<https://app.test/settings/notifications>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    )

    expect(sender.captured).toHaveLength(1)
    expect(sender.last).toMatchObject({
      to: 'manager@example.com',
      text: 'Approve this reply',
      capturedAt: new Date('2026-08-21T09:00:00Z'),
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
  })

  it('returns a distinct provider message id per send so queue rows do not collapse', async () => {
    const sender = createCapturingEmailSender()

    const first = await sender.send(request({ idempotencyKey: 'a' }))
    const second = await sender.send(request({ idempotencyKey: 'b' }))

    expect(first.kind).toBe('accepted')
    expect(second.kind).toBe('accepted')
    expect(first.kind === 'accepted' && second.kind === 'accepted').toBe(true)
    if (first.kind !== 'accepted' || second.kind !== 'accepted') return
    expect(first.providerMessageId).not.toBe(second.providerMessageId)
  })

  it('forces a rejection outcome while still capturing the attempt', async () => {
    const sender = createCapturingEmailSender({
      outcome: () => ({
        kind: 'rejected',
        classification: 'transient',
        providerCode: 'rate_limit_exceeded',
      }),
    })

    const outcome = await sender.send(request())

    expect(outcome).toEqual({
      kind: 'rejected',
      classification: 'transient',
      providerCode: 'rate_limit_exceeded',
    })
    expect(sender.captured).toHaveLength(1)
  })

  it('clear() empties the capture log', async () => {
    const sender = createCapturingEmailSender()
    await sender.send(request())

    sender.clear()

    expect(sender.captured).toEqual([])
    expect(sender.last).toBeUndefined()
  })
})
