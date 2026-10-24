import { describe, expect, it } from 'vitest'
import {
  defaultPrintKitOutput,
  printKitFaces,
  type PrintFace,
  type PrintKitChoice,
} from '#/shared/domain/portal-print-kit'
import {
  printKitFaceCaption,
  printKitFaceLabel,
  printKitPreviewNote,
  printKitSheetCaption,
} from './print-kit-preview-copy'

const TITLES = { en: 'Pool & Terrace', es: 'Piscina y terraza' }

const choice = (rest: Partial<PrintKitChoice>): PrintKitChoice => ({
  style: 'paper',
  paper: 'letter',
  size: 'large',
  output: defaultPrintKitOutput(rest.style ?? 'paper'),
  piece: 'counter_card',
  languages: ['en', 'es'],
  callToAction: 'rate',
  showPropertyName: true,
  ...rest,
})

const facesOf = (picked: PrintKitChoice): readonly PrintFace[] =>
  printKitFaces(picked, TITLES, 'Pool')

/** The words as they read: a no-break space is a space to the eye. */
const plain = (text: string): string => text.replaceAll(' ', ' ')

describe('printKitSheetCaption', () => {
  it('says the paper, what is on the sheet and which page it is, as the board does', () => {
    expect(printKitSheetCaption(choice({}), { index: 0, count: 2, faces: 2 })).toBe(
      'Letter · two 4 × 6 in counter cards · page 1 of 2, fronts',
    )
    expect(
      printKitSheetCaption(choice({ paper: 'a4' }), { index: 1, count: 2, faces: 4 }),
    ).toBe('A4 · four A6 counter cards · page 2 of 2, backs')
  })

  it('names a print shop’s page for Immersive', () => {
    expect(
      printKitSheetCaption(choice({ style: 'immersive' }), {
        index: 0,
        count: 2,
        faces: 1,
      }),
    ).toBe(
      '4 × 6 in counter card for a print shop, with bleed and crop marks · page 1 of 2, front',
    )
  })
})

describe('printKitFaceCaption and printKitFaceLabel', () => {
  it.each([
    [{}, 'front', '4 × 6 in counter card · front'],
    [{ paper: 'a4' }, 'back', 'A6 counter card · back'],
    [{ piece: 'table_tent' }, 'front', '8.5 × 5.5 in table tent face · front'],
    [{ piece: 'table_tent', paper: 'a4' }, 'front', 'A5 table tent face · front'],
    [
      { style: 'immersive', piece: 'table_tent' },
      'back',
      '4 × 6 in table tent panel · back',
    ],
  ] as const)('names %j on its %s as "%s"', (rest, side, expected) => {
    expect(plain(printKitFaceCaption(choice(rest), side))).toBe(expected)
  })

  it('describes the face for a screen reader', () => {
    const picked = choice({ piece: 'table_tent' })
    const [front, back] = facesOf(picked)
    expect(front && printKitFaceLabel(picked, front)).toBe(
      'Print preview: 8.5 × 5.5 in table tent face, front, English and Spanish, "Rate your visit"',
    )
    expect(back && printKitFaceLabel(picked, back)).toContain('back, Spanish and English')
  })
})

describe('printKitPreviewNote', () => {
  it('says where the backs are and how to cut a Paper card sheet', () => {
    expect(plain(printKitPreviewNote(choice({}), facesOf(choice({}))))).toBe(
      'Page 2 holds the backs, Spanish first. Cut on the ticks: two 4 × 6 in cards.',
    )
    const a4 = choice({ paper: 'a4' })
    expect(plain(printKitPreviewNote(a4, facesOf(a4)))).toBe(
      'Page 2 holds the backs, Spanish first. Cut on the ticks: four A6 cards.',
    )
  })

  it('has no page 2 for a card in one language', () => {
    const one = choice({ languages: ['en'] })
    expect(plain(printKitPreviewNote(one, facesOf(one)))).toBe(
      'Cut on the ticks: two 4 × 6 in cards.',
    )
  })

  it('says how a Paper tent folds, and which language leads its back', () => {
    const tent = choice({ piece: 'table_tent' })
    expect(plain(printKitPreviewNote(tent, facesOf(tent)))).toBe(
      'Fold on the ticks: two 8.5 × 5.5 in faces, the back with Spanish first.',
    )
    const oneLanguage = choice({ piece: 'table_tent', languages: ['en'], paper: 'a4' })
    expect(plain(printKitPreviewNote(oneLanguage, facesOf(oneLanguage)))).toBe(
      'Fold on the ticks: two A5 faces.',
    )
  })

  it('sends an Immersive card to a print shop with its bleed in the file', () => {
    const card = choice({ style: 'immersive', languages: ['en'] })
    expect(plain(printKitPreviewNote(card, facesOf(card)))).toBe(
      'For a print shop: 1/8 in bleed and crop marks are in the file.',
    )
    const a4 = choice({ style: 'immersive', paper: 'a4', languages: ['en'] })
    expect(plain(printKitPreviewNote(a4, facesOf(a4)))).toContain('3 mm bleed')
  })

  it('explains why a two-language Immersive tent has no photo', () => {
    const tent = choice({ style: 'immersive', piece: 'table_tent' })
    const note = plain(printKitPreviewNote(tent, facesOf(tent)))
    expect(note).toContain('4 × 12 in flat, folded at the middle')
    expect(note).toContain('With two languages the tent has no room for a photo.')
    const one = choice({ style: 'immersive', piece: 'table_tent', languages: ['en'] })
    expect(plain(printKitPreviewNote(one, facesOf(one)))).not.toContain('no room')
  })
})

