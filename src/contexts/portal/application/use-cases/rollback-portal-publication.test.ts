import { describe, expect, it } from 'vitest'
import { rollbackPortalPublication } from './rollback-portal-publication'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'
import type { PortalPublicationRepository } from '../ports/portal-publication.repository'
import type { UpdatePortalCommand } from '../ports/portal-command-store.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const NOW = new Date('2026-08-26T12:00:00.000Z')
const portal = buildTestPortal({ publicationState: 'published' })
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
  uri: 'https://search.google.com/local/writereview?placeid=test',
  retrievedAt: NOW,
  sourceEpoch: 1,
  profileVersion: 1,
} as const
const versionOne = buildPortalPublicationSnapshot({
  id: 'snapshot-v1',
  portalId: portal.id,
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  version: 1,
  source,
  destination,
  createdBy: 'manager-1',
  createdAt: new Date(NOW.getTime() - 2_000),
})
const versionTwo = buildPortalPublicationSnapshot({
  id: 'snapshot-v2',
  portalId: portal.id,
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  version: 2,
  source: {
    ...source,
    portal: { ...source.portal, name: 'Current published name' },
  },
  destination,
  createdBy: 'manager-1',
  createdAt: new Date(NOW.getTime() - 1_000),
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

function setup(
  options: { targetExists?: boolean; state?: 'published' | 'disabled' } = {},
) {
  const portalRepo = createInMemoryPortalRepo()
  const seeded = { ...portal, publicationState: options.state ?? 'published' }
  portalRepo.seed([seeded])
  const events = createCapturingEventBus()
  const baseCommandStore = createInMemoryPortalCommandStore({ portalRepo, events })
  let command: UpdatePortalCommand | null = null
  const publicationRepo: PortalPublicationRepository = {
    loadWorkingCopy: async () => null,
    getCursor: async () => ({
      nextSnapshotVersion: 3,
      nextActivationSequence: 3,
    }),
    findSnapshotByVersion: async (_organizationId, _portalId, version) =>
      options.targetExists === false || version !== 1 ? null : versionOne,
    findActiveForPortal: async () => versionTwo,
    listActivationHistoryPage: async () => ({
      records: [],
      latest: null,
      current: null,
      nextCursor: null,
    }),
    resolveActiveByTokenDigest: async () => null,
  }
  const useCase = rollbackPortalPublication({
    portalRepo,
    publicationRepo,
    commandStore: {
      ...baseCommandStore,
      updatePortal: async (input) => {
        command = input
        await baseCommandStore.updatePortal(input)
      },
    },
    staffPublicApi,
    idGen: () => 'activation-rollback-3',
    clock: () => NOW,
  })
  return { useCase, command: () => command, portalRepo }
}

describe('rollbackPortalPublication', () => {
  it('appends an activation for an older immutable version', async () => {
    const harness = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      harness.useCase({ portalId: portal.id, version: 1 }, ctx),
    ).resolves.toEqual({
      snapshotId: 'snapshot-v1',
      version: 1,
      configurationDigest: versionOne.configurationDigest,
      activatedAt: NOW,
    })
    expect(harness.command()?.publication).toEqual({
      kind: 'rollback',
      snapshotId: 'snapshot-v1',
      snapshotVersion: 1,
      publicationDigest: versionOne.configurationDigest,
      activation: {
        id: 'activation-rollback-3',
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        snapshotId: 'snapshot-v1',
        activationSequence: 3,
        kind: 'rollback',
        activatedBy: ctx.userId,
        activatedAt: NOW,
        deactivatedAt: null,
        deactivationReason: null,
      },
    })
    expect(harness.command()?.lifecycleEvent).toMatchObject({
      _tag: 'portal.publication.rolled_back',
      organizationId: portal.organizationId,
      propertyId: portal.propertyId,
      portalId: portal.id,
      publicationSnapshotId: 'snapshot-v1',
      publicationVersion: 1,
      publicationDigest: versionOne.configurationDigest,
      userId: ctx.userId,
      sourceAggregateVersion: NOW.toISOString(),
      occurredAt: NOW,
    })
    expect(harness.portalRepo.all()[0].publicationState).toBe('published')
  })

  it('rejects a version outside the current tenant Portal', async () => {
    const harness = setup({ targetExists: false })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      harness.useCase({ portalId: portal.id, version: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(harness.command()).toBeNull()
  })

  it('never republishes a disabled Portal as a rollback side effect', async () => {
    const harness = setup({ state: 'disabled' })
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    await expect(
      harness.useCase({ portalId: portal.id, version: 1 }, ctx),
    ).rejects.toMatchObject({ code: 'invalid_publication_transition' })
    expect(harness.command()).toBeNull()
  })
})
