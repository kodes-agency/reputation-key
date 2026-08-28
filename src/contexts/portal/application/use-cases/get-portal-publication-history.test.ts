import { describe, expect, it, vi } from 'vitest'
import { getPortalPublicationHistory } from './get-portal-publication-history'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyId } from '#/shared/domain/ids'

const NOW = new Date('2026-08-26T14:00:00.000Z')
const portal = buildTestPortal({ publicationState: 'published' })
const ctx = buildTestAuthContext()
const source = {
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
} as const
const localizedExperience = {
  primaryGuestLocale: 'en',
  localeSet: ['en'],
  languagePackVersions: {
    en: 'guest-ui-en-v1',
    bg: 'guest-ui-bg-v1',
  },
  localizedContent: {
    en: {
      title: 'Tell us about your stay',
      shortDescription: 'Your view matters.',
      heroImageUrl: null,
    },
    bg: {
      title: 'Разкажете ни за престоя си',
      shortDescription: 'Вашето мнение е важно.',
      heroImageUrl: null,
    },
  },
  brandProfile: {
    displayName: 'Example Hotel',
    logoUrl: null,
    defaultHeroImageUrl: null,
    primaryColor: '#1D4ED8',
    backgroundColor: '#FFFFFF',
    textColor: '#111827',
    version: 1,
  },
} as const
const destination = {
  state: 'verified',
  uri: 'https://search.google.com/local/writereview?placeid=history-test',
  retrievedAt: new Date('2026-08-25T10:00:00.000Z'),
  sourceEpoch: 2,
  profileVersion: 3,
} as const

function publishedSnapshot(version: number, name: string) {
  return buildPortalPublicationSnapshot({
    id: `snapshot-version-${version}`,
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version,
    source: { ...source, portal: { ...source.portal, name } },
    destination,
    createdBy: 'manager-1',
    createdAt: new Date(NOW.getTime() - (3 - version) * 60_000),
  })
}

const staffPublicApi = (
  accessible: readonly PropertyId[] | null = null,
): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

function setup(
  options?: Readonly<{
    workingName?: string
    accessible?: PropertyId[]
    durablePending?: boolean
  }>,
) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const versionOne = publishedSnapshot(1, portal.name)
  const versionTwo = publishedSnapshot(2, 'Second published name')
  const listActivationHistoryPage = vi.fn<
    PortalPublicationRepository['listActivationHistoryPage']
  >(async () => {
    const records = [
      {
        activation: {
          id: 'activation-3',
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          snapshotId: versionOne.id,
          activationSequence: 3,
          kind: 'rollback',
          activatedBy: 'manager-2',
          activatedAt: NOW,
          deactivatedAt: null,
          deactivationReason: null,
        },
        snapshot: versionOne,
      },
      {
        activation: {
          id: 'activation-2',
          organizationId: portal.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          snapshotId: versionTwo.id,
          activationSequence: 2,
          kind: 'publish',
          activatedBy: 'manager-1',
          activatedAt: new Date(NOW.getTime() - 60_000),
          deactivatedAt: NOW,
          deactivationReason: 'replaced',
        },
        snapshot: versionTwo,
      },
    ] as const
    return {
      records,
      latest: records[0],
      current: records[0],
      nextCursor: 1,
    }
  })
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...source,
      portal: { ...source.portal, name: options?.workingName ?? portal.name },
    })),
    listActivationHistoryPage,
    listOpenPendingContentChanges: vi.fn(async () =>
      options?.durablePending
        ? [
            {
              kind: 'property_brand_content' as const,
              key: 'bg',
              sourceVersion: 'v2',
              changedAt: NOW,
            },
          ]
        : [],
    ),
  } as unknown as PortalPublicationRepository
  return {
    useCase: getPortalPublicationHistory({
      portalRepo,
      publicationRepo,
      staffPublicApi: staffPublicApi(options?.accessible ?? null),
    }),
    publicationRepo,
    listActivationHistoryPage,
  }
}

function setupLocalized(options?: Readonly<{ workingDisplayName?: string }>) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const publishedSource = { ...source, experience: localizedExperience }
  const snapshot = buildPortalPublicationSnapshot({
    id: 'localized-snapshot-version-1',
    portalId: portal.id,
    organizationId: portal.organizationId,
    propertyId: portal.propertyId,
    version: 1,
    source: publishedSource,
    destination,
    createdBy: 'manager-1',
    createdAt: NOW,
  })
  const record = {
    activation: {
      id: 'localized-activation-1',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      snapshotId: snapshot.id,
      activationSequence: 1,
      kind: 'publish' as const,
      activatedBy: 'manager-1',
      activatedAt: NOW,
      deactivatedAt: null,
      deactivationReason: null,
    },
    snapshot,
  }
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...publishedSource,
      experience: {
        ...localizedExperience,
        brandProfile: {
          ...localizedExperience.brandProfile,
          displayName:
            options?.workingDisplayName ?? localizedExperience.brandProfile.displayName,
        },
      },
    })),
    listActivationHistoryPage: vi.fn(async () => ({
      records: [record],
      latest: record,
      current: record,
      nextCursor: null,
    })),
  } as unknown as PortalPublicationRepository

  return getPortalPublicationHistory({
    portalRepo,
    publicationRepo,
    staffPublicApi: staffPublicApi(),
  })
}

describe('getPortalPublicationHistory', () => {
  it('returns the live rollback separately from earlier property-scoped activity', async () => {
    const harness = setup()

    await expect(harness.useCase({ portalId: portal.id }, ctx)).resolves.toEqual({
      current: {
        activationSequence: 3,
        version: 1,
        kind: 'rollback',
        activatedAt: NOW.toISOString(),
        deactivatedAt: null,
        deactivationReason: null,
      },
      priorActivations: [
        {
          activationSequence: 2,
          version: 2,
          kind: 'publish',
          activatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          deactivatedAt: NOW.toISOString(),
          deactivationReason: 'replaced',
        },
      ],
      hasPendingChanges: false,
      pendingChanges: [],
      nextCursor: 1,
    })
    expect(harness.listActivationHistoryPage).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { beforeSequence: null, limit: 20 },
    )
  })

  it('passes a bounded exclusive cursor to the repository', async () => {
    const harness = setup()

    await harness.useCase({ portalId: portal.id, cursor: 2, limit: 1 }, ctx)

    expect(harness.listActivationHistoryPage).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
      { beforeSequence: 2, limit: 1 },
    )
  })

  it('marks saved content as pending when it differs from the live rollback', async () => {
    const harness = setup({ workingName: 'A saved name for the next publication' })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(true)
    expect(result.current).toMatchObject({ version: 1, kind: 'rollback' })
  })

  it('surfaces a durable pending change even when the resolved content still matches', async () => {
    const harness = setup({ durablePending: true })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result).toMatchObject({
      hasPendingChanges: true,
      pendingChanges: [
        {
          kind: 'property_brand_content',
          key: 'bg',
          changedAt: NOW.toISOString(),
        },
      ],
    })
  })

  it('does not mark an identical localized experience as pending', async () => {
    const useCase = setupLocalized()

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(false)
  })

  it('marks a changed Property brand profile as pending', async () => {
    const useCase = setupLocalized({ workingDisplayName: 'Updated Example Hotel' })

    const result = await useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(true)
  })

  it('checks property access before reading publication content', async () => {
    const harness = setup({ accessible: [] })
    const propertyManager = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      harness.useCase({ portalId: portal.id }, propertyManager),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopy).not.toHaveBeenCalled()
    expect(harness.listActivationHistoryPage).not.toHaveBeenCalled()
  })
})
