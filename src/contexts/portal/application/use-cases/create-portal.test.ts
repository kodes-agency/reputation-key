// Portal context — create portal use case tests

import { describe, it, expect } from 'vitest'
import { createPortal } from './create-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import { portalId } from '#/shared/domain/ids'

const FIXED_ID = portalId('portal-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    propertyExists: async (_orgId: string, propertyId: string) =>
      propertyId === 'a0000000-0000-0000-0000-000000000001',
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }
  const useCase = createPortal(deps)
  return { useCase, portalRepo, events }
}

describe('createPortal', () => {
  it('creates a portal with defaults when optional fields are omitted', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const portal = await useCase(
      { name: 'My Portal', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(portal.slug).toBe('my-portal')
    expect(portal.theme.primaryColor).toBe('#6366F1')
    expect(portal.smartRoutingEnabled).toBe(false)
    expect(portal.smartRoutingThreshold).toBe(4)
    expect(portalRepo.all()).toHaveLength(1)
  })

  it('creates a portal with custom slug and theme', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const portal = await useCase(
      {
        name: 'My Portal',
        slug: 'custom-slug',
        propertyId: 'a0000000-0000-0000-0000-000000000001',
        theme: { primaryColor: '#FF5500' },
        smartRoutingEnabled: true,
        smartRoutingThreshold: 3,
      },
      ctx,
    )

    expect(portal.slug).toBe('custom-slug')
    expect(portal.theme.primaryColor).toBe('#FF5500')
    expect(portal.smartRoutingEnabled).toBe(true)
    expect(portal.smartRoutingThreshold).toBe(3)
  })

  it('rejects users who cannot create portals', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ name: 'Test', propertyId: 'a0000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects when property does not exist', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        { name: 'Test', propertyId: 'nonexistent-property-id' },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'property_not_found',
    )
  })

  it('rejects duplicate slug in same organization', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const existing = buildTestPortal({
      id: 'portal-existing-0000-0000-000000000001',
      slug: 'my-portal',
    })
    portalRepo.seed([existing])

    await expect(
      useCase({ name: 'My Portal', propertyId: 'a0000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('emits portal.created event on success', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      { name: 'My Portal', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    const emitted = events.capturedByTag('portal.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('My Portal')
  })

  it('rejects invalid name', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ name: '', propertyId: 'a0000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects invalid theme color', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        {
          name: 'Test',
          propertyId: 'a0000000-0000-0000-0000-000000000001',
          theme: { primaryColor: 'not-a-color' },
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_theme',
    )
  })

  it('rejects invalid smart routing threshold', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        {
          name: 'Test',
          propertyId: 'a0000000-0000-0000-0000-000000000001',
          smartRoutingThreshold: 5,
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'invalid_threshold',
    )
  })
})
