import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PrintKitRenderInput } from '../../application/ports/portal-print-kit-renderer.port'
import {
  PRINT_KIT_PAPERS,
  PRINT_KIT_PIECES,
  printKitFaces,
  type PrintKitWords,
  type PrintKitPaper,
} from '#/shared/domain/portal-print-kit'
import { createPdfKitPrintKitRenderer } from './pdfkit-print-kit-renderer'
import type { PrintKitWarning } from './print-kit-pages'

const ADDRESS =
  'https://app.reputationkey.app/p/pt_AbCdEfGhIjKlMnOp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcDe?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'
const TITLES = { en: 'Pool & Terrace', es: 'Piscina y terraza' }

function rendererWith(warnings: PrintKitWarning[] = []) {
  return createPdfKitPrintKitRenderer({
    now: () => new Date('2026-10-22T10:00:00Z'),
    compress: false,
    warn: (warning) => warnings.push(warning),
  })
}

function paperInput(
  choice: PrintKitWords,
  paper: PrintKitPaper,
  overrides: Partial<PrintKitRenderInput> = {},
): PrintKitRenderInput {
  return {
    title: 'Pool & Terrace',
    piece: choice.piece,
    style: 'paper',
    paper,
    faces: printKitFaces(choice, TITLES, 'Pool & Terrace'),
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

const choice = (
  piece: PrintKitWords['piece'],
  languages: PrintKitWords['languages'],
) => ({
  piece,
  languages,
  callToAction: 'rate' as const,
})

describe('a Paper print', () => {
  it.each(
    PRINT_KIT_PIECES.flatMap((piece) =>
      PRINT_KIT_PAPERS.map((paper) => [piece, paper] as const),
    ),
  )(
    'prints a %s on %s pages the size of the sheet, with the trim the whole sheet and no bleed box',
    async (piece, paper) => {
      const text = await render(paperInput(choice(piece, ['en', 'es']), paper))
      const expected = paper === 'letter' ? [0, 0, 612, 792] : [0, 0, 595.28, 841.89]
      const media = boxes(text, 'MediaBox')
      expect(media.length).toBeGreaterThan(0)
      for (const box of [...media, ...boxes(text, 'TrimBox')]) {
        box.forEach((value, index) => expect(value).toBeCloseTo(expected[index] ?? 0, 1))
      }
      expect(text).not.toMatch(/\/BleedBox/u)
    },
  )

  it('puts the backs of a two-language card on a second page, and prints one page for one language', async () => {
    const two = await render(paperInput(choice('counter_card', ['en', 'es']), 'letter'))
    const one = await render(paperInput(choice('counter_card', ['en']), 'letter'))
    expect(boxes(two, 'MediaBox')).toHaveLength(2)
    expect(boxes(one, 'MediaBox')).toHaveLength(1)
  })

  it('prints a tent on one sheet', async () => {
    const text = await render(paperInput(choice('table_tent', ['en', 'es']), 'a4'))
    expect(boxes(text, 'MediaBox')).toHaveLength(1)
  })

  it('paints no background: the paper is the customer’s', async () => {
    const text = await render(paperInput(choice('counter_card', ['en']), 'letter'))
    // The board's paper tone is never filled.
    expect(text).not.toMatch(/0\.99\d* 0\.98\d* 0\.97\d* rg/u)
  })

  it('says it is a Paper print on its paper in the document’s subject', async () => {
    const text = await render(paperInput(choice('table_tent', ['en']), 'letter'))
    expect(text).toContain('(Print kit, paper on letter paper)')
  })

  it('warns, and still prints, when the logo would print soft', async () => {
    const logo = await sharp({
      create: { width: 120, height: 30, channels: 4, background: '#1A1A1A' },
    })
      .png()
      .toBuffer()
    const warnings: PrintKitWarning[] = []
    const text = await render(
      paperInput(choice('table_tent', ['en']), 'letter', { logo }),
      warnings,
    )
    expect(text.startsWith('%PDF-1.4')).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]?.context).toMatchObject({ minimumDpi: 150 })
  })
})
