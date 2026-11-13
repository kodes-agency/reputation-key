// The Property and Organization scope resolvers the delivery jobs read their
// timezone and display names from, against real PostgreSQL. A notice must never
// take a timezone or a name from a Property outside the Organization asked
// about, or from one that is archived or deleted.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Pool } from 'pg'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { createNotificationPropertyScopeResolver } from './notification-property-scope.repository'
import { createNotificationOrganizationScopeResolver } from './notification-organization-scope.repository'

const ORG = 'scope-resolver-org'
const OTHER_ORG = 'scope-resolver-other-org'
const EMPTY_ORG = 'scope-resolver-empty-org'
const SOFIA = '86400000-0000-4000-8000-000000000001'
const SOFIA_TWO = '86400000-0000-4000-8000-000000000002'
const DENVER = '86400000-0000-4000-8000-000000000003'
const ARCHIVED = '86400000-0000-4000-8000-000000000004'
const DELETED = '86400000-0000-4000-8000-000000000005'
const FOREIGN = '86400000-0000-4000-8000-000000000006'

describe('notification scope resolvers (real PostgreSQL)', () => {
  let held: HeldTransaction
  let pool: Pool

  const seed = (
    id: string,
    organization: string,
    name: string,
    timezone: string,
    createdAt: string,
    state: 'active' | 'archived' | 'deleted' = 'active',
  ) =>
    held.client.query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, lifecycle_state, deleted_at)
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
      [
        id,
        organization,
        name,
        `scope-${id}`,
        timezone,
        createdAt,
        state === 'archived' ? 'archived' : 'active',
        state === 'deleted' ? '2026-01-01T00:00:00Z' : null,
      ],
    )

  beforeAll(async () => {
    held = await holdTransaction()
    pool = held.client as unknown as Pool
    await seed(SOFIA, ORG, 'Riverside', 'Europe/Sofia', '2026-01-01T00:00:00Z')
    await seed(SOFIA_TWO, ORG, 'Hillcrest', 'Europe/Sofia', '2026-01-02T00:00:00Z')
    await seed(DENVER, ORG, 'Summit', 'America/Denver', '2026-01-03T00:00:00Z')
    await seed(ARCHIVED, ORG, 'Closed', 'Asia/Tokyo', '2026-01-04T00:00:00Z', 'archived')
    await seed(DELETED, ORG, 'Gone', 'Asia/Tokyo', '2026-01-05T00:00:00Z', 'deleted')
    await seed(FOREIGN, OTHER_ORG, 'Elsewhere', 'Asia/Tokyo', '2026-01-06T00:00:00Z')
  })

  afterAll(async () => {
    await held?.rollBack()
  })

  describe('property scope', () => {
    const resolve = (organization: string, property: string) =>
      createNotificationPropertyScopeResolver(pool)(organization, property)

    it('returns the active Property’s timezone inside the requested Organization', async () => {
      expect(await resolve(ORG, DENVER)).toEqual({
        organizationId: ORG,
        propertyId: DENVER,
        timezone: 'America/Denver',
      })
    })

    it('returns null for a Property that belongs to another Organization', async () => {
      expect(await resolve(ORG, FOREIGN)).toBeNull()
    })

    it.each([
      ['archived', ARCHIVED],
      ['deleted', DELETED],
    ])('returns null for a %s Property', async (_state, property) => {
      expect(await resolve(ORG, property)).toBeNull()
    })
  })

  describe('organization scope', () => {
    const resolve = (organization: string) =>
      createNotificationOrganizationScopeResolver(pool)(organization)

    it('names only the Organization’s active Properties and takes their commonest timezone', async () => {
      const scope = await resolve(ORG)

      expect(scope.timezone).toBe('Europe/Sofia')
      expect([...scope.propertyNames]).toEqual([
        [SOFIA, 'Riverside'],
        [SOFIA_TWO, 'Hillcrest'],
        [DENVER, 'Summit'],
      ])
    })

    it('yields no timezone and no names for an Organization with no active Property', async () => {
      const scope = await resolve(EMPTY_ORG)

      expect(scope.timezone).toBeNull()
      expect(scope.propertyNames.size).toBe(0)
    })

    it('does not borrow another Organization’s Properties', async () => {
      const scope = await resolve(OTHER_ORG)

      expect([...scope.propertyNames.keys()]).toEqual([FOREIGN])
    })
  })
})
