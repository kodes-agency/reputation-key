// ADR 0059 — the first Organization-scoped notice that is not mandatory, and
// the shape every later one (ADR 0046, amended 2026-09-24) has to fit.

import { describe, expect, it } from 'vitest'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createNotification } from './notification-constructors'
import {
  classifyNotification,
  notificationScopeForType,
  ORGANIZATION_INFORMATIONAL_TYPES,
} from './notification-delivery-policy'
import { parseNotificationPayload } from './notification-payload'
import {
  BETA_FEEDBACK_REPORTS_ANCHOR,
  notificationLink,
  renderNotification,
} from './notification-templates'
import { NOTIFICATION_TYPES } from './notification-types'

const NOW = new Date('2026-09-18T10:00:00.000Z')
const REFERENCE = '00000000-0000-4000-8000-0000000000f1'
const outcome = {
  id: notificationId('notification-1'),
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  propertyId: null,
  type: 'beta_feedback.outcome' as const,
  resourceType: 'beta_feedback_report' as const,
  resourceId: REFERENCE,
  eventId: 'event-1',
  payload: { reportOutcome: 'resolved' },
}

describe('report outcome scope and policy', () => {
  it('is collaboration, not a mandatory notice', () => {
    expect(classifyNotification('beta_feedback.outcome')).toBe('workflow_collaboration')
  })

  it('belongs to the Organization', () => {
    expect(notificationScopeForType('beta_feedback.outcome')).toBe('organization')
  })

  it('is one of the named few the Organization scope admits', () => {
    // Widening this list is an ADR decision; the database CHECK names the same
    // types, one branch each, so the two cannot drift apart silently.
    const organizationScopedNonMandatory = NOTIFICATION_TYPES.filter(
      (type) =>
        notificationScopeForType(type) === 'organization' &&
        classifyNotification(type) !== 'mandatory',
    )
    expect(organizationScopedNonMandatory).toEqual([
      'integration.google_disconnected',
      'beta_feedback.outcome',
    ])
    expect([...ORGANIZATION_INFORMATIONAL_TYPES]).toEqual([
      'beta_feedback.outcome',
      'integration.google_disconnected',
    ])
  })

  it('leaves every other workflow notice Property-scoped', () => {
    expect(notificationScopeForType('reply.approved')).toBe('property')
    expect(notificationScopeForType('inbox.assigned')).toBe('property')
  })
})

describe('report outcome construction', () => {
  it('builds an Organization-scoped notice pointing at the report', () => {
    const result = createNotification(outcome, () => NOW)

    expect(result.isOk()).toBe(true)
    if (result.isOk()) {
      expect(result.value).toMatchObject({
        propertyId: null,
        category: 'workflow_collaboration',
        resourceType: 'beta_feedback_report',
        resourceId: REFERENCE,
        payload: { reportOutcome: 'resolved' },
      })
    }
  })

  it('refuses a Property on a report outcome', () => {
    const result = createNotification(
      { ...outcome, propertyId: propertyId('11111111-1111-4111-8111-111111111111') },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'beta_feedback.outcome notifications are Organization-scoped and cannot name a Property',
    )
  })

  it('refuses a report outcome that points at the Organization', () => {
    const result = createNotification(
      { ...outcome, resourceType: 'organization', resourceId: 'org-1' },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'beta_feedback.outcome notifications must point at beta_feedback_report',
    )
  })

  it('refuses a Property notice that points at a report', () => {
    const result = createNotification(
      {
        ...outcome,
        type: 'reply.approved',
        propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
      },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'Property notifications cannot point at a beta report',
    )
  })

  it('refuses a mandatory notice that points at a report', () => {
    const result = createNotification(
      { ...outcome, type: 'account.organization_access_granted' },
      () => NOW,
    )

    expect(result.isErr() && result.error.message).toBe(
      'Mandatory notifications must use an Organization resource',
    )
  })
})

describe('report outcome copy', () => {
  it.each([
    ['accepted', 'Your report was accepted'],
    ['declined', 'Your report won’t be taken forward'],
    ['resolved', 'Your report was resolved'],
  ] as const)('says a report was %s', (reportOutcome, title) => {
    const rendered = renderNotification('beta_feedback.outcome', { reportOutcome })

    expect(rendered.title).toBe(title)
    expect(rendered.actionLabel).toBe('View reports')
  })

  it('degrades to a neutral update when the outcome is missing', () => {
    expect(renderNotification('beta_feedback.outcome', {}).title).toBe(
      'Your report was updated',
    )
  })

  it('never names a Property, because a report has none', () => {
    const rendered = renderNotification('beta_feedback.outcome', {
      reportOutcome: 'resolved',
      propertyName: 'Riverside Hotel',
    })

    expect([rendered.title, rendered.body, rendered.summary].join(' ')).not.toContain(
      'Riverside Hotel',
    )
  })
})

describe('report outcome link', () => {
  it('opens the reporter’s list rather than a route that does not exist', () => {
    expect(notificationLink('beta_feedback_report', REFERENCE, null)).toEqual({
      path: '/properties',
      search: {},
      hash: BETA_FEEDBACK_REPORTS_ANCHOR,
    })
  })

  it('does not put the report reference in the URL', () => {
    const link = notificationLink('beta_feedback_report', REFERENCE, null)

    expect(JSON.stringify(link)).not.toContain(REFERENCE)
  })
})

describe('report outcome payload', () => {
  it.each(['accepted', 'declined', 'resolved'])(
    'keeps the %s outcome',
    (reportOutcome) => {
      expect(parseNotificationPayload({ reportOutcome })).toEqual({ reportOutcome })
    },
  )

  it.each([
    ['an internal triage state', 'reproducing'],
    ['report text', 'The reviews page crashed for guest Jane'],
    ['a number', 3],
  ])('drops %s rather than rendering it', (_label, reportOutcome) => {
    expect(parseNotificationPayload({ reportOutcome })).toEqual({})
  })
})
