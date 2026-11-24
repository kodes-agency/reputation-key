// The final print kit's PDF through the use case over real PostgreSQL and two
// Organizations (final design spec §11, slice 7): it discloses only after every
// check, discloses through the audited reveal (a row in the downloads table),
// hands the renderer the piece, its orientation and its sheets, and remembers
// the wording and the print as the Portal's own. The Portal, the live version,
// the pictures' rows, the code and the remembered rows are real; the renderer is
// stood in so each refusal it can make is raised on purpose.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { organizationId, portalId } from '#/shared/domain/ids'
import { PRINT_REFUSAL_COPY } from '#/shared/domain/portal-print-refusals'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import type { DownloadPortalPrintInput } from './portal-print.contracts'
import { PrintRenderRefusal } from './pdfkit-print-renderer.port.server'
import {
  COMPLETE_SCENARIO,
  SCENARIO_HERO_ASSET,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from '../publication/portal-working-copy-scenarios.test-fixtures'
import { PRINT_KIT_INTEGRATION_TABLES } from './print-kit-live-seed.test-fixtures'
import {
  createPrintKitWorld,
  PRINT_WORLD_PDF as PDF,
  PRINT_WORLD_PRINTED_AT as PRINTED_AT,
  type PrintKitWorldOptions as Options,
} from './print-kit-use-case-world.test-fixtures'

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: PRINT_KIT_INTEGRATION_TABLES,
})

const PORTAL = COMPLETE_SCENARIO.portalId
const SHORT_ADDRESS = /^HTTPS:\/\/AP\.EXAMPLE\.TEST\/p\/[0-9A-Z]{20}$/u

const harness = (options: Options = {}) => createPrintKitWorld(getPool(), options)
type World = Awaited<ReturnType<typeof harness>>

const downloads = async () =>
  (await getPool().query('SELECT purpose FROM portal_address_downloads')).rows.length

const nothingDisclosed = async () => expect(await downloads()).toBe(0)

const lastPrint = ({ lastPrintRepo, ctx }: Pick<World, 'lastPrintRepo' | 'ctx'>) =>
  lastPrintRepo.find(ctx.organizationId, portalId(PORTAL))

const savedWording = ({ wordingRepo, ctx }: Pick<World, 'wordingRepo' | 'ctx'>) =>
  wordingRepo.find(ctx.organizationId, portalId(PORTAL))

const tents = (
  over: Partial<DownloadPortalPrintInput> = {},
): DownloadPortalPrintInput => ({
  portalId: PORTAL,
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  printer: 'my_printer',
  quantity: 10,
  fillSpares: false,
  cropMarks: false,
  backPage: false,
  languages: ['en', 'bg'],
  callToAction: 'how_did_we_do',
  ...over,
})