describe('the copy for the sizes after Large', () => {
  const table = (rest: Partial<PrintKitChoice>) =>
    choice({ size: 'table', languages: ['en'], ...rest })

  it('says what a Paper sheet of Table or Mini cards holds, as the board does', () => {
    expect(plain(printKitSheetCaption(table({}), { index: 0, count: 1, faces: 4 }))).toBe(
      'Letter · four 3.5 × 5 in Table cards',
    )
    expect(
      plain(
        printKitSheetCaption(table({ paper: 'a4', languages: ['en', 'es'] }), {
          index: 1,
          count: 2,
          faces: 4,
        }),
      ),
    ).toBe('A4 · four 90 × 130 mm Table cards · page 2 of 2, backs')
    expect(
      plain(
        printKitSheetCaption(choice({ size: 'mini', languages: ['en'] }), {
          index: 0,
          count: 1,
          faces: 10,
        }),
      ),
    ).toBe('Letter · ten 2 × 3.5 in Mini cards')
  })

  it('names an Immersive Table sheet and its one bleed, as the board does', () => {
    const imm = table({ style: 'immersive', output: 'office' })
    expect(plain(printKitSheetCaption(imm, { index: 0, count: 1, faces: 4 }))).toBe(
      'Letter · four 3.5 × 5 in Table cards, one bleed around them',
    )
    expect(plain(printKitPreviewNote(imm, facesOf(imm)))).toBe(
      'Cut on the crop marks: four 3.5 × 5 in cards. For deeper colour, choose “For a print shop”.',
    )
  })

  it('names the Immersive Large office sheet and its two cards', () => {
    const imm = choice({ style: 'immersive', output: 'office', languages: ['en'] })
    expect(plain(printKitSheetCaption(imm, { index: 0, count: 1, faces: 2 }))).toBe(
      'Letter landscape · two 4 × 6 in cards, each with its own bleed',
    )
    expect(plain(printKitPreviewNote(imm, facesOf(imm)))).toContain(
      'Cut on the crop marks: two 4 × 6 in cards.',
    )
  })

  it('names a print shop’s page for a smaller card and for the small tent', () => {
    const card = table({ style: 'immersive', output: 'print_shop' })
    expect(plain(printKitSheetCaption(card, { index: 0, count: 1, faces: 1 }))).toBe(
      '3.5 × 5 in Table card for a print shop, with bleed and crop marks · page 1 of 1, front',
    )
    const tent = table({ style: 'immersive', output: 'print_shop', piece: 'table_tent' })
    expect(plain(printKitSheetCaption(tent, { index: 0, count: 1, faces: 2 }))).toBe(
      '5 × 3.5 in table tent for a print shop, 5 × 7 in flat with bleed, crop marks and fold marks',
    )
    expect(plain(printKitPreviewNote(tent, facesOf(tent)))).toBe(
      'For a print shop: 5 × 7 in flat, folded at the middle, with 1/8 in bleed, crop marks and fold marks.',
    )
  })

  it('says how the small Paper tent is cut and folded, and which language is on its back', () => {
    const tent = table({ piece: 'table_tent', languages: ['en', 'es'] })
    expect(plain(printKitSheetCaption(tent, { index: 0, count: 1, faces: 4 }))).toBe(
      'Letter · two table tents, 5 × 3.5 in faces, folded on the dashed line',
    )
    expect(plain(printKitPreviewNote(tent, facesOf(tent)))).toBe(
      'Cut on the ticks, then fold on the dashed line: two tents, Spanish on the back face.',
    )
    const one = table({ piece: 'table_tent', paper: 'a4' })
    expect(plain(printKitPreviewNote(one, facesOf(one)))).toContain(
      'the same on both faces',
    )
  })

  it('names a face by its size', () => {
    expect(plain(printKitFaceCaption(table({}), 'front'))).toBe(
      '3.5 × 5 in Table card · front',
    )
    expect(
      plain(printKitFaceCaption(choice({ size: 'mini', paper: 'a4' }), 'front')),
    ).toBe('55 × 85 mm Mini card · front')
    expect(
      plain(
        printKitFaceCaption(table({ piece: 'table_tent', style: 'immersive' }), 'back'),
      ),
    ).toBe('5 × 3.5 in table tent face · back')
  })

  it('leaves the Large card and the Letter-half tent to the copy they have always had', () => {
    expect(plain(printKitFaceCaption(choice({ piece: 'table_tent' }), 'front'))).toBe(
      '8.5 × 5.5 in table tent face · front',
    )
  })
})
