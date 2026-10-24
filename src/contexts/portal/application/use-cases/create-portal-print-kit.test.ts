// Portal context — the print kit PDF (round 4, slice 45): the one use case that
// puts the code's address into a file, so it authorises and validates before it
// discloses, and it discloses through the audited reveal.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { portalMediaAssetId, propertyId, type PropertyId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
  SOURCE_LOGO_ASSET_ID,
} from '../../domain/__fixtures__/publication-source'
import type { PortalPublicationConfiguration } from '../../domain/portal-publication-snapshot'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { portalError } from '../../domain/errors'
import type { PortalPublicationSource } from '../../domain/portal-publication-source'
import {
  PrintKitRenderRefusal,
  type PortalPrintKitRenderer,
  type PrintKitRenderInput,
} from '../ports/portal-print-kit-renderer.port'
import { PRINT_KIT_SIZES, type PrintKitSize } from '#/shared/domain/portal-print-kit'
import { createPortalPrintKit, printKitDownloadOf } from './create-portal-print-kit'
import type { RevealPortalAddress } from './reveal-portal-address'

const QR_ADDRESS =
  'https://app.example.test/p/pt_AAAAAAAAAAAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb?accessArtifact=11111111-1111-4111-8111-111111111111'
const PDF = new Uint8Array([37, 80, 68, 70])
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const HERO_BYTES = Buffer.from('hero image bytes')
const LOGO_BYTES = Buffer.from('logo image bytes')

const staffApi = (accessible: readonly PropertyId[] | null): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => accessible,
  getAssignedPortals: async () => [],
})

const liveSnapshot = (
  configuration: PortalPublicationConfiguration,
): PortalPublicationSnapshot =>
  ({ id: 'snapshot-1', version: 1, configuration }) as PortalPublicationSnapshot

type Options = Readonly<{
  /** The working copy; it only matters for a live version older than the Immersive Hub. */
  source?: PortalPublicationSource
  /** What is live: the Immersive Hub fixture unless told otherwise; null for nothing live. */
  live?: PortalPublicationConfiguration | null
  accessible?: readonly PropertyId[] | null
  reveal?: RevealPortalAddress
  heroStatus?: 'active' | 'taken_down'
  storeHero?: boolean
  heroHash?: string
  /** The Property's country; null when it has none recorded. */
  country?: string | null
  /** The sizes a manager may choose; the shipped list unless a test reaches for the hidden ones. */
  selectableSizes?: readonly PrintKitSize[]
  /** What the renderer does instead of returning the PDF. */
  refuse?: PrintKitRenderRefusal
}>

async function setup(options: Options = {}) {
  const portal = buildTestPortal({ name: 'Harbor lobby' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objectStore = createInMemoryObjectStore()
  const hero = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_HERO_ASSET_ID),
    purpose: 'hero',
    status: options.heroStatus ?? 'active',
    byteSize: HERO_BYTES.length,
    contentSha256: options.heroHash ?? sha256Hex(HERO_BYTES),
  })
  const logo = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_LOGO_ASSET_ID),
    purpose: 'logo',
    byteSize: LOGO_BYTES.length,
    contentSha256: sha256Hex(LOGO_BYTES),
  })
  mediaRepo.seed([hero, logo])
  if (options.storeHero !== false) {
    await objectStore.putObject(hero.objectKey, HERO_BYTES, 'image/webp')
  }
  await objectStore.putObject(logo.objectKey, LOGO_BYTES, 'image/webp')
  const reveal = vi.fn<RevealPortalAddress>(
    options.reveal ??
      (async () => ({
        publicUrl: QR_ADDRESS,
        publicUrls: { qr: QR_ADDRESS, nfc: `${QR_ADDRESS}-nfc` },
        version: 1,
        issuedAt: new Date('2026-10-01T10:00:00Z'),
      })),
  )
  const propertyCountry = vi.fn(async () => options.country ?? null)
  const rendered: PrintKitRenderInput[] = []
  const renderer: PortalPrintKitRenderer = {
    render: vi.fn(async (input) => {
      rendered.push(input)
      if (options.refuse) throw options.refuse
      return PDF
    }),
  }
  const make = createPortalPrintKit({
    portalRepo,
    staffPublicApi: staffApi(options.accessible ?? null),
    publicationRepo: {
      loadWorkingCopy: async () => options.source ?? publicationSource(),
      findActiveForPortal: async () =>
        options.live === null
          ? null
          : liveSnapshot(options.live ?? immersiveConfiguration()),
    },
    mediaRepo,
    objectStore,
    sha256Hex,
    revealAddress: reveal,
    renderer,
    propertyCountry,
    ...(options.selectableSizes ? { selectableSizes: options.selectableSizes } : {}),
  })
  return { portal, make, reveal, renderer, rendered, propertyCountry }
}

