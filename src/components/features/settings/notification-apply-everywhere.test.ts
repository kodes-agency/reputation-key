import { describe, expect, it } from 'vitest'
import type { NotificationChannel } from '#/contexts/feed/application/public-api'
import {
  applyEverywhereNotice,
  applyEverywhereInOrder,
  namesInBrief,
  setDifferentlyElsewhere,
} from './notification-apply-everywhere'
import {
  notificationPreferenceId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { NotificationPreference } from '#/contexts/feed/application/public-api'

const saved = async () => undefined
const refused = async () => {
  throw new Error('capability_denied')
}

describe('applyEverywhereInOrder', () => {
  it('leaves email alone while the Property in view cannot send it', async () => {
    const calls: NotificationChannel[] = []

    const outcome = await applyEverywhereInOrder(false, async (channel) => {
      calls.push(channel)
    })

    expect(calls).toEqual(['in_app'])
    expect(outcome).toEqual({ applied: ['in_app'], failed: null, skipped: ['email'] })
  })

  it('says which channel was already applied when a later one fails', async () => {
    const outcome = await applyEverywhereInOrder(true, (channel) =>
      channel === 'email' ? refused() : saved(),
    )

    expect(outcome).toEqual({ applied: ['in_app'], failed: 'email', skipped: [] })
  })
})

describe('applyEverywhereNotice', () => {
  it('reports a whole success plainly', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app', 'email'], failed: null, skipped: [] }),
    ).toEqual({
      tone: 'success',
      message: 'Now your default for every property without its own setting',
    })
  })

  it('does not call a half-applied answer a failure', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app'], failed: 'email', skipped: [] }),
    ).toEqual({
      tone: 'error',
      message: 'In-app is now your default; email could not be saved',
    })
  })

  it('names the channel it left alone', () => {
    expect(
      applyEverywhereNotice({ applied: ['in_app'], failed: null, skipped: ['email'] }),
    ).toEqual({
      tone: 'success',
      message: 'In-app is now your default; email is not enabled here',
    })
  })

  it('reports nothing applied when the first save fails', () => {
    expect(applyEverywhereNotice({ applied: [], failed: 'in_app', skipped: [] })).toEqual(
      { tone: 'error', message: 'Could not make this your default' },
    )
  })
})

const PROPERTIES = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Riverside Hotel' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Harbor & Pine' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Lakeside Lodge' },
]
const row = (
  property: number,
  overrides: Partial<NotificationPreference> = {},
): NotificationPreference => ({
  id: notificationPreferenceId(`20000000-0000-4000-8000-00000000000${property}`),
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  propertyId: propertyId(PROPERTIES[property]!.id),
  category: 'workflow_collaboration',
  channel: 'in_app',
  enabled: true,
  cadence: 'immediate',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...overrides,
})

describe('setDifferentlyElsewhere', () => {
  it('names the other properties with their own setting for the category, and their mutes', () => {
    const preferences = [
      row(0),
      row(1, { enabled: false }),
      row(2, { channel: 'email', enabled: true }),
      row(2, { category: 'recognition' }),
    ]

    expect(
      setDifferentlyElsewhere(
        'workflow_collaboration',
        preferences,
        PROPERTIES,
        PROPERTIES[0]!.id,
      ),
    ).toEqual([
      { id: PROPERTIES[1]!.id, name: 'Harbor & Pine', muted: true },
      { id: PROPERTIES[2]!.id, name: 'Lakeside Lodge', muted: false },
    ])
  })

  it('finds nothing when only the property in view has its own setting', () => {
    expect(
      setDifferentlyElsewhere(
        'workflow_collaboration',
        [row(0)],
        PROPERTIES,
        PROPERTIES[0]!.id,
      ),
    ).toEqual([])
  })
})

describe('namesInBrief', () => {
  it.each([
    [['Harbor & Pine'], 'Harbor & Pine'],
    [['Harbor & Pine', 'Lakeside Lodge'], 'Harbor & Pine and Lakeside Lodge'],
    [['A', 'B', 'C'], 'A, B and 1 other'],
    [['A', 'B', 'C', 'D'], 'A, B and 2 others'],
  ])('writes %j as %s', (names, expected) => {
    expect(namesInBrief(names)).toBe(expected)
  })
})
