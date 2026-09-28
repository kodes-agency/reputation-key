import { describe, expect, it, vi } from 'vitest'
import {
  createImmediateEmailEnqueue,
  createQuietHoursRelease,
} from './immediate-email-enqueue'

const NOW = new Date('2026-01-15T15:00:00.000Z')
const EMAIL = '84000000-0000-4000-8000-000000000001'
const PROPERTY = '84000000-0000-4000-8000-000000000002'

const queueDouble = () => ({ add: vi.fn(async () => ({ id: 'job-1' })) })

describe('createQuietHoursRelease', () => {
  it('enqueues the urgent job to run the minute quiet hours end', async () => {
    const queue = queueDouble()
    const release = createQuietHoursRelease(queue, () => NOW)

    await release(
      { notificationEmailId: EMAIL, organizationId: 'org-1', propertyId: PROPERTY },
      new Date('2026-01-16T05:30:00.000Z'),
    )

    expect(queue.add).toHaveBeenCalledWith(
      'urgent-email',
      expect.objectContaining({
        notificationEmailId: EMAIL,
        organizationId: 'org-1',
        propertyId: PROPERTY,
        capability: 'notification.send_email',
      }),
      expect.objectContaining({
        delay: 14.5 * 60 * 60_000,
        jobId: `quiet-release-${EMAIL}-${Date.parse('2026-01-16T05:30:00.000Z')}`,
      }),
    )
  })

  it('never asks for a negative delay', async () => {
    const queue = queueDouble()

    await createQuietHoursRelease(queue, () => NOW)(
      { notificationEmailId: EMAIL, organizationId: 'org-1', propertyId: PROPERTY },
      new Date(NOW.getTime() - 1_000),
    )

    expect(queue.add).toHaveBeenCalledWith(
      'urgent-email',
      expect.anything(),
      expect.objectContaining({ delay: 0 }),
    )
  })
})

describe('createImmediateEmailEnqueue', () => {
  it('sends an Organization notice under the mandatory job and capability', async () => {
    const queue = queueDouble()

    await createImmediateEmailEnqueue(
      queue,
      'notification:delivery-sweep',
    )({
      notificationEmailId: EMAIL,
      organizationId: 'org-1',
    })

    expect(queue.add).toHaveBeenCalledWith(
      'mandatory-email',
      expect.objectContaining({
        notificationEmailId: EMAIL,
        capability: 'notification.send_mandatory_email',
        initiator: { kind: 'system', id: 'notification:delivery-sweep' },
      }),
      expect.not.objectContaining({ delay: expect.anything() }),
    )
  })
})
