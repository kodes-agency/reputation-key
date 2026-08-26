// Portal context — update portal use case tests

import { describe, it, expect } from 'vitest'
import { updatePortal, resolvePortalContentFields } from './update-portal'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId } from '#/shared/domain/ids'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { UpdatePortalCommand } from '../ports/portal-command-store.port'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')
const NEXT_TIME = new Date(FIXED_TIME.getTime() + 1)

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})
const setup = (
  accessible: ReadonlyArray<PropertyId> | null = null,
  destinationState: 'verified' | 'unavailable' = 'verified',
) => {
  const portalRepo = createInMemoryPortalRepo()
  const events = createCapturingEventBus()
  let destinationLookups = 0
  let lastUpdateCommand: UpdatePortalCommand | null = null
  let generatedId = 0
  const baseCommandStore = createInMemoryPortalCommandStore({ portalRepo, events })
  const publicationRepo: PortalPublicationRepository = {
    loadWorkingCopy: async (organizationId, portalId) => {
      const portal = await portalRepo.findById(organizationId, portalId)
      return portal
        ? {
            portal: {
              id: portal.id,
              name: portal.name,
              slug: portal.slug,
              description: portal.description,
              heroImageUrl: portal.heroImageUrl,
              theme: portal.theme,
              organizationName: 'Example Organization',
            },
            categories: [],
            links: [],
            privateFeedbackThreshold: portal.privateFeedbackThreshold,
            organizationId: portal.organizationId,
            propertyId: portal.propertyId,
          }
        : null
    },
    getCursor: async () => ({
      nextSnapshotVersion: 1,
      nextActivationSequence: 1,
    }),
    findSnapshotByVersion: async () => null,
    findActiveForPortal: async () => null,
    listActivationHistory: async () => [],
    resolveActiveByTokenDigest: async () => null,
  }
  const deps = {
    portalRepo,
    commandStore: {
      ...baseCommandStore,
      updatePortal: async (command: UpdatePortalCommand) => {
        lastUpdateCommand = command
        await baseCommandStore.updatePortal(command)
      },
    },
    publicationRepo,
    propertyGoogleReviewDestinationApi: {
      getGoogleReviewDestination: async () => {
        destinationLookups += 1
        return destinationState === 'verified'
          ? {
              state: 'verified' as const,
              uri: 'https://search.google.com/local/writereview?placeid=test',
              retrievedAt: FIXED_TIME,
              sourceEpoch: 1,
              profileVersion: 1,
            }
          : {
              state: 'unavailable' as const,
              uri: null,
              retrievedAt: null,
              sourceEpoch: null,
              profileVersion: null,
            }
      },
    },
    staffPublicApi: staffApiMock(accessible),
    idGen: () => `publication-id-${(generatedId += 1)}`,
    clock: () => FIXED_TIME,
  }
  const useCase = updatePortal(deps)
  return {
    useCase,
    portalRepo,
    events,
    destinationLookups: () => destinationLookups,
    lastUpdateCommand: () => lastUpdateCommand,
  }
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

  it('reports an invalid publication transition before a taken slug', async () => {
    // The patch is assembled in a fixed order — content, publication, slug — so the
    // error a user sees for a doubly-invalid edit does not depend on field ordering.
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const p1 = buildTestPortal({ id: 'p1', slug: 'slug-a' })
    const p2 = buildTestPortal({ id: 'p2', slug: 'slug-b', publicationState: 'archived' })
    portalRepo.seed([p1, p2])

    await expect(
      useCase({ portalId: p2.id, slug: 'slug-a', publicationState: 'published' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) &&
        (e as { code: string }).code === 'invalid_publication_transition',
    )
  })

  it('keeps occurrence time from the clock while allocating a later revision', async () => {
    const { useCase, portalRepo, events, lastUpdateCommand } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])

    await useCase({ portalId: portal.id, name: 'Updated' }, ctx)

    const emitted = events.capturedByTag('portal.updated')
    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toMatchObject({
      propertyId: portal.propertyId,
      previousPublicationState: portal.publicationState,
      publicationState: portal.publicationState,
      sourceAggregateVersion: NEXT_TIME.toISOString(),
      occurredAt: FIXED_TIME,
    })
    expect(lastUpdateCommand()).toMatchObject({
      occurredAt: FIXED_TIME,
      revision: NEXT_TIME,
    })
    expect(emitted[0]).not.toHaveProperty('name')
    expect(emitted[0]).not.toHaveProperty('slug')
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

  it('rejects a caller-supplied hero image URL', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/old.jpg' })
    portalRepo.seed([portal])

    await expect(
      useCase(
        {
          portalId: portal.id,
          heroImageUrl: 'https://cdn.example.com/new.jpg',
        } as unknown as Parameters<typeof useCase>[0],
        ctx,
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'invalid_url',
    )
    expect(portalRepo.all()[0].heroImageUrl).toBe('https://cdn.example.com/old.jpg')
  })

  it('leaves the hero image untouched when heroImageUrl is absent', async () => {
    const { useCase, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ heroImageUrl: 'https://cdn.example.com/hero.jpg' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, name: 'Renamed' }, ctx)

    expect(updated.heroImageUrl).toBe('https://cdn.example.com/hero.jpg')
  })

  it('rejects publishing when the Property has no verified Google destination', async () => {
    const { useCase, portalRepo } = setup(null, 'unavailable')
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft' })
    portalRepo.seed([portal])

    await expect(
      useCase({ portalId: portal.id, publicationState: 'published' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && e.code === 'google_review_destination_unavailable',
    )
    expect(portalRepo.all()[0].publicationState).toBe('draft')
  })

  it('publishes a rating-first gateway without requiring secondary links', async () => {
    const { useCase, portalRepo, lastUpdateCommand } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft' })
    portalRepo.seed([portal])
    const updated = await useCase(
      { portalId: portal.id, publicationState: 'published' },
      ctx,
    )

    expect(updated.publicationState).toBe('published')
    expect(lastUpdateCommand()?.publication).toMatchObject({
      kind: 'publish',
      snapshot: {
        version: 1,
        configuration: {
          reviewGateway: { privateFeedbackThreshold: 3 },
          links: [],
        },
      },
      activation: { activationSequence: 1, kind: 'publish' },
    })
  })

  it('does not require a destination to transition out of published', async () => {
    const { useCase, portalRepo, lastUpdateCommand } = setup(null, 'unavailable')
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'published' })
    portalRepo.seed([portal])

    const updated = await useCase(
      { portalId: portal.id, publicationState: 'disabled' },
      ctx,
    )

    expect(updated.publicationState).toBe('disabled')
    expect(lastUpdateCommand()?.publication).toEqual({
      kind: 'deactivate',
      reason: 'disabled',
      at: FIXED_TIME,
    })
  })

  // The shape the beta journey actually sends: publish bundled with a content
  // edit. The precondition has to run BEFORE the write, or a refused publish
  // still leaks the other fields.
  it('refuses a publish bundled with other edits and persists none of them', async () => {
    const { useCase, portalRepo } = setup(null, 'unavailable')
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft', description: 'Before' })
    portalRepo.seed([portal])

    await expect(
      useCase(
        { portalId: portal.id, description: 'After', publicationState: 'published' },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isPortalError(e) && e.code === 'google_review_destination_unavailable',
    )
    expect(portalRepo.all()[0].publicationState).toBe('draft')
    expect(portalRepo.all()[0].description).toBe('Before')
  })

  it('never consults the destination when the update leaves publication state alone', async () => {
    const { useCase, portalRepo, destinationLookups } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'draft', description: 'Before' })
    portalRepo.seed([portal])

    const updated = await useCase({ portalId: portal.id, description: 'After' }, ctx)

    expect(updated.description).toBe('After')
    expect(updated.publicationState).toBe('draft')
    expect(destinationLookups()).toBe(0)
  })

  // A portal that is ALREADY published (pre-precondition data) must
  // stay editable: re-asserting the current state is not a transition.
  it('never consults the destination when the requested state is current', async () => {
    const { useCase, portalRepo, destinationLookups } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({ publicationState: 'published' })
    portalRepo.seed([portal])

    const updated = await useCase(
      { portalId: portal.id, name: 'Renamed', publicationState: 'published' },
      ctx,
    )

    expect(updated.name).toBe('Renamed')
    expect(updated.publicationState).toBe('published')
    expect(destinationLookups()).toBe(0)
  })
})

