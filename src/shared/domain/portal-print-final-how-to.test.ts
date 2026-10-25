import { describe, expect, it } from 'vitest'
import {
  printFinalCutStep,
  printFinalDocumentTitle,
  printFinalFaceCaption,
  printFinalFileName,
  printFinalHowToSteps,
  printFinalPhotoNotice,
  printFinalSheetCaption,
  printFinalSheetHeading,
  printFinalSummary,
  type PrintFinalDescribed,
} from './portal-print-final-how-to'
import { inPt, mmPt } from './portal-print-final-measures'

const tents: PrintFinalDescribed = {
  piece: 'tent',
  orientation: 'wide',
  look: 'paper',
  paper: 'letter',
  printer: 'my_printer',
  languages: ['en', 'es'],
}

describe('printFinalCutStep', () => {
  it('cuts Paper tents into quarters or strips', () => {
    expect(printFinalCutStep(tents)).toBe(
      'Cut the sheet in half each way, then fold each quarter on the dashed marks.',
    )
    expect(printFinalCutStep({ ...tents, orientation: 'upright' })).toBe(
      'Cut the sheet in half, then each half in half: four strips. Fold each across its middle on the dashed marks.',
    )
  })

  it('cuts Paper cards on the grey ticks, and an A4 sheet of four Counter cards in half each way', () => {
    expect(printFinalCutStep({ ...tents, piece: 'small' })).toBe('Cut on the grey ticks.')
    expect(printFinalCutStep({ ...tents, piece: 'counter' })).toBe(
      'Cut on the grey ticks.',
    )
    expect(printFinalCutStep({ ...tents, piece: 'counter', paper: 'a4' })).toBe(
      'Cut the sheet in half each way.',
    )
  })

  it('cuts Immersive on its crop marks, and scores a tent first', () => {
    expect(printFinalCutStep({ ...tents, piece: 'counter', look: 'immersive' })).toBe(
      'Cut on the crop marks (6 cuts a sheet).',
    )
    expect(printFinalCutStep({ ...tents, look: 'immersive' })).toBe(
      'Cut on the crop marks (6 cuts a sheet), score, then fold on the dashed marks.',
    )
    expect(printFinalCutStep({ ...tents, piece: 'small', look: 'immersive' })).toBe(
      'Cut on the crop marks (12 cuts a sheet).',
    )
  })
})

describe('printFinalHowToSteps', () => {
  it('reads as the board’s three steps from the manager’s printer', () => {
    expect(printFinalHowToSteps(tents, inPt(1.4))).toEqual([
      {
        text: 'Print from a computer at Actual size (100%), on card stock through the manual slot.',
        strong: 'Actual size (100%)',
      },
      {
        text: 'Check one code: its cream square should measure 1.4 in (3.6 cm). Smaller means scaling was on; print again.',
        strong: '1.4 in (3.6 cm)',
      },
      {
        text: 'Cut the sheet in half each way, then fold each quarter on the dashed marks.',
      },
    ])
  })

  it('says on a phone why to print from a computer', () => {
    expect(printFinalHowToSteps(tents, inPt(1.4), true)[0]?.text).toBe(
      'Print from a computer at Actual size (100%), on card stock through the manual slot. Phone print screens often cannot turn scaling off.',
    )
  })

  it('measures the code in millimetres on A4', () => {
    expect(
      printFinalHowToSteps({ ...tents, piece: 'counter', paper: 'a4' }, mmPt(38))[1]
        ?.strong,
    ).toBe('38 mm')
  })

  it('hands a print shop the file and a check on its proof', () => {
    const steps = printFinalHowToSteps(
      { ...tents, piece: 'counter', printer: 'print_shop' },
      inPt(1.5),
    )
    expect(steps.map((step) => step.text)).toEqual([
      'Send the PDF to a print shop and ask for it at Actual size (100%), one card per page.',
      'Check the proof: one code’s cream square should measure 1.5 in (3.8 cm). Smaller means scaling was on; ask the shop to print again.',
    ])
  })
})

describe('printFinalSummary', () => {
  it('reads as the board’s summary beside the download', () => {
    expect(printFinalSummary(tents, { sheets: 3, pieces: 10 })).toEqual({
      lead: '3 sheets',
      rest: '10 tents · wide · Letter · one side · English + Español',
    })
  })

  it('is shorter in the phone’s pinned bar', () => {
    expect(
      printFinalSummary(
        { ...tents, orientation: 'upright' },
        { sheets: 3, pieces: 10 },
        true,
      ),
    ).toEqual({ lead: '3 sheets', rest: '10 tents · upright · Letter' })
  })

  it('counts one sheet and one card in the singular', () => {
    expect(
      printFinalSummary(
        { ...tents, piece: 'counter', languages: ['en'] },
        { sheets: 1, pieces: 1 },
      ),
    ).toEqual({ lead: '1 sheet', rest: '1 card · wide · Letter · one side · English' })
  })

  it('says a print shop’s file is one page', () => {
    expect(
      printFinalSummary(
        { ...tents, piece: 'counter', printer: 'print_shop' },
        { sheets: 1, pieces: 1 },
      ),
    ).toEqual({
      lead: '1 page',
      rest: 'one card per page · wide · 6 × 4 in · one side · English + Español',
    })
  })
})

