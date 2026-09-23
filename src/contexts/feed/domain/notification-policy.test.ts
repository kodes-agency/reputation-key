import { describe, expect, it } from 'vitest'
import {
  applyCoalescence,
  getDefaultCadence,
  getDefaultEnabled,
  isPreferenceDisableable,
  withWaitAtNotice,
} from './notification-policy'
import { createNotification } from './notification-constructors'
import { notificationId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import type { Notification } from './notification-types'

const NOW = new Date('2026-01-01T00:00:00.000Z')
const LATER = new Date('2026-01-01T09:00:00.000Z')

const unread = (
  payload: Record<string, unknown>,
  type: Notification['type'] = 'inbox.escalated',
): Notification => {
  const result = createNotification(
    {
      id: notificationId('notification-1'),
      userId: userId('user-1'),
      organizationId: organizationId('org-1'),
      propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
      type,
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
    expect(isPreferenceDisableable('mandatory', 'email')).toBe(false)
    expect(isPreferenceDisableable('mandatory', 'in_app')).toBe(false)
    expect(isPreferenceDisableable('urgent_operational', 'in_app')).toBe(false)
    expect(isPreferenceDisableable('urgent_operational', 'email')).toBe(true)
    expect(isPreferenceDisableable('recognition', 'in_app')).toBe(true)
  })

  it('keeps cadence defaults in domain policy', () => {
    expect(getDefaultCadence('mandatory')).toBe('immediate')
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
    const bumped = applyCoalescence(
      unread({ guestRating: 1, platform: 'portal' }),
      { guestRating: 1, platform: 'portal' },
      LATER,
    )

    expect(bumped.payload.occurrences).toBe(2)
    expect(bumped.body).toMatch(/ Escalated 2 times\.$/)
  })

  it('re-renders the title from the merged facts', () => {
    const bumped = applyCoalescence(
      unread({ propertyName: 'Riverside', guestRating: 3, platform: 'portal' }),
      {
        propertyName: 'Riverside Hotel',
        guestRating: 1,
        platform: 'portal',
        actorRole: 'account_admin',
      },
      LATER,
    )

    // The newer Property name, rating and escalator's role win.
    expect(bumped.title).toBe('Escalated: feedback at Riverside Hotel')
    expect(bumped.payload.guestRating).toBe(1)
    expect(bumped.body).toMatch(/^An account admin escalated this/)
  })

  it('keeps a fact the repeat event could not resolve (newest wins per key)', () => {
    const bumped = applyCoalescence(
      unread({ propertyName: 'Riverside', guestRating: 2, platform: 'portal' }),
      { guestRating: 2, platform: 'portal' },
      LATER,
    )

    expect(bumped.payload.propertyName).toBe('Riverside')
  })

  // A cause names the remedy for one occurrence. A later event with none had
  // none, so the row must stop advertising the earlier remedy.
  it.each([
    {
      type: 'reply.publish_failed' as const,
      cause: { publishFailureCause: 'google_reauthorization_required' },
      body: 'Open the reply to see where it stands.',
    },
    {
      type: 'integration.reauthorization_required' as const,
      cause: { reauthorizationCause: 'provider_revoked' },
      body: 'Reconnect the account to keep Google review updates and replies working.',
    },
  ])(
    'lets a repeat $type without a cause drop the earlier one',
    ({ type, cause, body }) => {
      const bumped = applyCoalescence(
        unread({ propertyName: 'Riverside', ...cause }, type),
        { propertyName: 'Riverside' },
        LATER,
      )

      expect(bumped.payload).toEqual({ propertyName: 'Riverside', occurrences: 2 })
      expect(bumped.body).toContain(body)
    },
  )

  // Both occurrence facts go in the same merge: a repeat that named no cause
  // and measured no wait keeps neither from the earlier event.
  it('drops an earlier cause and an earlier wait together', () => {
    const bumped = applyCoalescence(
      unread(
        {
          propertyName: 'Riverside',
          publishOutcome: 'refused',
          publishFailureCause: 'google_reauthorization_required',
          waitingSince: '2025-12-25T00:00:00.000Z',
        },
        'reply.publish_failed',
      ),
      { propertyName: 'Riverside', publishOutcome: 'not_sent' },
      LATER,
    )

    expect(bumped.payload).toEqual({
      propertyName: 'Riverside',
      publishOutcome: 'not_sent',
      occurrences: 2,
    })
    expect(bumped.body).toContain(
      'Nothing was posted to Google, so it is safe to try again.',
    )
  })

  // Every publish failure fact carries its outcome, so the newest one decides
  // the copy: a failure that may be live must not keep offering a retry.
  it('takes the outcome of the latest publish failure', () => {
    const bumped = applyCoalescence(
      unread({ publishOutcome: 'not_sent' }, 'reply.publish_failed'),
      { publishOutcome: 'unconfirmed' },
      LATER,
    )

    expect(bumped.payload.publishOutcome).toBe('unconfirmed')
    expect(bumped.title).toBe('Reply not confirmed on Google')
  })

  // Escalated while waiting, then answered, then escalated again: the second
  // escalation measured no wait, so the row must not keep the first one's.
  it('drops the earlier wait once a repeat event measured none', () => {
    const bumped = applyCoalescence(
      unread({ propertyName: 'Riverside', waitingSince: '2025-12-25T00:00:00.000Z' }),
      { propertyName: 'Riverside' },
      LATER,
    )

    expect(bumped.payload.waitingSince).toBeUndefined()
    expect(bumped.body).toMatch(/ Escalated 2 times\.$/)
  })

  it('takes the wait the repeat event measured', () => {
    const bumped = applyCoalescence(
      unread({ waitingSince: '2025-12-25T00:00:00.000Z' }),
      { waitingSince: '2025-12-31T12:00:00.000Z' },
      LATER,
    )

    expect(bumped.payload.waitingSince).toBe('2025-12-31T12:00:00.000Z')
  })

  it('never stores the wait a row was read with', () => {
    const read = unread({ waitingSince: '2025-12-25T00:00:00.000Z' })
    const bumped = applyCoalescence(
      { ...read, payload: { ...read.payload, waitedHours: 168 } },
      { waitingSince: '2025-12-31T12:00:00.000Z' },
      LATER,
    )

    expect(bumped.payload.waitedHours).toBeUndefined()
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

// A notice says how long its item had waited when the notice was raised. The
// reader's clock never enters: the item may have been answered since, and an
// age that keeps growing would say it is still waiting.
describe('the wait a notice was raised with', () => {
  const SINCE = '2026-09-20T09:00:00.000Z'

  it.each([
    ['2026-09-20T09:59:59.000Z', 0],
    ['2026-09-20T14:30:00.000Z', 5],
    ['2026-09-22T10:00:00.000Z', 49],
  ])('raised at %s had waited %i whole hours', (raisedAt, hours) => {
    expect(
      withWaitAtNotice({ waitingSince: SINCE }, new Date(raisedAt)).waitedHours,
    ).toBe(hours)
  })

  it('says nothing when the notice measured no wait', () => {
    const payload = withWaitAtNotice(
      { propertyName: 'Riverside', waitedHours: 30 },
      new Date('2026-09-22T10:00:00.000Z'),
    )

    expect(payload).toEqual({ propertyName: 'Riverside' })
  })

  it('never reads a wait that began after the notice as negative', () => {
    expect(
      withWaitAtNotice({ waitingSince: SINCE }, new Date('2026-09-20T08:00:00.000Z'))
        .waitedHours,
    ).toBe(0)
  })
})
