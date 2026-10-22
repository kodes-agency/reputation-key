import { describe, expect, it } from 'vitest'
import {
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
  piece: 'counter_card',
  languages: ['en', 'es'],
  callToAction: 'rate',
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