describe('printFinalFaceCaption', () => {
  it('reads as the board’s caption for a wide tent', () => {
    expect(printFinalFaceCaption(tents, null)).toEqual({
      lead: 'Each face · 4.25 × 2.75 in',
      rest: ', wide, shown smaller. Both faces are the same.',
    })
  })

  it('says where the second language is one small line', () => {
    expect(printFinalFaceCaption({ ...tents, orientation: 'upright' }, null).rest).toBe(
      ', upright, shown smaller. Both faces are the same. Español prints as one small line on upright tents.',
    )
    expect(
      printFinalFaceCaption({ ...tents, piece: 'small', orientation: 'upright' }, null)
        .rest,
    ).toBe(
      ', upright, shown smaller. Español prints as one small line on upright Small cards.',
    )
  })

  it('names a sharp photo’s resolution', () => {
    expect(
      printFinalFaceCaption(
        { ...tents, piece: 'counter', orientation: 'upright', look: 'immersive' },
        241,
      ),
    ).toEqual({
      lead: 'Counter card · 4 × 6 in',
      rest: ', upright, shown smaller. Your photo prints at 241 dpi here: sharp.',
    })
  })
})

describe('the sheet’s heading and caption', () => {
  it('names the paper, a landscape page and the sheets', () => {
    expect(printFinalSheetHeading(tents, 3)).toBe('Letter · sheet 1 of 3')
    expect(
      printFinalSheetHeading(
        { ...tents, piece: 'counter', orientation: 'upright', look: 'immersive' },
        5,
      ),
    ).toBe('Letter landscape · sheet 1 of 5')
  })

  it('says how many a sheet holds and how it is cut', () => {
    expect(printFinalSheetCaption(tents, 4)).toBe(
      '4 tents per sheet. Cut the sheet in half each way, then fold each quarter on the dashed marks.',
    )
    expect(
      printFinalSheetCaption({ ...tents, piece: 'counter', look: 'immersive' }, 2),
    ).toBe('2 cards per sheet. Cut on the crop marks (6 cuts a sheet).')
  })
})

describe('printFinalPhotoNotice', () => {
  it('says a photo from 150 to 199 dpi may look soft', () => {
    expect(printFinalPhotoNotice(186, { widthPx: 850, heightPx: 717 })).toEqual({
      title: 'Your photo may look soft at this size',
      body: 'It prints at 186 dpi here. Fine at arm’s length, not crisp up close. A photo of at least 850 × 717 px prints sharp.',
    })
  })

  it('says a photo under 150 dpi will look soft', () => {
    expect(printFinalPhotoNotice(137, { widthPx: 850, heightPx: 850 })).toEqual({
      title: 'Your photo will look soft at this size',
      body: 'It prints at 137 dpi here. Expect a blurry photo. A photo of at least 850 × 850 px prints sharp.',
    })
  })

  it('says nothing from 200 dpi up', () => {
    expect(printFinalPhotoNotice(200, { widthPx: 850, heightPx: 850 })).toBeNull()
  })
})

describe('printFinalFileName', () => {
  it('names the portal, the piece, its orientation, the languages and the paper', () => {
    expect(printFinalFileName('Reception', tents)).toBe(
      'reception-table-tents-wide-en-es-letter.pdf',
    )
  })

  it('names Immersive and a print shop when chosen', () => {
    expect(
      printFinalFileName('Pool & Terrace', {
        ...tents,
        piece: 'counter',
        look: 'immersive',
        printer: 'print_shop',
        paper: 'a4',
        languages: ['bg'],
      }),
    ).toBe('pool-terrace-counter-cards-wide-bg-immersive-print-shop-a4.pdf')
  })

  it('names a print shop’s crop marks, so a file with them and one without differ', () => {
    const shop = { ...tents, piece: 'counter', printer: 'print_shop' } as const
    expect(printFinalFileName('Reception', { ...shop, cropMarks: true })).toBe(
      'reception-counter-cards-wide-en-es-print-shop-crop-marks-letter.pdf',
    )
    expect(printFinalFileName('Reception', { ...shop, cropMarks: false })).toBe(
      printFinalFileName('Reception', shop),
    )
  })

  it('does not name crop marks the manager’s own printer ignores', () => {
    expect(printFinalFileName('Reception', { ...tents, cropMarks: true })).toBe(
      printFinalFileName('Reception', tents),
    )
  })

  it('titles the document by the portal and the piece', () => {
    expect(printFinalDocumentTitle('Reception', 'small')).toBe('Reception small cards')
  })
})
