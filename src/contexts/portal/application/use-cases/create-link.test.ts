// Portal context — create link use case tests

import { describe, it, expect } from 'vitest'
import { createLink } from './create-link'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { portalId, propertyId, type PropertyId, userId } from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'

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
    idGen: () => '10000000-0000-0000-0000-000000000001',
    clock: () => FIXED_TIME,
  }
  const useCase = createLink(deps)
  return { useCase, portalRepo, portalLinkRepo, events }
}

describe('createLink', () => {
  it('creates a link in an existing category', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    const link = await useCase(
      {
        categoryId: category.id,
        portalId: 'd0000000-0000-0000-0000-000000000001',
        label: 'Google Review',
        url: 'https://google.com/review',
      },
      ctx,
    )

    expect(link.label).toBe('Google Review')
    expect(link.destinationId).not.toBeNull()
    expect(link.legacyDestinationState).toBe('migrated')
    expect(portalLinkRepo.allLinks()).toHaveLength(1)
  })

  it('rejects when category not found', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase(
        {
          categoryId: 'nonexistent',
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: 'Test',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy(
      (e: unknown) => isPortalError(e) && e.code === 'category_not_found',
    )
  })

  it('rejects a category owned by a different portal without writing', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({
      portalId: portalId('d0000000-0000-0000-0000-000000000099'),
    })
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: portal.id,
          label: 'Cross-portal link',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
    expect(portalLinkRepo.allLinks()).toEqual([])
  })

  it('rejects empty label', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: '',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'invalid_label')
  })

  it('rejects invalid URL', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: 'd0000000-0000-0000-0000-000000000001',
          label: 'Test',
          url: 'not-a-url',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'invalid_url')
  })

  it('emits portal_link.created event', async () => {
    const { useCase, portalRepo, portalLinkRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await useCase(
      {
        categoryId: category.id,
        portalId: 'd0000000-0000-0000-0000-000000000001',
        label: 'Test',
        url: 'https://example.com',
      },
      ctx,
    )

    const emitted = events.capturedByTag('portal_link.created')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].linkId).toBe('10000000-0000-0000-0000-000000000001')
  })

  it('rejects when role lacks portal.update permission', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: category.portalId,
          label: 'Test',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager without assignment to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    await expect(
      useCase(
        {
          categoryId: category.id,
          portalId: portal.id,
          label: 'Test',
          url: 'https://example.com',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
  })

  it('allows PropertyManager assigned to the property', async () => {
    const { useCase, portalRepo, portalLinkRepo } = setup([
      propertyId('a0000000-0000-0000-0000-000000000001'),
    ])
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const portal = buildTestPortal({})
    portalRepo.seed([portal])
    const category = buildTestPortalLinkCategory({})
    portalLinkRepo.seedCategories([category])

    const link = await useCase(
      {
        categoryId: category.id,
        portalId: portal.id,
        label: 'Test',
        url: 'https://example.com',
      },
      ctx,
    )

    expect(link.label).toBe('Test')
  })
})
