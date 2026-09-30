import { describe, expect, it } from 'vitest'
import {
  ACTIONABLE_NOTIFICATION_TYPES,
  isSettleableNotificationType,
  isStillActionable,
  settledNotificationTypes,
  SUPERSEDED_FOR_READER,
  type SettlingFact,
} from './notification-settlement'
import { NOTIFICATION_TYPES, type NotificationType } from './notification-types'

const row = (
  over: Partial<{
    type: NotificationType
    status: 'unread' | 'read' | 'dismissed'
    resolvedAt: Date | null
    readAt: Date | null
  }> = {},
) => ({
  type: 'reply.pending_approval' as NotificationType,
  status: 'unread' as const,
  resolvedAt: null,
  readAt: over.status === 'read' ? new Date('2026-09-23T08:00:00Z') : null,
  ...over,
})

describe('which notices a settling fact retires', () => {
  it('retires the approval request when the reply is approved', () => {
    expect(settledNotificationTypes('reply.decided')).toEqual(['reply.pending_approval'])
  })

  it('retires the approval request and the failed publication when the reply goes live', () => {
    expect([...settledNotificationTypes('reply.published')].sort()).toEqual([
      'reply.pending_approval',
      'reply.publish_failed',
    ])
  })

  it('retires the escalation when it is resolved', () => {
    expect(settledNotificationTypes('escalation.resolved')).toEqual(['inbox.escalated'])
  })

  it('retires every waiting-cycle notice when the Handling Cycle closes', () => {
    expect([...settledNotificationTypes('handling_cycle.closed')].sort()).toEqual([
      'feedback.created',
      'inbox.assigned',
      'inbox.reopened',
      'inbox.response_target_halfway',
      'inbox.response_target_passed',
      'review.created',
      'review.updated',
    ])
  })

  it('retires the reconnect request whichever way the connection was answered', () => {
    expect(settledNotificationTypes('google_connection.reconnected')).toEqual([
      'integration.reauthorization_required',
    ])
    expect(settledNotificationTypes('google_connection.disconnected')).toEqual([
      'integration.reauthorization_required',
    ])
  })

  it('retires the Health notice once the Portal needs nobody', () => {
    expect(settledNotificationTypes('portal_health.recovered')).toEqual([
      'portal.health_attention',
    ])
  })

  it('retires a failed publication once a cancellation returns the reply to draft', () => {
    expect(settledNotificationTypes('reply.returned_to_draft')).toEqual([
      'reply.publish_failed',
    ])
  })

  it('leaves a grouped reopen standing, because one closed item is not all of them', () => {
    expect(settledNotificationTypes('handling_cycle.closed')).not.toContain(
      'inbox.bulk_reopened',
    )
  })

  it('retires only the Property request when a Property gets a manager back', () => {
    expect(settledNotificationTypes('property.responsibility_restored')).toEqual([
      'property.responsibility_needed',
    ])
  })

  it('retires only the Portal request when a Portal gets a manager back', () => {
    expect(settledNotificationTypes('portal.responsibility_restored')).toEqual([
      'portal.responsibility_needed',
    ])
  })

  it('only ever retires a type that asks its reader for work', () => {
    const facts: ReadonlyArray<SettlingFact> = [
      'reply.decided',
      'reply.published',
      'reply.returned_to_draft',
      'escalation.resolved',
      'handling_cycle.closed',
      'property.responsibility_restored',
      'portal.responsibility_restored',
      'google_connection.reconnected',
      'google_connection.disconnected',
      'portal_health.recovered',
    ]
    const settled = facts.flatMap((fact) => [...settledNotificationTypes(fact)])

    expect(settled.filter((type) => !ACTIONABLE_NOTIFICATION_TYPES.has(type))).toEqual([])
  })

  it('takes back the final deletion warning, the one warning a later fact retracts', () => {
    expect(settledNotificationTypes('organization.purge_cancelled')).toEqual([
      'account.organization_purge_pending',
    ])
    expect(isSettleableNotificationType('account.organization_purge_pending')).toBe(true)
    expect(isSettleableNotificationType('account.organization_access_removed')).toBe(
      false,
    )
  })

  it('names only real notification types as actionable', () => {
    expect(
      [...ACTIONABLE_NOTIFICATION_TYPES].filter(
        (type) => !(NOTIFICATION_TYPES as readonly string[]).includes(type),
      ),
    ).toEqual([])
  })
})

