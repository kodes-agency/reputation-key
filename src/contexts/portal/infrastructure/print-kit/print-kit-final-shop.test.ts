import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  PrintFinalRenderRefusal,
  type PrintFinalRenderInput,
} from '../../application/ports/portal-print-final-renderer.port'
import {
  PRINT_FINAL_ORIENTATIONS,
  type PrintFinalFace,
  type PrintFinalLook,
  type PrintFinalOrientation,
  type PrintFinalPiece,
  type PrintFinalRegion,
} from '#/shared/domain/portal-print-final'
import { PRINT_FINAL_SHEET_MARKS } from '#/shared/domain/portal-print-final-sheet-marks'
import { printFinalShopPage } from '#/shared/domain/portal-print-final-shop'
import { printFinalBlocks } from '#/shared/domain/portal-print-final-languages'
import { createPdfKitPrintFinalRenderer } from './pdfkit-print-final-renderer'

// The final print-shop file as a PDF (spec §10.3, the board print-shop): one
// piece per page, the page the bleed box or, with crop marks on, the trim plus
// the marks' margin; a TrimBox and a BleedBox on every page, Paper's too; the
// photo and ground of an Immersive face run into the bleed; a card's back is
// the next page with the same boxes; and a tent has no file.

const SHORT = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'
const LONG =
  'https://web-closed-beta-v2.up.railway.app/p/pt_Q7mXc2LpV9sKt4Rw_Hc8vN3pL0qZr5TfY2bWm7XdJ9aKs4EuG1oPi6CnV8hR?accessArtifact=0b6d1c1e-52c4-4b34-9d63-6e3b4a1f9a10'

const renderer = createPdfKitPrintFinalRenderer({
  now: () => new Date('2026-10-25T10:00:00Z'),
  compress: false,
})

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

const face = (
  piece: PrintFinalPiece,
  orientation: PrintFinalOrientation,
  look: PrintFinalLook,
  region: PrintFinalRegion = 'us',
): PrintFinalFace => ({ piece, orientation, look, region })

async function inputFor(
  shopFace: PrintFinalFace,
  cropMarks: boolean,
  over: Partial<PrintFinalRenderInput> = {},
): Promise<PrintFinalRenderInput> {
  const blocks = printFinalBlocks(
    ['en'],
    'rate',
    { en: 'Review us on Google' },
    'Reception',
  )
  return {
    title: 'Hotel Elegance counter card',
    face: shopFace,
    blocks: blocks,
    wordmark: 'Hotel Elegance',
    logo: null,
    accentColour: '#E3B873',
    fieldColour: '#2A1712',
    photo:
      shopFace.look === 'immersive'
        ? { bytes: await photoBytes(), focalX: 0.5, focalY: 0.4 }
        : null,
    qrAddress: SHORT,
    address: 'short',
    shop: { cropMarks },
    ...over,
  }
}

const text = (pdf: Uint8Array) => Buffer.from(pdf).toString('latin1')
const pagesOf = (pdf: string) => [...pdf.matchAll(/\/Type \/Page\n/gu)].length
const numbers = (pdf: string, key: string): number[][] =>
  [...pdf.matchAll(new RegExp(`/${key} \\[([\\d. -]+)\\]`, 'gu'))].map((match) =>
    (match[1] ?? '').trim().split(/\s+/u).map(Number),
  )

const close = (actual: readonly number[] | undefined, expected: readonly number[]) => {
  expect(actual).toHaveLength(expected.length)
  expected.forEach((value, index) =>
    expect(Math.abs((actual?.[index] ?? NaN) - value)).toBeLessThan(0.01),
  )
}

/** A box as PDF writes it: `[left, bottom, right, top]` from the page's bottom-left corner. */
const pdfBox = (
  page: Readonly<{ heightPt: number }>,
  rect: Readonly<{ leftPt: number; topPt: number; widthPt: number; heightPt: number }>,
) => [
  rect.leftPt,
  page.heightPt - (rect.topPt + rect.heightPt),
  rect.leftPt + rect.widthPt,
  page.heightPt - rect.topPt,
]

