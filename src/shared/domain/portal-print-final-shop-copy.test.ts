import { describe, expect, it } from 'vitest'
import { inPt, mmPt } from './portal-print-final-measures'
import { printFinalShopPage } from './portal-print-final-shop'
import {
  PRINT_FINAL_SHOP_CROP_MARKS_HELP,
  PRINT_FINAL_SHOP_CROP_MARKS_LABEL,
  printFinalShopNote,
  printFinalShopOrderLine,
  printFinalShopPageCaption,
  printFinalShopPageHeading,
  printFinalWhoLine,
  type PrintFinalShopPrint,
} from './portal-print-final-shop-copy'
import { printFinalStockLine } from './portal-print-final-share'

const counter: PrintFinalShopPrint = {
  piece: 'counter',
  orientation: 'upright',
  look: 'immersive',
  paper: 'letter',
}

describe('printFinalShopOrderLine', () => {
  it('says what to order, in the card’s own orientation, and to upload the file as it is', () => {
    expect(printFinalShopOrderLine(counter)).toBe(
      'Order 4 × 6 in postcards, 14–16 pt, matte, one side. Upload this PDF as it is.',
    )
    expect(printFinalShopOrderLine({ ...counter, orientation: 'wide' })).toBe(
      'Order 6 × 4 in postcards, 14–16 pt, matte, one side. Upload this PDF as it is.',
    )
  })

  it('orders a Small card as business cards, and Europe’s in millimetres and g/m²', () => {
    expect(
      printFinalShopOrderLine({
        ...counter,
        piece: 'small',
        orientation: 'wide',
        paper: 'a4',
      }),
    ).toBe(
      'Order 85 × 54 mm business cards, 300–350 g/m², matte, one side. Upload this PDF as it is.',
    )
  })

  it('asks for both sides when the card has a back page', () => {
    expect(printFinalShopOrderLine({ ...counter, backPage: true })).toContain(
      'matte, both sides.',
    )
  })

  it('names no product and says nothing about bleed', () => {
    for (const paper of ['letter', 'a4'] as const) {
      expect(printFinalShopOrderLine({ ...counter, paper })).not.toMatch(/bleed/iu)
    }
  })
})

describe('printFinalWhoLine', () => {
  const us = {
    ...counter,
    printer: 'print_shop',
    countryPaper: 'letter',
    countryCode: 'US',
  } as const

  it('gives a print shop what to order, why the paper is this one, and the print margins', () => {
    expect(printFinalWhoLine(us)).toBe(
      'Order 4 × 6 in postcards, 14–16 pt, matte, one side. Upload this PDF as it is. Letter because your property is in the United States. A print shop gets one card per page, with print margins added.',
    )
  })

  it('leaves a paper chosen against the country unexplained', () => {
    expect(printFinalWhoLine({ ...us, paper: 'a4' })).toBe(
      'Order 105 × 148 mm postcards, 300–350 g/m², matte, one side. Upload this PDF as it is. A print shop gets one card per page, with print margins added.',
    )
  })

  it('is the stock line from the manager’s own printer', () => {
    const mine = { ...us, printer: 'my_printer' } as const
    expect(printFinalWhoLine(mine)).toBe(printFinalStockLine(mine))
  })

  it('keeps the stock line, which says why, for a tent a shop cannot print', () => {
    const tent = { ...us, piece: 'tent', orientation: 'wide' } as const
    expect(printFinalWhoLine(tent)).toBe(printFinalStockLine(tent))
    expect(printFinalWhoLine(tent)).toContain('so for a shop choose Counter cards')
  })
})

