import { describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { portalGroupId, propertyId, type PropertyId } from '#/shared/domain/ids'
import { isPortalError } from '../../domain/errors'
import {
  completeContentReview,
  type PortalWorkflowFactCommand,
} from './complete-content-review'

const now = new Date('2026-08-09T12:00:00.000Z')
const accessible = (ids: readonly PropertyId[]): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => ids,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

function setup(
  options: { published?: boolean; accessibleIds?: readonly PropertyId[] } = {},
) {
  const portalRepo = createInMemoryPortalRepo()
  const portal = buildTestPortal({
    id: '22222222-2222-4222-8222-222222222222',
    propertyId: propertyId('11111111-1111-4111-8111-111111111111'),
    publicationState: options.published === false ? 'draft' : 'published',
  })
  portalRepo.seed([portal])
  const commands: PortalWorkflowFactCommand[] = []
  const factStore = {
    recordCompletedReview: vi.fn(async (command: PortalWorkflowFactCommand) => {
      commands.push(command)
      return { status: 'recorded' as const, events: [] }
    }),
  }
  const groupId = portalGroupId('33333333-3333-4333-8333-333333333333')
  const useCase = completeContentReview({
    portalRepo,
    staffPublicApi: accessible(options.accessibleIds ?? [portal.propertyId]),
    portalGroupLookup: {
      findGroupForPortal: vi.fn(async () => ({
        id: groupId,
        propertyId: portal.propertyId,
        name: 'Front desk',
      })),
    },
    factStore,
    clock: () => now,
  })
  return { useCase, commands, portal, groupId, factStore }
}

describe('completeContentReview', () => {
  it('records an exact occurrence-time Portal workflow command', async () => {
    const { useCase, commands, portal, groupId } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ portalId: portal.id, reviewId: 'review-1', revision: 1 }, ctx)

    expect(commands).toEqual([
      {
        organizationId: ctx.organizationId,
        propertyId: portal.propertyId,
        portalId: portal.id,
        portalGroupId: groupId,
        reviewId: 'review-1',
        revision: 1,
        supersedes: null,
        occurredAt: now,
      },
    ])
  })

  it('passes complete correction lineage without creating an unrelated review', async () => {
    const { useCase, commands, portal } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase(
      {
        portalId: portal.id,
        reviewId: 'review-1',
        revision: 2,
        supersedes: {
          contentReviewSourceEventId: 'old-review',
          configurationSourceEventId: 'old-config',
          destinationRatioSourceEventId: 'old-ratio',
        },
      },
      ctx,
    )

    expect(commands[0]).toMatchObject({
      reviewId: 'review-1',
      revision: 2,
      supersedes: {
        contentReviewSourceEventId: 'old-review',
        configurationSourceEventId: 'old-config',
        destinationRatioSourceEventId: 'old-ratio',
      },
    })
  })

  it('rejects cross-property access before recording any fact', async () => {
    const { useCase, portal, factStore } = setup({ accessibleIds: [] })
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ portalId: portal.id, reviewId: 'review-1', revision: 1 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'forbidden',
    )
    expect(factStore.recordCompletedReview).not.toHaveBeenCalled()
  })

  it('rejects review completion for non-published content', async () => {
    const { useCase, portal, factStore } = setup({ published: false })
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ portalId: portal.id, reviewId: 'review-1', revision: 1 }, ctx),
    ).rejects.toSatisfy(
      (error: unknown) =>
        isPortalError(error) && error.code === 'invalid_publication_transition',
    )
    expect(factStore.recordCompletedReview).not.toHaveBeenCalled()
  })
})
