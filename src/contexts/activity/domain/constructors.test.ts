import { describe, it, expect } from 'vitest'
import { createRecentActivityEntry } from './constructors'
import {
  ACTIVITY_ACTIONS,
  RECENT_ACTIVITY_KINDS,
  type ActivityAction,
  type ResourceType,
} from './types'
import {
  userId,
  propertyId,
  organizationId,
  recentActivityEntryId,
} from '#/shared/domain/ids'

const clock = () => new Date('2026-06-02T12:00:00Z')

describe('createRecentActivityEntry', () => {
  const validInput = {
    id: recentActivityEntryId('al-1'),
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
    eventId: 'test-event-id',
  }

  it('constructs a valid recent activity entry', () => {
    const result = createRecentActivityEntry(validInput, clock)
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    const entry = result.value
    expect(entry.id).toBe('al-1')
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
    const result = createRecentActivityEntry(
      { ...validInput, action: 'invalid' as ActivityAction },
      clock,
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) throw new Error('unreachable')
    expect(result.error.code).toBe('invalid_action')
  })

  it('accepts every governed Recent Activity kind', () => {
    for (const kind of RECENT_ACTIVITY_KINDS) {
      const result = createRecentActivityEntry({ ...validInput, ...kind }, clock)
      expect(result.isOk()).toBe(true)
    }
  })

  it('keeps legacy action/resource values readable but rejects them for new entries', () => {
    expect(ACTIVITY_ACTIONS).toContain('created')

    for (const resourceType of ['review', 'note'] as const) {
      const result = createRecentActivityEntry({ ...validInput, resourceType }, clock)
      expect(result.isErr()).toBe(true)
      if (!result.isErr()) throw new Error('unreachable')
      expect(result.error.code).toBe('invalid_event_kind')
    }
  })

  it('rejects unsupported combinations of otherwise known values', () => {
    const result = createRecentActivityEntry(
      { ...validInput, action: 'deleted', resourceType: 'reply' },
      clock,
    )
    expect(result.isErr()).toBe(true)
    if (!result.isErr()) throw new Error('unreachable')
    expect(result.error.code).toBe('invalid_event_kind')
  })

  it('sets actorAvatarUrl to null when provided as null', () => {
    const result = createRecentActivityEntry(
      { ...validInput, actorAvatarUrl: null },
      clock,
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    expect(result.value.actorAvatarUrl).toBeNull()
  })

  it('preserves actorAvatarUrl when provided', () => {
    const result = createRecentActivityEntry(
      { ...validInput, actorAvatarUrl: 'https://example.com/avatar.jpg' },
      clock,
    )
    expect(result.isOk()).toBe(true)
    if (!result.isOk()) throw new Error('unreachable')
    expect(result.value.actorAvatarUrl).toBe('https://example.com/avatar.jpg')
  })
})