/** Every filled rectangle the weight of a mark: the crop marks of a page. */
const tickRects = (pdf: string) =>
  [...pdf.matchAll(/^([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+) re$/gmu)].filter(
    (rect) =>
      Math.abs(Number(rect[3]) - PRINT_FINAL_SHEET_MARKS.tickWeightPt) < 0.001 ||
      Math.abs(Number(rect[4]) - PRINT_FINAL_SHEET_MARKS.tickWeightPt) < 0.001,
  )

const CARDS = (['counter', 'small'] as const).flatMap((piece) =>
  PRINT_FINAL_ORIENTATIONS.flatMap((orientation) =>
    (['paper', 'immersive'] as const).flatMap((look) =>
      (['us', 'eu'] as const).map(
        (region) =>
          [
            `${look} ${piece} ${orientation} (${region})`,
            face(piece, orientation, look, region),
          ] as const,
      ),
    ),
  ),
)

describe('the final print-shop file', () => {
  describe.each(CARDS)('%s', (_, shopFace) => {
    it('is one page, the bleed box, with its trim and bleed declared, when the marks are off', async () => {
      const pdf = text(await renderer.render(await inputFor(shopFace, false)))
      const page = printFinalShopPage({ face: shopFace, cropMarks: false })
      expect(pagesOf(pdf)).toBe(1)
      close(numbers(pdf, 'MediaBox')[0], [0, 0, page.widthPt, page.heightPt])
      close(numbers(pdf, 'BleedBox')[0], [0, 0, page.widthPt, page.heightPt])
      close(numbers(pdf, 'TrimBox')[0], pdfBox(page, page.trim))
      expect(tickRects(pdf)).toHaveLength(0)
      expect(pdf).not.toContain('AP.UP.RAILWAY.APP')
    })

    it('is the trim plus the marks’ margin with the marks on, eight of them, the boxes where the page puts them', async () => {
      const pdf = text(await renderer.render(await inputFor(shopFace, true)))
      const page = printFinalShopPage({ face: shopFace, cropMarks: true })
      expect(pagesOf(pdf)).toBe(1)
      close(numbers(pdf, 'MediaBox')[0], [0, 0, page.widthPt, page.heightPt])
      close(numbers(pdf, 'TrimBox')[0], pdfBox(page, page.trim))
      close(numbers(pdf, 'BleedBox')[0], pdfBox(page, page.bleed))
      expect(tickRects(pdf)).toHaveLength(8)
    })
  })

  it('declares the Counter card’s boxes in PDF space on Letter: 4.25 × 6.25 in, the trim 1/8 in in', async () => {
    const pdf = text(
      await renderer.render(await inputFor(face('counter', 'upright', 'paper'), false)),
    )
    expect(pdf).toContain('/MediaBox [0 0 306 450]')
    close(numbers(pdf, 'TrimBox')[0], [9, 9, 297, 441])
    close(numbers(pdf, 'BleedBox')[0], [0, 0, 306, 450])
  })

  it('declares the marks’ page on Letter: 4.75 × 6.75 in, the bleed box inside it', async () => {
    const pdf = text(
      await renderer.render(await inputFor(face('counter', 'upright', 'paper'), true)),
    )
    expect(pdf).toContain('/MediaBox [0 0 342 486]')
    close(numbers(pdf, 'TrimBox')[0], [27, 27, 315, 459])
    close(numbers(pdf, 'BleedBox')[0], [18, 18, 324, 468])
  })

  it('runs an Immersive face into the bleed: its clip is the trim plus the bleed, at the page’s edge', async () => {
    const pdf = text(
      await renderer.render(
        await inputFor(face('counter', 'upright', 'immersive'), false),
      ),
    )
    // The face sits at the trim (9, 9) and is clipped 9 pt past it on every side, which is the page.
    expect(pdf).toMatch(/^1 0 0 1 9 9 cm$/mu)
    expect(pdf).toMatch(/^-9 -9 306 450 re\nW n/mu)
  })

  it('clips a Paper face to its trim, so its bleed stays white', async () => {
    const pdf = text(
      await renderer.render(await inputFor(face('counter', 'upright', 'paper'), false)),
    )
    expect(pdf).toMatch(/^0 0 288 432 re\nW n/mu)
    expect(pdf).not.toMatch(/^-9 -9 306 450 re\nW n/mu)
  })

  it('draws the crop marks in black', async () => {
    const pdf = text(
      await renderer.render(await inputFor(face('counter', 'upright', 'paper'), true)),
    )
    expect(pdf).toMatch(/^0 0 0 scn$/mu)
  })

  describe('with a back page', () => {
    it.each([false, true])(
      'adds the back as page 2, on the same page with the same boxes (marks %s)',
      async (cropMarks) => {
        const shopFace = face('counter', 'upright', 'immersive')
        const pdf = text(
          await renderer.render(
            await inputFor(shopFace, cropMarks, {
              back: { propertyName: 'Hotel Elegance Downtown' },
            }),
          ),
        )
        const page = printFinalShopPage({ face: shopFace, cropMarks })
        expect(pagesOf(pdf)).toBe(2)
        expect(numbers(pdf, 'MediaBox')).toHaveLength(2)
        expect(numbers(pdf, 'TrimBox')).toHaveLength(2)
        close(numbers(pdf, 'MediaBox')[1], [0, 0, page.widthPt, page.heightPt])
        expect(numbers(pdf, 'TrimBox')[1]).toEqual(numbers(pdf, 'TrimBox')[0])
        expect(numbers(pdf, 'BleedBox')[1]).toEqual(numbers(pdf, 'BleedBox')[0])
        expect(tickRects(pdf)).toHaveLength(cropMarks ? 16 : 0)
      },
    )
  })

  describe('refusals', () => {
    it('has no file for a tent: it stays office-only', async () => {
      await expect(
        renderer.render(await inputFor(face('tent', 'wide', 'paper'), false)),
      ).rejects.toBeInstanceOf(RangeError)
    })

    it('does not mix a print shop’s file with office sheets', async () => {
      await expect(
        renderer.render(
          await inputFor(face('counter', 'upright', 'paper'), false, {
            sheets: { quantity: 3, fillSpares: false },
          }),
        ),
      ).rejects.toBeInstanceOf(RangeError)
    })

    it('still refuses a Small card on today’s long address, before any page', async () => {
      await expect(
        renderer.render(
          await inputFor(face('small', 'upright', 'paper'), false, {
            qrAddress: LONG,
            address: 'long',
          }),
        ),
      ).rejects.toBeInstanceOf(PrintFinalRenderRefusal)
    })
  })
})
