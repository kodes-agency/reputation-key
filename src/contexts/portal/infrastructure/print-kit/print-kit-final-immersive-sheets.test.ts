import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import type { PrintFinalRenderInput } from '../../application/ports/portal-print-final-renderer.port'
import {
  PRINT_FINAL_ORIENTATIONS,
  PRINT_FINAL_PIECES,
  printFinalRegionOf,
  type PrintFinalFace,
} from '#/shared/domain/portal-print-final'
import {
  printFinalImmersiveSheet,
  printFinalSheetFaceBleed,
} from '#/shared/domain/portal-print-final-immersive-sheets'
import { printFinalLiveArea } from '#/shared/domain/portal-print-final-measures'
import {
  PRINT_FINAL_SHEET_MARKS,
  printFinalSheetMarks,
} from '#/shared/domain/portal-print-final-sheet-marks'
import { printFinalSheetNotes } from '#/shared/domain/portal-print-final-sheet-notes'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'

// The final Immersive office sheets as PDFs: a page per sheet at the paper's
// size, each cell holding the face with its art run into its bleed and clipped
// to it, exactly as many pieces as asked for, black crop marks, and Actual size
// asked of the print dialog where the sheet has no note to say so.

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

/** A photo light at the top and dark at the foot, 1200 × 700 px. */
async function photoBytes(): Promise<Uint8Array> {
  const width = 1200
  const height = 700
  const raw = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) {
    const level = Math.round(230 - (y / height) * 180)
    for (let x = 0; x < width; x++)
      raw.set([level, level - 10, level - 20], (y * width + x) * 3)
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .png()
      .toBuffer(),
  )
}

async function inputFor(
  face: PrintFinalFace,
  sheets: NonNullable<PrintFinalRenderInput['sheets']>,
  over: Partial<PrintFinalRenderInput> = {},
): Promise<PrintFinalRenderInput> {
  const blocks = printFinalBlocks(
    ['en'],
    'rate',
    { en: 'Review us on Google' },
    'Reception',
  )
  return {
    title: 'Hotel Elegance sheets',
    face,
    blocks: blocks,
    wordmark: 'Hotel Elegance',
    logo: null,
    accentColour: '#E3B873',
    fieldColour: '#2A1712',
    photo: { bytes: await photoBytes(), focalX: 0.5, focalY: 0.4 },
    qrAddress: SHORT,
    address: 'short',
    sheets,
    ...over,
  }
}

const faceOf = (key: (typeof KEYS)[number]): PrintFinalFace => ({
  piece: key.piece,
  orientation: key.orientation,
  look: 'immersive',
  region: printFinalRegionOf(key.paper),
})

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')
const pagesOf = (pdf: string) => [...pdf.matchAll(/\/Type \/Page\n/gu)].length

/**
 * Every face is drawn under a clip to its trim and bleed: `x y w h re`, then
 * `W n`. The grain is clipped to the same box, and is told by the overlay state
 * that follows it.
 */
function facesIn(pdf: string, face: PrintFinalFace): number {
  const { widthPt, heightPt } = printFinalLiveArea(face)
  const sheet = printFinalImmersiveSheet({
    piece: face.piece,
    orientation: face.orientation,
    paper: face.region === 'us' ? 'letter' : 'a4',
  })
  const bleed = printFinalSheetFaceBleed(sheet)
  const width = widthPt + bleed.leftPt + bleed.rightPt
  const height = heightPt + bleed.topPt + bleed.bottomPt
  return [
    ...pdf.matchAll(
      /^(-?[\d.]+) (-?[\d.]+) ([\d.]+) ([\d.]+) re\nW n(?!\nq\n\/RkOverlay)$/gmu,
    ),
  ].filter(
    (clip) =>
      Math.abs(Number(clip[1]) + bleed.leftPt) < 0.01 &&
      Math.abs(Number(clip[2]) + bleed.topPt) < 0.01 &&
      Math.abs(Number(clip[3]) - width) < 0.01 &&
      Math.abs(Number(clip[4]) - height) < 0.01,
  ).length
}

