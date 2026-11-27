// The wiring every print use-case integration test shares: the scenario's live
// print kit (working copy, live Immersive version, sealed code, country, two
// stored pictures) and `createPortalPrint` over real repositories, with the
// renderer, staff access, logger, clock and repository failures stood in on
// request. The caller owns the pool from `setupIntegrationDb`.

import type { Pool } from 'pg'
import type { StaffPublicApi } from '#/contexts/identity/public-api'
import { getDb } from '#/shared/db'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import {
  createInMemoryObjectStore,
  type InMemoryObjectStore,
} from '#/shared/testing/in-memory-object-store'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type {
  PrintRenderRefusal,
  PortalPrintRenderer,
  PrintRenderInput,
} from './pdfkit-print-renderer.port.server'
import { createPortalPrint } from './create-portal-print.server'
import { getPortalPrintKit } from './get-portal-print-kit.server'
import { createPdfKitPrintRenderer } from './pdfkit-print-renderer.server'
import { revealPortalAddress } from '../addresses/reveal-portal-address.server'
import { createPortalAddressRepository } from '../addresses/portal-address-repository.server'
import { createPortalLastPrintRepository } from './portal-last-print-repository.server'
import { createPortalMediaAssetRepository } from '../media/portal-media-asset-repository.server'
import { createPortalPrintWordingRepository } from './portal-print-wording-repository.server'
import { createPortalPublicationRepository } from '../publication/portal-publication-repository.server'
import { createPortalRepository } from '../publication/portal-repository.server'
import { seedLiveImmersiveSnapshot } from '../publication/portal-live-immersive-seed.test-fixtures'
import { testPortalTokenCodec } from '../addresses/portal-token-codec.test-fixtures'
import { seedPortalWorkingCopy } from '../publication/portal-working-copy-seed.test-fixtures'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  withOwnLook,
} from '../publication/portal-working-copy-scenarios.test-fixtures'
import {
  BASE_URL,
  LOGO_ASSET,
  PRINT_ORIGIN,
  printKitCipher,
  printKitLiveConfiguration,
  seedPrintKitCode,
  sha256Hex,
  storePrintKitPicture,
} from './print-kit-live-seed.test-fixtures'
import { createPropertyCountryReader } from './print-kit-property-country.server'

export const PRINT_WORLD_PDF = new Uint8Array([37, 80, 68, 70])
export const PRINT_WORLD_PRINTED_AT = new Date('2026-10-25T10:00:00.000Z')
const PORTAL = COMPLETE_SCENARIO.portalId
const PDF = PRINT_WORLD_PDF
const PRINTED_AT = PRINT_WORLD_PRINTED_AT

export type PrintKitWorldOptions = Readonly<{
  personal?: Readonly<{ staffName: string; publicName: string }>
  /** The wordmark the live version carries: left out, the scenario's; null, none written. */
  wordmark?: string | null
  /** The Portal wrote its own wordmark instead of following the Property brand. */
  ownWordmark?: boolean
  accessible?: readonly string[] | null
  live?: boolean
  /** The code is not kept sealed, so the address cannot be revealed again. */
  codeSealed?: boolean
  country?: string | null
  refuse?: PrintRenderRefusal
  /** The languages the live version offers; Bulgarian and English by default. */
  localeSet?: readonly ('bg' | 'en' | 'de')[]
  failLastPrint?: boolean
  failWording?: boolean
  /** `pdfkit` draws the real file (uncompressed, dated at the world's instant); the default returns a fixed PDF. */
  renderer?: 'stub' | 'pdfkit'
  /** More of the world to seed once its own pictures are stored. */
  extraSeed?: (pool: Pool, objectStore: InMemoryObjectStore) => Promise<void>
}>

