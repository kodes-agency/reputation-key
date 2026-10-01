// Portal context — create portal group with Portals that are in another group
// (create-with-move), and the history the group commands write.

import { describe, expect, it } from 'vitest'
import { createPortalGroup } from './create-portal-group'
import { updatePortalGroup } from './update-portal-group'
import { softDeletePortalGroup } from './soft-delete-portal-group'
import { addPortalToGroup } from './add-portal-to-group'
import { removePortalFromGroup } from './remove-portal-from-group'
import { createRecordedOutbox } from '#/shared/testing/recorded-outbox'
import { createInMemoryPortalCommandStore } from '#/shared/testing/in-memory-portal-command-store'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryPortalGroupRepo } from '#/shared/testing/in-memory-portal-group-repo'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { isPortalError } from '../../domain/errors'
import type { PortalGroupHistoryDraft } from '../../domain/portal-group-history'
import type { PortalGroup } from '../../domain/types'
import { portalGroupId, portalId, propertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { PropertyPublicApi } from '#/contexts/property/application/public-api'

const NOW = new Date('2026-09-30T10:00:00.000Z')
const EARLIER = new Date('2026-09-01T10:00:00.000Z')
const PROPERTY = propertyId('a0000000-0000-0000-0000-000000000001')
const OLD_A = portalGroupId('6f000000-0000-4000-8000-00000000000a')
const OLD_B = portalGroupId('6f000000-0000-4000-8000-00000000000b')
const NEW_GROUP = portalGroupId('6f000000-0000-4000-8000-0000000000ff')
const PORTAL_1 = portalId('d0000000-0000-0000-0000-000000000001')
const PORTAL_2 = portalId('d0000000-0000-0000-0000-000000000002')
const PORTAL_3 = portalId('d0000000-0000-0000-0000-000000000003')

const staffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}
const propertyApi = {
  propertyExists: async () => true,
} as unknown as PropertyPublicApi

