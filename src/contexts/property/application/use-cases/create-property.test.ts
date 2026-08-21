// Property context — create property use case tests
// Per architecture: use case tests with in-memory port fakes.

import { describe, it, expect } from 'vitest'
import { createProperty } from './create-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createSequentialPropertyCommandStore } from '#/shared/testing/sequential-property-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'
import { assertRegionResolved } from '../../domain/processing-routing'
import { propertyId } from '#/shared/domain/ids'

const FIXED_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = (extra: Partial<Parameters<typeof createProperty>[0]> = {}) => {
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()
  const deps = {
    propertyRepo,
    commandStore: createSequentialPropertyCommandStore({ repo: propertyRepo, events }),
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
    ...extra,
  }
  const useCase = createProperty(deps)
  return { useCase, propertyRepo, events }
}

describe('createProperty', () => {
  it('creates a property with defaults when optional fields are omitted', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const property = await useCase(
      { name: 'Grand Hotel', timezone: 'America/New_York' },
      ctx,
    )

    expect(property.slug).toBe('grand-hotel')
    expect(property.timezone).toBe('America/New_York')
    expect(property.gbpLocationId).toBeNull()
    expect(property.processingRegion).toBe('unresolved')
    expect(propertyRepo.all()).toHaveLength(1)
  })

  it('resolves processing region when countryCode is provided (BQR-3.5)', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      { name: 'US Hotel', timezone: 'America/New_York', countryCode: 'US' },
      ctx,
    )

    expect(property.countryCode).toBe('US')
    expect(property.processingRegion).toBe('us')
    expect(property.countrySource).toBe('manual')
    expect(property.processingRegionResolvedAt).toEqual(FIXED_TIME)
  })

  // BQC-4.1 / ADR 0048: the resolution state is explicit on the created
  // property — a property born without a country is unresolved and NOT
  // processable (sync/import fail closed on it until reconciliation).
  it('is born unresolved and non-processing when no country is given (BQC-4.1)', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      { name: 'No Country Hotel', timezone: 'America/New_York' },
      ctx,
    )

    expect(property.processingRegion).toBe('unresolved')
    expect(property.processingRegionResolvedAt).toBeNull()
    try {
      assertRegionResolved(property)
      expect.unreachable('unresolved property must not be processable')
    } catch (e) {
      expect(isPropertyError(e)).toBe(true)
      expect((e as { code: string }).code).toBe('region_unresolved')
    }
  })

  it('is born processable when the country resolves into the approved cell (BQC-4.1)', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      { name: 'US Hotel', timezone: 'America/New_York', countryCode: 'US' },
      ctx,
    )

    expect(() => assertRegionResolved(property)).not.toThrow()
  })

  it('creates browser-submitted properties without a provider binding', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      {
        name: 'Grand Hotel',
        slug: 'custom-slug',
        timezone: 'UTC',
      },
      ctx,
    )

    expect(property.slug).toBe('custom-slug')
    expect(property.gbpLocationId).toBeNull()
    expect(property.googleBindingState).toBe('unbound')
  })

  it('rejects users who cannot create properties', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ name: 'Test', timezone: 'UTC' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects duplicate slug in same organization', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    // Seed an existing property with the same slug but different id
    const existing = buildTestProperty({
      id: 'prop-existing-0000-0000-000000000001',
      slug: 'grand-hotel',
    })
    propertyRepo.seed([existing])

    // The use case will try to create with FIXED_ID and slug 'grand-hotel'
    await expect(
      useCase({ name: 'Grand Hotel', timezone: 'UTC' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('emits property.created event on success', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ name: 'Grand Hotel', timezone: 'UTC' }, ctx)

    const emitted = events.capturedByTag('property.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('Grand Hotel')
  })

  it('rejects invalid timezone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ name: 'Test', timezone: 'Invalid/Zone' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_timezone',
    )
  })

  it('rejects empty name', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ name: '', timezone: 'UTC' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  // BQC-2.7 parity: a freshly created property has an EMPTY property_capability
  // set, and an empty set denies every non-core capability
  // (`property_not_allowlisted`). The Google import provisions the properties
  // it creates; the manual path must do the same or a new property is dark for
  // Portals, Teams, Goals and Recognition with no in-product remedy.
  it('provisions the new property from its organization allowlist', async () => {
    const calls: Array<{
      organizationId: string
      propertyId: string
      createdBy: string
    }> = []
    const { useCase } = setup({
      provisionCapabilities: async (input) => {
        calls.push(input)
      },
    })
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const property = await useCase({ name: 'Grand Hotel', timezone: 'UTC' }, ctx)

    expect(calls).toEqual([
      {
        organizationId: property.organizationId,
        propertyId: property.id,
        createdBy: ctx.userId,
      },
    ])
  })

  // The property exists and is usable; provisioning is idempotent and
  // repairable out of band (`pnpm ops:property-capabilities sync`). Failing the
  // creation would be a worse outcome than a dark new property.
  it('still returns the property when provisioning fails, and warns', async () => {
    const warnings: Array<{ obj: object; msg: string }> = []
    const { useCase, propertyRepo } = setup({
      provisionCapabilities: async () => {
        throw Object.assign(new Error('policy_version row is locked'), {
          code: 'lock_timeout',
        })
      },
      logger: { warn: (obj, msg) => warnings.push({ obj, msg }) },
    })
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const property = await useCase({ name: 'Grand Hotel', timezone: 'UTC' }, ctx)

    expect(property.slug).toBe('grand-hotel')
    expect(propertyRepo.all()).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.msg).toBe('property capability provisioning failed')
    // Content-free: codes and names only, never a tenant identifier.
    expect(warnings[0]?.obj).toEqual({ errorName: 'Error', errorCode: 'lock_timeout' })
  })

  it('creates the property when no provisioning port is wired', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ name: 'Grand Hotel', timezone: 'UTC' }, ctx)

    expect(propertyRepo.all()).toHaveLength(1)
  })
})
