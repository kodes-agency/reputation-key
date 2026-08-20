// Portal context — update portal use case tests

import { describe, it, expect } from 'vitest'
import { updatePortal } from './update-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})
const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    events,
    clock: () => FIXED_TIME,
  }
  const useCase = updatePortal(deps)
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('updatePortal', () => {
  it('updates name and theme', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({
      name: 'Old Name',
      theme: { primaryColor: '#000000' },
    })
    portalRepo.seed([portal])

    const updated = await useCase(
      { portalId: portal.id, name: 'New Name', theme: { primaryColor: '#FF5500' } },
      ctx,
    )

    expect(updated.name).toBe('New Name')
    expect(updated.theme.primaryColor).toBe('#FF5500')
  })

  it('updates slug', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ slug: 'old-slug' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, slug: 'new-slug' }, ctx)

    expect(updated.slug).toBe('new-slug')
  })

  it('rejects users who cannot edit', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ portalId: 'any', name: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('rejects update to non-existent portal', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ portalId: 'nonexistent', name: 'Test' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'portal_not_found',
    )
  })

  it('rejects duplicate slug', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const p1 = buildTestPortal({ id: 'p1', slug: 'slug-a' })
    const p2 = buildTestPortal({ id: 'p2', slug: 'slug-b' })
    portalRepo.seed([p1, p2])

    await expect(useCase({ portalId: p2.id, slug: 'slug-a' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'slug_taken',
    )
  })

  it('emits portal.updated event', async () => {
    const { useCase, portalRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id, name: 'Updated' }, ctx)

    const emitted = events.capturedByTag('portal.updated')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].name).toBe('Updated')
  })

  it('rejects update with empty name', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ name: 'Valid Name' })
    portalRepo.seed([portal])

    await expect(useCase({ portalId: portal.id, name: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'invalid_name',
    )
  })

  it('rejects update with invalid theme', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ theme: { primaryColor: '#000000' } })
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, theme: { primaryColor: 'bad' } }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && (e as { code: string }).code === 'invalid_theme',
    )
  })

  it('returns existing portal unchanged when no fields are different', async () => {
    const { useCase, portalRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ name: 'Same Name', slug: 'same-slug' })
    portalRepo.seed([portal])

    const result = await useCase(
      { portalId: portal.id, name: 'Same Name', slug: 'same-slug' },
      ctx,
    )

    expect(result.name).toBe('Same Name')
    expect(events.capturedByTag('portal.updated')).toHaveLength(0)
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ name: 'Name' })
    portalRepo.seed([portal])

    await expect(useCase({ portalId: portal.id, name: 'X' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && (e as { code: string }).code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ name: 'Old' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, name: 'New' }, ctx)
    expect(updated.name).toBe('New')
  })

  it('clears the hero image when heroImageUrl is null', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, heroImageUrl: null }, ctx)

    expect(updated.heroImageUrl).toBeNull()
    expect(portalRepo.all()[0].heroImageUrl).toBeNull()
  })

  it('replaces the hero image when heroImageUrl is a new url', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/old.jpg' })
    portalRepo.seed([portal])

    const updated = await useCase(
      { portalId: portal.id, heroImageUrl: 'https://cdn.example.com/new.jpg' },
      ctx,
    )

    expect(updated.heroImageUrl).toBe('https://cdn.example.com/new.jpg')
    expect(portalRepo.all()[0].heroImageUrl).toBe('https://cdn.example.com/new.jpg')
  })

  it('leaves the hero image untouched when heroImageUrl is absent', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, name: 'Renamed' }, ctx)

    expect(updated.heroImageUrl).toBe('https://cdn.example.com/hero.jpg')
  })

  it('rejects publishing a portal that has no links', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft' })
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, publicationState: 'published' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'portal_has_no_links',
    )
    expect(portalRepo.all()[0].publicationState).toBe('draft')
  })

  it('publishes a portal that has at least one link', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft' })
    portalRepo.seed([portal])
    portalLinkRepo.seedLinks([
      buildTestPortalLink({
        portalId: portal.id,
        organizationId: portal.organizationId,
      }),
    ])

    const updated = await useCase(
      { portalId: portal.id, publicationState: 'published' },
      ctx,
    )

    expect(updated.publicationState).toBe('published')
  })

  it('does not require links to transition out of published', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'published' })
    portalRepo.seed([portal])

    const updated = await useCase(
      { portalId: portal.id, publicationState: 'disabled' },
      ctx,
    )

    expect(updated.publicationState).toBe('disabled')
  })
})
