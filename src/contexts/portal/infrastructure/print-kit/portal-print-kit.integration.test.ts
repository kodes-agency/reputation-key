// The print kit over real PostgreSQL (round 4, slice 45): the languages, titles
// and look come from the live version's row, the photo and the logo are read
// from the media rows and the object store, the address is the real audited
// reveal over a code sealed with the real cipher, and a real PDF is drawn from
// them. Only the renderer is wrapped, to see what it was handed.

import { createHash, randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { getDb } from '#/shared/db'
import { organizationId } from '#/shared/domain/ids'
import { printKitSubject } from '#/shared/domain/portal-print-kit-pieces'
import {
  PRINT_KIT_SIZES,
  type PrintKitOutput,
  type PrintKitPaper,
  type PrintKitSize,
  type PrintKitStyle,
} from '#/shared/domain/portal-print-kit'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { buildPortalPublicUrls } from '../../application/portal-address-urls'
import type { PortalPrintKitRenderer } from '../../application/ports/portal-print-kit-renderer.port'
import { createPortalPrintKit } from '../../application/use-cases/create-portal-print-kit'
import { getPortalPrintKit } from '../../application/use-cases/get-portal-print-kit'
import { revealPortalAddress } from '../../application/use-cases/reveal-portal-address'
import { bulgarianPrimaryConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import { createPortalAddressCipher } from '../adapters/portal-address-cipher'
import { createPortalAddressRepository } from '../repositories/portal-address.repository'
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
import { pdfSubject } from './__fixtures__/print-kit-face-fixtures'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import { createPropertyCountryReader } from './print-kit-property-country'

const BASE_URL = 'https://app.example.test'
const RAW_TOKEN = 'pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const TOKEN_ID = 'c6000000-0000-4000-8000-000000000001'
const QR_MARKER = 'c7000000-0000-4000-8000-000000000001'
const NFC_MARKER = 'c7000000-0000-4000-8000-000000000002'
const KEYRING = `1:${'ab'.repeat(32)}`
const LOGO_ASSET = 'c5000000-0000-4000-8000-000000000002'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_address_downloads',
    'portal_access_artifacts',
    'portal_tokens',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Stores a real picture under an asset the seed made, and makes its row say so. */
async function storePicture(
  store: ReturnType<typeof createInMemoryObjectStore>,
  assetId: string,
  size: Readonly<{ width: number; height: number }>,
): Promise<void> {
  const body = await sharp({
    create: { ...size, channels: 3, background: '#557766' },
  })
    .webp()
    .toBuffer()
  await store.putObject(`portal-media/${assetId}.webp`, body, 'image/webp')
  await getPool().query(
    `UPDATE portal_media_assets SET byte_size = $2, content_sha256 = $3 WHERE id = $1::uuid`,
    [assetId, body.length, sha256Hex(body)],
  )
}

const cipher = createPortalAddressCipher({
  keyring: KEYRING,
  generateIv: () => randomBytes(12),
})

/** What the live version published: Bulgarian first, with the look the scenario's working copy has. */
const liveConfiguration = (localeSet: readonly ('bg' | 'en')[] = ['bg', 'en']) => {
  const base = bulgarianPrimaryConfiguration()
  const own = (value: string) => ({ value, fallbackFrom: null }) as const
  const content = (title: string) => ({
    title: own(title),
    shortDescription: own(title),
    heroAlt: own(title),
    linktreeTitle: own(title),
  })
  return bulgarianPrimaryConfiguration({
    portal: { id: COMPLETE_SCENARIO.portalId, slug: COMPLETE_SCENARIO.slug },
    localeSet,
    languagePackVersions: Object.fromEntries(
      localeSet.map((locale) => [locale, base.languagePackVersions[locale]]),
    ),
    localizedContent: Object.fromEntries(
      localeSet.map((locale) => [
        locale,
        content(locale === 'bg' ? 'Хотел Рила' : 'Hotel Rila Lobby'),
      ]),
    ),
    links: base.links.map((link) => ({
      ...link,
      texts: Object.fromEntries(
        localeSet.flatMap((locale) => {
          const text = link.texts[locale]
          return text ? [[locale, text]] : []
        }),
      ),
    })),
    brandProfile: {
      ...base.brandProfile,
      wordmark: 'RILA',
      logo: { assetId: LOGO_ASSET, width: 480, height: 120 },
      hero: {
        assetId: SCENARIO_HERO_ASSET,
        width: 1600,
        height: 1000,
        focalX: 0.3,
        focalY: 0.7,
      },
    },
  })
}

/** A live code: the token row sealed by the real cipher, and its two markers. */
async function seedCode(sealed: boolean): Promise<void> {
  const {
    organizationId: org,
    propertyId: property,
    portalId: portal,
  } = COMPLETE_SCENARIO
  const address = sealed
    ? cipher.seal(RAW_TOKEN, {
        organizationId: org,
        propertyId: property,
        portalId: portal,
        tokenId: TOKEN_ID,
        version: 1,
      })
    : null
  await getPool().query(
    `INSERT INTO portal_tokens (
       id, organization_id, property_id, portal_id, token_identifier, token_hash,
       encrypted_raw_token, address_encryption_key_version, version, status,
       issued_at, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, 'active', now(), now())`,
    [
      TOKEN_ID,
      org,
      property,
      portal,
      RAW_TOKEN.slice(0, 19),
      sha256Hex(Buffer.from(RAW_TOKEN)),
      address?.ciphertext ?? null,
      address?.keyVersion ?? null,
    ],
  )
  for (const [channel, id] of [
    ['qr', QR_MARKER],
    ['nfc', NFC_MARKER],
  ] as const) {
    await getPool().query(
      `INSERT INTO portal_access_artifacts (
         id, organization_id, property_id, portal_id, portal_token_id, channel, status,
         published_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'published', now())`,
      [id, org, property, portal, TOKEN_ID, channel],
    )
  }
}

type HarnessOptions = Readonly<{
  sealed?: boolean
  locales?: readonly ('bg' | 'en')[]
  /** The sizes a manager may choose: the hidden ones too, for a test. */
  selectableSizes?: readonly PrintKitSize[]
  /**
   * What the renderer draws in place of the revealed address: a short print
   * address, as the code will carry once print codes are minted (plan slice 5).
   */
  printAddress?: string
}>

async function harness(options: HarnessOptions = {}) {
  await seedPortalWorkingCopy(getPool(), COMPLETE_SCENARIO)
  await seedLiveImmersiveSnapshot({
    organizationId: COMPLETE_SCENARIO.organizationId,
    propertyId: COMPLETE_SCENARIO.propertyId,
    portalId: COMPLETE_SCENARIO.portalId,
    configuration: liveConfiguration(options.locales),
  })
  await seedCode(options.sealed ?? true)
  const objectStore = createInMemoryObjectStore()
  await storePicture(objectStore, SCENARIO_HERO_ASSET, { width: 1600, height: 1000 })
  await storePicture(objectStore, LOGO_ASSET, { width: 480, height: 120 })
  const db = getDb()
  const portalRepo = createPortalRepository(db)
  const publicationRepo = createPortalPublicationRepository(db)
  const common = { portalRepo, staffPublicApi, publicationRepo }
  const real = createPdfKitPrintKitRenderer({
    now: () => new Date('2026-10-01T10:00:00Z'),
    compress: false,
  })
  const renderedAddresses: string[] = []
  const renderer: PortalPrintKitRenderer = {
    render: async (input) => {
      renderedAddresses.push(input.qrAddress)
      const qrAddress = options.printAddress ?? input.qrAddress
      return real.render({ ...input, qrAddress })
    },
  }
  return {
    read: getPortalPrintKit(common),
    make: createPortalPrintKit({
      ...common,
      mediaRepo: createPortalMediaAssetRepository(db),
      objectStore,
      sha256Hex,
      revealAddress: revealPortalAddress({
        portalRepo,
        staffPublicApi,
        portalAddressRepo: createPortalAddressRepository(db),
        addressCipher: cipher,
        clock: () => new Date('2026-10-01T10:00:00Z'),
        baseUrl: BASE_URL,
      }),
      renderer,
      propertyCountry: createPropertyCountryReader(db),
      ...(options.selectableSizes ? { selectableSizes: options.selectableSizes } : {}),
    }),
    renderedAddresses,
    ctx: buildTestAuthContext({ organizationId: WORKING_COPY_ORG }),
  }
}

/** Records the scenario Property's country, or clears it. */
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

const downloadRows = async () =>
  (
    await getPool().query<{ purpose: string; portal_token_id: string }>(
      'SELECT purpose, portal_token_id FROM portal_address_downloads',
    )
  ).rows

describe.sequential('Portal print kit (real PostgreSQL)', () => {
  it('reads the Portal titles, languages and look from the live version', async () => {
    const { read, ctx } = await harness()

    const view = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)

    expect(view.primaryLocale).toBe('bg')
    expect(view.locales).toEqual(['bg', 'en'])
    expect(view.titles).toEqual({ bg: 'Хотел Рила', en: 'Hotel Rila Lobby' })
    expect(view.look.wordmark).toBe('RILA')
    expect(view.look.heroUrl).toBe(`/api/public/portal-media/${SCENARIO_HERO_ASSET}`)
    expect(view.look.heroFocal).toEqual({ x: 0.3, y: 0.7 })
    expect(view.look.logoUrl).toBe(`/api/public/portal-media/${LOGO_ASSET}`)
  })

  it('draws an Immersive counter card with the photo, the logo and the Bulgarian words', async () => {
    const { make, ctx } = await harness()

    const file = await make(
      {
        portalId: COMPLETE_SCENARIO.portalId,
        piece: 'counter_card',
        languages: ['bg'],
        callToAction: 'rate',
        style: 'immersive',
      },
      ctx,
    )

    const text = Buffer.from(file.pdf).toString('latin1')
    expect(file.fileName).toMatch(/-counter-card-bg-immersive-(letter|a4)\.pdf$/u)
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    // The photo and the logo: at least one picture each.
    expect(text.match(/\/Subtype \/Image/gu)?.length ?? 0).toBeGreaterThanOrEqual(2)
    // The Bulgarian call to action reached the file as embedded text.
    expect(text).toMatch(/<041E>/iu)
  })

  it('prints the address of the live code, and records that it was downloaded', async () => {
    const { make, ctx, renderedAddresses } = await harness()

    await make(
      {
        portalId: COMPLETE_SCENARIO.portalId,
        piece: 'counter_card',
        languages: ['bg'],
        callToAction: 'tell',
        style: 'paper',
      },
      ctx,
    )

    const expected = buildPortalPublicUrls(BASE_URL, RAW_TOKEN, {
      qr: QR_MARKER,
      nfc: NFC_MARKER,
    }).qr
    expect(renderedAddresses).toEqual([expected])
    expect(await downloadRows()).toEqual([
      { purpose: 'download', portal_token_id: TOKEN_ID },
    ])
  })

  it('makes no file and records nothing for a code that was never sealed', async () => {
    const { make, ctx, renderedAddresses } = await harness({ sealed: false })

    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['bg'],
          callToAction: 'rate',
          style: 'paper',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'address_unavailable' })

    expect(renderedAddresses).toEqual([])
    expect(await downloadRows()).toEqual([])
  })

  it('offers only the languages the live version serves, though the editor has more', async () => {
    const { read, make, ctx } = await harness({ locales: ['bg'] })

    const view = await read({ portalId: COMPLETE_SCENARIO.portalId }, ctx)
    expect(view.locales).toEqual(['bg'])
    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['bg', 'en'],
          callToAction: 'rate',
          style: 'paper',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(await downloadRows()).toEqual([])
  })

  it('does not make a print for a Portal of another organization', async () => {
    const { make } = await harness()
    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['en'],
          callToAction: 'rate',
          style: 'paper',
        },
        buildTestAuthContext({ organizationId: organizationId('org-other-0000-0000') }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
  })

  it('does not offer a language the Portal does not have', async () => {
    const { make, ctx } = await harness()
    await expect(
      make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece: 'counter_card',
          languages: ['fr'],
          callToAction: 'rate',
          style: 'paper',
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
  })

  it.each([
    ['table_tent', 'letter', [[612, 792]]],
    ['table_tent', 'a4', [[595, 842]]],
    [
      'counter_card',
      'letter',
      [
        [612, 792],
        [612, 792],
      ],
    ],
    [
      'counter_card',
      'a4',
      [
        [595, 842],
        [595, 842],
      ],
    ],
  ] as const)('draws a Paper %s on %s sheets', async (piece, paper, sizes) => {
    const { make, ctx } = await harness()
    const file = await make(
      {
        portalId: COMPLETE_SCENARIO.portalId,
        piece,
        languages: ['bg', 'en'],
        callToAction: 'rate',
        style: 'paper',
        paper,
      },
      ctx,
    )
    expect(file.fileName.endsWith(`-bg-en-${paper}.pdf`)).toBe(true)
    expect(pageSizes(file.pdf)).toEqual(sizes)
    expect(Buffer.from(file.pdf).toString('latin1')).not.toMatch(/\/BleedBox/u)
  })

  it.each([
    [
      'counter_card',
      'letter',
      [
        [342, 486],
        [342, 486],
      ],
    ],
    ['table_tent', 'letter', [[342, 918]]],
    [
      'counter_card',
      'a4',
      [
        [354, 476],
        [354, 476],
      ],
    ],
    ['table_tent', 'a4', [[354, 896]]],
  ] as const)(
    'draws an Immersive %s on %s for a print shop, with its photo and bleed',
    async (piece, paper, sizes) => {
      const { make, ctx } = await harness()
      const file = await make(
        {
          portalId: COMPLETE_SCENARIO.portalId,
          piece,
          languages: ['bg', 'en'],
          callToAction: 'rate',
          style: 'immersive',
          paper,
        },
        ctx,
      )
      expect(file.fileName.endsWith(`-bg-en-immersive-${paper}.pdf`)).toBe(true)
      expect(pageSizes(file.pdf)).toEqual(sizes)
      const text = Buffer.from(file.pdf).toString('latin1')
      expect(text.match(/\/BleedBox/gu)).toHaveLength(sizes.length)
      expect(pdfSubject(text)).toBe(printKitSubject('immersive', piece, paper))
    },
  )

  it('prints an Immersive request on 4 × 6 in for a property with no country', async () => {
    const { make, ctx } = await harness()
    await setCountry(null)
    const file = await make(
      {
        portalId: COMPLETE_SCENARIO.portalId,
        piece: 'counter_card',
        languages: ['bg'],
        callToAction: 'rate',
        style: 'immersive',
      },
      ctx,
    )
    expect(file.fileName.endsWith('-bg-immersive-letter.pdf')).toBe(true)
    expect(pageSizes(file.pdf)).toEqual([[342, 486]])
  })

  it('prints a Paper request on Letter for a property with no country, and on A4 for one in Bulgaria', async () => {
    const { make, ctx } = await harness()
    const request = {
      portalId: COMPLETE_SCENARIO.portalId,
      piece: 'table_tent',
      languages: ['bg'],
      callToAction: 'rate',
      style: 'paper',
    } as const
    await setCountry(null)
    const unknown = await make(request, ctx)
    expect(unknown.fileName.endsWith('-bg-letter.pdf')).toBe(true)
    expect(pageSizes(unknown.pdf)).toEqual([[612, 792]])
    await setCountry('BG')
    const bulgarian = await make(request, ctx)
    expect(bulgarian.fileName.endsWith('-bg-a4.pdf')).toBe(true)
    expect(pageSizes(bulgarian.pdf)).toEqual([[595, 842]])
  })

  describe('at the round-3 sizes, made selectable for the test', () => {
    /** A short print address on the print host: a version 3 symbol. */
    const PRINT_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
    const request = (
      size: PrintKitSize,
      style: PrintKitStyle,
      paper: PrintKitPaper,
      output: PrintKitOutput,
    ) =>
      ({
        portalId: COMPLETE_SCENARIO.portalId,
        piece: 'counter_card',
        languages: ['bg'],
        callToAction: 'rate',
        style,
        paper,
        size,
        output,
      }) as const

    it.each([
      ['table', 'paper', 'letter', 'office', [612, 792], '-table-card-bg-4up-letter.pdf'],
      ['table', 'paper', 'a4', 'office', [595, 842], '-table-card-bg-4up-a4.pdf'],
      [
        'table',
        'immersive',
        'letter',
        'office',
        [612, 792],
        '-table-card-bg-immersive-4up-letter.pdf',
      ],
      [
        'table',
        'immersive',
        'a4',
        'office',
        [595, 842],
        '-table-card-bg-immersive-4up-a4.pdf',
      ],
      [
        'table',
        'immersive',
        'letter',
        'print_shop',
        [306, 414],
        '-table-card-bg-immersive-letter.pdf',
      ],
      [
        'table',
        'immersive',
        'a4',
        'print_shop',
        [312, 425],
        '-table-card-bg-immersive-a4.pdf',
      ],
      ['mini', 'paper', 'letter', 'office', [612, 792], '-mini-card-bg-10up-letter.pdf'],
      ['mini', 'paper', 'a4', 'office', [595, 842], '-mini-card-bg-10up-a4.pdf'],
      [
        'mini',
        'immersive',
        'letter',
        'print_shop',
        [198, 306],
        '-mini-card-bg-immersive-letter.pdf',
      ],
      [
        'mini',
        'immersive',
        'a4',
        'print_shop',
        [213, 298],
        '-mini-card-bg-immersive-a4.pdf',
      ],
      [
        'large',
        'immersive',
        'letter',
        'office',
        [792, 612],
        '-counter-card-bg-immersive-2up-letter.pdf',
      ],
      [
        'large',
        'immersive',
        'a4',
        'office',
        [842, 595],
        '-counter-card-bg-immersive-2up-a4.pdf',
      ],
    ] as const)(
      'draws a %s %s card on %s for %s, with the photo and the logo',
      async (size, style, paper, output, page, ending) => {
        const { make, ctx } = await harness({
          selectableSizes: PRINT_KIT_SIZES,
          printAddress: PRINT_ADDRESS,
        })
        const file = await make(request(size, style, paper, output), ctx)
        expect(file.fileName.endsWith(ending)).toBe(true)
        expect(pageSizes(file.pdf)).toEqual([page])
        const text = Buffer.from(file.pdf).toString('latin1')
        // Paper has no photo; the logo is a picture on every card.
        const pictures = text.match(/\/Subtype \/Image/gu)?.length ?? 0
        expect(pictures).toBeGreaterThanOrEqual(style === 'immersive' ? 2 : 1)
        expect(text.match(/\/BleedBox/gu) ?? []).toHaveLength(
          output === 'print_shop' ? 1 : 0,
        )
        expect(pdfSubject(text)).toBe(printKitSubject(style, 'counter_card', paper, size))
      },
    )

    it('refuses today’s long address on a Table card: its tile would print the code too small', async () => {
      const { make, ctx } = await harness({ selectableSizes: PRINT_KIT_SIZES })
      await expect(
        make(request('table', 'paper', 'letter', 'office'), ctx),
      ).rejects.toMatchObject({
        code: 'print_code_too_small',
        context: { cause: 'needs_short_code', size: 'table' },
      })
    })

    it('refuses a size managers may not choose yet, before it reveals or records anything', async () => {
      const { make, ctx, renderedAddresses } = await harness()
      await expect(
        make(request('mini', 'paper', 'letter', 'office'), ctx),
      ).rejects.toMatchObject({
        code: 'print_format_not_offered',
      })
      expect(renderedAddresses).toEqual([])
      expect(await downloadRows()).toEqual([])
    })
  })
})
