import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  createNotificationOrganizationScopeResolver,
  representativeTimezone,
} from './notification-organization-scope.repository'

const poolWith = (rows: ReadonlyArray<Record<string, string>>) =>
  ({ query: vi.fn(async () => ({ rows })) }) as unknown as Pool

describe('representativeTimezone', () => {
  it('picks the modal timezone across the organization properties', () => {
    expect(
      representativeTimezone([
        { timezone: 'America/Denver' },
        { timezone: 'Europe/Sofia' },
        { timezone: 'Europe/Sofia' },
      ]),
    ).toBe('Europe/Sofia')
  })

  it('breaks a tie on the query order, so the answer is stable across sweeps', () => {
    // Query orders oldest property first; the first-seen zone wins a tie.
    expect(
      representativeTimezone([{ timezone: 'Europe/London' }, { timezone: 'Asia/Tokyo' }]),
    ).toBe('Europe/London')
  })

  it('returns null when the organization has no active property', () => {
    expect(representativeTimezone([])).toBeNull()
  })
})

describe('organization scope resolver', () => {
  it('returns the fallback timezone and the property display names together', async () => {
    const pool = poolWith([
      { property_id: 'prop-a', name: 'Riverside Hotel', timezone: 'Europe/Sofia' },
      { property_id: 'prop-b', name: 'Hillcrest Inn', timezone: 'Europe/Sofia' },
    ])

    const scope = await createNotificationOrganizationScopeResolver(pool)('org-1')

    expect(scope.timezone).toBe('Europe/Sofia')
    expect(scope.propertyNames.get('prop-a')).toBe('Riverside Hotel')
    expect(scope.propertyNames.get('prop-b')).toBe('Hillcrest Inn')
  })

  it('scopes the read to active, non-deleted properties of the organization', async () => {
    const pool = poolWith([])

    await createNotificationOrganizationScopeResolver(pool)('org-9')

    const [sql, params] = vi.mocked(pool.query).mock.calls[0] as unknown as [
      string,
      string[],
    ]
    expect(sql).toContain('deleted_at IS NULL')
    expect(sql).toContain("lifecycle_state = 'active'")
    expect(params).toEqual(['org-9'])
  })

  it('yields a null timezone and an empty name map for an organization with no properties', async () => {
    const scope = await createNotificationOrganizationScopeResolver(poolWith([]))('org-1')

    expect(scope.timezone).toBeNull()
    expect(scope.propertyNames.size).toBe(0)
  })
})