describe.sequential('createPortalPrint (real PostgreSQL)', () => {
  it('prints the chosen piece, way up and look on office sheets, for the live code', async () => {
    const { make, rendered, ctx } = await harness()

    const file = await make(tents(), ctx)

    expect(file).toEqual({
      fileName: 'lobby-portal-table-tents-wide-en-bg-letter.pdf',
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
    expect(input?.qrAddress).toMatch(SHORT_ADDRESS)
    expect(input?.address).toBe('short')
    expect(input?.blocks.map((block) => block.headline)).toEqual([
      'How did we do?',
      'Как беше при нас?',
    ])
    expect(input?.title).toBe('Lobby portal table tents')
    expect(input?.photo).not.toBeNull()
    expect(input?.logo).not.toBeNull()
    expect(await downloads()).toBe(1)
  })

  it('prints a personal Portal whose staff name is in the Property brand', async () => {
    const { make, rendered, ctx } = await harness({
      personal: { staffName: 'Marco Rossi', publicName: 'Reception' },
      wordmark: 'Pizzeria Marco',
    })

    await make(tents(), ctx)

    expect(rendered[0]?.wordmark).toBe('Pizzeria Marco')
  })

  it('refuses a staff name in the wordmark the personal Portal wrote itself', async () => {
    const { make, rendered, wordingRepo, lastPrintRepo, ctx } = await harness({
      personal: { staffName: 'Marco Rossi', publicName: 'Reception' },
      wordmark: 'MARCO',
      ownWordmark: true,
    })

    await expect(make(tents(), ctx)).rejects.toMatchObject({
      code: 'personal_portal_name_private',
    })

    expect(await downloads()).toBe(0)
    expect(rendered).toEqual([])
    expect(await wordingRepo.find(ctx.organizationId, portalId(PORTAL))).toBeNull()
    expect(await lastPrintRepo.find(ctx.organizationId, portalId(PORTAL))).toBeNull()
  })

  it('still refuses the staff name in the personal Portal custom words', async () => {
    const { make, rendered, ctx } = await harness({
      personal: { staffName: 'Marco Rossi', publicName: 'Reception' },
      wordmark: 'Pizzeria Marco',
    })

    await expect(
      make(
        tents({
          callToAction: 'how_was_stay',
          customWords: { en: { headline: 'Ask Marco', subline: 'Tell us more' } },
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'personal_portal_name_private' })

    expect(rendered).toEqual([])
    expect(await downloads()).toBe(0)
  })

  it('keeps a neutral personal print and the manager-only name in its file name', async () => {
    const { make, rendered, ctx } = await harness({
      personal: { staffName: 'Polly Smith', publicName: 'Harbor' },
      wordmark: 'HARBOR',
    })

    const file = await make(tents(), ctx)

    expect(rendered[0]?.wordmark).toBe('HARBOR')
    expect(rendered[0]?.personalName).toBe('Polly Smith')
    expect(file.fileName).toBe('Polly Smith - Table tents.pdf')
  })

  it.each([
    [
      'passes the spares and a count a sheet the manager asked for',
      { fillSpares: true, perSheet: 3 },
      {
        sheets: { quantity: 10, fillSpares: true, perSheet: 3 },
        shop: undefined,
        fileName: expect.any(String),
      },
    ],
    [
      'gives a print shop one piece per page',
      { piece: 'counter', orientation: 'upright', printer: 'print_shop' },
      {
        sheets: undefined,
        shop: { cropMarks: false },
        fileName: 'lobby-portal-counter-cards-upright-en-bg-print-shop-letter.pdf',
      },
    ],
    [
      'asks for a print shop’s crop marks when the manager does, and names the file for them',
      {
        piece: 'counter',
        orientation: 'upright',
        printer: 'print_shop',
        cropMarks: true,
      },
      {
        sheets: undefined,
        shop: { cropMarks: true },
        fileName:
          'lobby-portal-counter-cards-upright-en-bg-print-shop-crop-marks-letter.pdf',
      },
    ],
    [
      'leaves crop marks to the print shop: office sheets ignore them',
      { cropMarks: true },
      {
        sheets: expect.anything(),
        shop: undefined,
        fileName: 'lobby-portal-table-tents-wide-en-bg-letter.pdf',
      },
    ],
  ] as const)('%s', async (_title, over, expected) => {
    const { make, rendered, ctx } = await harness()

    const file = await make(tents(over), ctx)

    expect(rendered[0]?.sheets).toEqual(expected.sheets)
    expect(rendered[0]?.shop).toEqual(expected.shop)
    expect(file.fileName).toEqual(expected.fileName)
  })

  it('hands the renderer the property’s name for a card’s back page, and none otherwise', async () => {
    const { make, rendered, live, ctx } = await harness()

    const file = await make(
      tents({ piece: 'counter', orientation: 'upright', backPage: true }),
      ctx,
    )
    await make(tents({ piece: 'counter' }), ctx)

    expect(rendered[0]?.back).toEqual({ propertyName: live.brandProfile.displayName })
    expect(file.fileName).toBe('lobby-portal-counter-cards-upright-en-bg-back-letter.pdf')
    expect(rendered[1]?.back).toBeUndefined()
  })

  it('gives a print shop’s card a back page too: the front on page 1, the back on page 2', async () => {
    const { make, rendered, live, ctx } = await harness()

    await make(tents({ piece: 'small', printer: 'print_shop', backPage: true }), ctx)

    expect(rendered[0]?.sheets).toBeUndefined()
    expect(rendered[0]?.shop).toEqual({ cropMarks: false })
    expect(rendered[0]?.back).toEqual({ propertyName: live.brandProfile.displayName })
  })

  it.each([
    [
      'prints on the paper the property’s country uses unless the request names one',
      {},
      'eu',
    ],
    [
      'prints on the paper the request names even for a European property',
      { paper: 'letter' },
      'us',
    ],
  ] as const)('%s', async (_title, over, region) => {
    const { make, rendered, ctx } = await harness({ country: 'BG' })

    await make(tents(over), ctx)

    expect(rendered[0]?.face.region).toBe(region)
  })

  it.each([
    ['a tent for a print shop', { printer: 'print_shop' }, 'tents_office_only'],
    ['more tents a sheet than fit', { perSheet: 5 }, 'per_sheet_out_of_range'],
    ['no tents', { quantity: 0 }, 'quantity_out_of_range'],
  ] as const)('refuses %s before revealing', async (_label, over, cause) => {
    const { make, ctx } = await harness()

    await expect(make(tents(over), ctx)).rejects.toMatchObject({
      code: 'print_format_not_offered',
      context: { cause },
    })
    await nothingDisclosed()
  })

  it('refuses languages the live version does not offer, before revealing', async () => {
    const { make, ctx } = await harness()

    await expect(make(tents({ languages: ['en', 'fr'] }), ctx)).rejects.toMatchObject({
      code: 'locale_not_offered',
    })
    await nothingDisclosed()
  })

  describe('saving the wording the print said as the Portal’s own', () => {
    const own = { en: { headline: 'Thanks for staying', subline: 'Tell us more' } }

    it('saves the wording and the own words that printed, normalised, for the languages of the print', async () => {
      const world = await harness()

      await world.make(
        tents({ callToAction: 'how_was_stay', languages: ['en'], customWords: own }),
        world.ctx,
      )

      expect(await savedWording(world)).toEqual({
        callToAction: 'how_was_stay',
        customWords: own,
      })
      const stored = await getPool().query(
        'SELECT organization_id, updated_at FROM portal_print_wordings WHERE portal_id = $1',
        [PORTAL],
      )
      expect(stored.rows).toEqual([
        { organization_id: WORKING_COPY_ORG, updated_at: PRINTED_AT },
      ])
    })

    it('saves the wording alone when no own words differ from its copy', async () => {
      const world = await harness()

      await world.make(
        tents({
          callToAction: 'how_was_stay',
          customWords: {
            en: { headline: 'How was your stay?', subline: 'Share your experience' },
          },
        }),
        world.ctx,
      )

      expect(await savedWording(world)).toEqual({
        callToAction: 'how_was_stay',
        customWords: null,
      })
    })

    it('saves nothing for a print that was refused', async () => {
      const world = await harness()

      await expect(world.make(tents({ quantity: 0 }), world.ctx)).rejects.toMatchObject({
        code: 'print_format_not_offered',
      })

      expect(await savedWording(world)).toBeNull()
    })

    it('still hands over the file when the wording cannot be saved, and says so without the words', async () => {
      const { make, warnings, ctx } = await harness({ failWording: true })

      const file = await make(tents({ customWords: own }), ctx)

      expect(file.pdf).toEqual(PDF)
      expect(warnings).toEqual([
        expect.objectContaining({ errorCode: 'portal_print_wording_not_remembered' }),
      ])
      expect(JSON.stringify(warnings)).not.toContain('Thanks for staying')
    })
  })

  describe('remembering the print as the Portal’s last', () => {
    it('keeps the choices as the manager made them, on the paper the file was made for', async () => {
      const world = await harness({ country: 'BG' })

      await world.make(
        tents({ fillSpares: true, perSheet: 3, backPage: false }),
        world.ctx,
      )

      expect(await lastPrint(world)).toEqual({
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
      })
    })

    it('keeps the photo an Immersive print used, by image and framing, and none for Paper', async () => {
      const world = await harness()

      await world.make(tents({ look: 'immersive' }), world.ctx)
      const immersive = await lastPrint(world)
      await world.make(tents({ look: 'paper' }), world.ctx)
      const paper = await lastPrint(world)

      expect(immersive?.photo).toEqual({
        assetId: SCENARIO_HERO_ASSET,
        focalX: 0.3,
        focalY: 0.7,
      })
      expect(paper?.photo).toBeNull()
    })

    it('keeps a print shop’s choices too, the form coming back as it was', async () => {
      const world = await harness()

      await world.make(
        tents({
          piece: 'counter',
          orientation: 'upright',
          printer: 'print_shop',
          cropMarks: true,
          backPage: true,
          quantity: 40,
        }),
        world.ctx,
      )

      expect((await lastPrint(world))?.settings).toMatchObject({
        piece: 'counter',
        printer: 'print_shop',
        cropMarks: true,
        backPage: true,
        quantity: 40,
      })
    })

    it('never keeps the address or a code', async () => {
      const { make, rendered, ctx } = await harness()

      await make(tents(), ctx)

      const stored = await getPool().query(
        `SELECT to_jsonb(l)::text AS row FROM portal_last_prints l
         UNION ALL SELECT to_jsonb(w)::text FROM portal_print_wordings w`,
      )
      const text = stored.rows.map((row) => row.row).join(' ')
      expect(text).not.toMatch(/railway|example\.test|\/p\//iu)
      expect(text).not.toContain(rendered[0]?.qrAddress ?? 'no-address')
    })

    it('keeps nothing of a print that was refused', async () => {
      const world = await harness({
        refuse: new PrintRenderRefusal({ code: 'needs_short_code', moduleMm: null }),
      })

      await expect(world.make(tents(), world.ctx)).rejects.toMatchObject({
        code: 'print_code_too_small',
      })

      expect(await lastPrint(world)).toBeNull()
    })

    it('still hands over the file when the print cannot be remembered, and says so without the address', async () => {
      const { make, warnings, rendered, ctx } = await harness({ failLastPrint: true })

      const file = await make(tents(), ctx)

      expect(file.pdf).toEqual(PDF)
      expect(warnings).toEqual([
        expect.objectContaining({ errorCode: 'portal_last_print_not_remembered' }),
      ])
      expect(JSON.stringify(warnings)).not.toContain(PORTAL)
      expect(JSON.stringify(warnings)).not.toContain(
        rendered[0]?.qrAddress ?? 'no-address',
      )
    })
  })

  it('refuses a viewer who may not make prints', async () => {
    const { make } = await harness()

    await expect(
      make(
        tents(),
        buildTestAuthContext({
          organizationId: WORKING_COPY_ORG,
          effectivePermissions: new Set(['portal.read']),
        }),
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })
    await nothingDisclosed()
  })

  it('refuses a Property outside the caller’s access before revealing', async () => {
    const { make, ctx } = await harness({ accessible: [randomUUID()] })

    await expect(make(tents(), ctx)).rejects.toMatchObject({ code: 'forbidden' })
    await nothingDisclosed()
  })

  it('does not find a Portal of another Organization, and discloses nothing', async () => {
    const { make, rendered } = await harness()

    await expect(
      make(
        tents(),
        buildTestAuthContext({ organizationId: organizationId(WORKING_COPY_OTHER_ORG) }),
      ),
    ).rejects.toMatchObject({ code: 'portal_not_found' })
    expect(rendered).toEqual([])
    await nothingDisclosed()
  })

  it('refuses a Portal with no live publication before revealing', async () => {
    const { make, ctx } = await harness({ live: false })

    await expect(make(tents(), ctx)).rejects.toMatchObject({
      code: 'publication_snapshot_unavailable',
    })
    await nothingDisclosed()
  })

  it('makes and remembers nothing when the live address cannot be revealed', async () => {
    const world = await harness({ codeSealed: false })

    await expect(world.make(tents(), world.ctx)).rejects.toMatchObject({
      code: 'address_unavailable',
    })

    expect(world.rendered).toEqual([])
    expect(await lastPrint(world)).toBeNull()
    expect(await savedWording(world)).toBeNull()
  })

  // Renderer and format refusals: `beforeReveal` rows are refused before the
  // address is disclosed; `keepsNothing` rows leave no remembered print.
  it.each([
    [
      'refuses a back page on a tent before revealing: a tent prints its front on both faces',
      undefined,
      { backPage: true },
      {
        code: 'print_format_not_offered',
        message:
          'Tents print the front on both faces, so they have no back page. Choose a card for one.',
        context: { cause: 'no_back_for_tents' },
      },
      { beforeReveal: true, keepsNothing: false },
    ],
    [
      'says why the code cannot print on the piece, in the Share tab’s words',
      'needs_short_code',
      {},
      {
        code: 'print_code_too_small',
        message:
          'Replace the code to print tents and Small cards. Counter cards print with the code you have.',
        context: { cause: 'needs_short_code' },
      },
      { beforeReveal: false, keepsNothing: false },
    ],
    [
      'says when the words do not fit the piece, in the Share tab’s words, and keeps nothing',
      'words_do_not_fit',
      {},
      {
        code: 'print_format_not_offered',
        message: PRINT_REFUSAL_COPY.words_do_not_fit,
        context: { cause: 'words_do_not_fit' },
      },
      { beforeReveal: false, keepsNothing: true },
    ],
    [
      'asks the manager to shorten their own words when the face cannot hold them',
      'words_do_not_fit',
      {
        customWords: {
          en: {
            headline: 'Tell us how your visit went today, in a few taps',
            subline: '',
          },
        },
      },
      {
        code: 'print_format_not_offered',
        message: PRINT_REFUSAL_COPY.shorten_to_fit,
        context: { cause: 'shorten_to_fit' },
      },
      { beforeReveal: false, keepsNothing: false },
    ],
  ] as const)('%s', async (_title, refusal, over, expected, checks) => {
    const world = await harness(
      refusal
        ? { refuse: new PrintRenderRefusal({ code: refusal, moduleMm: null }) }
        : {},
    )

    await expect(world.make(tents(over), world.ctx)).rejects.toMatchObject(expected)

    if (checks.beforeReveal) await nothingDisclosed()
    if (checks.keepsNothing) expect(await lastPrint(world)).toBeNull()
  })

  it('prints the manager’s own words where they wrote them and the wording in the other language', async () => {
    const { make, rendered, ctx } = await harness()

    await make(
      tents({
        callToAction: 'rate_visit',
        customWords: { en: { headline: 'How was today?', subline: '' } },
      }),
      ctx,
    )

    expect(
      rendered[0]?.blocks.map(({ headline, subline }) => [headline, subline]),
    ).toEqual([
      ['How was today?', ''],
      ['Оценете посещението си', 'Около 30 секунди'],
    ])
  })

  it('refuses a wording that rule F holds back in a language of the print, before the address is read', async () => {
    const world = await harness({ localeSet: ['en', 'de'] })
    const { make, ctx } = world

    await expect(
      make(tents({ languages: ['en', 'de'], callToAction: 'got_30_seconds' }), ctx),
    ).rejects.toMatchObject({
      code: 'print_format_not_offered',
      message: PRINT_REFUSAL_COPY.wording_not_available,
      context: { cause: 'wording_not_available' },
    })
    // Own words in English alone do not lift the hold on the German copy.
    await expect(
      make(
        tents({
          languages: ['en', 'de'],
          callToAction: 'got_30_seconds',
          customWords: { en: { headline: 'How was today?', subline: '' } },
        }),
        ctx,
      ),
    ).rejects.toMatchObject({ context: { cause: 'wording_not_available' } })
    await nothingDisclosed()
    expect(await lastPrint(world)).toBeNull()
  })

  it('prints a held wording’s language once the manager has written their own words in it', async () => {
    const { make, rendered, ctx } = await harness({ localeSet: ['en', 'de'] })

    await make(
      tents({
        languages: ['en', 'de'],
        callToAction: 'got_30_seconds',
        customWords: { de: { headline: 'Wie war es heute?', subline: '' } },
      }),
      ctx,
    )

    expect(rendered[0]?.blocks.map(({ headline }) => headline)).toEqual([
      'Got 30 seconds?',
      'Wie war es heute?',
    ])
  })

  it.each(['Get 10% off', 'Feel free to tell us; free dessert'])(
    'refuses own words that offer something for the review, before the address is read (%s)',
    async (headline) => {
      const { make, ctx } = await harness()

      await expect(
        make(tents({ customWords: { en: { headline, subline: '' } } }), ctx),
      ).rejects.toMatchObject({
        code: 'print_format_not_offered',
        message: PRINT_REFUSAL_COPY.remove_offer,
        context: { cause: 'remove_offer' },
      })
      await nothingDisclosed()
    },
  )

  it('remembers the manager’s own words with the print, only the languages that changed', async () => {
    const world = await harness()

    await world.make(
      tents({
        callToAction: 'rate_visit',
        customWords: {
          en: { headline: 'How was today?', subline: '' },
          bg: { headline: 'Оценете посещението си', subline: 'Около 30 секунди' },
        },
      }),
      world.ctx,
    )

    expect((await lastPrint(world))?.settings).toMatchObject({
      callToAction: 'rate_visit',
      customWords: { en: { headline: 'How was today?', subline: '' } },
    })
  })
})
