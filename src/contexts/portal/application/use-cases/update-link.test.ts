// Portal context — update link use case tests

import { describe, it, expect, vi } from 'vitest'
import { updateLink } from './update-link'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { propertyId, type PropertyId, userId } from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const events = createCapturingEventBus()
  const deps = {
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalLinkRepo,
      events,
    }),
    destinationRepo: {
      request: async (
        input: Parameters<
          import('../ports/portal-approved-destination.repository').PortalApprovedDestinationRepository['request']
        >[0],
      ) => ({
        id: input.id,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        normalizedUri: input.destination.normalizedUri,
        hostname: input.destination.hostname,
        sourceType: input.destination.sourceType,
        approvalState: 'approved' as const,
        validationVersion: PORTAL_DESTINATION_VALIDATION_VERSION,
        requestedBy: input.requestedBy,
        approvedBy: userId('admin-1'),
        approvedAt: input.at,
        disabledAt: null,
        disabledReason: null,
        lastValidatedAt: input.at,
        createdAt: input.at,
        updatedAt: input.at,
      }),
    },
    destinationNetworkValidator: {
      validate: async (uri: string) => ({
        outcome: 'safe' as const,
        validatedAt: FIXED_TIME,
        finalUri: uri,
        redirectCount: 0,
      }),
    },
    idGen: () => '20000000-0000-4000-8000-000000000001',
    clock: () => FIXED_TIME,
  }
  const useCase = updateLink(deps)
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('updateLink', () => {
  it('updates link label and URL', async () => {
    const { useCase, portalRepo, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase(
      { linkId: link.id, label: 'New Label', url: 'https://new.com' },
      ctx,
    )

    expect(updated.label).toBe('New Label')
    expect(updated.url).toBe('https://new.com/')
    expect(events.capturedByTag('portal_link.updated')).toEqual([
      expect.objectContaining({
        linkId: link.id,
        occurredAt: FIXED_TIME,
        sourceAggregateVersion: new Date(FIXED_TIME.getTime() + 1).toISOString(),
      }),
    ])
  })

  it('rejects when the Portal revision advanced after the atomic child snapshot', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const previousRevision = new Date('2026-04-10T12:00:00.000Z')
    const portal = buildTestPortal({
      updatedAt: new Date(previousRevision.getTime() + 1),
    })
    const stale = buildTestPortalLink({ url: 'https://old.example' })
    const current = { ...stale, url: 'https://concurrent.example' }
    portalRepo.seed([portal])
    portalLinkRepo.seedLinks([current])
    vi.spyOn(portalLinkRepo, 'findLinkCommandTarget').mockResolvedValueOnce({
      link: stale,
      portalUpdatedAt: previousRevision,
    })

    await expect(
      useCase({ linkId: stale.id, label: 'New Label' }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'revision_conflict',
    )

    expect(portalLinkRepo.allLinks()[0]?.url).toBe('https://concurrent.example')
  })

  it('rejects users who cannot update', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(useCase({ linkId: 'any', label: 'Test' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('rejects when link not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ linkId: 'nonexistent', label: 'Test' }, ctx),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'link_not_found')
  })

  it('rejects empty label', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: '' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_label',
    )
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, url: 'bad-url' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'invalid_url',
    )
  })

  it('returns existing link unchanged when no fields provided', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({ label: 'Original' })
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id }, ctx)

    expect(updated.label).toBe('Original')
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    await expect(useCase({ linkId: link.id, label: 'New' }, ctx)).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'forbidden',
    )
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const link = buildTestPortalLink({})
    portalLinkRepo.seedLinks([link])

    const updated = await useCase({ linkId: link.id, label: 'New' }, ctx)

    expect(updated.label).toBe('New')
  })
})
