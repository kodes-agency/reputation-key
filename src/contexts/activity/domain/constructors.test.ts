import { describe, it, expect } from 'vitest'
import { createActivityLog } from './constructors'
import type { ActivityAction, ResourceType } from './types'

const clock = () => new Date('2026-06-02T12:00:00Z')

describe('createActivityLog', () => {
  const validInput = {
    actorId: 'user-1',
    actorName: 'Bozhidar',
    actorAvatarUrl: null,
    actorRole: 'AccountAdmin' as const,
    action: 'created' as ActivityAction,
    resourceType: 'inbox_item' as ResourceType,
    resourceId: 'ii-1',
    propertyId: 'prop-1',
    organizationId: 'org-1',
    payload: {
      subject: 'inbox_item',
      from: null,
      to: null,
      detail: 'review',
    },
    source: 'web' as const,
  }

  it('constructs a valid activity log entry', () => {
    const entry = createActivityLog(validInput, clock)
    expect(entry.id).toBe('') // populated by DB
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

  it('throws for invalid action', () => {
    expect(() =>
      createActivityLog({ ...validInput, action: 'invalid' as ActivityAction }, clock),
    ).toThrow('Invalid action')
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
      expect(() => createActivityLog({ ...validInput, action }, clock)).not.toThrow()
    }
  })

  it('sets actorAvatarUrl to null when provided as null', () => {
    const entry = createActivityLog({ ...validInput, actorAvatarUrl: null }, clock)
    expect(entry.actorAvatarUrl).toBeNull()
  })

  it('preserves actorAvatarUrl when provided', () => {
    const entry = createActivityLog(
      { ...validInput, actorAvatarUrl: 'https://example.com/avatar.jpg' },
      clock,
    )
    expect(entry.actorAvatarUrl).toBe('https://example.com/avatar.jpg')
  })
})
