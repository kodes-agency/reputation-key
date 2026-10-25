import { describe, expect, it } from 'vitest'
import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  printFinalRegionOf,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import {
  inPt,
  mmPt,
  printFinalLiveArea,
} from '#/shared/domain/portal-print-final-measures'
import {
  PRINT_FINAL_SHEET_NOTE,
  printFinalSheetNotes,
} from '#/shared/domain/portal-print-final-sheet-notes'
import { printFinalPaperSheet } from '#/shared/domain/portal-print-final-sheets'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'
import { setFinalSheetNote } from './print-kit-final-sheets'
import { PrintKitFonts } from './print-kit-pdf-text'

// The final Paper office sheets as PDFs: a page per sheet at the paper's size,
// each cell holding the face, exactly as many pieces as asked for, and Actual
// size asked of the print dialog where the sheet has no note to say so.

const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const LONG =
  'https://web-closed-beta-v2.up.railway.app/p/pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hR?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

const renderer = createPdfKitPrintFinalRenderer({
  now: () => new Date('2026-10-25T10:00:00Z'),
  compress: false,
})

const PAPERS: readonly PrintKitPaper[] = ['letter', 'a4']
const KEYS = PRINT_FINAL_PIECES.flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    PAPERS.map((paper) => ({ piece, orientation, paper })),
  ),
)
const nameOf = (key: { piece: string; orientation: string; paper: string }) =>
  `${key.piece} ${key.orientation} on ${key.paper}`

function inputFor(
  face: PrintFinalFace,
  sheets: NonNullable<PrintFinalRenderInput['sheets']>,
  over: Partial<PrintFinalRenderInput> = {},
): PrintFinalRenderInput {
  const blocks = printFinalBlocks(
    ['en'],
    { preset: 'how_did_we_do' },
    { en: 'Review us on Google' },
    'Reception',
  )
  return {
    title: 'Hotel Elegance sheets',
    face,
    blocks: blocks,
    wordmark: 'Hotel Elegance',
    logo: null,
    accentColour: '#A8C6FE',
    fieldColour: '#001E57',
    photo: null,
    qrAddress: SHORT,
    address: 'short',
    sheets,
    ...over,
  }
}

const paperFace = (key: (typeof KEYS)[number]): PrintFinalFace => ({
  piece: key.piece,
  orientation: key.orientation,
  look: 'paper',
  region: printFinalRegionOf(key.paper),
})

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')
const pagesOf = (pdf: string) => [...pdf.matchAll(/\/Type \/Page\n/gu)].length

/** Every face is drawn under a clip to its trim: `0 0 w h re`, then `W n`. */
function facesIn(pdf: string, face: PrintFinalFace): number {
  const { widthPt, heightPt } = printFinalLiveArea(face)
  return [...pdf.matchAll(/^0 0 ([\d.]+) ([\d.]+) re\nW n$/gmu)].filter(
    (clip) =>
      Math.abs(Number(clip[1]) - widthPt) < 0.01 &&
      Math.abs(Number(clip[2]) - heightPt) < 0.01,
  ).length
}

