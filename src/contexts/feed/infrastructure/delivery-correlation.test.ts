import { describe, expect, it, vi } from 'vitest'
import { emailCorrelationId, providerEventCorrelationId } from './delivery-correlation'
import {
  createImmediateEmailEnqueue,
  createQuietHoursRelease,
} from './jobs/immediate-email-enqueue'

describe('delivery correlation ids', () => {
  it('builds the queue row log identity', () => {
    expect(emailCorrelationId('email-1')).toBe('notification-email:email-1')
    expect(providerEventCorrelationId('msg_2abc')).toBe('resend-event:msg_2abc')
  })

  it('is the correlationId every immediate-email job envelope carries', async () => {
    // If these drift, the enqueue log and the delivery log stop joining, which
    // is exactly the invisible-failure problem this pipeline exists to fix.
    const add = vi.fn(async (_name: string, _data: unknown) => undefined)
    const target = { notificationEmailId: 'email-1', organizationId: 'org-1' }

    await createImmediateEmailEnqueue({ add }, 'notification:urgent-enqueue')(target)
    await createQuietHoursRelease({ add }, () => new Date(0))(
      { ...target, propertyId: 'property-1' },
      new Date(60_000),
    )

    expect(add.mock.calls.map(([, data]) => data)).toEqual([
      expect.objectContaining({ correlationId: emailCorrelationId('email-1') }),
      expect.objectContaining({ correlationId: emailCorrelationId('email-1') }),
    ])
  })
})