// D3 (docs/design/notifications): an assignment is work handed to its reader.
describe('an assignment waits on its reader', () => {
  it('counts "Assigned to you" and a grouped assignment as work', () => {
    expect(ACTIONABLE_NOTIFICATION_TYPES.has('inbox.assigned')).toBe(true)
    expect(ACTIONABLE_NOTIFICATION_TYPES.has('inbox.bulk_assigned')).toBe(true)
    // Losing an item is news, never a call to act.
    expect(ACTIONABLE_NOTIFICATION_TYPES.has('inbox.unassigned')).toBe(false)
  })

  it('retires both when the Property is archived', () => {
    expect(settledNotificationTypes('property.archived')).toEqual(
      expect.arrayContaining(['inbox.assigned', 'inbox.bulk_assigned']),
    )
  })

  it('takes over only the arrival it hands over, only its row in the app, and only while shown there', () => {
    // A guest concern (feedback rated 1-3 or unrated) is Action needed, not an
    // arrival: it stays its own notice, and so does its email.
    expect(SUPERSEDED_FOR_READER['inbox.assigned']).toEqual({
      types: ['review.created', 'review.updated', 'feedback.created'],
      categories: ['arrivals'],
      onlyWhenShownInApp: true,
      keepsEmail: true,
    })
  })

  it('retires the previous holder\'s "Assigned to you" when the item moves on', () => {
    expect(SUPERSEDED_FOR_READER['inbox.unassigned']).toEqual({
      types: ['inbox.assigned'],
      categories: null,
      onlyWhenShownInApp: false,
      keepsEmail: false,
    })
  })

  it('only ever takes over a type that asks its reader for work', () => {
    for (const rule of Object.values(SUPERSEDED_FOR_READER)) {
      for (const type of rule?.types ?? []) {
        expect(ACTIONABLE_NOTIFICATION_TYPES.has(type)).toBe(true)
      }
    }
  })
})

describe('whether a queued email still has work to announce', () => {
  it('sends an actionable notice that is still unread and unresolved', () => {
    expect(isStillActionable(row())).toBe(true)
  })

  it('holds back an actionable notice whose work was settled', () => {
    expect(isStillActionable(row({ resolvedAt: new Date('2026-09-23T09:00:00Z') }))).toBe(
      false,
    )
  })

  it('holds back an actionable notice the reader already read', () => {
    expect(isStillActionable(row({ status: 'read' }))).toBe(false)
  })

  it('sends an email-only anchor, which is stored read but nobody read', () => {
    expect(isStillActionable(row({ status: 'read', readAt: null }))).toBe(true)
  })

  it('holds back an email-only anchor whose work was settled', () => {
    expect(
      isStillActionable(
        row({
          status: 'read',
          readAt: null,
          resolvedAt: new Date('2026-09-23T09:00:00Z'),
        }),
      ),
    ).toBe(false)
  })

  it('holds back an actionable notice the reader dismissed', () => {
    expect(isStillActionable(row({ status: 'dismissed' }))).toBe(false)
  })

  it('still sends an outcome notice the reader read in the app first', () => {
    expect(isStillActionable(row({ type: 'reply.approved', status: 'read' }))).toBe(true)
  })

  it('still sends a mandatory account notice that was read in the app first', () => {
    expect(
      isStillActionable(
        row({ type: 'account.organization_access_removed', status: 'read' }),
      ),
    ).toBe(true)
  })
})