export function printKitWorldConfiguration(options: PrintKitWorldOptions) {
  const base = printKitLiveConfiguration()
  const localeSet = options.localeSet ?? base.localeSet
  const own = (value: string) => ({ value, fallbackFrom: null }) as const
  const withLocales =
    options.localeSet === undefined
      ? base
      : {
          ...base,
          guestLocale: localeSet[0] ?? base.guestLocale,
          languagePackVersion: `guest-ui-${localeSet[0] ?? 'bg'}-v2`,
          localeSet: [...localeSet],
          languagePackVersions: Object.fromEntries(
            localeSet.map((locale) => [locale, `guest-ui-${locale}-v2`]),
          ),
          localizedContent: Object.fromEntries(
            localeSet.map((locale) => [
              locale,
              {
                title: own(`Hotel Rila ${locale}`),
                shortDescription: own('Welcome'),
                heroAlt: own('Hotel Rila'),
                linktreeTitle: own('Links'),
              },
            ]),
          ),
          links: [],
        }
  const wordmark =
    options.wordmark === undefined ? withLocales.brandProfile.wordmark : options.wordmark
  return {
    ...withLocales,
    brandProfile: { ...withLocales.brandProfile, wordmark },
  } as typeof base
}

export async function createPrintKitWorld(
  pool: Pool,
  options: PrintKitWorldOptions = {},
) {
  await seedPortalWorkingCopy(
    pool,
    options.ownWordmark
      ? withOwnLook({
          identity: { wordmark: options.wordmark ?? null, logoAssetId: null },
          lookVersion: 5,
        })
      : COMPLETE_SCENARIO,
  )
  if (options.personal) {
    await pool.query(
      `UPDATE portals SET kind = 'personal', name = $2, public_name = $3 WHERE id = $1`,
      [PORTAL, options.personal.staffName, options.personal.publicName],
    )
  }
  if (options.live !== false) {
    await seedLiveImmersiveSnapshot({
      organizationId: COMPLETE_SCENARIO.organizationId,
      propertyId: COMPLETE_SCENARIO.propertyId,
      portalId: PORTAL,
      configuration: printKitWorldConfiguration(options),
    })
  }
  await seedPrintKitCode(pool, options.codeSealed ?? true)
  await pool.query('UPDATE properties SET country_code = $2 WHERE id = $1::uuid', [
    COMPLETE_SCENARIO.propertyId,
    options.country === undefined ? 'US' : options.country,
  ])
  const objectStore = createInMemoryObjectStore()
  await storePrintKitPicture(pool, objectStore, SCENARIO_HERO_ASSET, {
    width: 1600,
    height: 1000,
  })
  await storePrintKitPicture(pool, objectStore, LOGO_ASSET, { width: 480, height: 120 })
  await options.extraSeed?.(pool, objectStore)

  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const lastPrintRepo = createPortalLastPrintRepository(db)
  const wordingRepo = createPortalPrintWordingRepository(db)
  const staffPublicApi: StaffPublicApi = {
    getAccessiblePropertyIds: async () => (options.accessible ?? null) as never,
    getAssignedPortals: async () => [],
  }
  const warnings: object[] = []
  const logger = {
    ...createMockLogger(),
    warn: (context: unknown) => {
      if (typeof context === 'object' && context !== null) warnings.push(context)
    },
  }
  const rendered: PrintRenderInput[] = []
  const real =
    options.renderer === 'pdfkit'
      ? createPdfKitPrintRenderer({ now: () => PRINTED_AT, compress: false })
      : null
  const renderer: PortalPrintRenderer = {
    render: async (input) => {
      rendered.push(input)
      if (options.refuse) throw options.refuse
      return real ? real.render(input) : PDF
    },
  }
  const failing = (): never => {
    throw new Error('connection reset')
  }
  const publicationRepo = createPortalPublicationRepository(db)
  const mediaRepo = createPortalMediaAssetRepository(db)
  const make = createPortalPrint({
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
      clock: () => PRINTED_AT,
      address: { appOrigin: BASE_URL, printOrigin: PRINT_ORIGIN },
    }),
    renderer,
    propertyCountry: createPropertyCountryReader(db),
    lastPrintRepo: options.failLastPrint
      ? { ...lastPrintRepo, record: async () => failing() }
      : lastPrintRepo,
    wordingRepo: options.failWording
      ? { ...wordingRepo, save: async () => failing() }
      : wordingRepo,
    clock: () => PRINTED_AT,
    logger,
  })
  const read = getPortalPrintKit({
    portalRepo,
    staffPublicApi,
    publicationRepo,
    mediaRepo,
    lastPrintRepo,
    wordingRepo,
  })
  return {
    make,
    read,
    rendered,
    warnings,
    lastPrintRepo,
    wordingRepo,
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
    live: printKitWorldConfiguration(options),
  }
}
