// The final print kit over real PostgreSQL (final design spec §11, slice 7),
// with PRINT_KIT_FINAL_ENABLED on: the languages, titles and look come from the
// live version's row, the pictures from the media rows and the object store,
// the address from the real audited reveal (a short print address minted on the
// first download), and real office sheets are drawn from them.

import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { getDb } from '#/shared/db'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type { DownloadPortalPrintFinalInput } from '../../application/dto/portal-print-final.dto'
import type { PortalPrintFinalRenderer } from '../../application/ports/portal-print-final-renderer.port'
import { createPortalPrintFinal } from '../../application/use-cases/create-portal-print-final'
import { revealPortalAddress } from '../../application/use-cases/reveal-portal-address'
import { testPortalTokenCodec } from '../testing/portal-token-codec-fixture'
import { createPortalAddressRepository } from '../repositories/portal-address.repository'
import { createPortalMediaAssetRepository } from '../repositories/portal-media-asset.repository'
import { createPortalPublicationRepository } from '../repositories/portal-publication.repository'
import { createPortalRepository } from '../repositories/portal.repository'
import { seedLiveImmersiveSnapshot } from '../testing/portal-live-immersive-seed'
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
} from './__fixtures__/print-kit-live-seed'
import { seedPortalWorkingCopy } from '../testing/portal-working-copy-seed'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../testing/portal-working-copy-scenarios'
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

type HarnessOptions = Readonly<{
  /** PRINT_KIT_FINAL_ENABLED; on unless a test turns it off. */
  enabled?: boolean
  /** `PORTAL_PRINT_CODES_ENABLED`: on, the reveal mints and hands over the short address. */
  printCodes?: boolean
}>

async function harness(options: HarnessOptions = {}) {
  await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
  await seedLiveImmersiveSnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    configuration: printKitLiveConfiguration(),
  })
  await seedPrintKitCode(getPool(), true)
  const objectStore = createInMemoryObjectStore()
  await storePrintKitPicture(getPool(), objectStore, SCENARIO_HERO_ASSET, {
    width: 1600,
    height: 1000,
  })
  await storePrintKitPicture(getPool(), objectStore, LOGO_ASSET, {
    width: 480,
    height: 120,
  })
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const real = createPdfKitPrintFinalRenderer({
    now: () => new Date('2026-10-25T10:00:00Z'),
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
    make: createPortalPrintFinal({
      portalRepo,
      staffPublicApi,
      publicationRepo: createPortalPublicationRepository(db),
      mediaRepo: createPortalMediaAssetRepository(db),
      objectStore,
      sha256Hex,
      revealAddress: revealPortalAddress({
        portalRepo,
        staffPublicApi,
        portalAddressRepo: createPortalAddressRepository(db),
        addressCipher: printKitCipher,
        tokenCodec: testPortalTokenCodec(),
        reportPrintCodeProblem: () => undefined,
        clock: () => new Date('2026-10-25T10:00:00Z'),
        address: {
          appOrigin: BASE_URL,
          printOrigin: PRINT_ORIGIN,
          printCodesEnabled: options.printCodes ?? true,
        },
      }),
      renderer,
      propertyCountry: createPropertyCountryReader(db),
      finalKitEnabled: options.enabled ?? true,
    }),
    rendered,
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
  }
}

const setCountry = (countryCode: string | null) =>
  getPool().query('UPDATE properties SET country_code = $2 WHERE id = $1::uuid', [
    COMPLETE_SCENARIO.propertyId,
    countryCode,
  ])

/** The size of every page of a PDF, from its MediaBoxes. */
const pageSizes = (pdf: Uint8Array): number[][] =>
  [
    ...Buffer.from(pdf)
      .toString('latin1')
      .matchAll(/\/MediaBox \[([^\]]+)\]/gu),
  ].map((match) =>
    (match[1] ?? '')
      .trim()
      .split(/\s+/u)
      .slice(2)
      .map((value) => Math.round(Number(value))),
  )

const downloads = async () =>
  (await getPool().query('SELECT purpose FROM portal_address_downloads')).rows.length

const request = (
  over: Partial<DownloadPortalPrintFinalInput> = {},
): DownloadPortalPrintFinalInput => ({
  portalId: COMPLETE_SCENARIO.portalId,
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  printer: 'my_printer',
  quantity: 10,
  languages: ['en', 'bg'],
  callToAction: 'rate',
  ...over,
})

describe.sequential('Final print kit (real PostgreSQL)', () => {
  it('prints ten Paper wide tents on three Letter sheets, on the short address', async () => {
    const { make, ctx, rendered } = await harness()
    await setCountry('US')

    const file = await make(request({ languages: ['bg'] }), ctx)

    expect(file.fileName).toBe('lobby-portal-table-tents-wide-bg-letter.pdf')
    expect(pageSizes(file.pdf)).toEqual([
      [612, 792],
      [612, 792],
      [612, 792],
    ])
    expect(rendered[0]?.address).toBe('short')
    expect(rendered[0]?.qrAddress).toMatch(
      /^HTTPS:\/\/AP\.EXAMPLE\.TEST\/p\/[0-9A-Z]{20}$/u,
    )
    expect(rendered[0]?.blocks.map((block) => block.kicker)).toEqual(['Хотел Рила'])
    expect(await downloads()).toBe(1)
  })

  it('prints Immersive upright Counter cards two to a landscape A4 sheet for a European property', async () => {
    const { make, ctx } = await harness()
    await setCountry('BG')

    const file = await make(
      request({
        piece: 'counter',
        orientation: 'upright',
        look: 'immersive',
        quantity: 3,
        languages: ['en'],
      }),
      ctx,
    )

    expect(file.fileName).toBe('lobby-portal-counter-cards-upright-en-immersive-a4.pdf')
    expect(pageSizes(file.pdf)).toEqual([
      [842, 595],
      [842, 595],
    ])
    const text = Buffer.from(file.pdf).toString('latin1')
    // The photo and the logo are pictures on every card.
    expect(text.match(/\/Subtype \/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })

  it('refuses English and Bulgarian together: the Bulgarian cue does not fit the bar on one line', async () => {
    const { make, ctx } = await harness()

    await expect(make(request(), ctx)).rejects.toMatchObject({
      code: 'print_format_not_offered',
      context: { cause: 'cue_does_not_fit' },
    })
  })

  it('refuses a tent on today’s long address in the Share tab’s words', async () => {
    const { make, ctx } = await harness({ printCodes: false })

    await expect(make(request({ languages: ['bg'] }), ctx)).rejects.toMatchObject({
      code: 'print_code_too_small',
      context: { cause: 'needs_short_code' },
    })
  })

  it('refuses every download while the server has the final kit off, and discloses nothing', async () => {
    const { make, ctx } = await harness({ enabled: false })

    await expect(make(request(), ctx)).rejects.toMatchObject({
      code: 'print_format_not_offered',
    })
    expect(await downloads()).toBe(0)
  })
})
