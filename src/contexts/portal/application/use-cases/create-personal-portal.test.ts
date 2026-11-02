import { portalGroupId } from '#/shared/domain/ids'
import { describe, expect, it } from 'vitest'
import { setupCreatePortal, PROPERTY } from '#/shared/testing/portal-create-setup'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import {
  createPersonalPortal,
  checkPersonalPortalSource,
  type CreatePersonalPortalDeps,
} from './create-personal-portal'
import { publicationSource } from '../../domain/__fixtures__/publication-source'
import { buildPortalPublicationSnapshot } from '../portal-publication-snapshot'

const ctx = buildTestAuthContext()
const reserved = '12345678-abcd-4000-8000-000000000001'
function setup() {
  const state = setupCreatePortal({ propertyLookVersion: 1 })
  const source = publicationSource()
  const snapshot = buildPortalPublicationSnapshot({
    id: 'snapshot',
    portalId: source.portal.id,
    organizationId: source.organizationId,
    propertyId: source.propertyId,
    version: 1,
    source,
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=harbor',
      retrievedAt: new Date(),
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: 'manager',
    createdAt: new Date(),
  })
  const deps = {
    ...state.optionsDeps,
    addressRecoverable: true,
    checkGroupTarget: async () => {},
    publicationRepo: {
      loadWorkingCopy: async () => source,
      findActiveForPortal: async () => snapshot,
    },
    experienceRepo: {
      ...state.optionsDeps.experienceRepo,
      getPropertyExperience: async () => ({
        profile: {
          ...(
            await (
              state.optionsDeps.experienceRepo
                .getPropertyExperience as CreatePersonalPortalDeps['experienceRepo']['getPropertyExperience']
            )(ctx.organizationId, PROPERTY)
          ).profile!,
          displayName: 'Harbor',
        },
        content: [],
      }),
    },
  }
  return { state, deps, source }
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
  const checkGroupTarget = async () => {
    throw Object.assign(new Error('End the goal first.'), {
      code: 'personal_portal_goal_locked',
    })
  }
  await expect(
    checkPersonalPortalSource({ ...deps, checkGroupTarget })(
      { propertyId: PROPERTY, portalGroupId: group },
      ctx,
    ),
  ).rejects.toMatchObject({ code: 'personal_portal_goal_locked' })
  expect(state.portalRepo.all()).toEqual([])
})
