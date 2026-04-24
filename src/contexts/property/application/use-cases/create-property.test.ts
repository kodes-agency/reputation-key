// Property context — create property use case tests
// Per architecture: use case tests with in-memory port fakes.

import { describe, it, expect } from 'vitest'
import { createProperty } from './create-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'
import { propertyId } from '#/shared/domain/ids'

const FIXED_ID = propertyId('prop-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()
  const deps = {
    propertyRepo,
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
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
    expect(property.gbpPlaceId).toBeNull()
    expect(propertyRepo.all()).toHaveLength(1)
  })

  it('creates a property with custom slug and gbpPlaceId', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const property = await useCase(
      {
        name: 'Grand Hotel',
        slug: 'custom-slug',
        timezone: 'UTC',
        gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      },
      ctx,
    )

    expect(property.slug).toBe('custom-slug')
    expect(property.gbpPlaceId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4')
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
})
