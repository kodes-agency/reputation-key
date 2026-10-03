// Portal context — create link use case tests

import { describe, it, expect } from 'vitest'
import { createLink } from './create-link'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalLinkRepo } from '#/shared/testing/in-memory-portal-link-repo'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import {
  buildTestAuthContext,
  buildTestPortal,
  buildTestPortalLink,
  buildTestPortalLinkCategory,
} from '#/shared/testing/fixtures'
import { isPortalError, portalError } from '../../domain/errors'
import type { CreatePortalLinkCommand } from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import {
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  type PropertyId,
  userId,
} from '#/shared/domain/ids'
import { PORTAL_DESTINATION_VALIDATION_VERSION } from '../../domain/approved-destination'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const staffApiMock = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const setup = (accessible: ReadonlyArray<PropertyId> | null = null) => {
  const portalRepo = createInMemoryPortalRepo()
  const portalLinkRepo = createInMemoryPortalLinkRepo()
  const outbox = createRecordedOutbox()
  const store = createInMemoryPortalCommandStore({ portalRepo, portalLinkRepo, outbox })
  const commandStoreCalls: CreatePortalLinkCommand[] = []
  let refuseLinkWrite = false
  const destinationRequests: string[] = []
  const deps = {
    portalRepo,
    portalLinkRepo,
    staffPublicApi: staffApiMock(accessible),
    commandStore: {
      ...store,
      createPortalLink: async (command: CreatePortalLinkCommand) => {
        commandStoreCalls.push(command)
        if (refuseLinkWrite) throw portalError('revision_conflict', 'Portal changed')
        return store.createPortalLink(command)
      },
    },
    destinationRepo: {
      request: async (
        input: Parameters<
          import('../ports/portal-approved-destination.repository').PortalApprovedDestinationRepository['request']
        >[0],
      ) => {
        destinationRequests.push(input.destination.normalizedUri)
        return {
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
        }
      },
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
  return {
    useCase,
    portalRepo,
    portalLinkRepo,
    outbox,
    destinationRequests,
    commandStoreCalls,
    refuseLinkWrites: () => {
      refuseLinkWrite = true
    },
  }
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

  it('records a portal_link.created outbox fact', async () => {
    const { useCase, portalRepo, portalLinkRepo, outbox } = setup()
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

    const recorded = outbox.byTag('portal_link.created')
    expect(recorded).toHaveLength(1)
    expect(recorded[0].linkId).toBe('10000000-0000-0000-0000-000000000001')
  })

  it('rejects when role lacks portal.update permission', async () => {
    const { useCase, portalLinkRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'Member' })
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

  describe('the Linktree working model', () => {
    const seededPortal = (linkCount: number) => {
      const fixture = setup()
      fixture.portalRepo.seed([buildTestPortal({ additionalGuestLocales: ['bg'] })])
      fixture.portalLinkRepo.seedCategories([buildTestPortalLinkCategory({})])
      fixture.portalLinkRepo.seedLinks(
        Array.from({ length: linkCount }, (_, index) =>
          buildTestPortalLink({
            id: portalLinkId(`10000000-0000-0000-0000-00000000010${index}`),
            label: `Existing ${index}`,
            sortKey: `a${index}`,
          }),
        ),
      )
      return fixture
    }
    const input = {
      categoryId: 'c0000000-0000-0000-0000-000000000001',
      portalId: 'd0000000-0000-0000-0000-000000000001',
      label: 'Fifth',
      url: 'https://example.com/fifth',
    }
    const ctx = () => buildTestAuthContext({ role: 'PropertyManager' })

    it('takes the fourth link', async () => {
      const { useCase, portalLinkRepo } = seededPortal(3)

      await useCase(input, ctx())

      expect(portalLinkRepo.allLinks()).toHaveLength(4)
    })

    it('refuses a fifth link before asking for a destination, and writes nothing', async () => {
      const { useCase, portalLinkRepo, destinationRequests, outbox } = seededPortal(4)

      await expect(useCase(input, ctx())).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'link_limit_reached',
      )

      expect(destinationRequests).toEqual([])
      expect(portalLinkRepo.allLinks()).toHaveLength(4)
      expect(outbox.byTag('portal_link.created')).toEqual([])
    })

    it('keeps a Portal that already has more than four, and adds no more', async () => {
      const { useCase, portalLinkRepo } = seededPortal(6)

      await expect(useCase(input, ctx())).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'link_limit_reached',
      )

      expect(portalLinkRepo.allLinks()).toHaveLength(6)
    })

    it('writes the label as the primary-language text and not to the legacy column', async () => {
      const { useCase, portalLinkRepo } = seededPortal(0)

      const link = await useCase({ ...input, label: 'City guide' }, ctx())

      expect(
        portalLinkRepo
          .storedTexts()
          .map((text) => [text.linkId, text.locale, text.label, text.line]),
      ).toEqual([[link.id, 'en', 'City guide', null]])
      expect(
        (await portalLinkRepo.findLinkById(link.organizationId, link.id))?.label,
      ).toBe('')
    })
  })
  describe('without a category, as the Linktree editor adds a link', () => {
    const base = {
      portalId: 'd0000000-0000-0000-0000-000000000001',
      label: 'Olive Terrace menu',
      url: 'https://avela.bg/olive-terrace/menu',
    }
    const ctx = () => buildTestAuthContext({ role: 'PropertyManager' })

    it("starts the Portal's first category when it has none, and puts the link in it", async () => {
      const { useCase, portalRepo, portalLinkRepo, outbox } = setup()
      portalRepo.seed([buildTestPortal({})])

      const link = await useCase(base, ctx())

      const categories = portalLinkRepo.allCategories()
      expect(categories.map((category) => category.title)).toEqual(['Links'])
      expect(link.categoryId).toBe(categories[0]?.id)
      expect(portalLinkRepo.allLinks()).toHaveLength(1)
      expect(outbox.byTag('portal_link_category.created')).toHaveLength(1)
      expect(outbox.byTag('portal_link.created')).toHaveLength(1)
    })

    it('titles the started category neutrally, whatever language or Linktree title the Portal has', async () => {
      const { useCase, portalRepo, portalLinkRepo } = setup()
      portalRepo.seed([
        buildTestPortal({ primaryGuestLocale: 'bg', additionalGuestLocales: ['en'] }),
      ])

      await useCase(base, ctx())

      expect(portalLinkRepo.allCategories().map((category) => category.title)).toEqual([
        'Links',
      ])
    })

    it('hands the new category to the link write, so the store can keep them together', async () => {
      const { useCase, portalRepo, commandStoreCalls } = setup()
      portalRepo.seed([buildTestPortal({})])

      const link = await useCase(base, ctx())

      const [call] = commandStoreCalls
      expect(call?.startCategory?.category.id).toBe(link.categoryId)
      expect(call?.startCategory?.event._tag).toBe('portal_link_category.created')
      expect(call?.event.categoryId).toBe(link.categoryId)
    })

    it('puts the link in the last category when the Portal already has some', async () => {
      const { useCase, portalRepo, portalLinkRepo, commandStoreCalls } = setup()
      portalRepo.seed([buildTestPortal({})])
      const first = buildTestPortalLinkCategory({
        id: portalLinkCategoryId('c0000000-0000-0000-0000-000000000001'),
        sortKey: 'a0',
      })
      const last = buildTestPortalLinkCategory({
        id: portalLinkCategoryId('c0000000-0000-0000-0000-000000000002'),
        sortKey: 'a1',
      })
      portalLinkRepo.seedCategories([last, first])

      const link = await useCase(base, ctx())

      expect(link.categoryId).toBe(last.id)
      expect(portalLinkRepo.allCategories()).toHaveLength(2)
      expect(commandStoreCalls[0]?.startCategory).toBeUndefined()
    })

    it('leaves no category and no category fact behind when the link write is refused', async () => {
      const { useCase, portalRepo, portalLinkRepo, outbox, refuseLinkWrites } = setup()
      portalRepo.seed([buildTestPortal({})])
      refuseLinkWrites()

      await expect(useCase(base, ctx())).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'revision_conflict',
      )

      expect(portalLinkRepo.allCategories()).toEqual([])
      expect(outbox.byTag('portal_link_category.created')).toEqual([])
    })

    it('refuses an empty label without starting a category', async () => {
      const { useCase, portalRepo, portalLinkRepo } = setup()
      portalRepo.seed([buildTestPortal({})])

      await expect(useCase({ ...base, label: '  ' }, ctx())).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'invalid_label',
      )
      expect(portalLinkRepo.allCategories()).toEqual([])
    })

    it('still refuses a fifth link without leaving a category behind', async () => {
      const { useCase, portalRepo, portalLinkRepo } = setup()
      portalRepo.seed([buildTestPortal({})])
      const category = buildTestPortalLinkCategory({})
      portalLinkRepo.seedCategories([category])
      portalLinkRepo.seedLinks(
        Array.from({ length: 4 }, (_, index) =>
          buildTestPortalLink({
            id: portalLinkId(`10000000-0000-0000-0000-00000000020${index}`),
            sortKey: `a${index}`,
          }),
        ),
      )

      await expect(useCase(base, ctx())).rejects.toSatisfy(
        (error: unknown) => isPortalError(error) && error.code === 'link_limit_reached',
      )
      expect(portalLinkRepo.allCategories()).toHaveLength(1)
    })
  })
})
