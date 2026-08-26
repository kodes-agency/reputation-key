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
  countAssignmentsByTeam: async () => 0,
})

function setup(options?: Readonly<{ workingName?: string; accessible?: PropertyId[] }>) {
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const versionOne = publishedSnapshot(1, portal.name)
  const versionTwo = publishedSnapshot(2, 'Second published name')
  const listActivationHistory = vi.fn<
    PortalPublicationRepository['listActivationHistory']
  >(async () => [
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
  ])
  const publicationRepo = {
    loadWorkingCopy: vi.fn(async () => ({
      ...source,
      portal: { ...source.portal, name: options?.workingName ?? portal.name },
    })),
    listActivationHistory,
  } as unknown as PortalPublicationRepository
  return {
    useCase: getPortalPublicationHistory({
      portalRepo,
      publicationRepo,
      staffPublicApi: staffPublicApi(options?.accessible ?? null),
    }),
    publicationRepo,
    listActivationHistory,
  }
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
    })
    expect(harness.listActivationHistory).toHaveBeenCalledWith(
      ctx.organizationId,
      portal.propertyId,
      portal.id,
    )
  })

  it('marks saved content as pending when it differs from the live rollback', async () => {
    const harness = setup({ workingName: 'A saved name for the next publication' })

    const result = await harness.useCase({ portalId: portal.id }, ctx)

    expect(result.hasPendingChanges).toBe(true)
    expect(result.current).toMatchObject({ version: 1, kind: 'rollback' })
  })

  it('checks property access before reading publication content', async () => {
    const harness = setup({ accessible: [] })
    const propertyManager = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      harness.useCase({ portalId: portal.id }, propertyManager),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(harness.publicationRepo.loadWorkingCopy).not.toHaveBeenCalled()
    expect(harness.listActivationHistory).not.toHaveBeenCalled()
  })
})
