import { describe, expect, it } from 'vitest'
import type { Job } from 'bullmq'
import {
  createInsertNotificationHandler,
  type InsertNotificationJobData,
} from './insert-notification.job'
import { buildFakeInsertNotificationDeps } from '../../application/use-cases/test-fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'

const data: InsertNotificationJobData = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
  type: 'review.created',
  resourceType: 'inbox_item',
  resourceId: 'item-1',
  eventId: 'event-1',
  payload: { propertyName: 'Riverside Hotel', rating: 2 },
}

describe('insert-notification job', () => {
  it('passes concrete property scope to the use case', async () => {
    const deps = buildFakeInsertNotificationDeps()
    const handler = createInsertNotificationHandler(deps)

    await handler({ data } as Job<InsertNotificationJobData>)

    expect(deps.notificationRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: data.propertyId }),
    )
  })

  it('rethrows invalid payload failures so BullMQ can classify the attempt', async () => {
    const handler = createInsertNotificationHandler(buildFakeInsertNotificationDeps())
    const invalid = { ...data, propertyId: '' } as InsertNotificationJobData

    await expect(
      handler({ data: invalid } as Job<InsertNotificationJobData>),
    ).rejects.toMatchObject({
      _tag: 'NotificationError',
      code: 'invalid_input',
    })
  })
})
