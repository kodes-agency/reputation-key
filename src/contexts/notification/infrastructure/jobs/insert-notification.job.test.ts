import { describe, expect, it, vi } from 'vitest'
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
  audience: {
    kind: 'responsible_scope',
    scope: { kind: 'property', propertyId: '11111111-1111-4111-8111-111111111111' },
  },
}

const buildDeps = (authorized = true) => ({
  ...buildFakeInsertNotificationDeps(),
  authorizeAudience: vi.fn().mockResolvedValue(authorized),
})

describe('insert-notification job', () => {
  it('passes concrete property scope to the use case', async () => {
    const deps = buildDeps()
    const handler = createInsertNotificationHandler(deps)

    await handler({ data } as Job<InsertNotificationJobData>)

    expect(deps.notificationRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ propertyId: data.propertyId }),
    )
    expect(deps.authorizeAudience).toHaveBeenCalledWith({
      userId: data.userId,
      organizationId: data.organizationId,
      propertyId: data.propertyId,
      audience: data.audience,
    })
  })

  it('suppresses a stale recipient without persisting or retrying', async () => {
    const deps = buildDeps(false)
    const handler = createInsertNotificationHandler(deps)

    await expect(
      handler({ data } as Job<InsertNotificationJobData>),
    ).resolves.toBeUndefined()
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
  })

  it('fails closed for a legacy job without an audience descriptor', async () => {
    const deps = buildDeps()
    const handler = createInsertNotificationHandler(deps)
    const legacy = {
      ...data,
      audience: undefined,
    } as unknown as InsertNotificationJobData

    await expect(
      handler({ data: legacy } as Job<InsertNotificationJobData>),
    ).resolves.toBeUndefined()
    expect(deps.authorizeAudience).not.toHaveBeenCalled()
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
  })

  it('fails closed for a malformed audience descriptor', async () => {
    const deps = buildDeps()
    const handler = createInsertNotificationHandler(deps)
    const malformed = {
      ...data,
      audience: { kind: 'responsible_scope' },
    } as unknown as InsertNotificationJobData

    await expect(
      handler({ data: malformed } as Job<InsertNotificationJobData>),
    ).resolves.toBeUndefined()
    expect(deps.authorizeAudience).not.toHaveBeenCalled()
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
  })

  it('rethrows audience lookup failures so BullMQ can retry safely', async () => {
    const deps = buildDeps()
    deps.authorizeAudience.mockRejectedValue(new Error('authority unavailable'))
    const handler = createInsertNotificationHandler(deps)

    await expect(handler({ data } as Job<InsertNotificationJobData>)).rejects.toThrow(
      'authority unavailable',
    )
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
  })

  it('rethrows invalid payload failures so BullMQ can classify the attempt', async () => {
    const handler = createInsertNotificationHandler(buildDeps())
    const invalid = { ...data, propertyId: '' } as InsertNotificationJobData

    await expect(
      handler({ data: invalid } as Job<InsertNotificationJobData>),
    ).rejects.toMatchObject({
      _tag: 'NotificationError',
      code: 'invalid_input',
    })
  })
})
