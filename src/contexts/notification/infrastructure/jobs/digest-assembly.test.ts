import { describe, expect, it } from 'vitest'
import {
  digestBatchIdempotencyKey,
  digestMemberSet,
  digestProviderRequest,
  groupItemsByProperty,
  type DigestItem,
} from './digest-assembly'
import { buildDigestItem } from './test-fixtures'

const url = (path: string, search: Readonly<Record<string, string>>) =>
  `https://app.test${path}${Object.keys(search).length > 0 ? `?${new URLSearchParams(search)}` : ''}`

describe('immutable digest batch fingerprints (ADR 0046 r.5)', () => {
  const members = ['email-b', 'email-a'] as const
  const memberDigest = digestMemberSet(members)
  const keyFor = (
    overrides: Partial<Parameters<typeof digestBatchIdempotencyKey>[0]> = {},
  ) =>
    digestBatchIdempotencyKey({
      organizationId: 'org-1',
      userId: 'user-1',
      localDate: '2026-08-21',
      batchId: '11111111-1111-4111-8111-111111111111',
      memberDigest,
      ...overrides,
    })

  it('fingerprints the exact member set independent of read order', () => {
    expect(digestMemberSet(['email-a', 'email-b'])).toBe(memberDigest)
    expect(digestMemberSet(['email-a', 'email-c'])).not.toBe(memberDigest)
  })

  it('is stable only for the same persisted batch identity', () => {
    expect(keyFor()).toBe(keyFor())
    expect(keyFor()).toMatch(/^rk-digest-v2:[a-f0-9]{64}$/)
    expect(keyFor({ batchId: '22222222-2222-4222-8222-222222222222' })).not.toBe(keyFor())
    expect(keyFor({ memberDigest: digestMemberSet(['email-a']) })).not.toBe(keyFor())
  })

  it('separates organizations, recipients, and local dates', () => {
    expect(keyFor({ organizationId: 'org-2' })).not.toBe(keyFor())
    expect(keyFor({ userId: 'user-2' })).not.toBe(keyFor())
    expect(keyFor({ localDate: '2026-08-22' })).not.toBe(keyFor())
  })

  it('fingerprints every provider-visible field with canonical header ordering', () => {
    const request = {
      to: 'manager@example.com',
      subject: 'Two updates',
      html: '<p>Two updates</p>',
      text: 'Two updates',
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click', Z: 'last' },
    }
    expect(digestProviderRequest(request)).toBe(
      digestProviderRequest({
        ...request,
        headers: { Z: 'last', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      }),
    )
    expect(digestProviderRequest({ ...request, subject: 'Three updates' })).not.toBe(
      digestProviderRequest(request),
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
