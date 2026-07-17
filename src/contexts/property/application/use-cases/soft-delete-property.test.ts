// Property context — hard-delete property use case tests

import { describe, it, expect, vi } from 'vitest'
import { deleteProperty } from './soft-delete-property'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { isPropertyError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()
  const useCase = deleteProperty({ propertyRepo, events, clock: () => FIXED_TIME })
  return { useCase, propertyRepo, events }
}

describe('deleteProperty', () => {
  it('hard-deletes a property as AccountAdmin', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const prop = buildTestProperty({ id: 'p1' })
    propertyRepo.seed([prop])

    await useCase({ propertyId: prop.id }, ctx)

    // Property should no longer be found
    const found = await propertyRepo.findById(ctx.organizationId, prop.id as never)
    expect(found).toBeNull()

    // And it should not exist in the store at all
    const all = propertyRepo.all()
    expect(all).toHaveLength(0)
  })

  it('rejects PropertyManager (only AccountAdmin can delete)', async () => {
    const { useCase, propertyRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const prop = buildTestProperty({ id: 'p1' })
    propertyRepo.seed([prop])

    await expect(useCase({ propertyId: prop.id }, ctx)).rejects.toSatisfy(
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

  it('purges inbox rows and source content (bounded) before the hard delete (BQC-1.7)', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const events = createCapturingEventBus()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })
    const prop = buildTestProperty({})
    propertyRepo.seed([prop])

    const calls: string[] = []
    const sourceContentPurge = {
      inboxForProperty: vi.fn(async () => {
        calls.push('inbox')
        return { subject: 'inbox_items.purge.property', batches: 1, rowsDeleted: 2 }
      }),
      forProperty: vi.fn(async () => {
        calls.push('reviews')
        return { subject: 'reviews.purge.property', batches: 2, rowsDeleted: 7 }
      }),
      forConnection: vi.fn(),
      forOrganization: vi.fn(),
    }
    const useCase = deleteProperty({
      propertyRepo,
      events,
      clock: () => FIXED_TIME,
      sourceContentPurge,
    })

    await useCase({ propertyId: prop.id }, ctx)

    // Bounded purge ran, inbox before reviews, both before hardDelete
    expect(calls).toEqual(['inbox', 'reviews'])
    expect(sourceContentPurge.inboxForProperty).toHaveBeenCalledWith(
      ctx.organizationId,
      prop.id,
    )
    expect(sourceContentPurge.forProperty).toHaveBeenCalledWith(
      ctx.organizationId,
      prop.id,
    )
    expect(propertyRepo.all()).toHaveLength(0)
  })
})
