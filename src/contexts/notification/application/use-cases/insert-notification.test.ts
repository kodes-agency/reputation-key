import { beforeEach, describe, expect, it, vi } from 'vitest'
import { insertNotification, type InsertNotificationDeps } from './insert-notification'
import { buildFakeInsertNotificationDeps } from './test-fixtures'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { NotificationPreference } from '../../domain/types'

const ORG_ID = organizationId('org-1')
const PROPERTY_ID = propertyId('11111111-1111-4111-8111-111111111111')
const USER_ID = userId('user-1')
const NOW = new Date('2026-06-10T10:00:00.000Z')
const input = {
  userId: USER_ID,
  organizationId: ORG_ID,
  propertyId: PROPERTY_ID,
  type: 'review.created' as const,
  resourceType: 'inbox_item' as const,
  resourceId: 'item-1',
  eventId: 'event-1',
  title: 'New review',
  body: 'A new review was received',
}

function preference(
  channel: 'in_app' | 'email',
  enabled: boolean,
  cadence: 'immediate' | 'daily' = 'daily',
): NotificationPreference {
  return {
    id: 'pref-1' as NotificationPreference['id'],
    userId: USER_ID,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    category: 'workflow_collaboration',
    channel,
    enabled,
    cadence,
    urgentBypassEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

describe('insertNotification', () => {
  let deps: InsertNotificationDeps

  beforeEach(() => {
    deps = buildFakeInsertNotificationDeps()
  })

  it('persists a property-scoped in-app notification with governed category', async () => {
    const result = await insertNotification(deps)(input)

    expect(result).toMatchObject({
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      category: 'workflow_collaboration',
    })
    expect(deps.notificationRepo.insert).toHaveBeenCalledOnce()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('creates a durable property-scoped email row when the email preference is enabled', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference('email', true, 'immediate') : null,
    )

    await insertNotification(deps)(input)

    expect(deps.emailRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        category: 'workflow_collaboration',
        cadence: 'immediate',
        idempotencyKey: 'notif-1:email',
        status: 'pending',
      }),
    )
    expect(deps.enqueueImmediateEmail).toHaveBeenCalledWith({
      notificationEmailId: 'email-1',
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
    })
  })

  it('skips every channel when concrete property preferences disable both', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        preference(channel, false),
    )

    await expect(insertNotification(deps)(input)).resolves.toBeNull()
    expect(deps.notificationRepo.insert).not.toHaveBeenCalled()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
  })

  it('deduplicates only within the concrete property scope', async () => {
    ;(
      deps.notificationRepo.findUnreadByUserTypeResource as ReturnType<typeof vi.fn>
    ).mockResolvedValue(
      await insertNotification(buildFakeInsertNotificationDeps())(input),
    )

    await insertNotification(deps)(input)

    expect(deps.notificationRepo.findUnreadByUserTypeResource).toHaveBeenCalledWith(
      USER_ID,
      ORG_ID,
      PROPERTY_ID,
      'review.created',
      'item-1',
    )
  })

  it('keeps the durable email row pending when immediate queue dispatch is unavailable', async () => {
    ;(deps.preferenceRepo.findForDelivery as ReturnType<typeof vi.fn>).mockImplementation(
      async (_userId, _orgId, _propertyId, _category, channel) =>
        channel === 'email' ? preference('email', true, 'immediate') : null,
    )
    ;(deps.enqueueImmediateEmail as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('queue unavailable'),
    )

    await expect(insertNotification(deps)(input)).resolves.not.toBeNull()
    expect(deps.emailRepo.insert).toHaveBeenCalledOnce()
  })
})
