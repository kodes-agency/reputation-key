// The print download's pictures over real PostgreSQL and two Organizations: the
// checked bytes and the focal point are read before the audited reveal of the
// address (a row in the downloads table), a picture that is missing, changed or
// larger than its row says costs no disclosure, and a picture taken down since
// the working copy was read is left off while the live address is still revealed.

import { describe, expect, it } from 'vitest'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { getDb } from '#/shared/db'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { revealPortalAddress } from '../application/use-cases/reveal-portal-address'
import { createPortalAddressRepository } from '../infrastructure/repositories/portal-address.repository'
import { createPortalMediaAssetRepository } from '../infrastructure/repositories/portal-media-asset.repository'
import { createPortalRepository } from '../infrastructure/repositories/portal.repository'
import {
  BASE_URL,
  LOGO_ASSET,
  PRINT_KIT_INTEGRATION_TABLES,
  PRINT_ORIGIN,
  printKitCipher,
  seedPrintKitCode,
  sha256Hex,
  storePrintKitPicture,
} from '../infrastructure/print-kit/__fixtures__/print-kit-live-seed'
import { testPortalTokenCodec } from '../infrastructure/testing/portal-token-codec-fixture'
import { seedPortalWorkingCopy } from '../infrastructure/testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../infrastructure/testing/portal-working-copy-scenarios'
import { readPicturesThenReveal } from './print-download.server'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: PRINT_KIT_INTEGRATION_TABLES,
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

async function setup() {
  const pool = getPool()
  await seedPortalWorkingCopy(pool, COMPLETE_SCENARIO)
  await seedPrintKitCode(pool, true)
  const objectStore = createInMemoryObjectStore()
  await storePrintKitPicture(pool, objectStore, SCENARIO_HERO_ASSET, {
    width: 1600,
    height: 1000,
  })
  await storePrintKitPicture(
    pool,
    objectStore,
    LOGO_ASSET,
    { width: 480, height: 120 },
    '#aa5544',
  )
  const db = getDb()
  const mediaRepo = createPortalMediaAssetRepository(db)
  const deps = {
    mediaRepo,
    objectStore,
    sha256Hex,
    revealAddress: revealPortalAddress({
      portalRepo: createPortalRepository(db),
      staffPublicApi,
      portalAddressRepo: createPortalAddressRepository(db),
      addressCipher: printKitCipher,
      tokenCodec: testPortalTokenCodec(),
      reportPrintCodeProblem: () => undefined,
      clock: () => new Date('2026-10-25T10:00:00Z'),
      address: { appOrigin: BASE_URL, printOrigin: PRINT_ORIGIN },
    }),
  }
  const ctx = buildTestAuthContext({ organizationId: WORKING_COPY_ORG })
  const look = {
    hero: {
      assetId: SCENARIO_HERO_ASSET,
      width: 1600,
      height: 1000,
      focalX: 0.4,
      focalY: 0.6,
    },
    logo: { assetId: LOGO_ASSET },
  }
  const scope = {
    organizationId: ctx.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId as never,
  }
  const read = (chosen = look) =>
    readPicturesThenReveal(deps, chosen, scope, ctx, {
      portalId: COMPLETE_SCENARIO.portalId,
    })
  const stored = async (assetId: string) => {
    const asset = await mediaRepo.findById(
      ctx.organizationId,
      portalMediaAssetId(assetId),
    )
    if (!asset) throw new Error('the seeded picture is missing')
    return asset
  }
  return { deps, read, stored, ctx, look, scope }
}

const downloads = async () =>
  (await getPool().query('SELECT purpose FROM portal_address_downloads')).rows

describe.sequential('print download pictures (real PostgreSQL)', () => {
  it('reads the checked media bytes and focal point before the audited download reveal', async () => {
    const { read, deps } = await setup()
    const hero = await deps.objectStore.getObject(
      `portal-media/${SCENARIO_HERO_ASSET}.webp`,
      1 << 24,
    )
    const logo = await deps.objectStore.getObject(
      `portal-media/${LOGO_ASSET}.webp`,
      1 << 24,
    )

    const result = await read()

    expect(result).toEqual({
      photo: { bytes: hero?.body, focalX: 0.4, focalY: 0.6 },
      logo: logo?.body,
      qrAddress: expect.stringMatching(/^HTTPS:\/\/AP\.EXAMPLE\.TEST\/p\/[0-9A-Z]{20}$/u),
    })
    expect(await downloads()).toEqual([{ purpose: 'download' }])
  })

  it.each(['missing', 'changed', 'oversized'] as const)(
    'refuses a %s object before disclosing the address',
    async (fault) => {
      const { deps, read, stored } = await setup()
      const hero = await stored(SCENARIO_HERO_ASSET)
      if (fault === 'missing') await deps.objectStore.deleteObject(hero.objectKey)
      if (fault === 'changed') {
        await deps.objectStore.putObject(
          hero.objectKey,
          Buffer.alloc(hero.byteSize, 7),
          'image/webp',
        )
      }
      if (fault === 'oversized') {
        await deps.objectStore.putObject(
          hero.objectKey,
          Buffer.alloc(hero.byteSize + 1, 7),
          'image/webp',
        )
      }

      await expect(read()).rejects.toMatchObject({ code: 'media_not_found' })

      expect(await downloads()).toEqual([])
    },
  )

  it('omits a taken-down picture and still reveals the live address', async () => {
    const { deps, read, ctx } = await setup()
    const logo = await deps.objectStore.getObject(
      `portal-media/${LOGO_ASSET}.webp`,
      1 << 24,
    )
    await deps.mediaRepo.markTakenDown(
      ctx.organizationId,
      portalMediaAssetId(SCENARIO_HERO_ASSET),
      new Date(),
    )

    expect(await read()).toMatchObject({
      photo: null,
      logo: logo?.body,
      qrAddress: expect.stringMatching(/^HTTPS:\/\/AP\./u),
    })
    expect(await downloads()).toEqual([{ purpose: 'download' }])
  })

  it('reads no picture of another Organization and reveals nothing to it', async () => {
    const { deps, look, scope } = await setup()
    const stranger = buildTestAuthContext({ organizationId: WORKING_COPY_OTHER_ORG })

    await expect(
      readPicturesThenReveal(
        deps,
        look,
        { ...scope, organizationId: stranger.organizationId },
        stranger,
        { portalId: COMPLETE_SCENARIO.portalId },
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })

    expect(await downloads()).toEqual([])
  })
})
