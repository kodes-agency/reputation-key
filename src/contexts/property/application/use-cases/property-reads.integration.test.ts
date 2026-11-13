// Property reads against real PostgreSQL: tenant scoping, assignment scoping
// and soft deletion are decided by the repository's SQL, not by a stand-in.

import { describe, it, expect } from 'vitest'
import { getDb } from '#/shared/db'
import {
  organizationId,
  type OrganizationId,
  type PropertyId,
  type UserId,
} from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { isPropertyError } from '../../domain/errors'
import { createPropertyRepository } from '../../infrastructure/repositories/property.repository'
import { seedTestProperty } from '../../infrastructure/property-test-fixtures'
import { getProperty } from './get-property'
import { listProperties } from './list-properties'

const ORG_A = organizationId('org-property-reads-a')
const ORG_B = organizationId('org-property-reads-b')
const MISSING_PROPERTY = '00000000-0000-4000-8000-0000000000aa'

setupIntegrationDb({ orgA: ORG_A, orgB: ORG_B, tables: ['properties'] })

const db = getDb()
const propertyRepo = createPropertyRepository(db)

const seed = (id: string, overrides: Parameters<typeof buildTestProperty>[0] = {}) => {
  const property = buildTestProperty({
    id,
    slug: `slug-${id}`,
    organizationId: ORG_A,
    ...overrides,
  })
  return seedTestProperty(db, property).then(() => property)
}

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async (
    _orgId: OrganizationId,
    _userId: UserId,
    orgWide: boolean,
  ) => (orgWide ? null : accessible),
  getAssignedPortals: async () => [],
})

const ctxFor = (role: 'AccountAdmin' | 'PropertyManager', org = ORG_A) =>
  buildTestAuthContext({ role, organizationId: org })

const hasCode = (code: string) => (error: unknown) =>
  isPropertyError(error) && (error as { code: string }).code === code

describe('getProperty', () => {
  const read = (accessible: ReadonlyArray<PropertyId> | null = null) =>
    getProperty({ propertyRepo, staffPublicApi: staffApi(accessible) })

  it('returns property by id', async () => {
    const property = await seed('p1', { name: 'Grand Hotel' })

    const result = await read()({ propertyId: property.id }, ctxFor('AccountAdmin'))

    expect(result.name).toBe('Grand Hotel')
  })

  it('throws property_not_found for missing property', async () => {
    await expect(
      read()({ propertyId: MISSING_PROPERTY }, ctxFor('AccountAdmin')),
    ).rejects.toSatisfy(hasCode('property_not_found'))
  })

  it('throws property_not_found for property in different org', async () => {
    const property = await seed('p1')

    await expect(
      read()({ propertyId: property.id }, ctxFor('AccountAdmin', ORG_B)),
    ).rejects.toSatisfy(hasCode('property_not_found'))
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const property = await seed('p1', { name: 'Grand Hotel' })

    await expect(
      read([])({ propertyId: property.id }, ctxFor('PropertyManager')),
    ).rejects.toSatisfy(hasCode('forbidden'))
  })

  it('allows PropertyManager assigned to the property', async () => {
    const property = await seed('p1', { name: 'Grand Hotel' })

    const result = await read([property.id])(
      { propertyId: property.id },
      ctxFor('PropertyManager'),
    )

    expect(result.name).toBe('Grand Hotel')
  })
})

describe('listProperties', () => {
  const list = (accessible: ReadonlyArray<PropertyId> | null = null) =>
    listProperties({ propertyRepo, staffApi: staffApi(accessible) })

  it('returns all properties for AccountAdmin', async () => {
    await seed('p1', { name: 'Hotel A' })
    await seed('p2', { name: 'Hotel B' })

    await expect(list()(ctxFor('AccountAdmin'))).resolves.toHaveLength(2)
  })

  it('returns empty array when no properties exist', async () => {
    await expect(list()(ctxFor('AccountAdmin'))).resolves.toHaveLength(0)
  })

  it('does not list another organization’s properties or a soft-deleted one', async () => {
    await seed('p1', { name: 'Hotel A' })
    await seed('p2', { name: 'Hotel B', organizationId: ORG_B })
    await seed('p3', { name: 'Hotel C', deletedAt: new Date('2026-04-11T12:00:00Z') })

    const properties = await list()(ctxFor('AccountAdmin'))

    expect(properties.map((p) => p.name)).toEqual(['Hotel A'])
  })

  it('filters to assigned properties for PropertyManager', async () => {
    const p1 = await seed('p1', { name: 'Hotel A' })
    await seed('p2', { name: 'Hotel B' })
    const p3 = await seed('p3', { name: 'Hotel C' })

    const properties = await list([p1.id, p3.id])(ctxFor('PropertyManager'))

    expect(properties.map((p) => p.name).sort()).toEqual(['Hotel A', 'Hotel C'])
  })

  it('lists nothing for a PropertyManager with no assignments', async () => {
    await seed('p1')

    await expect(list([])(ctxFor('PropertyManager'))).resolves.toHaveLength(0)
  })
})
