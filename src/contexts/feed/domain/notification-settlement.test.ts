import { describe, expect, it } from 'vitest'
import {
  ACTIONABLE_NOTIFICATION_TYPES,
  isStillActionable,
  settledNotificationTypes,
  type SettlingFact,
} from './notification-settlement'
import { NOTIFICATION_TYPES, type NotificationType } from './notification-types'

const row = (
  over: Partial<{
    type: NotificationType
    status: 'unread' | 'read' | 'dismissed'
    resolvedAt: Date | null
  }> = {},
) => ({
  type: 'reply.pending_approval' as NotificationType,
  status: 'unread' as const,
  resolvedAt: null,
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
      'inbox.bulk_reopened',
      'inbox.reopened',
      'inbox.response_target_halfway',
      'inbox.response_target_passed',
    ])
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
      'escalation.resolved',
      'handling_cycle.closed',
      'property.responsibility_restored',
      'portal.responsibility_restored',
    ]
    const settled = facts.flatMap((fact) => [...settledNotificationTypes(fact)])

    expect(settled.filter((type) => !ACTIONABLE_NOTIFICATION_TYPES.has(type))).toEqual([])
  })

  it('names only real notification types as actionable', () => {
    expect(
      [...ACTIONABLE_NOTIFICATION_TYPES].filter(
        (type) => !(NOTIFICATION_TYPES as readonly string[]).includes(type),
      ),
    ).toEqual([])
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