describe('printFinalShopNote', () => {
  it('is the technical line, in the shop’s words, for a Letter Counter card with no marks', () => {
    expect(printFinalShopNote(counter, inPt(1.5))).toBe(
      'Print-ready PDF. One card per page. Trim 4 × 6 in (TrimBox). Bleed 1/8 in on every side (BleedBox 4.25 × 6.25 in); the photo and colour run into it. Crop marks: none; the page is the bleed box. Colour: RGB; please convert to your press profile. Print at 100%, no scaling: the cream code square measures 1.5 in (3.8 cm). Stock: 14–16 pt, matte, one side.',
    )
  })

  it('says a Paper card’s bleed is white', () => {
    expect(printFinalShopNote({ ...counter, look: 'paper' }, inPt(1.5))).toContain(
      '(BleedBox 4.25 × 6.25 in); it is white.',
    )
  })

  it('names the marks and the wider page they need, in millimetres for a Small card in Europe, and the back on page 2', () => {
    expect(
      printFinalShopNote(
        {
          ...counter,
          piece: 'small',
          orientation: 'wide',
          look: 'paper',
          paper: 'a4',
          cropMarks: true,
          backPage: true,
        },
        mmPt(32),
      ),
    ).toBe(
      'Print-ready PDF. One card per page: the front on page 1, the back on page 2. Trim 85 × 54 mm (TrimBox). Bleed 3 mm on every side (BleedBox 91 × 60 mm); it is white. Crop marks: on, along the trim lines, 1.5 mm beyond the bleed and 4.5 mm long; the page is 103 × 72 mm. Colour: RGB; please convert to your press profile. Print at 100%, no scaling: the cream code square measures 32 mm. Stock: 300–350 g/m², matte, both sides.',
    )
  })

  it('agrees with the page the file draws', () => {
    const marks = printFinalShopPage({
      face: { ...counter, region: 'us' },
      cropMarks: true,
    })
    expect(printFinalShopNote({ ...counter, cropMarks: true }, inPt(1.5))).toContain(
      `the page is ${marks.widthPt / 72} × ${marks.heightPt / 72} in.`,
    )
  })
})

describe('the crop-marks option', () => {
  it('is a checkbox that says most shops want it off, and that the page gets wider', () => {
    expect(PRINT_FINAL_SHOP_CROP_MARKS_LABEL).toBe('Add crop marks')
    expect(PRINT_FINAL_SHOP_CROP_MARKS_HELP).toBe(
      'Most shops cut from the page edge, so leave this off. Turn it on if your shop asks for crop marks: the page gets wider to show them.',
    )
    expect(PRINT_FINAL_SHOP_CROP_MARKS_HELP).not.toMatch(/bleed/iu)
  })
})

describe('the preview of the file’s page', () => {
  const face = { ...counter, region: 'us' } as const

  it('says which page it is of how many', () => {
    expect(printFinalShopPageHeading({ side: 'front' })).toBe('page 1 of 1')
    expect(printFinalShopPageHeading({ backPage: true, side: 'front' })).toBe(
      'page 1 of 2',
    )
    expect(printFinalShopPageHeading({ backPage: true, side: 'back' })).toBe(
      'page 2 of 2',
    )
  })

  it('says the page’s size and what the margin is, for Immersive', () => {
    expect(
      printFinalShopPageCaption(printFinalShopPage({ face, cropMarks: false }), false),
    ).toBe(
      '4.25 × 6.25 in. One card per page, with a 1/8 in print margin round it. The photo and colour run into it. The dashed line is where the card is cut.',
    )
  })

  it('says a Paper card’s margin stays white, and where the marks stand', () => {
    expect(
      printFinalShopPageCaption(
        printFinalShopPage({ face: { ...face, look: 'paper' }, cropMarks: true }),
        true,
      ),
    ).toBe(
      '4.75 × 6.75 in. One card per page, with a 1/8 in print margin round it. Crop marks stand just outside it, on the lines the card is cut along. It stays white. The dashed line is where the card is cut. The back is page 2.',
    )
  })

  it('says 3 mm in Europe', () => {
    expect(
      printFinalShopPageCaption(
        printFinalShopPage({ face: { ...face, region: 'eu' }, cropMarks: false }),
        false,
      ),
    ).toContain('111 × 154 mm. One card per page, with a 3 mm print margin round it.')
  })
})
