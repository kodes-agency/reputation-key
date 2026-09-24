// ADR 0046, amended 2026-09-24 — the Google connection belongs to the
// Organization, so the notice that it was disconnected does too.

import { describe, expect, it } from 'vitest'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotification } from './notification-constructors'
import {
  classifyNotification,
  notificationScopeForType,
} from './notification-delivery-policy'
import { notificationLink, renderNotification } from './notification-templates'
import { isUrgent } from './notification-types'

const NOW = new Date('2026-09-24T10:00:00.000Z')
const CONNECTION = '00000000-0000-4000-8000-0000000000e1'

const disconnected = {
  id: notificationId('notification-1'),
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  propertyId: null,
  type: 'integration.google_disconnected' as const,
  resourceType: 'integration' as const,
  resourceId: CONNECTION,
  eventId: 'event-1',
  payload: {},
}

describe('Google disconnect notice scope and policy', () => {
  it('is collaboration, not a mandatory notice and not urgent', () => {
    expect(classifyNotification('integration.google_disconnected')).toBe(
      'workflow_collaboration',
    )
    expect(isUrgent('integration.google_disconnected')).toBe(false)
  })

  it('belongs to the Organization', () => {
    expect(notificationScopeForType('integration.google_disconnected')).toBe(
      'organization',
    )
  })

  it('builds a Property-less notice pointing at the connection', () => {
    const result = createNotification(disconnected, () => NOW)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        propertyId: null,
        category: 'workflow_collaboration',
        resourceType: 'integration',
        resourceId: CONNECTION,
      })
    }
  })

  it('refuses a Property on a disconnect notice', () => {
    const result = createNotification(
      {
        ...disconnected,
        propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
      },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'integration.google_disconnected notifications are Organization-scoped and cannot name a Property',
    )
  })

  it('refuses a disconnect notice that points at the Organization', () => {
    const result = createNotification(
      { ...disconnected, resourceType: 'organization', resourceId: 'org-1' },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'integration.google_disconnected notifications must point at integration',
    )
  })

  it('says what stopped without naming who stopped it', () => {
    const rendered = renderNotification('integration.google_disconnected', {
      propertyName: 'Riverside Hotel',
      actorRole: 'account_admin',
    })

    expect(rendered.title).toBe('Google was disconnected')
    expect(`${rendered.title} ${rendered.body} ${rendered.summary}`).not.toContain(
      'Riverside Hotel',
    )
    expect(rendered.body).toContain('Reconnect it in Settings')
  })

  it('opens the integrations settings page', () => {
    expect(
      notificationLink(
        'integration',
        CONNECTION,
        null,
        'integration.google_disconnected',
      ),
    ).toEqual({ path: '/settings/integrations', search: {} })
  })
})
