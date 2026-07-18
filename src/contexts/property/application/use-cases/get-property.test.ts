// Property context — get property use case tests

import { describe, it, expect } from 'vitest'
import { getProperty } from './get-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const propertyRepo = createInMemoryPropertyRepo()
  const useCase = getProperty({
    propertyRepo,
    staffPublicApi: staffApiMock(accessible),
  })
  return { useCase, propertyRepo }
}

describe('getProperty', () => {
  it('returns property by id', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext()
    const prop = buildTestProperty({ id: 'p1', name: 'Grand Hotel' })
    propertyRepo.seed([prop])

    const result = await useCase({ propertyId: prop.id }, ctx)

    expect(result.name).toBe('Grand Hotel')
  })

  it('throws property_not_found for missing property', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(useCase({ propertyId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  it('throws property_not_found for property in different org', async () => {
    const { useCase, propertyRepo } = setup()
    const otherOrg = buildTestAuthContext({
      organizationId: 'org-other-0000-0000-0000-000000000001' as never,
    })
    const prop = buildTestProperty({ id: 'p1' })
    propertyRepo.seed([prop])

    await expect(useCase({ propertyId: prop.id }, otherOrg)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  // ── Property-assignment scoping (PROPERTY-001 / D6-001) ────────────

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, propertyRepo } = setup([]) // PM not assigned to any property
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ id: 'p1', name: 'Grand Hotel' })
    propertyRepo.seed([prop])

    await expect(useCase({ propertyId: prop.id }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const prop = buildTestProperty({ id: 'p1', name: 'Grand Hotel' })
    const { useCase, propertyRepo } = setup([prop.id]) // PM assigned to this property
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    propertyRepo.seed([prop])

    const result = await useCase({ propertyId: prop.id }, ctx)

    expect(result.name).toBe('Grand Hotel')
  })

  // ── BQC-4.4: region metadata + content-free blocked reason on the DTO ──

  it('carries the region block for a processable property (null reason)', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext()
    const prop = buildTestProperty({
      id: 'p1',
      processingRegion: 'us',
      processingRegionSource: 'country_default',
      routingPolicyVersion: 3,
    })
    propertyRepo.seed([prop])

    const result = await useCase({ propertyId: prop.id }, ctx)

    expect(result.processingRegion).toBe('us')
    expect(result.processingRegionSource).toBe('country_default')
    expect(result.routingPolicyVersion).toBe(3)
    expect(result.regionProcessable).toBe(true)
    expect(result.regionBlockedReason).toBeNull()
  })

  it.each([
    ['unresolved', 'region_unresolved'],
    ['europe', 'region_denied'],
    ['global', 'region_denied'],
  ] as const)('reports %s as not processable with reason %s', async (region, reason) => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext()
    const prop = buildTestProperty({ id: 'p1', processingRegion: region })
    propertyRepo.seed([prop])

    const result = await useCase({ propertyId: prop.id }, ctx)

    expect(result.regionProcessable).toBe(false)
    expect(result.regionBlockedReason).toBe(reason)
  })

  it('reports a missing region as region_unresolved (fail closed)', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext()
    const prop = buildTestProperty({ id: 'p1', processingRegion: null })
    propertyRepo.seed([prop])

    const result = await useCase({ propertyId: prop.id }, ctx)

    expect(result.regionProcessable).toBe(false)
    expect(result.regionBlockedReason).toBe('region_unresolved')
  })
})
