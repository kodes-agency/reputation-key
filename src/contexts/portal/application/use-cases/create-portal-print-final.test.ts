// Portal context — the final print kit's PDF (final design spec §11, slice 7):
// behind PRINT_KIT_FINAL_ENABLED, it refuses what the kit does not make before
// it discloses, discloses through the audited reveal, and hands the renderer
// the piece, its orientation and its sheets.

import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryPortalRepo } from '#/shared/testing/in-memory-portal-repo'
import { createInMemoryObjectStore } from '#/shared/testing/in-memory-object-store'
import { createInMemoryPortalLastPrintRepo } from '#/shared/testing/in-memory-portal-last-print-repo'
import { createInMemoryPortalPrintWordingRepo } from '#/shared/testing/in-memory-portal-print-wording-repo'
import { createInMemoryPortalMediaAssetRepo } from '#/shared/testing/in-memory-portal-media-asset-repo'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { portalMediaAssetId } from '#/shared/domain/ids'
import { PRINT_FINAL_REFUSAL_COPY } from '#/shared/domain/portal-print-final-refusals'
import type { PortalPublicationSnapshot } from '../../domain/portal-publication-snapshot'
import { immersiveConfiguration } from '../../domain/__fixtures__/immersive-configuration'
import {
  publicationSource,
  SOURCE_HERO_ASSET_ID,
  SOURCE_LOGO_ASSET_ID,
} from '../../domain/__fixtures__/publication-source'
import type { DownloadPortalPrintFinalInput } from '../dto/portal-print-final.dto'
import {
  PrintFinalRenderRefusal,
  type PortalPrintFinalRenderer,
  type PrintFinalRenderInput,
} from '../ports/portal-print-final-renderer.port'
import { createPortalPrintFinal } from './create-portal-print-final'
import type { RevealPortalAddress } from './reveal-portal-address'

const SHORT_ADDRESS = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const PDF = new Uint8Array([37, 80, 68, 70])
const sha256Hex = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const HERO_BYTES = Buffer.from('hero image bytes')
const LOGO_BYTES = Buffer.from('logo image bytes')
const PRINTED_AT = new Date('2026-10-25T09:30:00.000Z')

type Options = Readonly<{
  enabled?: boolean
  country?: string | null
  refuse?: PrintFinalRenderRefusal
  /** The languages the live version offers; English and Bulgarian by default. */
  localeSet?: NonNullable<Parameters<typeof immersiveConfiguration>[0]>['localeSet']
}>

async function setup(options: Options = {}) {
  const portal = buildTestPortal({ name: 'Reception' })
  const portalRepo = createInMemoryPortalRepo()
  portalRepo.seed([portal])
  const mediaRepo = createInMemoryPortalMediaAssetRepo()
  const objectStore = createInMemoryObjectStore()
  const hero = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_HERO_ASSET_ID),
    purpose: 'hero',
    byteSize: HERO_BYTES.length,
    contentSha256: sha256Hex(HERO_BYTES),
  })
  const logo = buildTestPortalMediaAsset({
    id: portalMediaAssetId(SOURCE_LOGO_ASSET_ID),
    purpose: 'logo',
    byteSize: LOGO_BYTES.length,
    contentSha256: sha256Hex(LOGO_BYTES),
  })
  mediaRepo.seed([hero, logo])
  await objectStore.putObject(hero.objectKey, HERO_BYTES, 'image/webp')
  await objectStore.putObject(logo.objectKey, LOGO_BYTES, 'image/webp')
  const reveal = vi.fn<RevealPortalAddress>(async () => ({
    publicUrl: SHORT_ADDRESS,
    publicUrls: { qr: SHORT_ADDRESS, nfc: SHORT_ADDRESS, direct: SHORT_ADDRESS },
    version: 1,
    issuedAt: new Date('2026-10-01T10:00:00Z'),
  }))
  const lastPrintRepo = createInMemoryPortalLastPrintRepo()
  const wordingRepo = createInMemoryPortalPrintWordingRepo()
  const warnings: object[] = []
  const logger = {
    ...createMockLogger(),
    warn: (context: unknown) => {
      if (typeof context === 'object' && context !== null) warnings.push(context)
    },
  }
  const rendered: PrintFinalRenderInput[] = []
  const renderer: PortalPrintFinalRenderer = {
    render: vi.fn(async (input) => {
      rendered.push(input)
      if (options.refuse) throw options.refuse
      return PDF
    }),
  }
  const make = createPortalPrintFinal({
    portalRepo,
    staffPublicApi: {
      getAccessiblePropertyIds: async () => null,
      getAssignedPortals: async () => [],
    },
    publicationRepo: {
      loadWorkingCopy: async () => publicationSource(),
      findActiveForPortal: async () =>
        ({
          id: 'snapshot-1',
          version: 1,
          configuration: immersiveConfiguration(
            options.localeSet === undefined ? {} : { localeSet: options.localeSet },
          ),
        }) as PortalPublicationSnapshot,
    },
    mediaRepo,
    objectStore,
    sha256Hex,
    revealAddress: reveal,
    renderer,
    propertyCountry: async () => options.country ?? 'US',
    finalKitEnabled: options.enabled ?? true,
    lastPrintRepo,
    wordingRepo,
    clock: () => PRINTED_AT,
    logger,
  })
  return { portal, make, reveal, rendered, lastPrintRepo, wordingRepo, warnings }
}