describe('resolvePortalContentFields', () => {
  const existing = buildTestPortal({
    name: 'Existing',
    description: 'Existing description',
    heroImageUrl: 'https://cdn.example.com/hero.png',
    theme: { primaryColor: '#112233' },
  })

  it('keeps every existing value when the keys are absent', () => {
    const fields = resolvePortalContentFields({ portalId: existing.id }, existing)

    expect(fields).toEqual({
      name: 'Existing',
      description: 'Existing description',
      heroImageUrl: 'https://cdn.example.com/hero.png',
      theme: { primaryColor: '#112233' },
      privateFeedbackThreshold: 3,
    })
  })

  it('treats an explicit null as "clear this field", not "leave unchanged"', () => {
    const fields = resolvePortalContentFields(
      { portalId: existing.id, description: null, heroImageUrl: null },
      existing,
    )

    expect(fields.description).toBeNull()
    expect(fields.heroImageUrl).toBeNull()
    // Untouched keys still fall back.
    expect(fields.name).toBe('Existing')
  })

  it('validates and updates the inclusive private-feedback threshold', () => {
    expect(
      resolvePortalContentFields(
        { portalId: existing.id, privateFeedbackThreshold: 4 },
        existing,
      ).privateFeedbackThreshold,
    ).toBe(4)
    expect(() =>
      resolvePortalContentFields(
        { portalId: existing.id, privateFeedbackThreshold: 0 },
        existing,
      ),
    ).toThrow(expect.objectContaining({ code: 'invalid_threshold' }))
  })

  it('validates values that are present', () => {
    expect(() =>
      resolvePortalContentFields({ portalId: existing.id, name: '   ' }, existing),
    ).toThrow(expect.objectContaining({ code: 'invalid_name' }))
  })
})
