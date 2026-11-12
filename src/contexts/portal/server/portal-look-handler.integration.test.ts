// Portal context — a Portal's own look server functions over PostgreSQL.
// The real createServerFn handlers run over the real look use cases and
// repositories. The session and the execution policy are other contexts'
// answers, so they are stood in for; what each save and each refusal leaves is
// asserted on the stored look.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { policyDenial } from '#/shared/testing/policy-denial'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import {
  savePortalLookColours as savePortalLookColoursUseCase,
  savePortalLookIdentity as savePortalLookIdentityUseCase,
} from '../application/use-cases/save-portal-look'
import { savePortalLookPhoto as savePortalLookPhotoUseCase } from '../application/use-cases/save-portal-photo'
import { createPortalLookRepository } from '../infrastructure/repositories/portal-look.repository'
import { createPortalMediaAssetRepository } from '../infrastructure/repositories/portal-media-asset.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import {
  MEDIA_EXPERIENCE_TABLES,
  seedBrandProfile,
  seedMediaAsset,
  seedMediaPortal,
  seedMediaProperty,
} from '../infrastructure/testing/portal-media-experience-seed'

const handlerWorld = vi.hoisted(() => ({
  actor: undefined as unknown,
  requireExecutionAllowed: vi.fn(),
  management: (): unknown => undefined,
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => handlerWorld.actor),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: handlerWorld.requireExecutionAllowed,
  getExecutionPolicy: vi.fn(),
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: { management: handlerWorld.management() },
  }),
}))

import {
  savePortalLookColours,
  savePortalLookIdentity,
  savePortalLookPhoto,
} from './portal-look'

const ORG_A = organizationId('org-portal-look-hndlr-000000001')
const ORG_B = organizationId('org-portal-look-hndlr-000000002')
const NOW = new Date('2026-10-26T12:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: MEDIA_EXPERIENCE_TABLES,
})

handlerWorld.management = () => {
  const deps = {
    portalRepo: createPortalRepository(getDb()),
    portalLookRepo: createPortalLookRepository(getDb()),
    mediaRepo: createPortalMediaAssetRepository(getDb()),
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    clock: () => NOW,
  }
  return {
    savePortalLookColours: savePortalLookColoursUseCase(deps),
    savePortalLookIdentity: savePortalLookIdentityUseCase(deps),
    savePortalLookPhoto: savePortalLookPhotoUseCase(deps),
  }
}

const overrideRow = async (portal: string) =>
  (
    await getPool().query(
      `SELECT photo_mode, hero_asset_id::text AS hero_asset_id, colours_mode,
              primary_color, identity_mode, wordmark
         FROM portal_look_overrides WHERE organization_id = $1 AND portal_id = $2`,
      [ORG_A, portal],
    )
  ).rows[0]

async function scene() {
  const property = await seedMediaProperty(getPool(), ORG_A)
  const portal = await seedMediaPortal(getPool(), ORG_A, property, {
    state: 'published',
    published: true,
    additionalLocales: ['bg'],
  })
  await seedBrandProfile(getPool(), ORG_A, property, {
    wordmark: 'AVELA',
    lookVersion: 4,
  })
  const hero = await seedMediaAsset(ORG_A, property, { purpose: 'hero' })
  return { property, portal, hero, target: { propertyId: property, portalId: portal } }
}

beforeEach(() => {
  handlerWorld.actor = buildTestAuthContext({
    role: 'AccountAdmin',
    organizationId: ORG_A,
  })
  handlerWorld.requireExecutionAllowed.mockReset()
  handlerWorld.requireExecutionAllowed.mockResolvedValue(undefined)
})

describe('a portal’s own look server functions (real PostgreSQL)', () => {
  it('saves the colours once the Property policy has been asked for portal.write', async () => {
    const { property, portal, target } = await scene()

    await withStartContext(() =>
      savePortalLookColours({
        data: { ...target, colours: { mode: 'own', accentColour: '#2f855a' } },
      }),
    )

    expect(await overrideRow(portal)).toMatchObject({
      colours_mode: 'own',
      primary_color: '#2F855A',
    })
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: handlerWorld.actor,
        action: 'portal.update',
        capability: 'portal.write',
        propertyId: property,
      }),
    )
  })

  it('saves the name and logo under the same policy question', async () => {
    const { portal, target } = await scene()

    await withStartContext(() =>
      savePortalLookIdentity({
        data: { ...target, identity: { mode: 'own', wordmark: 'Harbour' } },
      }),
    )

    expect(await overrideRow(portal)).toMatchObject({
      identity_mode: 'own',
      wordmark: 'Harbour',
    })
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'portal.update', capability: 'portal.write' }),
    )
  })

  it('asks for portal.write, not portal.upload, before pointing the portal at a photo', async () => {
    const { portal, hero, target } = await scene()

    await withStartContext(() =>
      savePortalLookPhoto({
        data: {
          ...target,
          photo: {
            mode: 'own',
            heroAssetId: hero.id,
            focalX: 0.5,
            focalY: 0.4,
            altTexts: [{ locale: 'en', text: 'Treatment room' }],
          },
        },
      }),
    )

    expect(await overrideRow(portal)).toMatchObject({
      photo_mode: 'own',
      hero_asset_id: hero.id,
    })
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith(
      expect.objectContaining({ capability: 'portal.write' }),
    )
  })

  it('carries a refusal of the use case out as a tagged error and stores nothing', async () => {
    const { property, portal } = await scene()

    await expect(
      withStartContext(() =>
        savePortalLookPhoto({
          data: { propertyId: property, portalId: randomUUID(), photo: { mode: 'none' } },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'PortalError',
      code: 'portal_not_found',
      status: 404,
    })

    expect(await overrideRow(portal)).toBeUndefined()
  })

  it('stores no look when the Property policy refuses', async () => {
    const { portal, target } = await scene()
    handlerWorld.requireExecutionAllowed.mockRejectedValue(
      policyDenial('capability_disabled'),
    )

    await expect(
      withStartContext(() =>
        savePortalLookColours({
          data: { ...target, colours: { mode: 'own', accentColour: '#2f855a' } },
        }),
      ),
    ).rejects.toMatchObject({
      _tag: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await overrideRow(portal)).toBeUndefined()
  })
})