describe('the final Immersive office sheets', () => {
  it.each(KEYS.map((key) => [nameOf(key), key] as const))(
    '%s: one page at the paper’s size, a face in every cell, clipped to its bleed',
    async (_, key) => {
      const sheet = printFinalImmersiveSheet(key)
      const face = faceOf(key)
      const pdf = text(
        await renderer.render(
          await inputFor(face, { quantity: sheet.cells.length, fillSpares: false }),
        ),
      )
      const boxes = [...pdf.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/gu)]
      expect(boxes).toHaveLength(1)
      expect(Number(boxes[0]?.[1])).toBeCloseTo(sheet.widthPt, 1)
      expect(Number(boxes[0]?.[2])).toBeCloseTo(sheet.heightPt, 1)
      expect(facesIn(pdf, face)).toBe(sheet.cells.length * (sheet.folds ? 2 : 1))
      expect(pdf).not.toContain('AP.UP.RAILWAY.APP')
    },
  )

  it('turns the page to landscape where the piece turns it', async () => {
    const pdf = text(
      await renderer.render(
        await inputFor(
          { piece: 'counter', orientation: 'upright', look: 'immersive', region: 'us' },
          { quantity: 2, fillSpares: false },
        ),
      ),
    )
    expect(pdf).toContain(`/MediaBox [0 0 ${11 * 72} ${8.5 * 72}]`)
  })

  it('draws the sheet’s art once, however many pieces are on it', async () => {
    const face: PrintFinalFace = {
      piece: 'small',
      orientation: 'wide',
      look: 'immersive',
      region: 'us',
    }
    const images = async (quantity: number) =>
      [
        ...text(
          await renderer.render(await inputFor(face, { quantity, fillSpares: false })),
        ).matchAll(/\/Subtype \/Image/gu),
      ].length
    // One photo, its fade, the scrims and the grain: not one set for each piece.
    expect(await images(1)).toBe(await images(8))
    expect(await images(8)).toBe(await images(24))
  })

  describe('exact N', () => {
    const counter: PrintFinalFace = {
      piece: 'counter',
      orientation: 'wide',
      look: 'immersive',
      region: 'us',
    }

    it('prints five Counter cards on three sheets of 2, 2 and 1, and no more', async () => {
      const pdf = text(
        await renderer.render(
          await inputFor(counter, { quantity: 5, fillSpares: false }),
        ),
      )
      expect(pagesOf(pdf)).toBe(3)
      expect(facesIn(pdf, counter)).toBe(5)
    })

    it('fills the last sheet’s spare cells when asked to', async () => {
      const pdf = text(
        await renderer.render(await inputFor(counter, { quantity: 5, fillSpares: true })),
      )
      expect(pagesOf(pdf)).toBe(3)
      expect(facesIn(pdf, counter)).toBe(6)
    })

    it('prints ten Letter Small cards on sheets of 8 and 2', async () => {
      const small: PrintFinalFace = {
        piece: 'small',
        orientation: 'upright',
        look: 'immersive',
        region: 'us',
      }
      const pdf = text(
        await renderer.render(await inputFor(small, { quantity: 10, fillSpares: false })),
      )
      expect(pagesOf(pdf)).toBe(2)
      expect(facesIn(pdf, small)).toBe(10)
    })

    it('prints nine A4 Small cards on one sheet', async () => {
      const small: PrintFinalFace = {
        piece: 'small',
        orientation: 'wide',
        look: 'immersive',
        region: 'eu',
      }
      const pdf = text(
        await renderer.render(await inputFor(small, { quantity: 9, fillSpares: false })),
      )
      expect(pagesOf(pdf)).toBe(1)
      expect(facesIn(pdf, small)).toBe(9)
    })

    it('refuses a count no sheet run is meant to make, before drawing', async () => {
      for (const quantity of [0, -1, 1.5, 1001]) {
        await expect(
          renderer.render(await inputFor(counter, { quantity, fillSpares: false })),
        ).rejects.toBeInstanceOf(RangeError)
      }
    })
  })

  describe('crop marks', () => {
    const BLACK = /0\.0705\d* 0\.0862\d* 0\.0784\d* scn/gu
    const GREY = /0\.6117\d* 0\.5882\d* 0\.5568\d* scn/gu

    it('draws them black, one fill for all of a sheet’s marks, and no Paper grey', async () => {
      const pdf = text(
        await renderer.render(
          await inputFor(
            faceOf({ piece: 'counter', orientation: 'upright', paper: 'letter' }),
            {
              quantity: 2,
              fillSpares: false,
            },
          ),
        ),
      )
      expect([...pdf.matchAll(GREY)]).toHaveLength(0)
      expect([...pdf.matchAll(BLACK)].length).toBeGreaterThanOrEqual(1)
      // The 12 crop marks of the Letter Counter sheet, each a filled rectangle the weight of a tick.
      const sheet = printFinalImmersiveSheet({
        piece: 'counter',
        orientation: 'upright',
        paper: 'letter',
      })
      const marks = printFinalSheetMarks(sheet, sheet.cells)
      expect(marks).toHaveLength(12)
      const weight = PRINT_FINAL_SHEET_MARKS.tickWeightPt
      const drawn = [
        ...pdf.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re$/gmu),
      ].filter(
        (rect) =>
          Math.abs(Number(rect[3]) - weight) < 0.001 ||
          Math.abs(Number(rect[4]) - weight) < 0.001,
      )
      expect(drawn).toHaveLength(12)
    })

    it('draws a tent flat’s fold marks dashed', async () => {
      const pdf = text(
        await renderer.render(
          await inputFor(
            faceOf({ piece: 'tent', orientation: 'wide', paper: 'letter' }),
            {
              quantity: 2,
              fillSpares: false,
            },
          ),
        ),
      )
      // Two flats, two fold marks each.
      expect([...pdf.matchAll(/\[[\d. ]+\] 0 d/gu)].length).toBeGreaterThanOrEqual(1)
      expect([...pdf.matchAll(/\[\] 0 d/gu)].length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Actual size', () => {
    const scaling = async (key: (typeof KEYS)[number]) =>
      text(
        await renderer.render(
          await inputFor(faceOf(key), {
            quantity: printFinalImmersiveSheet(key).cells.length,
            fillSpares: false,
          }),
        ),
      )

    it.each(KEYS.map((key) => [nameOf(key), key] as const))(
      '%s: asks the print dialog for no scaling exactly when the sheet has no note',
      async (_, key) => {
        const noNote = printFinalSheetNotes(printFinalImmersiveSheet(key), 0).length === 0
        expect(await scaling(key)).toSatisfy((pdf: string) =>
          noNote ? pdf.includes('/PrintScaling /None') : !pdf.includes('/PrintScaling'),
        )
      },
    )

    it('asks only the Letter upright Small card sheet, which has no free paper', () => {
      const without = KEYS.filter(
        (key) => printFinalSheetNotes(printFinalImmersiveSheet(key), 0).length === 0,
      ).map(nameOf)
      expect(without).toEqual(['small upright on letter'])
    })
  })

  it('prints the Counter card on the long address, its 2.1 in tile on Letter', async () => {
    const face: PrintFinalFace = {
      piece: 'counter',
      orientation: 'upright',
      look: 'immersive',
      region: 'us',
    }
    const pdf = text(
      await renderer.render(
        await inputFor(
          face,
          { quantity: 2, fillSpares: false },
          { qrAddress: LONG, address: 'long' },
        ),
      ),
    )
    expect(pagesOf(pdf)).toBe(1)
    expect(facesIn(pdf, face)).toBe(2)
  })

  it('refuses a tent on the long address before any page', async () => {
    await expect(
      renderer.render(
        await inputFor(
          { piece: 'tent', orientation: 'wide', look: 'immersive', region: 'us' },
          { quantity: 2, fillSpares: false },
          { qrAddress: LONG, address: 'long' },
        ),
      ),
    ).rejects.toMatchObject({ refusal: { code: 'needs_short_code' } })
  })

  it('leaves a single Immersive piece’s PDF at the viewer’s default and unbled', async () => {
    const { sheets: _sheets, ...single } = await inputFor(
      { piece: 'tent', orientation: 'wide', look: 'immersive', region: 'us' },
      { quantity: 1, fillSpares: false },
    )
    const pdf = text(await renderer.render(single))
    expect(pdf).not.toContain('/PrintScaling')
    expect(pagesOf(pdf)).toBe(1)
  })
})
