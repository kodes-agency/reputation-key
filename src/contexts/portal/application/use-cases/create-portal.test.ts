// Portal context — create portal use case tests

import { describe, it, expect } from 'vitest'
import { createPortal } from './create-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { isPortalError } from '../../domain/errors'
import {
  portalId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'

const FIXED_ID = portalId('portal-00000000-0000-0000-0000-000000000001')
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (
  accessible: ReadonlyArray<PropertyId> | null,
  participates = true,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  findActiveParticipation: async () => (participates ? ({} as never) : null),
})

const setup = (
  accessible: ReadonlyArray<PropertyId> | null = [
    propertyId('a0000000-0000-0000-0000-000000000001'),
  ],
  participates = true,
  managerRole: 'AccountAdmin' | 'PropertyManager' = 'PropertyManager',
) => {
  const portalRepo = createInMemoryPortalRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    propertyApi: {
      propertyExists: async (_orgId: OrganizationId, pid: PropertyId) =>
        pid === propertyId('a0000000-0000-0000-0000-000000000001'),
      getPropertyName: async () => null,
      getPropertyNames: async () => [],
      findByGbpLocationId: async () => null,
      findBySlug: async () => null,
      getProcessingRegion: async () => 'us',
      findIdsByGoogleConnection: async () => [],
      findGoogleNotificationAnchor: async () => null,
      clearGoogleConnectionRef: async () => {},
    },
    staffPublicApi: staffApiMock(accessible, participates),
    identityPublicApi: {
      listActiveManagers: async () => [
        {
          userId: 'user-00000000-0000-0000-0000-000000000001',
          role: managerRole,
          propertyAccessScope:
            managerRole === 'AccountAdmin'
              ? ('organization' as const)
              : ('assigned-properties' as const),
        },
      ],
    },
    commandStore: createInMemoryPortalCommandStore({ portalRepo, events }),
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
    expect(portal.publicationState).toBe('draft')
    expect(portal.entityType).toBe('property')
    expect(portal.entityId).toBe(portal.propertyId)
    expect(portal.privateFeedbackThreshold).toBe(3)
    expect(portal.createdBy).toBe(ctx.userId)
    expect(portal.responsibilityNeededSince).toBeNull()
    expect(portalRepo.all()).toHaveLength(1)
  })

  it('creates a portal with custom slug and theme', async () => {
    const { useCase } = setup(null, true, 'AccountAdmin')
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const portal = await useCase(
      {
        name: 'My Portal',
        slug: 'custom-slug',
        propertyId: 'a0000000-0000-0000-0000-000000000001',
        theme: { primaryColor: '#FF5500' },
        privateFeedbackThreshold: 4,
      },
      ctx,
    )

    expect(portal.slug).toBe('custom-slug')
    expect(portal.theme.primaryColor).toBe('#FF5500')
    expect(portal.publicationState).toBe('draft')
    expect(portal.privateFeedbackThreshold).toBe(4)
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
      useCase({ name: 'Test', propertyId: 'nonexistent-property-id' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'property_not_found',
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
      useCase(
        { name: 'My Portal', propertyId: 'a0000000-0000-0000-0000-000000000001' },
        ctx,
      ),
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
    expect(emitted[0]).toMatchObject({
      propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
      publicationState: 'draft',
      sourceAggregateVersion: FIXED_TIME.toISOString(),
    })
    expect(emitted[0]).not.toHaveProperty('name')
    expect(emitted[0]).not.toHaveProperty('slug')
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
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'invalid_theme',
    )
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase } = setup([]) // PM not assigned to any property
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ name: 'Test', propertyId: 'a0000000-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const portal = await useCase(
      { name: 'Test', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(portal.name).toBe('Test')
    expect(portalRepo.all()).toHaveLength(1)
  })

  it('creates a visible responsibility-needed state when the creator is not eligible', async () => {
    const { useCase, events } = setup(
      [propertyId('a0000000-0000-0000-0000-000000000001')],
      false,
    )
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const portal = await useCase(
      { name: 'Needs owner', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(portal.responsibilityNeededSince).toEqual(FIXED_TIME)
    expect(events.capturedByTag('portal.responsibility_became_needed')).toEqual([
      expect.objectContaining({
        portalId: FIXED_ID,
        organizationId: ctx.organizationId,
        propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
        occurredAt: FIXED_TIME,
      }),
    ])
  })

  it('does not raise a recovery alert when the creator becomes the default manager', async () => {
    const { useCase, events } = setup()

    await useCase(
      { name: 'Owned', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )

    expect(events.capturedByTag('portal.responsibility_became_needed')).toHaveLength(0)
  })
})
