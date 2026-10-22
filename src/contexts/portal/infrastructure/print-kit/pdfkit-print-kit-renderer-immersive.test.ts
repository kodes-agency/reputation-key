import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  printKitFaces,
  type PrintKitChoice,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import type { PrintKitWarning } from './print-kit-pages'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const TITLES = { en: 'Pool & Terrace', es: 'Piscina y terraza' }

function rendererWith(warnings: PrintKitWarning[] = []) {
  return createPdfKitPrintKitRenderer({
    now: () => new Date('2026-10-23T10:00:00Z'),
    compress: false,
    warn: (warning) => warnings.push(warning),
  })
}

const choice = (
  piece: PrintKitChoice['piece'],
  languages: PrintKitChoice['languages'],
): PrintKitChoice => ({ piece, languages, callToAction: 'rate' })

function immersiveInput(
  picked: PrintKitChoice,
  paper: PrintKitPaper,
  overrides: Partial<PrintKitRenderInput> = {},
): PrintKitRenderInput {
  return {
    title: 'Pool & Terrace',
    piece: picked.piece,
    style: 'immersive',
    paper,
    faces: printKitFaces(picked, TITLES, 'Pool & Terrace'),
    wordmark: 'Avela',
    logo: null,
    photo: null,
    accentColour: '#EAD6A8',
    fieldColour: '#16130E',
    qrAddress: ADDRESS,
    ...overrides,
  }
}

const render = async (input: PrintKitRenderInput, warnings?: PrintKitWarning[]) =>
  Buffer.from(await rendererWith(warnings).render(input)).toString('latin1')

const boxes = (text: string, name: string): number[][] =>
  [...text.matchAll(new RegExp(`/${name} \\[([^\\]]+)\\]`, 'gu'))].map((match) =>
    (match[1] ?? '').trim().split(/\s+/u).map(Number),
  )

const MM = 72 / 25.4

describe('an Immersive print', () => {
  it.each([
    ['counter_card', 'letter', [342, 486], [27, 27, 315, 459], [18, 18, 324, 468]],
    ['table_tent', 'letter', [342, 918], [27, 27, 315, 891], [18, 18, 324, 900]],
    [
      'counter_card',
      'a4',
      [125 * MM, 168 * MM],
      [10 * MM, 10 * MM, 115 * MM, 158 * MM],
      [7 * MM, 7 * MM, 118 * MM, 161 * MM],
    ],
    [
      'table_tent',
      'a4',
      [125 * MM, 316 * MM],
      [10 * MM, 10 * MM, 115 * MM, 306 * MM],
      [7 * MM, 7 * MM, 118 * MM, 309 * MM],
    ],
  ] as const)(
    'prints a %s on %s pages with its trim and bleed declared',
    async (piece, paper, size, trim, bleed) => {
      const text = await render(immersiveInput(choice(piece, ['en']), paper))
      const close = (actual: number[] | undefined, expected: readonly number[]) =>
        expected.forEach((value, index) => expect(actual?.[index]).toBeCloseTo(value, 1))
      close(boxes(text, 'MediaBox')[0], [0, 0, ...size])
      close(boxes(text, 'TrimBox')[0], trim)
      close(boxes(text, 'BleedBox')[0], bleed)
    },
  )

  it('prints a card’s back on its own page, and a tent on one', async () => {
    const card = await render(
      immersiveInput(choice('counter_card', ['en', 'es']), 'letter'),
    )
    const tent = await render(
      immersiveInput(choice('table_tent', ['en', 'es']), 'letter'),
    )
    expect(boxes(card, 'MediaBox')).toHaveLength(2)
    expect(boxes(tent, 'MediaBox')).toHaveLength(1)
  })

  it('paints the field into the bleed and says it is Immersive in the subject', async () => {
    const text = await render(immersiveInput(choice('counter_card', ['en']), 'letter'))
    // #16130E, the property's field.
    expect(text).toMatch(/0\.0862\d* 0\.0745\d* 0\.0549\d* scn/u)
    expect(text).toContain('(Print kit, immersive on letter paper)')
    expect(text.startsWith('%PDF-1.4')).toBe(true)
  })

  it('embeds the photo once for the two panels of a tent, cropped to their window', async () => {
    const bytes = await sharp({
      create: { width: 1600, height: 1000, channels: 3, background: '#6D7F6A' },
    })
      .jpeg()
      .toBuffer()
    const text = await render(
      immersiveInput(choice('table_tent', ['en']), 'letter', {
        photo: { bytes, focalX: 0.5, focalY: 0.94 },
      }),
    )
    expect(text.match(/\/Subtype \/Image/gu)).toHaveLength(1)
  })

  it('warns, and still prints, when the photo would print soft', async () => {
    const bytes = await sharp({
      create: { width: 200, height: 120, channels: 3, background: '#6D7F6A' },
    })
      .jpeg()
      .toBuffer()
    const warnings: PrintKitWarning[] = []
    await render(
      immersiveInput(choice('counter_card', ['en']), 'a4', {
        photo: { bytes, focalX: 0.5, focalY: 0.5 },
      }),
      warnings,
    )
    expect(warnings.map((warning) => warning.message)).toEqual([
      'The print kit photo prints below the resolution a print needs',
    ])
  })

  it('puts a dark logo on the cream plate', async () => {
    const logo = await sharp({
      create: { width: 900, height: 220, channels: 4, background: '#1A1A1A' },
    })
      .png()
      .toBuffer()
    const creams = async (input: PrintKitRenderInput) =>
      ((await render(input)).match(/0\.9647\d* 0\.9450\d* 0\.9019\d* scn/gu) ?? []).length
    const bare = immersiveInput(choice('counter_card', ['en']), 'letter')
    // #F6F1E6, the plate, is the tile's cream: one more fill of it, under the logo.
    expect(await creams({ ...bare, logo })).toBe((await creams(bare)) + 1)
  })
})
