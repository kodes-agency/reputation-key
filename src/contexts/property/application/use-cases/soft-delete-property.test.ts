// Property context — soft-delete property use case tests

import { describe, it, expect } from 'vitest'
import { softDeleteProperty } from './soft-delete-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()
  const useCase = softDeleteProperty({ propertyRepo, events, clock: () => FIXED_TIME })
  return { useCase, propertyRepo, events }
}

describe('softDeleteProperty', () => {
  it('soft-deletes a property as AccountAdmin', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const prop = buildTestProperty({ id: 'p1' })
    propertyRepo.seed([prop])

    await useCase({ propertyId: prop.id }, ctx)

    // Property should no longer be found (soft-deleted)
    const found = await propertyRepo.findById(ctx.organizationId, prop.id as never)
    expect(found).toBeNull()

    // But it still exists in the store
    const all = propertyRepo.all()
    expect(all).toHaveLength(1)
    expect(all[0].deletedAt).not.toBeNull()
  })

  it('rejects PropertyManager (not AccountAdmin)', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(useCase({ propertyId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects Staff', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ propertyId: 'any' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPropertyError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects delete of non-existent property', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(useCase({ propertyId: 'nonexistent' }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isPropertyError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  it('emits property.deleted event with deterministic timestamp', async () => {
    const { useCase, propertyRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const prop = buildTestProperty({})
    propertyRepo.seed([prop])

    await useCase({ propertyId: prop.id }, ctx)

    const emitted = events.capturedByTag('property.deleted')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].propertyId).toBe(prop.id)
    expect(emitted[0].occurredAt).toBe(FIXED_TIME)
  })
})
