import { describe, expect, it } from 'vitest'
import {
  applyCoalescence,
  getDefaultCadence,
  getDefaultEnabled,
  isDisableable,
} from './notification-policy'
import { createNotification } from './constructors'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { Notification } from './types'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-01T09:00:00.000Z')

const unread = (payload: Record<string, unknown>): Notification => {
  const result = createNotification(
    {
      id: notificationId('notification-1'),
      userId: userId('user-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
      type: 'inbox.escalated',
      resourceType: 'inbox_item',
      resourceId: 'item-1',
      eventId: 'event-1',
      payload,
    },
    () => NOW,
  )
  if (result.isErr()) throw result.error
  return result.value
}

describe('notification policy', () => {
  it('resolves a missing preference through the versioned default, never "both on"', () => {
    expect(getDefaultEnabled('workflow_collaboration', 'in_app')).toBe(true)
    expect(getDefaultEnabled('workflow_collaboration', 'email')).toBe(false)
    expect(getDefaultEnabled('recognition', 'email')).toBe(false)
  })

  it('keeps mandatory channels enabled and non-disableable by default', () => {
    expect(getDefaultEnabled('mandatory', 'email')).toBe(true)
    expect(isDisableable('mandatory')).toBe(false)
    expect(isDisableable('recognition')).toBe(true)
  })

  it('keeps cadence defaults in domain policy', () => {
    expect(getDefaultCadence('urgent_operational')).toBe('immediate')
    expect(getDefaultCadence('workflow_collaboration')).toBe('daily')
  })

  it('bumps the count and stamps the latest arrival', () => {
    const bumped = applyCoalescence(unread({ propertyName: 'Riverside' }), {}, LATER)

    expect(bumped).toMatchObject({
      id: 'notification-1',
      coalescedCount: 2,
      coalescedLatestAt: LATER,
      updatedAt: LATER,
    })
  })

  it('publishes the new count as `occurrences` so the copy can say it', () => {
    const bumped = applyCoalescence(unread({ rating: 1 }), { rating: 1 }, LATER)

    expect(bumped.payload.occurrences).toBe(2)
    expect(bumped.body).toContain('Updated 2 times')
  })

  it('re-renders the title from the merged facts', () => {
    const bumped = applyCoalescence(
      unread({ propertyName: 'Riverside', rating: 3 }),
      { propertyName: 'Riverside', rating: 1, waitingHours: 30 },
      LATER,
    )

    // The newer rating wins; the age it has now waited is reflected.
    expect(bumped.title).toBe('Escalated: 1-star review at Riverside')
    expect(bumped.body).toContain('Waiting 1d')
  })

  it('keeps a fact the repeat event could not resolve (newest wins per key)', () => {
    const bumped = applyCoalescence(
      unread({ propertyName: 'Riverside', rating: 2 }),
      { rating: 2 },
      LATER,
    )

    expect(bumped.payload.propertyName).toBe('Riverside')
  })

  it('accumulates across repeated bumps', () => {
    const once = applyCoalescence(unread({}), {}, LATER)
    const twice = applyCoalescence(once, {}, LATER)

    expect(twice.coalescedCount).toBe(3)
    expect(twice.payload.occurrences).toBe(3)
  })

  it('never changes the row identity or tenant scope', () => {
    const original = unread({ propertyName: 'Riverside' })
    const bumped = applyCoalescence(original, {}, LATER)

    expect(bumped.id).toBe(original.id)
    expect(bumped.userId).toBe(original.userId)
    expect(bumped.organizationId).toBe(original.organizationId)
    expect(bumped.propertyId).toBe(original.propertyId)
    expect(bumped.status).toBe('unread')
    expect(bumped.createdAt).toBe(original.createdAt)
  })
})
