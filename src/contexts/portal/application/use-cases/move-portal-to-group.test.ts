// Portal context — movePortalToGroup use case tests

import { describe, expect, it } from 'vitest'
import { movePortalToGroup } from './move-portal-to-group'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalGroupRepo } from '#/shared/testing/in-memory-portal-group-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalGroupHistoryDraft } from '../../domain/portal-group-history'
import type { PortalGroup } from '../../domain/types'
import {
  portalGroupId,
  propertyId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'

const NOW = new Date('2026-09-30T10:00:00.000Z')
const EARLIER = new Date('2026-09-01T10:00:00.000Z')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const OTHER_PROPERTY = propertyId('a0000000-0000-0000-0000-000000000002')
const GROUP_A = portalGroupId('6f000000-0000-4000-8000-000000000001')
const GROUP_B = portalGroupId('6f000000-0000-4000-8000-000000000002')
const GROUP_C = portalGroupId('6f000000-0000-4000-8000-000000000003')

const staffApi = (accessible: ReadonlyArray<PropertyId> | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const groupOf = (
  id: typeof GROUP_A,
  organizationId: OrganizationId,
  overrides: Partial<PortalGroup> = {},
): PortalGroup => ({
  id,
  organizationId,
  propertyId: PROPERTY,
  name: `Group ${id.slice(-1)}`,
  sortKey: null,
  createdBy: null,
  createdAt: EARLIER,
  updatedAt: EARLIER,
  deletedAt: null,
  ...overrides,
})

function setup(accessible: ReadonlyArray<PropertyId> | null = null) {
  const ctx = buildTestAuthContext({ role: 'PropertyManager' })
  const portalRepo = createInMemoryPortalRepo()
  const portal = buildTestPortal({ propertyId: PROPERTY })
  portalRepo.seed([portal])
  const portalGroupRepo = createInMemoryPortalGroupRepo()
  portalGroupRepo.seed([
    groupOf(GROUP_A, ctx.organizationId),
    groupOf(GROUP_B, ctx.organizationId),
    groupOf(GROUP_C, ctx.organizationId, { propertyId: OTHER_PROPERTY }),
  ])
  const outbox = createRecordedOutbox()
  const history: PortalGroupHistoryDraft[] = []
  const useCase = movePortalToGroup({
    portalGroupRepo,
    portalRepo,
    staffPublicApi: staffApi(accessible),
    commandStore: createInMemoryPortalCommandStore({
      portalRepo,
      portalGroupRepo,
      outbox,
      groupHistory: history,
    }),
    clock: () => NOW,
  })
  return { useCase, ctx, portal, portalGroupRepo, outbox, history }
}

const codeOf = (error: unknown): string | undefined =>
  isPortalError(error) ? error.code : undefined

describe('movePortalToGroup', () => {
  it('ends the old membership with moved_to_group and begins the new one', async () => {
    const { useCase, ctx, portal, portalGroupRepo } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_A, EARLIER)

    await useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx)

    expect(portalGroupRepo.memberships()).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP_A,
        effectiveTo: NOW,
        endReason: 'moved_to_group',
      }),
      expect.objectContaining({
        portalGroupId: GROUP_B,
        effectiveFrom: NOW,
        effectiveTo: null,
        createdBy: ctx.userId,
      }),
    ])
    expect(
      await portalGroupRepo.findPortalMembership(ctx.organizationId, portal.id),
    ).toBe(GROUP_B)
  })

  it('records a removal fact for the old group and an addition for the new, by identifier', async () => {
    const { useCase, ctx, portal, portalGroupRepo, outbox } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_A, EARLIER)

    await useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx)

    expect(outbox.byTag('portal_group.portal_removed')).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP_A,
        portalId: portal.id,
        propertyId: PROPERTY,
      }),
    ])
    expect(outbox.byTag('portal_group.portal_added')).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP_B,
        portalId: portal.id,
        propertyId: PROPERTY,
      }),
    ])
  })

  it('advances the revision of both groups past what it read', async () => {
    const { useCase, ctx, portal, portalGroupRepo } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_A, EARLIER)

    await useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx)

    const revisions = portalGroupRepo.all().map((group) => [group.id, group.updatedAt])
    expect(revisions).toContainEqual([GROUP_A, NOW])
    expect(revisions).toContainEqual([GROUP_B, NOW])
  })

  it('writes history on both sides of the move, naming the actor and the other group', async () => {
    const { useCase, ctx, portal, portalGroupRepo, history } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_A, EARLIER)

    await useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx)

    expect(history).toEqual([
      expect.objectContaining({
        portalGroupId: GROUP_A,
        kind: 'portal_moved_out',
        otherGroupId: GROUP_B,
        portalId: portal.id,
        actorUserId: ctx.userId,
        occurredAt: NOW,
      }),
      expect.objectContaining({
        portalGroupId: GROUP_B,
        kind: 'portal_moved_in',
        otherGroupId: GROUP_A,
        portalId: portal.id,
      }),
    ])
  })

  it('is a plain addition when the Portal has no group', async () => {
    const { useCase, ctx, portal, portalGroupRepo, outbox, history } = setup()

    await useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx)

    expect(portalGroupRepo.memberships()).toHaveLength(1)
    expect(outbox.byTag('portal_group.portal_removed')).toHaveLength(0)
    expect(outbox.byTag('portal_group.portal_added')).toHaveLength(1)
    expect(history.map((entry) => entry.kind)).toEqual(['portal_added'])
  })

  it('refuses a Portal that is already in the target group', async () => {
    const { useCase, ctx, portal, portalGroupRepo, outbox } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_B, EARLIER)

    await expect(
      useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_already_grouped')
    expect(outbox.facts).toHaveLength(0)
  })

  it('refuses a group in another Property and leaves the membership alone', async () => {
    const { useCase, ctx, portal, portalGroupRepo } = setup()
    portalGroupRepo.seedMembership(portal.id, GROUP_A, EARLIER)

    await expect(
      useCase({ portalGroupId: GROUP_C, portalId: portal.id }, ctx),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
    expect(
      await portalGroupRepo.findPortalMembership(ctx.organizationId, portal.id),
    ).toBe(GROUP_A)
  })

  it('refuses a missing group and a missing Portal', async () => {
    const { useCase, ctx, portal } = setup()

    await expect(
      useCase({ portalGroupId: 'missing-group', portalId: portal.id }, ctx),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'group_not_found')
    await expect(
      useCase({ portalGroupId: GROUP_B, portalId: 'missing-portal' }, ctx),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'portal_not_found')
  })

  it('refuses a role that cannot update Portals', async () => {
    const { useCase, portal } = setup()

    await expect(
      useCase(
        { portalGroupId: GROUP_B, portalId: portal.id },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    const { useCase, ctx, portal } = setup([])

    await expect(
      useCase({ portalGroupId: GROUP_B, portalId: portal.id }, ctx),
    ).rejects.toSatisfy((e: unknown) => codeOf(e) === 'forbidden')
  })
})
