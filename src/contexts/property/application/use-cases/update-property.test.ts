// Property context — update property use case tests

import { describe, it, expect } from 'vitest'
import { updateProperty } from './update-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()
  const deps = { propertyRepo, events, clock: () => FIXED_TIME }
  const useCase = updateProperty(deps)
  return { useCase, propertyRepo, events }
}

describe('updateProperty', () => {
  it('updates name and timezone', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ name: 'Old Name', timezone: 'UTC' })
    propertyRepo.seed([prop])

    const updated = await useCase(
      { propertyId: prop.id, name: 'New Name', timezone: 'Europe/London' },
      ctx,
    )

    expect(updated.name).toBe('New Name')
    expect(updated.timezone).toBe('Europe/London')
  })

  it('updates slug', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ slug: 'old-slug' })
    propertyRepo.seed([prop])

    const updated = await useCase({ propertyId: prop.id, slug: 'new-slug' }, ctx)

    expect(updated.slug).toBe('new-slug')
  })

  it('rejects users who cannot edit', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ propertyId: 'any', name: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects update to non-existent property', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ propertyId: 'nonexistent', name: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  it('rejects duplicate slug', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop1 = buildTestProperty({ id: 'p1', slug: 'slug-a' })
    const prop2 = buildTestProperty({ id: 'p2', slug: 'slug-b' })
    propertyRepo.seed([prop1, prop2])

    await expect(
      useCase({ propertyId: prop2.id, slug: 'slug-a' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('emits property.updated event', async () => {
    const { useCase, propertyRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({})
    propertyRepo.seed([prop])

    await useCase({ propertyId: prop.id, name: 'Updated' }, ctx)

    const emitted = events.capturedByTag('property.updated')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('Updated')
  })

  // ── Field-level validation tests ────────────────────────────────────

  it('rejects update with empty name', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ name: 'Valid Name' })
    propertyRepo.seed([prop])

    await expect(useCase({ propertyId: prop.id, name: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects update with name over 100 characters', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ name: 'Valid' })
    propertyRepo.seed([prop])

    await expect(
      useCase({ propertyId: prop.id, name: 'a'.repeat(101) }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects update with invalid slug', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ slug: 'valid-slug' })
    propertyRepo.seed([prop])

    await expect(
      useCase({ propertyId: prop.id, slug: 'INVALID SLUG!' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_slug',
    )
  })

  it('rejects update with invalid timezone', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ timezone: 'UTC' })
    propertyRepo.seed([prop])

    await expect(
      useCase({ propertyId: prop.id, timezone: 'Invalid/Zone' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'invalid_timezone',
    )
  })

  it('allows setting gbpPlaceId to null (clearing it)', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ gbpPlaceId: 'ChIJ_old_place_id' })
    propertyRepo.seed([prop])

    const updated = await useCase({ propertyId: prop.id, gbpPlaceId: null }, ctx)

    expect(updated.gbpPlaceId).toBeNull()
  })

  it('allows updating only gbpPlaceId without changing other fields', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({
      name: 'Original',
      slug: 'original',
      timezone: 'UTC',
    })
    propertyRepo.seed([prop])

    const updated = await useCase(
      { propertyId: prop.id, gbpPlaceId: 'ChIJ_new_place_id' },
      ctx,
    )

    expect(updated.gbpPlaceId).toBe('ChIJ_new_place_id')
    expect(updated.name).toBe('Original')
    expect(updated.slug).toBe('original')
    expect(updated.timezone).toBe('UTC')
  })

  it('returns existing property unchanged when no fields are different', async () => {
    const { useCase, propertyRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({
      name: 'Same Name',
      slug: 'same-slug',
      timezone: 'UTC',
    })
    propertyRepo.seed([prop])

    const result = await useCase(
      { propertyId: prop.id, name: 'Same Name', slug: 'same-slug', timezone: 'UTC' },
      ctx,
    )

    // Should return the same property without persisting or emitting events
    expect(result.name).toBe('Same Name')
    expect(events.capturedByTag('property.updated')).toHaveLength(0)
  })
})
