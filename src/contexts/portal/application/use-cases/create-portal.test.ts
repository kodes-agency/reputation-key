// Portal context — create portal use case tests

import { describe, it, expect } from 'vitest'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import { portalId, propertyId, type PropertyId } from '#/shared/domain/ids'
import { CLOCK, setupCreatePortal } from '#/shared/testing/portal-create-setup'

const FIXED_ID = portalId('d0000000-0000-0000-0000-000000000001')
const FIXED_TIME = CLOCK

const setup = (
  accessible: ReadonlyArray<PropertyId> | null = [
    propertyId('a0000000-0000-0000-0000-000000000001'),
  ],
  managerRole: 'AccountAdmin' | 'PropertyManager' = 'PropertyManager',
) =>
  setupCreatePortal({
    accessible,
    managers: [
      { userId: 'user-00000000-0000-0000-0000-000000000001', role: managerRole },
    ],
  })

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
    const { useCase } = setup(null, 'AccountAdmin')
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
    const ctx = buildTestAuthContext({ role: 'Member' })

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

  it('rejects a typed slug that is already taken at the property', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const existing = buildTestPortal({
      id: 'portal-existing-0000-0000-000000000001',
      slug: 'my-portal',
    })
    portalRepo.seed([existing])

    await expect(
      useCase(
        {
          name: 'Another name',
          slug: 'my-portal',
          propertyId: 'a0000000-0000-0000-0000-000000000001',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('records a portal.created outbox fact on success', async () => {
    const { useCase, outbox } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      { name: 'My Portal', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    const emitted = outbox.byTag('portal.created')
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
    const { useCase, portalRepo, outbox } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const portal = await useCase(
      { name: 'Test', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(portal.name).toBe('Test')
    expect(portalRepo.all()).toHaveLength(1)
    // A grant alone (no Staff participation anywhere in these deps) makes the
    // creator the initial Responsible Manager, so nothing is "needed".
    expect(portal.responsibilityNeededSince).toBeNull()
    expect(outbox.byTag('portal.responsibility_became_needed')).toHaveLength(0)
  })

  it('creates a visible responsibility-needed state when the creator holds no current grant', async () => {
    // The session is an AccountAdmin (Organization-wide access), but the
    // creator's current membership is a PropertyManager whose grants do not list
    // the Property, so they cannot be the initial Responsible Manager.
    const { useCase, outbox } = setup([], 'PropertyManager')
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const portal = await useCase(
      { name: 'Needs owner', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      ctx,
    )

    expect(portal.responsibilityNeededSince).toEqual(FIXED_TIME)
    expect(outbox.byTag('portal.responsibility_became_needed')).toEqual([
      expect.objectContaining({
        portalId: FIXED_ID,
        organizationId: ctx.organizationId,
        propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
        occurredAt: FIXED_TIME,
      }),
    ])
  })

  it('does not raise a recovery alert when the creator becomes the default manager', async () => {
    const { useCase, outbox } = setup()

    await useCase(
      { name: 'Owned', propertyId: 'a0000000-0000-0000-0000-000000000001' },
      buildTestAuthContext({ role: 'PropertyManager' }),
    )

    expect(outbox.byTag('portal.responsibility_became_needed')).toHaveLength(0)
  })
})