const choice = {
  style: 'paper',
  piece: 'table_tent',
  size: 'large',
  languages: ['en', 'bg'],
  callToAction: 'rate',
} as const

describe('createPortalPrintKit', () => {
  it('renders the piece the manager chose, for the address of the live code', async () => {
    const { portal, make, rendered } = await setup()

    const result = await make({ portalId: portal.id, ...choice }, buildTestAuthContext())

    expect(result).toEqual({
      fileName: 'harbor-lobby-table-tent-en-bg-letter.pdf',
      contentType: 'application/pdf',
      pdf: PDF,
    })
    const [input] = rendered
    expect(input?.piece).toBe('table_tent')
    expect(input?.qrAddress).toBe(QR_ADDRESS)
    expect(input?.faces.map((face) => face.side)).toEqual(['front', 'back'])
    expect(input?.faces[0]?.blocks.map((block) => block.headline)).toEqual([
      'Rate your visit',
      'Оценете посещението си',
    ])
    expect(input?.wordmark).toBe('HARBOR')
    expect(input?.propertyName).toBe('The Harbor Hotel')
    expect(input?.title).toBe('Harbor lobby table tent')
  })

  it.each([
    ['the US', 'US', 'letter'],
    ['Mexico', 'MX', 'letter'],
    ['Bulgaria', 'BG', 'a4'],
    ['no recorded country', null, 'letter'],
  ] as const)(
    'prints a Paper request for a property in %s on the paper it uses',
    async (_label, country, paper) => {
      const { portal, make, rendered, propertyCountry } = await setup({ country })
      const ctx = buildTestAuthContext()
      const file = await make({ portalId: portal.id, ...choice }, ctx)
      expect(rendered[0]).toMatchObject({ style: 'paper', paper })
      expect(file.fileName).toBe(`harbor-lobby-table-tent-en-bg-${paper}.pdf`)
      expect(propertyCountry).toHaveBeenCalledWith(ctx.organizationId, portal.propertyId)
    },
  )

  it('prints on the paper the manager chose over the country’s', async () => {
    const { portal, make, rendered, propertyCountry } = await setup({ country: 'US' })
    const file = await make(
      {
        portalId: portal.id,
        ...choice,
        piece: 'counter_card',
        paper: 'a4',
      },
      buildTestAuthContext(),
    )
    expect(rendered[0]).toMatchObject({ style: 'paper', paper: 'a4' })
    expect(file.fileName).toBe('harbor-lobby-counter-card-en-bg-a4.pdf')
    expect(propertyCountry).not.toHaveBeenCalled()
  })

  it('passes Immersive to the renderer on the property’s paper, and names the file for it', async () => {
    const { portal, make, rendered } = await setup({ country: 'BG' })
    const file = await make(
      { portalId: portal.id, ...choice, piece: 'counter_card', style: 'immersive' },
      buildTestAuthContext(),
    )
    expect(rendered[0]).toMatchObject({ style: 'immersive', paper: 'a4' })
    expect(file.fileName).toBe('harbor-lobby-counter-card-en-bg-immersive-a4.pdf')
  })

  it('reads the address through the audited reveal, as a download', async () => {
    const { portal, make, reveal } = await setup()
    const ctx = buildTestAuthContext()
    await make({ portalId: portal.id, ...choice }, ctx)
    expect(reveal).toHaveBeenCalledTimes(1)
    expect(reveal).toHaveBeenCalledWith({ portalId: portal.id, purpose: 'download' }, ctx)
  })

  it('prints the photo and the logo it reads from the media store', async () => {
    const { portal, make, rendered } = await setup()
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    const [input] = rendered
    expect(Buffer.from(input?.photo?.bytes ?? []).toString()).toBe('hero image bytes')
    expect(input?.photo).toMatchObject({ focalX: 0.4, focalY: 0.6 })
    expect(Buffer.from(input?.logo ?? []).toString()).toBe('logo image bytes')
  })

  it('prints no photo and no logo when the property has none', async () => {
    const base = immersiveConfiguration()
    const { portal, make, rendered } = await setup({
      live: immersiveConfiguration({
        brandProfile: { ...base.brandProfile, hero: null, logo: null },
      }),
    })
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    expect(rendered[0]?.photo).toBeNull()
    expect(rendered[0]?.logo).toBeNull()
  })

  it('prints without a photo that has been taken down since', async () => {
    const { portal, make, rendered } = await setup({ heroStatus: 'taken_down' })
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    expect(rendered[0]?.photo).toBeNull()
  })

  it('refuses a photo whose stored bytes are not what was stored', async () => {
    const { portal, make, reveal } = await setup({ heroHash: 'f'.repeat(64) })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'media_not_found' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses a photo whose object is missing', async () => {
    const { portal, make, reveal } = await setup({ storeHero: false })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'media_not_found' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses languages the portal does not offer, before it discloses anything', async () => {
    const { portal, make, reveal, renderer } = await setup()
    await expect(
      make(
        { portalId: portal.id, ...choice, languages: ['en', 'fr'] },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('refuses a language added in the editor and not yet published', async () => {
    const { portal, make, reveal, renderer } = await setup({
      source: publicationSource({ localeSet: ['en', 'bg', 'es'] }),
    })
    await expect(
      make(
        { portalId: portal.id, ...choice, languages: ['en', 'es'] },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
    expect(renderer.render).not.toHaveBeenCalled()
  })

  it('prints the look and the titles the live version published, not the draft', async () => {
    const draft = publicationSource().look
    if (draft === null) throw new Error('fixture has a look')
    const { portal, make, rendered } = await setup({
      source: publicationSource({
        look: { ...draft, wordmark: 'DRAFT', accentColour: '#112233', hero: null },
      }),
    })
    await make({ portalId: portal.id, ...choice }, buildTestAuthContext())
    const [input] = rendered
    expect(input?.wordmark).toBe('HARBOR')
    expect(input?.accentColour).toBe('#C8A45A')
    expect(input?.photo).not.toBeNull()
  })

  it('refuses to print a Portal with nothing live, before it discloses anything', async () => {
    const { portal, make, reveal } = await setup({ live: null })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'publication_snapshot_unavailable' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('offers a live version from before the Immersive Hub only the languages it serves', async () => {
    const legacy = {
      schemaVersion: 1,
      portal: { id: 'p', slug: 'harbor' },
    } as unknown as PortalPublicationConfiguration
    const { portal, make, reveal } = await setup({ live: legacy })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
    const english = await make(
      { portalId: portal.id, ...choice, languages: ['en'] },
      buildTestAuthContext(),
    )
    expect(english.contentType).toBe('application/pdf')
  })

  it('refuses a caller who may not update the Portal, before it discloses anything', async () => {
    const { portal, make, reveal } = await setup()
    await expect(
      make(
        { portalId: portal.id, ...choice },
        buildTestAuthContext({ effectivePermissions: new Set(['portal.read']) }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses a Portal in a Property the caller is not assigned to', async () => {
    const { portal, make, reveal } = await setup({
      accessible: [propertyId('a0000000-0000-0000-0000-0000000000ff')],
    })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('makes nothing when the address cannot be fetched again', async () => {
    const { portal, make, renderer } = await setup({
      reveal: async () => {
        throw portalError('address_unavailable', 'This code cannot be downloaded again.')
      },
    })
    await expect(
      make({ portalId: portal.id, ...choice }, buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'address_unavailable' })
    expect(renderer.render).not.toHaveBeenCalled()
  })
})

describe('createPortalPrintKit, at a size', () => {
  const card = { ...choice, piece: 'counter_card', languages: ['en'] } as const

  it('prints Large, in the style’s own output, when the request names neither', async () => {
    const { portal, make, rendered } = await setup()
    await make({ portalId: portal.id, ...card, size: undefined }, buildTestAuthContext())
    expect(rendered[0]).toMatchObject({ size: 'large', output: 'office' })
  })

  it.each(['table', 'mini'] as const)(
    'refuses a %s card while it is not selectable, before it reveals the address',
    async (size) => {
      const { portal, make, reveal } = await setup()
      await expect(
        make({ portalId: portal.id, ...card, size }, buildTestAuthContext()),
      ).rejects.toMatchObject({ code: 'print_format_not_offered', context: { size } })
      expect(reveal).not.toHaveBeenCalled()
    },
  )

  it('refuses a print the kit does not make, before it reveals the address', async () => {
    const { portal, make, reveal } = await setup({ selectableSizes: PRINT_KIT_SIZES })
    await expect(
      make(
        { portalId: portal.id, ...card, size: 'mini', languages: ['en', 'bg'] },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: 'A Mini card prints one language. Choose one.',
    })
    await expect(
      make(
        { portalId: portal.id, ...card, style: 'paper', output: 'print_shop' },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'print_format_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('prints a selectable Table card as an Immersive office sheet, named for its size and count', async () => {
    const { portal, make, rendered } = await setup({ selectableSizes: PRINT_KIT_SIZES })
    const file = await make(
      {
        portalId: portal.id,
        ...card,
        size: 'table',
        style: 'immersive',
        output: 'office',
      },
      buildTestAuthContext(),
    )
    expect(rendered[0]).toMatchObject({
      size: 'table',
      output: 'office',
      style: 'immersive',
    })
    expect(rendered[0]?.title).toBe('Harbor lobby table card')
    expect(file.fileName).toBe('harbor-lobby-table-card-en-immersive-4up-letter.pdf')
  })

  it('turns the renderer’s refusal of a long address on a small tile into words', async () => {
    const { portal, make } = await setup({
      selectableSizes: PRINT_KIT_SIZES,
      refuse: new PrintKitRenderRefusal({
        code: 'print_code_too_small',
        cause: 'needs_short_code',
        size: 'mini',
        moduleMm: 0.56,
      }),
    })
    await expect(
      make({ portalId: portal.id, ...card, size: 'mini' }, buildTestAuthContext()),
    ).rejects.toMatchObject({
      code: 'print_code_too_small',
      message: 'This code is too long to scan on a Mini card. Choose Large.',
      context: { cause: 'needs_short_code', size: 'mini', moduleMm: 0.56 },
    })
  })

  it('prints a selectable small tent two to a sheet, and names the tent in a refusal', async () => {
    const { portal, make, rendered } = await setup({ selectableSizes: PRINT_KIT_SIZES })
    const file = await make(
      { portalId: portal.id, ...card, piece: 'table_tent', size: 'table' },
      buildTestAuthContext(),
    )
    expect(rendered[0]).toMatchObject({
      piece: 'table_tent',
      size: 'table',
      output: 'office',
    })
    expect(file.fileName).toBe('harbor-lobby-table-tent-en-2up-letter.pdf')
    const refused = await setup({
      selectableSizes: PRINT_KIT_SIZES,
      refuse: new PrintKitRenderRefusal({
        code: 'print_code_too_small',
        cause: 'needs_short_code',
        size: 'table',
        moduleMm: 0.62,
      }),
    })
    await expect(
      refused.make(
        { portalId: refused.portal.id, ...card, piece: 'table_tent', size: 'table' },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({
      code: 'print_code_too_small',
      message: 'This code is too long to scan on a table tent. Choose Large.',
    })
  })

  it('refuses the small tent while managers may not choose its size', async () => {
    const { portal, make, rendered } = await setup()
    await expect(
      make(
        { portalId: portal.id, ...card, piece: 'table_tent', size: 'table' },
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ code: 'print_format_not_offered' })
    expect(rendered).toEqual([])
  })

  it('turns a refusal of a soft band photo into words', async () => {
    const { portal, make } = await setup({
      refuse: new PrintKitRenderRefusal({
        code: 'print_photo_too_soft',
        dpi: 96,
        minimumDpi: 120,
      }),
    })
    await expect(
      make({ portalId: portal.id, ...card, style: 'immersive' }, buildTestAuthContext()),
    ).rejects.toMatchObject({
      code: 'print_photo_too_soft',
      context: { dpi: 96, minimumDpi: 120 },
    })
  })
})

describe('printKitDownloadOf', () => {
  it('sends the file as base64 under its name and type', () => {
    expect(
      printKitDownloadOf({
        fileName: 'harbor-table-tent.pdf',
        contentType: 'application/pdf',
        pdf: new Uint8Array([37, 80, 68, 70]),
      }),
    ).toEqual({
      fileName: 'harbor-table-tent.pdf',
      contentType: 'application/pdf',
      pdfBase64: Buffer.from('%PDF').toString('base64'),
    })
  })
})
