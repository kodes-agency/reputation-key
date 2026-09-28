// `integration.reauthorization_required` anchors on a Property so it can be
// mailed. With no active Property to anchor on it falls back to the
// Organization: in the bell, never by email, rather than to nobody.
import { describe, expect, it } from 'vitest'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotification } from '../../domain/notification-constructors'
import { insertNotification } from './insert-notification'
import { buildFakeInsertNotificationDeps } from './test-fixtures'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const CONNECTION = '00000000-0000-4000-8000-0000000000e2'

const reauthorization = {
  userId: userId('admin-1'),
  organizationId: organizationId('org-1'),
  propertyId: null,
  type: 'integration.reauthorization_required' as const,
  resourceType: 'integration' as const,
  resourceId: CONNECTION,
  eventId: 'event-1',
  payload: { reauthorizationCause: 'provider_revoked' as const },
}

describe('Google reauthorization notice without a Property', () => {
  it('is admitted at Organization scope, pointing at the connection', () => {
    const result = createNotification(
      { ...reauthorization, id: notificationId('notification-1') },
      () => NOW,
    )

    expect(result.isOk() && result.value).toMatchObject({
      propertyId: null,
      category: 'urgent_operational',
      resourceType: 'integration',
      resourceId: CONNECTION,
    })
  })

  it('still refuses an Organization-scoped notice that points elsewhere', () => {
    const result = createNotification(
      {
        ...reauthorization,
        id: notificationId('notification-1'),
        resourceType: 'organization',
        resourceId: 'org-1',
      },
      () => NOW,
    )

    expect(result.isErr()).toBe(true)
  })

  it('keeps the Property-anchored shape it is mailed in', () => {
    const result = createNotification(
      {
        ...reauthorization,
        id: notificationId('notification-1'),
        propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
      },
      () => NOW,
    )

    expect(result.isOk()).toBe(true)
  })

  it('lands in the bell with no Property preference to consult and no email', async () => {
    const deps = buildFakeInsertNotificationDeps()

    const result = await insertNotification(deps)(reauthorization)

    expect(deps.preferenceRepo.resolveForDelivery).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      propertyId: null,
      type: 'integration.reauthorization_required',
      resourceType: 'integration',
    })
    expect(deps.notificationRepo.insert).toHaveBeenCalledOnce()
    expect(deps.emailRepo.insert).not.toHaveBeenCalled()
    expect(deps.enqueueImmediateEmail).not.toHaveBeenCalled()
  })
})
