import { describe, expect, it } from 'vitest'
import {
  digestIdempotencyKey,
  groupItemsByProperty,
  type DigestItem,
} from './digest-assembly'
import { buildDigestItem } from './test-fixtures'

const url = (path: string, search: Readonly<Record<string, string>>) =>
  `https://app.test${path}${Object.keys(search).length > 0 ? `?${new URLSearchParams(search)}` : ''}`

describe('digest idempotency key (ADR 0046 r.5)', () => {
  it('is stable across retries within the same recipient local date', () => {
    // Same (org, user, local date) at 08:00 and at a 23:59 retry.
    expect(digestIdempotencyKey('org-1', 'user-1', '2026-08-21')).toBe(
      digestIdempotencyKey('org-1', 'user-1', '2026-08-21'),
    )
  })

  it('carries no timestamp, so it outlives the provider 24h dedupe window', () => {
    const key = digestIdempotencyKey('org-1', 'user-1', '2026-08-21')

    expect(key).toBe('digest:org-1:user-1:2026-08-21')
    // A clock-derived component would make a retry a fresh send.
    expect(key).not.toMatch(/\d{2}:\d{2}/)
    expect(key).not.toMatch(/T\d/)
  })

  it('is keyed on the user, never on the property (ADR 0046 r.4)', () => {
    const key = digestIdempotencyKey('org-1', 'user-1', '2026-08-21')

    expect(key).not.toContain('prop')
    expect(key.split(':')).toHaveLength(4)
  })

  it('separates recipients and dates', () => {
    expect(digestIdempotencyKey('org-1', 'user-1', '2026-08-21')).not.toBe(
      digestIdempotencyKey('org-1', 'user-2', '2026-08-21'),
    )
    expect(digestIdempotencyKey('org-1', 'user-1', '2026-08-21')).not.toBe(
      digestIdempotencyKey('org-1', 'user-1', '2026-08-22'),
    )
  })
})

describe('grouping one user digest by property (ADR 0046 r.4)', () => {
  const items: readonly DigestItem[] = [
    buildDigestItem({
      propertyId: 'prop-a',
      payload: { propertyName: 'Riverside Hotel', rating: 2 },
      type: 'review.created',
      resourceId: 'inbox-1',
    }),
    buildDigestItem({
      propertyId: 'prop-b',
      payload: { propertyName: 'Hillcrest Inn' },
      type: 'goal.completed',
      resourceType: 'goal',
      resourceId: 'goal-1',
    }),
    buildDigestItem({
      propertyId: 'prop-a',
      payload: { propertyName: 'Riverside Hotel' },
      type: 'inbox_note.added',
      resourceId: 'inbox-2',
    }),
  ]

  it('produces one group per property with first-appearance order preserved', () => {
    const groups = groupItemsByProperty(items, new Map(), url)

    expect(groups.map((group) => group.propertyName)).toEqual([
      'Riverside Hotel',
      'Hillcrest Inn',
    ])
    expect(groups[0]!.items).toHaveLength(2)
    expect(groups[1]!.items).toHaveLength(1)
  })

  it('renders every line through the shared renderer and never leaks an id', () => {
    const groups = groupItemsByProperty(items, new Map(), url)

    for (const group of groups) {
      for (const item of group.items) {
        expect(item.rendered.title).not.toContain('inbox-')
        expect(item.rendered.title).not.toContain('goal-')
        expect(item.rendered.title.length).toBeGreaterThan(0)
        expect(item.rendered.actionLabel.length).toBeGreaterThan(0)
      }
    }
  })

  it('builds an absolute deep link per line, keyed on the row property', () => {
    const groups = groupItemsByProperty(items, new Map(), url)

    // Inbox items link to the item; a goal links to its PROPERTY page, which is
    // where the previous builder used the goalId and produced a dead link.
    expect(groups[0]!.items[0]!.actionUrl).toBe('https://app.test/inbox?itemId=inbox-1')
    expect(groups[1]!.items[0]!.actionUrl).toBe('https://app.test/properties/prop-b')
  })

  it('falls back to the resolved property name when the payload has none', () => {
    const nameless = [
      buildDigestItem({ propertyId: 'prop-c', payload: {}, resourceId: 'inbox-9' }),
    ]

    const groups = groupItemsByProperty(
      nameless,
      new Map([['prop-c', 'Seaside Lodge']]),
      url,
    )

    expect(groups[0]!.propertyName).toBe('Seaside Lodge')
  })

  it('never renders a bare property UUID as a heading', () => {
    const nameless = [
      buildDigestItem({
        propertyId: '11111111-1111-4111-8111-111111111111',
        payload: {},
        resourceId: 'inbox-9',
      }),
    ]

    const groups = groupItemsByProperty(nameless, new Map(), url)

    expect(groups[0]!.propertyName).toBe('Property')
  })
})