describe('the final Paper office sheets', () => {
  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: one page at the paper’s size, a face in every cell',
    async (_, key) => {
      const sheet = printFinalPaperSheet(key)
      const face = paperFace(key)
      const pdf = text(
        await renderer.render(
          inputFor(face, { quantity: sheet.cells.length, fillSpares: false }),
        ),
      )
      const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gu)]
      expect(boxes).toHaveLength(1)
      expect(Number(boxes[0]?.[1])).toBeCloseTo(sheet.widthPt, 1)
      expect(Number(boxes[0]?.[2])).toBeCloseTo(sheet.heightPt, 1)
      const facesPerCell = sheet.folds ? 2 : 1
      expect(facesIn(pdf, face)).toBe(sheet.cells.length * facesPerCell)
      expect(pdf).not.toContain('AP.UP.RAILWAY.APP')
    },
  )

  it('turns the page to landscape where the piece turns it', async () => {
    const pdf = text(
      await renderer.render(
        inputFor(
          { piece: 'tent', orientation: 'upright', look: 'paper', region: 'us' },
          { quantity: 4, fillSpares: false },
        ),
      ),
    )
    expect(pdf).toContain(`/MediaBox [0 0 ${inPt(11)} ${inPt(8.5)}]`)
  })

  describe('exact N', () => {
    const wideTent: PrintFinalFace = {
      piece: 'tent',
      orientation: 'wide',
      look: 'paper',
      region: 'us',
    }

    it('prints ten tents on three sheets of 4, 4 and 2, and no more', async () => {
      const pdf = text(
        await renderer.render(inputFor(wideTent, { quantity: 10, fillSpares: false })),
      )
      expect(pagesOf(pdf)).toBe(3)
      expect(facesIn(pdf, wideTent)).toBe(20)
    })

    it('fills the last sheet’s spare cells when asked to', async () => {
      const pdf = text(
        await renderer.render(inputFor(wideTent, { quantity: 10, fillSpares: true })),
      )
      expect(pagesOf(pdf)).toBe(3)
      expect(facesIn(pdf, wideTent)).toBe(24)
    })

    it('prints seven Letter Counter cards on sheets of 3, 3 and 1', async () => {
      const face: PrintFinalFace = {
        piece: 'counter',
        orientation: 'upright',
        look: 'paper',
        region: 'us',
      }
      const pdf = text(
        await renderer.render(inputFor(face, { quantity: 7, fillSpares: false })),
      )
      expect(pagesOf(pdf)).toBe(3)
      expect(facesIn(pdf, face)).toBe(7)
    })

    it('refuses a count no sheet run is meant to make, before drawing', async () => {
      for (const quantity of [0, -1, 1.5, 1001]) {
        await expect(
          renderer.render(inputFor(wideTent, { quantity, fillSpares: false })),
        ).rejects.toBeInstanceOf(RangeError)
      }
    })

    it('puts fewer tents on a sheet when the manager asks: ten at 3 a sheet is 3, 3, 3 and 1', async () => {
      const pdf = text(
        await renderer.render(
          inputFor(wideTent, { quantity: 10, fillSpares: false, perSheet: 3 }),
        ),
      )
      expect(pagesOf(pdf)).toBe(4)
      expect(facesIn(pdf, wideTent)).toBe(20)
    })

    it('fills spares up to the manager’s count a sheet, not every cell', async () => {
      const pdf = text(
        await renderer.render(
          inputFor(wideTent, { quantity: 10, fillSpares: true, perSheet: 3 }),
        ),
      )
      expect(pagesOf(pdf)).toBe(4)
      expect(facesIn(pdf, wideTent)).toBe(24)
    })

    it('refuses more a sheet than fit, or none', async () => {
      for (const perSheet of [0, 5, 2.5]) {
        await expect(
          renderer.render(
            inputFor(wideTent, { quantity: 10, fillSpares: false, perSheet }),
          ),
        ).rejects.toBeInstanceOf(RangeError)
      }
    })
  })

  describe('Actual size', () => {
    const scaling = async (key: (typeof KEYS)[number]) =>
      text(
        await renderer.render(
          inputFor(paperFace(key), {
            quantity: printFinalPaperSheet(key).cells.length,
            fillSpares: false,
          }),
        ),
      )

    it.each(KEYS.map((key) => [nameOf(key), key] as const))(
      '%s: asks the print dialog for no scaling exactly when the sheet has no note',
      async (_, key) => {
        const sheet = printFinalPaperSheet(key)
        const noNote = printFinalSheetNotes(sheet, 0).length === 0
        expect(await scaling(key)).toSatisfy((pdf: string) =>
          noNote ? pdf.includes('/PrintScaling /None') : !pdf.includes('/PrintScaling'),
        )
      },
    )

    it('leaves a single piece’s PDF at the viewer’s default', async () => {
      const blocks = printFinalBlocks(
        ['en'],
        { preset: 'how_did_we_do' },
        { en: 'Review us on Google' },
        'Reception',
      )
      const { sheets: _sheets, ...single } = inputFor(
        { piece: 'tent', orientation: 'wide', look: 'paper', region: 'us' },
        { quantity: 1, fillSpares: false },
        { blocks: blocks },
      )
      expect(text(await renderer.render(single))).not.toContain('/PrintScaling')
    })
  })

  it('prints the Counter card on the long address, its 2.1 in tile on Letter', async () => {
    const face: PrintFinalFace = {
      piece: 'counter',
      orientation: 'upright',
      look: 'paper',
      region: 'us',
    }
    const pdf = text(
      await renderer.render(
        inputFor(
          face,
          { quantity: 3, fillSpares: false },
          { qrAddress: LONG, address: 'long' },
        ),
      ),
    )
    expect(pagesOf(pdf)).toBe(1)
    expect(facesIn(pdf, face)).toBe(3)
  })

  it('refuses a tent on the long address before any page', async () => {
    await expect(
      renderer.render(
        inputFor(
          { piece: 'tent', orientation: 'wide', look: 'paper', region: 'us' },
          { quantity: 4, fillSpares: false },
          { qrAddress: LONG, address: 'long' },
        ),
      ),
    ).rejects.toMatchObject({ refusal: { code: 'needs_short_code' } })
  })
})

describe('the printed note', () => {
  async function setNotes(key: (typeof KEYS)[number], tilePt: number) {
    const { default: PDFDocument } = await import('pdfkit')
    const doc = new PDFDocument({ autoFirstPage: false, font: '' })
    const fonts = new PrintKitFonts(doc)
    return printFinalSheetNotes(printFinalPaperSheet(key), tilePt).map((note) => ({
      note,
      set: setFinalSheetNote(doc, fonts, note),
    }))
  }

  const SIZES: Readonly<Record<PrintKitPaper, readonly (readonly [string, number])[]>> = {
    letter: [
      ['1.25 in', inPt(1.25)],
      ['1.4 in', inPt(1.4)],
      ['1.5 in', inPt(1.5)],
      ['1.75 in step-up', inPt(1.75)],
      ['2.1 in long address', inPt(2.1)],
    ],
    a4: [
      ['32 mm', mmPt(32)],
      ['38 mm', mmPt(38)],
    ],
  }

  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: every note sets at 6.5 pt inside its box, whichever tile it names',
    async (_, key) => {
      for (const [, tilePt] of SIZES[key.paper]) {
        for (const { note, set } of await setNotes(key, tilePt)) {
          expect(set.size).toBe(PRINT_FINAL_SHEET_NOTE.sizePt)
          expect(
            set.lines.length * set.size * PRINT_FINAL_SHEET_NOTE.leading,
          ).toBeLessThanOrEqual(note.heightPt + 1e-6)
        }
      }
    },
  )
})
