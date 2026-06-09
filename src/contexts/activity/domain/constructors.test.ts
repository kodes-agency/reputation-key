import { describe, it, expect } from 'vitest'
import { createActivityLog } from './constructors'
import type { ActivityAction, ResourceType } from './types'
import { userId, propertyId, organizationId } from '#/shared/domain/ids'

const clock = () => new Date('2026-06-02T12:00:00Z')

describe('createActivityLog', () => {
  const validInput = {
    actorId: userId('user-1'),
    actorName: 'Bozhidar',
    actorAvatarUrl: null,
    actorRole: 'AccountAdmin' as const,
    action: 'created' as ActivityAction,
    resourceType: 'inbox_item' as ResourceType,
    resourceId: 'ii-1',
    propertyId: propertyId('prop-1'),
    organizationId: organizationId('org-1'),
    payload: {
      subject: 'inbox_item',
      from: null,
      to: null,
      detail: 'review',
    },
    source: 'web' as const,
  }

  it('constructs a valid activity log entry', () => {
    const result = createActivityLog(validInput, clock)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    const entry = result.value
    expect(entry.id).toBe('')
    expect(entry.actorId).toBe('user-1')
    expect(entry.actorName).toBe('Bozhidar')
    expect(entry.action).toBe('created')
    expect(entry.resourceType).toBe('inbox_item')
    expect(entry.resourceId).toBe('ii-1')
    expect(entry.propertyId).toBe('prop-1')
    expect(entry.organizationId).toBe('org-1')
    expect(entry.payload.subject).toBe('inbox_item')
    expect(entry.source).toBe('web')
    expect(entry.createdAt).toEqual(clock())
  })

  it('returns error for invalid action', () => {
    const result = createActivityLog(
      { ...validInput, action: 'invalid' as ActivityAction },
      clock,
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) throw new Error('unreachable')
    expect(result.error.code).toBe('invalid_action')
  })

  it('accepts all valid actions', () => {
    const actions: ActivityAction[] = [
      'created',
      'changed',
      'deleted',
      'assigned',
      'unassigned',
      'published',
      'rejected',
      'approved',
      'submitted',
      'added',
      'escalated',
    ]
    for (const action of actions) {
      const result = createActivityLog({ ...validInput, action }, clock)
      expect(result.isOk()).toBe(true)
    }
  })

  it('sets actorAvatarUrl to null when provided as null', () => {
    const result = createActivityLog({ ...validInput, actorAvatarUrl: null }, clock)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    expect(result.value.actorAvatarUrl).toBeNull()
  })

  it('preserves actorAvatarUrl when provided', () => {
    const result = createActivityLog(
      { ...validInput, actorAvatarUrl: 'https://example.com/avatar.jpg' },
      clock,
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    expect(result.value.actorAvatarUrl).toBe('https://example.com/avatar.jpg')
  })
})