function setup() {
  const ctx = buildTestAuthContext({ role: 'PropertyManager' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed(
    [PORTAL_1, PORTAL_2, PORTAL_3].map((id) =>
      buildTestPortal({ id, propertyId: PROPERTY, slug: `slug-${id.slice(-1)}` }),
    ),
  )
  const portalGroupRepo = createInMemoryPortalGroupRepo()
  const groupOf = (id: typeof OLD_A, name: string): PortalGroup => ({
    id,
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    name,
    sortKey: null,
    createdBy: null,
    createdAt: EARLIER,
    updatedAt: EARLIER,
    deletedAt: null,
  })
  portalGroupRepo.seed([groupOf(OLD_A, 'Old A'), groupOf(OLD_B, 'Old B')])
  const outbox = createRecordedOutbox()
  const history: PortalGroupHistoryDraft[] = []
  const commandStore = createInMemoryPortalCommandStore({
    portalRepo,
    portalGroupRepo,
    outbox,
    groupHistory: history,
  })
  const common = {
    portalGroupRepo,
    staffPublicApi: staffApi,
    commandStore,
    clock: () => NOW,
  }
  return {
    ctx,
    portalGroupRepo,
    outbox,
    history,
    create: createPortalGroup({
      ...common,
      portalRepo,
      propertyApi,
      idGen: () => NEW_GROUP,
    }),
    update: updatePortalGroup(common),
    archive: softDeletePortalGroup(common),
    add: addPortalToGroup({ ...common, portalRepo }),
    remove: removePortalFromGroup(common),
  }
}

describe('createPortalGroup with Portals that are already grouped', () => {
  it('moves them into the new group and ends their old memberships with moved_to_group', async () => {
    const { create, ctx, portalGroupRepo } = setup()
    portalGroupRepo.seedMembership(PORTAL_1, OLD_A, EARLIER)
    portalGroupRepo.seedMembership(PORTAL_2, OLD_B, EARLIER)

    await create(
      { name: 'New', propertyId: PROPERTY, portalIds: [PORTAL_1, PORTAL_2, PORTAL_3] },
      ctx,
    )

    const ended = portalGroupRepo.memberships().filter((m) => m.effectiveTo !== null)
    expect(ended.map((m) => [m.portalGroupId, m.endReason])).toEqual([
      [OLD_A, 'moved_to_group'],
      [OLD_B, 'moved_to_group'],
    ])
    expect(
      await portalGroupRepo.getGroupPortalIds(ctx.organizationId, NEW_GROUP),
    ).toHaveLength(3)
  })

  it('fences each old group once however many Portals leave it', async () => {
    const { create, ctx, portalGroupRepo, outbox } = setup()
    portalGroupRepo.seedMembership(PORTAL_1, OLD_A, EARLIER)
    portalGroupRepo.seedMembership(PORTAL_2, OLD_A, EARLIER)

    await create(
      { name: 'New', propertyId: PROPERTY, portalIds: [PORTAL_1, PORTAL_2] },
      ctx,
    )

    const removed = outbox.byTag('portal_group.portal_removed')
    expect(removed).toHaveLength(2)
    expect(new Set(removed.map((event) => event.sourceAggregateVersion)).size).toBe(1)
    const oldA = await portalGroupRepo.findById(ctx.organizationId, OLD_A)
    expect(oldA?.updatedAt).toEqual(NOW)
  })

  it('records who created the group and writes its history, moves included', async () => {
    const { create, ctx, portalGroupRepo, history } = setup()
    portalGroupRepo.seedMembership(PORTAL_1, OLD_A, EARLIER)

    const group = await create(
      { name: 'New', propertyId: PROPERTY, portalIds: [PORTAL_1, PORTAL_3] },
      ctx,
    )

    expect(group.createdBy).toBe(ctx.userId)
    expect(
      history.map((entry) => [entry.portalGroupId, entry.kind, entry.portalId]),
    ).toEqual([
      [NEW_GROUP, 'created', null],
      [OLD_A, 'portal_moved_out', PORTAL_1],
      [NEW_GROUP, 'portal_moved_in', PORTAL_1],
      [NEW_GROUP, 'portal_added', PORTAL_3],
    ])
    expect(history[0]).toMatchObject({ name: 'New', actorUserId: ctx.userId })
  })

  it('counts a Portal listed twice once', async () => {
    const { create, ctx, portalGroupRepo } = setup()
    portalGroupRepo.seedMembership(PORTAL_1, OLD_A, EARLIER)

    await create(
      { name: 'New', propertyId: PROPERTY, portalIds: [PORTAL_1, PORTAL_1] },
      ctx,
    )

    expect(
      await portalGroupRepo.getGroupPortalIds(ctx.organizationId, NEW_GROUP),
    ).toHaveLength(1)
  })

  it('refuses a Portal of another Property before anything is written', async () => {
    const { create, ctx, portalGroupRepo, outbox } = setup()

    await expect(
      create(
        {
          name: 'New',
          propertyId: 'a0000000-0000-0000-0000-0000000000ee',
          portalIds: [PORTAL_1],
        },
        ctx,
      ),
    ).rejects.toSatisfy((e: unknown) => isPortalError(e) && e.code === 'forbidden')
    expect(portalGroupRepo.all().map((group) => group.id)).not.toContain(NEW_GROUP)
    expect(outbox.facts).toHaveLength(0)
  })
})

describe('group history', () => {
  it('records a rename with the previous name, and nothing when the name is unchanged', async () => {
    const { update, ctx, history } = setup()

    await update({ portalGroupId: OLD_A, name: 'Renamed' }, ctx)
    await update({ portalGroupId: OLD_A, name: 'Renamed' }, ctx)

    expect(history).toEqual([
      expect.objectContaining({
        kind: 'renamed',
        portalGroupId: OLD_A,
        name: 'Renamed',
        previousName: 'Old A',
        actorUserId: ctx.userId,
      }),
    ])
  })

  it('records an archive, an addition and a removal with their actor', async () => {
    const { add, remove, archive, ctx, history } = setup()

    await add({ portalGroupId: OLD_A, portalId: PORTAL_1 }, ctx)
    await remove({ portalGroupId: OLD_A, portalId: PORTAL_1 }, ctx)
    await archive({ portalGroupId: OLD_A }, { ...ctx, role: 'AccountAdmin' })

    expect(history.map((entry) => [entry.kind, entry.actorUserId])).toEqual([
      ['portal_added', ctx.userId],
      ['portal_removed', ctx.userId],
      ['archived', ctx.userId],
    ])
  })
})
