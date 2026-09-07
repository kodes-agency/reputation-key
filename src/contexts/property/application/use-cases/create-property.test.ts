// Property context — create property use case tests
// Per architecture: use case tests with in-memory port fakes.

import { describe, it, expect } from 'vitest'
import { createProperty } from './create-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createSequentialPropertyCommandStore } from '#/shared/testing/sequential-property-command-store'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'

const FIXED_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = (extra: Partial<Parameters<typeof createProperty>[0]> = {}) => {
  const propertyRepo = createInMemoryPropertyRepo()
  const outbox = createRecordedOutbox()
  const deps = {
    propertyRepo,
    commandStore: createSequentialPropertyCommandStore({ repo: propertyRepo, outbox }),
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
    ...extra,
  }
  const useCase = createProperty(deps)
  return { useCase, propertyRepo, outbox }
}

describe('createProperty', () => {
  it('creates a property with defaults when optional fields are omitted', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const property = await useCase(
      { name: 'Grand Hotel', timezone: 'America/New_York', countryCode: 'US' },
      ctx,
    )

    expect(property.slug).toBe('grand-hotel')
    expect(property.timezone).toBe('America/New_York')
    expect(property.gbpLocationId).toBeNull()
    expect(propertyRepo.all()).toHaveLength(1)
  })

  it('normalizes the country business fact', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      { name: 'US Hotel', timezone: 'America/New_York', countryCode: 'US' },
      ctx,
    )

    expect(property.countryCode).toBe('US')
    expect(property.countrySource).toBe('manual')
  })

  it('creates browser-submitted properties without a provider binding', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      {
        name: 'Grand Hotel',
        slug: 'custom-slug',
        timezone: 'UTC',
        countryCode: 'US',
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

    await expect(
      useCase({ name: 'Test', timezone: 'UTC', countryCode: 'US' }, ctx),
    ).rejects.toSatisfy(
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
      useCase({ name: 'Grand Hotel', timezone: 'UTC', countryCode: 'US' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('records a property.created fact on success', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ name: 'Grand Hotel', timezone: 'UTC', countryCode: 'US' }, ctx)

    const recorded = outbox.byTag('property.created')
    expect(recorded).toHaveLength(1)
    expect(recorded[0].name).toBe('Grand Hotel')
  })

  it('rejects invalid timezone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ name: 'Test', timezone: 'Invalid/Zone', countryCode: 'US' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_timezone',
    )
  })

  it('rejects empty name', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ name: '', timezone: 'UTC', countryCode: 'US' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })
})
