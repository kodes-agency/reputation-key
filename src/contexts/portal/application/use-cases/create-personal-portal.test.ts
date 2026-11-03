import { buildPersonalPortalUseCases } from '../../build-personal-portals'
import { assertPersonalPropertySource } from '../personal-portal-property-source'
import { portalGroupId } from '#/shared/domain/ids'
import { describe, expect, it, vi } from 'vitest'
import { PROPERTY } from '#/shared/testing/portal-create-setup'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createPersonalPortal, checkPersonalPortalSource } from './create-personal-portal'
import { ctx, reserved, setup } from '#/shared/testing/personal-portal-setup'

const goalLocked = () =>
  vi.fn(async () => {
    throw Object.assign(new Error('End the goal first.'), {
      code: 'personal_portal_goal_locked',
    })
  })

function seedGroup(state: ReturnType<typeof setup>['state']) {
  const group = portalGroupId('12345678-abcd-4000-8000-000000000002')
  state.portalGroupRepo.seed({
    id: group,
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    name: 'Desk',
    sortKey: 'a',
    createdBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  })
  return group
}

describe('createPersonalPortal', () => {
  it('authorizes an idempotent retry before returning its reserved Portal', async () => {
    const { deps, state } = setup()
    state.portalRepo.seed([
      buildTestPortal({ id: reserved, kind: 'personal', publicName: 'Harbor' }),
    ])
    await expect(
      createPersonalPortal(deps)(
        { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
        buildTestAuthContext({ role: 'Member' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await expect(
      createPersonalPortal({
        ...deps,
        staffPublicApi: {
          ...deps.staffPublicApi,
          getAccessiblePropertyIds: async () => [],
        },
      })(
        { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
        buildTestAuthContext({ role: 'PropertyManager' }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })
  it('starts from the Property with a reserved id, fixed guest name and opaque slug', async () => {
    const { deps, state } = setup()
    const create = createPersonalPortal(deps)
    const portal = await create(
      { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
      ctx,
    )
    expect(portal).toMatchObject({
      id: reserved,
      name: 'Polly Smith',
      publicName: 'Harbor',
      kind: 'personal',
      slug: 'portal-12345678',
    })
    expect(
      (
        await create(
          { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
          ctx,
        )
      ).id,
    ).toBe(reserved)
    expect(state.portalRepo.all()).toHaveLength(1)
  })
  it('refuses preflight without address recovery before creating a Portal', async () => {
    const { deps, state } = setup()
    await expect(
      createPersonalPortal({ ...deps, addressRecoverable: false })(
        { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'address_keyring_missing' })
    expect(state.portalRepo.all()).toHaveLength(0)
  })
  // Publishing runs these two gates first. A check that passes here and a publish
  // that refuses would leave a person with a draft Portal and "Setup didn't finish".
  it('refuses a Property without a verified Google destination before creating a Portal', async () => {
    const { deps, state } = setup()
    const unverified = {
      ...deps,
      propertyGoogleReviewDestinationApi: {
        getGoogleReviewDestination: async () => null,
      },
    }
    await expect(
      checkPersonalPortalSource(unverified)({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    await expect(
      createPersonalPortal(unverified)(
        { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
    expect(state.portalRepo.all()).toHaveLength(0)
  })
  it('refuses an unavailable Property before creating a Portal', async () => {
    const { deps, state } = setup()
    const unavailable = {
      ...deps,
      propertyLifecycleApi: { isPropertyActive: async () => false },
    }
    await expect(
      checkPersonalPortalSource(unavailable)({ propertyId: PROPERTY }, ctx),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
    await expect(
      createPersonalPortal(unavailable)(
        { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly Smith' },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'portal_inactive' })
    expect(state.portalRepo.all()).toHaveLength(0)
  })
  it('asks the same two gates of a copy from another Portal', async () => {
    const { deps, state, source } = setup()
    state.portalRepo.seed([
      { ...buildTestPortal(), id: source.portal.id, propertyId: PROPERTY },
    ] as never)
    await expect(
      checkPersonalPortalSource({
        ...deps,
        propertyGoogleReviewDestinationApi: {
          getGoogleReviewDestination: async () => null,
        },
      })({ propertyId: PROPERTY, sourcePortalId: source.portal.id }, ctx),
    ).rejects.toMatchObject({ code: 'google_review_destination_unavailable' })
  })
  it('refuses an archived copy source', async () => {
    const { deps, state } = setup()
    const source = buildTestPortal({ publicationState: 'archived' })
    state.portalRepo.seed([source])
    await expect(
      checkPersonalPortalSource(deps)(
        { propertyId: PROPERTY, sourcePortalId: source.id },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'source_archived' })
  })
  it('refuses a source whose working copy differs from its published snapshot', async () => {
    const { deps, state, source } = setup()
    const portal = buildTestPortal()
    state.portalRepo.seed([portal])
    await expect(
      checkPersonalPortalSource({
        ...deps,
        publicationRepo: {
          ...deps.publicationRepo,
          loadWorkingCopy: async () => ({
            ...source,
            linktreeEnabled: !source.linktreeEnabled,
          }),
        },
      })({ propertyId: PROPERTY, sourcePortalId: portal.id }, ctx),
    ).rejects.toMatchObject({ code: 'source_has_unpublished_changes' })
  })
})

it('checks a running Group rating target before creating a personal Portal', async () => {
  const { deps, state } = setup()
  const group = seedGroup(state)
  const checkGroupTarget = goalLocked()
  await expect(
    checkPersonalPortalSource({ ...deps, checkGroupTarget })(
      { propertyId: PROPERTY, portalGroupId: group },
      ctx,
    ),
  ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
  expect(checkGroupTarget).toHaveBeenCalledWith(
    expect.objectContaining({ skipsPrivateRating: false }),
  )
  expect(state.portalRepo.all()).toEqual([])
})

it('checks a Group target with the skip setting the copy would inherit', async () => {
  const { deps, state } = setup()
  const group = seedGroup(state)
  const portal = buildTestPortal({ skipPrivateRating: true })
  state.portalRepo.seed([portal])
  const checkGroupTarget = goalLocked()
  await expect(
    checkPersonalPortalSource({ ...deps, checkGroupTarget })(
      { propertyId: PROPERTY, portalGroupId: group, sourcePortalId: portal.id },
      ctx,
    ),
  ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
  expect(checkGroupTarget).toHaveBeenCalledWith(
    expect.objectContaining({ skipsPrivateRating: true }),
  )
})

it('refuses missing guest wording before creating a Portal', async () => {
  const { deps, state } = setup()
  const empty = {
    ...deps,
    experienceRepo: {
      ...deps.experienceRepo,
      getPropertyExperience: async () => ({
        ...(await deps.experienceRepo.getPropertyExperience()),
        content: [],
      }),
    },
  }
  await expect(
    createPersonalPortal(empty)(
      { portalId: reserved, propertyId: PROPERTY, displayName: 'Polly' },
      ctx,
    ),
  ).rejects.toMatchObject({ code: 'guest_wording_missing' })
  expect(state.portalRepo.all()).toEqual([])
})
it('uses the publication time zone blocker before a write', async () => {
  const { deps } = setup()
  await expect(
    assertPersonalPropertySource(
      {
        ...deps,
        propertyApi: {
          ...deps.propertyApi,
          getPropertyTimezones: async () => [{ id: PROPERTY, timezone: 'Invalid/Zone' }],
        },
      },
      ctx,
      PROPERTY,
    ),
  ).rejects.toMatchObject({ code: 'time_zone_invalid' })
})

it('inherits eligible responsible managers from the copied Portal', async () => {
  const { deps, state, source } = setup()
  const portal = buildTestPortal({
    id: source.portal.id,
    propertyId: PROPERTY,
    publicationState: 'published',
  })
  state.portalRepo.seed([portal])
  const userId = 'source-manager'
  const assigned = ['source-manager', 'departed-manager'].map((id) => ({
    id,
    organizationId: ctx.organizationId,
    propertyId: PROPERTY,
    portalId: portal.id,
    userId: id,
    effectiveFrom: new Date(),
    effectiveTo: null,
    createdBy: ctx.userId,
    endReason: null,
  }))
  const command = vi.fn(deps.commandStore.createPortal)
  await createPersonalPortal({
    ...deps,
    commandStore: { ...deps.commandStore, createPortal: command },
    managerRepo: { listActive: async () => assigned },
    identityPublicApi: {
      listActiveManagers: async () => [
        { userId, role: 'AccountAdmin', propertyAccessScope: 'organization' },
      ],
    },
  })(
    {
      portalId: reserved,
      propertyId: PROPERTY,
      displayName: 'Polly Smith',
      sourcePortalId: portal.id,
    },
    ctx,
  )
  expect(command.mock.calls[0]?.[0].initialResponsibleManagerIds).toEqual([userId])
})
it('falls back to the eligible creator when the source has no eligible managers', async () => {
  const { deps, state, source } = setup()
  const portal = buildTestPortal({
    id: source.portal.id,
    propertyId: PROPERTY,
    publicationState: 'published',
  })
  state.portalRepo.seed([portal])
  const command = vi.fn(deps.commandStore.createPortal)
  await createPersonalPortal({
    ...deps,
    commandStore: { ...deps.commandStore, createPortal: command },
  })(
    {
      portalId: reserved,
      propertyId: PROPERTY,
      displayName: 'Polly Smith',
      sourcePortalId: portal.id,
    },
    ctx,
  )
  expect(command.mock.calls[0]?.[0].initialResponsibleManagerIds).toEqual([ctx.userId])
})
it.each([
  ['Welcome back', true],
  ['Ask Polly about your visit', false],
])('copies safe saved print wording (%s)', async (headline, copied) => {
  const { deps, state, source } = setup()
  const portal = buildTestPortal({
    id: source.portal.id,
    propertyId: PROPERTY,
    publicationState: 'published',
  })
  state.portalRepo.seed([portal])
  const wording = {
    callToAction: 'how_did_we_do' as const,
    customWords: { en: { headline, subline: '' } },
  }
  const command = vi.fn(deps.commandStore.createPortal)
  await createPersonalPortal({
    ...deps,
    commandStore: { ...deps.commandStore, createPortal: command },
    printWordingRepo: { find: async () => wording },
  })(
    {
      portalId: reserved,
      propertyId: PROPERTY,
      displayName: 'Polly Smith',
      sourcePortalId: portal.id,
    },
    ctx,
  )
  expect(command.mock.calls[0]?.[0].personalPrintWording).toEqual(
    copied ? wording : undefined,
  )
})

it('wires the same preflight through the Portal management builder', async () => {
  const { deps } = setup()
  await expect(
    buildPersonalPortalUseCases(
      { ...deps, addressRecoverable: false },
      {} as never,
    ).checkPersonalPortalSource({ propertyId: PROPERTY }, ctx),
  ).rejects.toMatchObject({ code: 'address_keyring_missing' })
})
