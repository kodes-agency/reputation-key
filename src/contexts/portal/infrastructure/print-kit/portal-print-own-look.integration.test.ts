// A Portal's own look and the print kit, over real PostgreSQL (ADR 0070).
//
// A print is permanent and its code opens the live page, so it is made of the
// Portal's live version and of nothing else: not of the Property's look as it is
// now, and not of an own look that has not been published. These tests give two
// Portals of one Property looks of their own and prove it from the outside:
// each Portal prints its own palette, photo and logo, and a Portal whose own
// look is saved but not published still prints the look it has live.
//
// The live versions are seeded as a publication writes them (the effective look
// in `brandProfile`), and the own looks as rows, so this proves the print kit
// reads only the snapshot without depending on the writers or the reader.

import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { getDb } from '#/shared/db'
import { portalId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { DownloadPortalPrintFinalInput } from '../../application/dto/portal-print-final.dto'
import type { PortalPrintFinalRenderer } from '../../application/ports/portal-print-final-renderer.port'
import { createPortalPrintFinal } from '../../application/use-cases/create-portal-print-final'
import { getPortalPrintKit } from '../../application/use-cases/get-portal-print-kit'
import { revealPortalAddress } from '../../application/use-cases/reveal-portal-address'
import { testPortalTokenCodec } from '../testing/portal-token-codec-fixture'
import { createPortalAddressRepository } from '../repositories/portal-address.repository'
import { createPortalLastPrintRepository } from '../repositories/portal-last-print.repository'
import { createPortalPrintWordingRepository } from '../repositories/portal-print-wording.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalRepository } from '../repositories/portal.repository'
import { seedLiveImmersiveSnapshot } from '../testing/portal-live-immersive-seed'
import { seedPortalWorkingCopy } from '../testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../testing/portal-working-copy-scenarios'
import {
  BASE_URL,
  LOGO_ASSET,
  PRINT_KIT_INTEGRATION_TABLES,
  PRINT_ORIGIN,
  printKitCipher,
  printKitLiveConfiguration,
  seedPrintKitCode,
  sha256Hex,
  storePrintKitPicture,
  type PrintKitCodeSeed,
} from './__fixtures__/print-kit-live-seed'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'
import { createPropertyCountryReader } from './print-kit-property-country'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: PRINT_KIT_INTEGRATION_TABLES,
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

/** The second Portal of the scenario's Property: the Spa, with a look of its own. */
const SPA_PORTAL = portalId('c2000000-0000-4000-8000-0000000000a1')
const SPA_HERO_ASSET = 'c5000000-0000-4000-8000-0000000000a1'
const SPA_LOGO_ASSET = 'c5000000-0000-4000-8000-0000000000a2'
const SPA_CODE: PrintKitCodeSeed = {
  portalId: SPA_PORTAL,
  tokenId: 'c6000000-0000-4000-8000-0000000000a1',
  rawToken: `pt_CCCCCCCCCCCCCCCC_${'d'.repeat(43)}`,
  qrMarker: 'c7000000-0000-4000-8000-0000000000a1',
  nfcMarker: 'c7000000-0000-4000-8000-0000000000a2',
}

/** The Spa's own colours: what its publication wrote into `brandProfile`. */
const SPA_ACCENT = '#B8860B'
const SPA_FIELD = '#0F2A2E'
/** What the Lobby portal publishes: the Property look, from `printKitLiveConfiguration`. */
const PROPERTY_ACCENT = '#C8A45A'
const PROPERTY_FIELD = '#14110F'

/** The Spa's own look, as a row: photo, colours, and name and logo. */
const insertSpaLook = (portal: string) =>
  getPool().query(
    `INSERT INTO portal_look_overrides (
       id, organization_id, property_id, portal_id, photo_mode, hero_asset_id,
       hero_focal_x, hero_focal_y, hero_alt_texts, colours_mode, primary_color,
       background_mode, background_color, identity_mode, wordmark, logo_asset_id,
       look_version, updated_by
     ) VALUES (gen_random_uuid(), $1, $2, $3, 'own', $4, 0.6, 0.2,
               '{"en": "The spa pool"}'::jsonb, 'own', $5, 'manual', $6, 'own', 'SPA', $7,
               5, 'seed-admin')`,
    [
      COMPLETE_SCENARIO.organizationId,
      COMPLETE_SCENARIO.propertyId,
      portal,
      SPA_HERO_ASSET,
      SPA_ACCENT,
      SPA_FIELD,
      SPA_LOGO_ASSET,
    ],
  )

async function seedSpa(): Promise<void> {
  const pool = getPool()
  const { organizationId, propertyId } = COMPLETE_SCENARIO
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id,
                          name, slug, theme, publication_state, primary_guest_locale,
                          additional_guest_locales)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'Spa', 'spa-own-look',
             '{"primaryColor":"#123456"}'::jsonb, 'published', 'bg', '["en"]'::jsonb)`,
    [SPA_PORTAL, organizationId, propertyId],
  )
  for (const [id, purpose, width, height] of [
    [SPA_HERO_ASSET, 'hero', 1500, 1000],
    [SPA_LOGO_ASSET, 'logo', 400, 100],
  ] as const) {
    await pool.query(
      `INSERT INTO portal_media_assets
         (id, organization_id, property_id, purpose, object_key, content_type, width,
          height, byte_size, content_sha256, source_format, source_bytes,
          rights_confirmed_at, created_by)
       VALUES ($1::uuid, $2, $3, $4, 'portal-media/' || $1::text || '.webp',
               'image/webp', $5, $6, 1000, repeat('a', 64), 'jpeg', 2000, now(),
               'seed-admin')`,
      [id, organizationId, propertyId, purpose, width, height],
    )
  }
  const lobby = printKitLiveConfiguration()
  await seedLiveImmersiveSnapshot({
    organizationId,
    propertyId,
    portalId: SPA_PORTAL,
    version: 2,
    configuration: {
      ...lobby,
      portal: { id: SPA_PORTAL, slug: 'spa-own-look' },
      brandProfile: {
        ...lobby.brandProfile,
        wordmark: 'SPA',
        logo: { assetId: SPA_LOGO_ASSET, width: 400, height: 100 },
        hero: {
          assetId: SPA_HERO_ASSET,
          width: 1500,
          height: 1000,
          focalX: 0.6,
          focalY: 0.2,
        },
        accentColour: SPA_ACCENT,
        fieldColour: SPA_FIELD,
        lookVersion: 5,
      },
    },
  })
  await seedPrintKitCode(pool, true, SPA_CODE)
}

async function harness() {
  const pool = getPool()
  await seedPortalWorkingCopy(pool, COMPLETE_SCENARIO)
  await seedLiveImmersiveSnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    configuration: printKitLiveConfiguration(),
  })
  await seedPrintKitCode(pool, true)
  await seedSpa()
  const objectStore = createInMemoryObjectStore()
  await storePrintKitPicture(pool, objectStore, SCENARIO_HERO_ASSET, {
    width: 1600,
    height: 1000,
  })
  await storePrintKitPicture(pool, objectStore, LOGO_ASSET, { width: 480, height: 120 })
  await storePrintKitPicture(
    pool,
    objectStore,
    SPA_HERO_ASSET,
    { width: 1500, height: 1000 },
    '#aa5533',
  )
  await storePrintKitPicture(
    pool,
    objectStore,
    SPA_LOGO_ASSET,
    { width: 400, height: 100 },
    '#3355aa',
  )
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const publicationRepo = createPortalPublicationRepository(db)
  const mediaRepo = createPortalMediaAssetRepository(db)
  const real = createPdfKitPrintFinalRenderer({
    now: () => new Date('2026-10-26T10:00:00Z'),
    compress: false,
  })
  const rendered: Parameters<PortalPrintFinalRenderer['render']>[0][] = []
  const renderer: PortalPrintFinalRenderer = {
    render: async (input) => {
      rendered.push(input)
      return real.render(input)
    },
  }
  return {
    read: getPortalPrintKit({
      portalRepo,
      staffPublicApi,
      publicationRepo,
      mediaRepo,
      lastPrintRepo: createPortalLastPrintRepository(db),
      wordingRepo: createPortalPrintWordingRepository(db),
      finalKitEnabled: true,
    }),
    make: createPortalPrintFinal({
      portalRepo,
      staffPublicApi,
      publicationRepo,
      mediaRepo,
      objectStore,
      sha256Hex,
      revealAddress: revealPortalAddress({
        portalRepo,
        staffPublicApi,
        portalAddressRepo: createPortalAddressRepository(db),
        addressCipher: printKitCipher,
        tokenCodec: testPortalTokenCodec(),
        reportPrintCodeProblem: () => undefined,
        clock: () => new Date('2026-10-26T10:00:00Z'),
        address: {
          appOrigin: BASE_URL,
          printOrigin: PRINT_ORIGIN,
          printCodesEnabled: true,
        },
      }),
      renderer,
      propertyCountry: createPropertyCountryReader(db),
      finalKitEnabled: true,
      lastPrintRepo: createPortalLastPrintRepository(db),
      wordingRepo: createPortalPrintWordingRepository(db),
      clock: () => new Date('2026-10-26T10:00:00Z'),
      logger: createMockLogger(),
    }),
    rendered,
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
  }
}

const request = (portal: string): DownloadPortalPrintFinalInput => ({
  portalId: portal,
  piece: 'counter',
  orientation: 'upright',
  look: 'immersive',
  printer: 'my_printer',
  quantity: 3,
  languages: ['en'],
  callToAction: 'how_did_we_do',
  paper: 'letter',
})

/** What a print was drawn from, with each picture reduced to its hash. */
const drawnFrom = (
  input: Parameters<PortalPrintFinalRenderer['render']>[0] | undefined,
) => ({
  wordmark: input?.wordmark,
  accentColour: input?.accentColour,
  fieldColour: input?.fieldColour,
  logo: input?.logo ? sha256Hex(input.logo) : null,
  photo: input?.photo ? sha256Hex(input.photo.bytes) : null,
  focal: input?.photo ? [input.photo.focalX, input.photo.focalY] : null,
})

describe.sequential("A Portal's own look and the print kit (real PostgreSQL)", () => {
  it('reads each Portal’s own palette, photo and logo from its own live version', async () => {
    const { read, ctx } = await harness()

    const lobby = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)
    const spa = await read({ portalId: SPA_PORTAL }, ctx)

    expect(lobby.look).toMatchObject({
      wordmark: 'RILA',
      accentColour: PROPERTY_ACCENT,
      fieldColour: PROPERTY_FIELD,
      heroUrl: `/api/public/portal-media/${SCENARIO_HERO_ASSET}`,
      heroFocal: { x: 0.3, y: 0.7 },
      logoUrl: `/api/public/portal-media/${LOGO_ASSET}`,
    })
    expect(spa.look).toMatchObject({
      wordmark: 'SPA',
      accentColour: SPA_ACCENT,
      fieldColour: SPA_FIELD,
      heroUrl: `/api/public/portal-media/${SPA_HERO_ASSET}`,
      heroFocal: { x: 0.6, y: 0.2 },
      heroSize: { width: 1500, height: 1000 },
      logoUrl: `/api/public/portal-media/${SPA_LOGO_ASSET}`,
    })
  })

  it('prints each Portal in its own palette, with its own photo and logo, on its own code', async () => {
    const { make, ctx, rendered } = await harness()

    await make(request(COMPLETE_SCENARIO.portalId), ctx)
    await make(request(SPA_PORTAL), ctx)

    const [lobby, spa] = rendered
    expect(drawnFrom(lobby)).toMatchObject({
      wordmark: 'RILA',
      accentColour: PROPERTY_ACCENT,
      fieldColour: PROPERTY_FIELD,
      focal: [0.3, 0.7],
    })
    expect(drawnFrom(spa)).toMatchObject({
      wordmark: 'SPA',
      accentColour: SPA_ACCENT,
      fieldColour: SPA_FIELD,
      focal: [0.6, 0.2],
    })
    // Pictures, not just words: neither Portal printed the other's photo or logo.
    expect(drawnFrom(spa).photo).not.toBeNull()
    expect(drawnFrom(spa).logo).not.toBeNull()
    expect(drawnFrom(spa).photo).not.toBe(drawnFrom(lobby).photo)
    expect(drawnFrom(spa).logo).not.toBe(drawnFrom(lobby).logo)
    // Each print carries its own Portal's live code.
    expect(spa?.qrAddress).not.toBe(lobby?.qrAddress)
  })

  it('never prints an own look that is saved but not published: the live version decides', async () => {
    const { read, make, ctx, rendered } = await harness()
    const lobbyBefore = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)
    await make(request(COMPLETE_SCENARIO.portalId), ctx)

    // The Lobby is given the Spa's whole look as its own. Nothing is published.
    await insertSpaLook(COMPLETE_SCENARIO.portalId)
    const lobbyAfter = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)
    await make(request(COMPLETE_SCENARIO.portalId), ctx)

    // The Share tab shows the same card; only its memory of the first print is new.
    expect(lobbyAfter.look).toEqual(lobbyBefore.look)
    expect(lobbyAfter.titles).toEqual(lobbyBefore.titles)
    expect(lobbyAfter.locales).toEqual(lobbyBefore.locales)
    expect(lobbyAfter.look).toMatchObject({
      wordmark: 'RILA',
      accentColour: PROPERTY_ACCENT,
      fieldColour: PROPERTY_FIELD,
    })
    expect(rendered).toHaveLength(2)
    expect(drawnFrom(rendered[1])).toEqual(drawnFrom(rendered[0]))
    expect(drawnFrom(rendered[1]).accentColour).not.toBe(SPA_ACCENT)
  })

  it('prints the live look of a Portal whose own look was saved after it was published', async () => {
    const { make, ctx, rendered } = await harness()
    // The Spa's row says what its live version says; then the Spa changes its mind.
    await insertSpaLook(SPA_PORTAL)
    await getPool().query(
      `UPDATE portal_look_overrides
       SET colours_mode = 'own', primary_color = '#00AA55', look_version = look_version + 1
       WHERE portal_id = $1`,
      [SPA_PORTAL],
    )

    await make(request(SPA_PORTAL), ctx)

    expect(drawnFrom(rendered[0])).toMatchObject({
      wordmark: 'SPA',
      accentColour: SPA_ACCENT,
      fieldColour: SPA_FIELD,
    })
  })
})