const tents = (
  portalId: string,
  over: Partial<DownloadPortalPrintFinalInput> = {},
): DownloadPortalPrintFinalInput => ({
  portalId,
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  printer: 'my_printer',
  quantity: 10,
  languages: ['en', 'bg'],
  callToAction: 'how_did_we_do',
  ...over,
})

describe('createPortalPrintFinal', () => {
  it('prints the chosen piece, way up and look on office sheets, for the live code', async () => {
    const { portal, make, rendered } = await setup()

    const file = await make(tents(portal.id), buildTestAuthContext())

    expect(file).toEqual({
      fileName: 'reception-table-tents-wide-en-bg-letter.pdf',
      contentType: 'application/pdf',
      pdf: PDF,
    })
    const [input] = rendered
    expect(input?.face).toEqual({
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      region: 'us',
    })
    expect(input?.sheets).toEqual({
      quantity: 10,
      fillSpares: false,
      perSheet: undefined,
    })
    expect(input?.qrAddress).toBe(SHORT_ADDRESS)
    expect(input?.address).toBe('short')
    expect(input?.blocks.map((block) => block.headline)).toEqual([
      'How did we do?',
      'Как беше при нас?',
    ])
    expect(input?.title).toBe('Reception table tents')
    expect(input?.photo).not.toBeNull()
    expect(input?.logo).not.toBeNull()
  })

  it('passes the spares and a count a sheet the manager asked for', async () => {
    const { portal, make, rendered } = await setup()

    await make(
      tents(portal.id, { fillSpares: true, perSheet: 3 }),
      buildTestAuthContext(),
    )

    expect(rendered[0]?.sheets).toEqual({ quantity: 10, fillSpares: true, perSheet: 3 })
  })

  it('gives a print shop one piece per page', async () => {
    const { portal, make, rendered } = await setup()

    const file = await make(
      tents(portal.id, {
        piece: 'counter',
        orientation: 'upright',
        printer: 'print_shop',
      }),
      buildTestAuthContext(),
    )

    expect(rendered[0]?.sheets).toBeUndefined()
    expect(rendered[0]?.shop).toEqual({ cropMarks: false })
    expect(file.fileName).toBe(
      'reception-counter-cards-upright-en-bg-print-shop-letter.pdf',
    )
  })

  it('asks for a print shop’s crop marks when the manager does, and names the file for them', async () => {
    const { portal, make, rendered } = await setup()

    const file = await make(
      tents(portal.id, {
        piece: 'counter',
        orientation: 'upright',
        printer: 'print_shop',
        cropMarks: true,
      }),
      buildTestAuthContext(),
    )

    expect(rendered[0]?.shop).toEqual({ cropMarks: true })
    expect(file.fileName).toBe(
      'reception-counter-cards-upright-en-bg-print-shop-crop-marks-letter.pdf',
    )
  })

  it('leaves crop marks to the print shop: office sheets ignore them', async () => {
    const { portal, make, rendered } = await setup()

    const file = await make(tents(portal.id, { cropMarks: true }), buildTestAuthContext())

    expect(rendered[0]?.shop).toBeUndefined()
    expect(rendered[0]?.sheets).toBeDefined()
    expect(file.fileName).toBe('reception-table-tents-wide-en-bg-letter.pdf')
  })

  it('hands the renderer the property’s name for a card’s back page, and none otherwise', async () => {
    const { portal, make, rendered } = await setup()

    const file = await make(
      tents(portal.id, { piece: 'counter', orientation: 'upright', backPage: true }),
      buildTestAuthContext(),
    )
    await make(tents(portal.id, { piece: 'counter' }), buildTestAuthContext())

    expect(rendered[0]?.back).toEqual({ propertyName: 'The Harbor Hotel' })
    expect(file.fileName).toBe('reception-counter-cards-upright-en-bg-back-letter.pdf')
    expect(rendered[1]?.back).toBeUndefined()
  })

  it('gives a print shop’s card a back page too: the front on page 1, the back on page 2', async () => {
    const { portal, make, rendered } = await setup()

    await make(
      tents(portal.id, { piece: 'small', printer: 'print_shop', backPage: true }),
      buildTestAuthContext(),
    )

    expect(rendered[0]?.sheets).toBeUndefined()
    expect(rendered[0]?.shop).toEqual({ cropMarks: false })
    expect(rendered[0]?.back).toEqual({ propertyName: 'The Harbor Hotel' })
  })

  it('refuses a back page on a tent before revealing: a tent prints its front on both faces', async () => {
    const { portal, make, reveal } = await setup()

    await expect(
      make(tents(portal.id, { backPage: true }), buildTestAuthContext()),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message:
        'Tents print the front on both faces, so they have no back page. Choose a card for one.',
      context: { cause: 'no_back_for_tents' },
    })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('prints on the paper the property’s country uses unless the request names one', async () => {
    const european = await setup({ country: 'BG' })
    await european.make(tents(european.portal.id), buildTestAuthContext())
    expect(european.rendered[0]?.face.region).toBe('eu')

    const named = await setup({ country: 'BG' })
    await named.make(tents(named.portal.id, { paper: 'letter' }), buildTestAuthContext())
    expect(named.rendered[0]?.face.region).toBe('us')
  })

  it('refuses every download while the server has the final kit off, before revealing', async () => {
    const { portal, make, reveal } = await setup({ enabled: false })

    await expect(make(tents(portal.id), buildTestAuthContext())).rejects.toMatchObject({
      code: 'print_format_not_offered',
    })
    expect(reveal).not.toHaveBeenCalled()
  })

  it.each([
    ['a tent for a print shop', { printer: 'print_shop' }, 'tents_office_only'],
    ['more tents a sheet than fit', { perSheet: 5 }, 'per_sheet_out_of_range'],
    ['no tents', { quantity: 0 }, 'quantity_out_of_range'],
  ] as const)('refuses %s before revealing', async (_label, over, cause) => {
    const { portal, make, reveal } = await setup()

    await expect(
      make(tents(portal.id, over), buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'print_format_not_offered', context: { cause } })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('refuses languages the live version does not offer, before revealing', async () => {
    const { portal, make, reveal } = await setup()

    await expect(
      make(tents(portal.id, { languages: ['en', 'fr'] }), buildTestAuthContext()),
    ).rejects.toMatchObject({ code: 'locale_not_offered' })
    expect(reveal).not.toHaveBeenCalled()
  })

  describe('saving the wording the print said as the Portal’s own', () => {
    const ctx = buildTestAuthContext()
    const own = { en: { headline: 'Thanks for staying', subline: 'Tell us more' } }

    it('saves the wording and the own words that printed, normalised, for the languages of the print', async () => {
      const { portal, make, wordingRepo } = await setup()

      await make(
        tents(portal.id, {
          callToAction: 'how_was_stay',
          languages: ['en'],
          customWords: own,
        }),
        ctx,
      )

      expect(wordingRepo.saved()).toEqual([
        {
          organizationId: ctx.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          wording: { callToAction: 'how_was_stay', customWords: own },
          savedAt: PRINTED_AT,
        },
      ])
      expect(await wordingRepo.find(ctx.organizationId, portal.id)).toEqual({
        callToAction: 'how_was_stay',
        customWords: own,
      })
    })

    it('saves the wording alone when no own words differ from its copy', async () => {
      const { portal, make, wordingRepo } = await setup()

      await make(
        tents(portal.id, {
          callToAction: 'how_was_stay',
          customWords: {
            en: { headline: 'How was your stay?', subline: 'Share your experience' },
          },
        }),
        ctx,
      )

      expect(wordingRepo.saved()[0]?.wording).toEqual({
        callToAction: 'how_was_stay',
        customWords: null,
      })
    })

    it('saves nothing for a print that was refused', async () => {
      const { portal, make, wordingRepo } = await setup()

      await expect(make(tents(portal.id, { quantity: 0 }), ctx)).rejects.toMatchObject({
        code: 'print_format_not_offered',
      })

      expect(wordingRepo.saved()).toEqual([])
    })

    it('still hands over the file when the wording cannot be saved, and says so without the words', async () => {
      const { portal, make, wordingRepo, warnings } = await setup()
      wordingRepo.failNextSave(new Error('connection reset'))

      const file = await make(tents(portal.id, { customWords: own }), ctx)

      expect(file.pdf).toEqual(PDF)
      expect(warnings).toEqual([
        expect.objectContaining({ errorCode: 'portal_print_wording_not_remembered' }),
      ])
      expect(JSON.stringify(warnings)).not.toContain('Thanks for staying')
    })
  })

  describe('remembering the print as the Portal’s last', () => {
    const ctx = buildTestAuthContext()

    it('keeps the choices as the manager made them, on the paper the file was made for', async () => {
      const { portal, make, lastPrintRepo } = await setup({ country: 'BG' })

      await make(
        tents(portal.id, { fillSpares: true, perSheet: 3, backPage: false }),
        ctx,
      )

      expect(lastPrintRepo.recorded()).toEqual([
        {
          organizationId: ctx.organizationId,
          propertyId: portal.propertyId,
          portalId: portal.id,
          printedAt: PRINTED_AT,
          settings: {
            piece: 'tent',
            orientation: 'wide',
            look: 'paper',
            paper: 'a4',
            printer: 'my_printer',
            quantity: 10,
            fillSpares: true,
            perSheet: 3,
            cropMarks: false,
            backPage: false,
            languages: ['en', 'bg'],
            callToAction: 'how_did_we_do',
            customWords: null,
          },
          photo: null,
        },
      ])
    })

    it('keeps the photo an Immersive print used, by image and framing, and none for Paper', async () => {
      const { portal, make, lastPrintRepo } = await setup()

      await make(tents(portal.id, { look: 'immersive' }), ctx)
      await make(tents(portal.id, { look: 'paper' }), ctx)

      const [immersive, paper] = lastPrintRepo.recorded()
      expect(immersive?.photo).toEqual({
        assetId: SOURCE_HERO_ASSET_ID,
        focalX: 0.4,
        focalY: 0.6,
      })
      expect(paper?.photo).toBeNull()
    })

    it('keeps a print shop’s choices too, the form coming back as it was', async () => {
      const { portal, make, lastPrintRepo } = await setup()

      await make(
        tents(portal.id, {
          piece: 'counter',
          orientation: 'upright',
          printer: 'print_shop',
          cropMarks: true,
          backPage: true,
          quantity: 40,
        }),
        ctx,
      )

      expect(lastPrintRepo.recorded()[0]?.settings).toMatchObject({
        piece: 'counter',
        printer: 'print_shop',
        cropMarks: true,
        backPage: true,
        quantity: 40,
      })
    })

    it('never keeps the address or a code', async () => {
      const { portal, make, lastPrintRepo } = await setup()

      await make(tents(portal.id), ctx)

      expect(JSON.stringify(lastPrintRepo.recorded())).not.toMatch(
        /railway|\/p\/|7K3QZ0VD9MWX4HT2BN6R/iu,
      )
    })

    it('keeps nothing of a print that was refused', async () => {
      const refused = await setup({ enabled: false })
      await expect(refused.make(tents(refused.portal.id), ctx)).rejects.toMatchObject({
        code: 'print_format_not_offered',
      })
      const drawn = await setup({
        refuse: new PrintFinalRenderRefusal({ code: 'needs_short_code', moduleMm: null }),
      })
      await expect(drawn.make(tents(drawn.portal.id), ctx)).rejects.toMatchObject({
        code: 'print_code_too_small',
      })

      expect(refused.lastPrintRepo.recorded()).toEqual([])
      expect(drawn.lastPrintRepo.recorded()).toEqual([])
    })

    it('still hands over the file when the print cannot be remembered, and says so without the address', async () => {
      const { portal, make, lastPrintRepo, warnings } = await setup()
      lastPrintRepo.failNextRecord(new Error('connection reset'))

      const file = await make(tents(portal.id), ctx)

      expect(file.pdf).toEqual(PDF)
      expect(warnings).toEqual([
        expect.objectContaining({ errorCode: 'portal_last_print_not_remembered' }),
      ])
      expect(JSON.stringify(warnings)).not.toContain(portal.id)
      expect(JSON.stringify(warnings)).not.toContain(SHORT_ADDRESS)
    })
  })

  it('refuses a viewer who may not make prints', async () => {
    const { portal, make, reveal } = await setup()

    await expect(
      make(
        tents(portal.id),
        buildTestAuthContext({ effectivePermissions: new Set(['portal.read']) }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('says why the code cannot print on the piece, in the Share tab’s words', async () => {
    const { portal, make } = await setup({
      refuse: new PrintFinalRenderRefusal({ code: 'needs_short_code', moduleMm: null }),
    })

    await expect(make(tents(portal.id), buildTestAuthContext())).rejects.toMatchObject({
      code: 'print_code_too_small',
      message:
        'Replace the code to print tents and Small cards. Counter cards print with the code you have.',
      context: { cause: 'needs_short_code' },
    })
  })

  it('says when the words do not fit the piece, in the Share tab’s words, and keeps nothing', async () => {
    const { portal, make, lastPrintRepo } = await setup({
      refuse: new PrintFinalRenderRefusal({ code: 'words_do_not_fit', moduleMm: null }),
    })

    await expect(make(tents(portal.id), buildTestAuthContext())).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: PRINT_FINAL_REFUSAL_COPY.words_do_not_fit,
      context: { cause: 'words_do_not_fit' },
    })
    expect(lastPrintRepo.recorded()).toEqual([])
  })

  it('prints the manager’s own words where they wrote them and the wording in the other language', async () => {
    const { portal, make, rendered } = await setup()

    await make(
      tents(portal.id, {
        callToAction: 'rate_visit',
        customWords: { en: { headline: 'How was today?', subline: '' } },
      }),
      buildTestAuthContext(),
    )

    expect(
      rendered[0]?.blocks.map(({ headline, subline }) => [headline, subline]),
    ).toEqual([
      ['How was today?', ''],
      ['Оценете посещението си', 'Около 30 секунди'],
    ])
  })

  it('asks the manager to shorten their own words when the face cannot hold them', async () => {
    const { portal, make } = await setup({
      refuse: new PrintFinalRenderRefusal({ code: 'words_do_not_fit', moduleMm: null }),
    })

    await expect(
      make(
        tents(portal.id, {
          customWords: {
            en: {
              headline: 'Tell us how your visit went today, in a few taps',
              subline: '',
            },
          },
        }),
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: PRINT_FINAL_REFUSAL_COPY.shorten_to_fit,
      context: { cause: 'shorten_to_fit' },
    })
  })

  it('refuses a wording that rule F holds back in a language of the print, before the address is read', async () => {
    const { portal, make, reveal, lastPrintRepo } = await setup({
      localeSet: ['en', 'de'],
    })

    await expect(
      make(
        tents(portal.id, { languages: ['en', 'de'], callToAction: 'got_30_seconds' }),
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: PRINT_FINAL_REFUSAL_COPY.wording_not_available,
      context: { cause: 'wording_not_available' },
    })
    // Own words in English alone do not lift the hold on the German copy.
    await expect(
      make(
        tents(portal.id, {
          languages: ['en', 'de'],
          callToAction: 'got_30_seconds',
          customWords: { en: { headline: 'How was today?', subline: '' } },
        }),
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({ context: { cause: 'wording_not_available' } })
    expect(reveal).not.toHaveBeenCalled()
    expect(lastPrintRepo.recorded()).toEqual([])
  })

  it('prints a held wording’s language once the manager has written their own words in it', async () => {
    const { portal, make, rendered } = await setup({ localeSet: ['en', 'de'] })

    await make(
      tents(portal.id, {
        languages: ['en', 'de'],
        callToAction: 'got_30_seconds',
        customWords: { de: { headline: 'Wie war es heute?', subline: '' } },
      }),
      buildTestAuthContext(),
    )

    expect(rendered[0]?.blocks.map(({ headline }) => headline)).toEqual([
      'Got 30 seconds?',
      'Wie war es heute?',
    ])
  })

  it('refuses own words that offer something for the review, before the address is read', async () => {
    const { portal, make, reveal } = await setup()

    await expect(
      make(
        tents(portal.id, {
          customWords: { en: { headline: 'Get 10% off', subline: '' } },
        }),
        buildTestAuthContext(),
      ),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: PRINT_FINAL_REFUSAL_COPY.remove_offer,
      context: { cause: 'remove_offer' },
    })
    expect(reveal).not.toHaveBeenCalled()
  })

  it('remembers the manager’s own words with the print, only the languages that changed', async () => {
    const { portal, make, lastPrintRepo } = await setup()

    await make(
      tents(portal.id, {
        callToAction: 'rate_visit',
        customWords: {
          en: { headline: 'How was today?', subline: '' },
          bg: { headline: 'Оценете посещението си', subline: 'Около 30 секунди' },
        },
      }),
      buildTestAuthContext(),
    )

    expect(lastPrintRepo.recorded()[0]?.settings).toMatchObject({
      callToAction: 'rate_visit',
      customWords: { en: { headline: 'How was today?', subline: '' } },
    })
  })
})
