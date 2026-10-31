import { describe, expect, it, vi } from 'vitest'
import {
  acceptReplyDraftingV2,
  hasSpanishReplyCommitment,
} from './reply-drafting-v2-contract'
import { replyDraftingV2OutputSchema } from './reply-drafting-v2-schema'
import * as leakage from './ai-reply-output-leakage'

const BODY =
  'We are sorry the wait took so long. Your time should have been treated with more care.'
const OUTPUT = {
  languageCode: 'en-Latn',
  case: 'complaint',
  mainPoint: [1],
  avoidTerms: [],
  replyText: BODY,
}
const INPUT = {
  sentences: [
    { n: 1, text: 'We waited for service.' },
    { n: 2, text: '' },
  ],
  targetLanguageTag: 'en-Latn',
  rating: 2,
  countryCode: 'US',
  output: OUTPUT,
}

describe('reply drafting v2 acceptance', () => {
  it('accepts actual sentence slots including an empty redacted slot', () => {
    expect(acceptReplyDraftingV2(INPUT).status).toBe('accepted')
    expect(
      acceptReplyDraftingV2({ ...INPUT, output: { ...OUTPUT, mainPoint: [2] } }).status,
    ).toBe('accepted')
    expect(
      acceptReplyDraftingV2({ ...INPUT, output: { ...OUTPUT, mainPoint: [1, 3] } }),
    ).toEqual({
      status: 'hard_failure',
      findings: expect.arrayContaining([
        { code: 'sentence_reference', severity: 'hard' },
      ]),
    })
  })
  it('enforces the word cap, sentence references and avoidance without returning rejected text', () => {
    const result = acceptReplyDraftingV2({
      ...INPUT,
      maxWords: 8,
      output: { ...OUTPUT, mainPoint: [99], avoidTerms: ['wait'] },
    })
    expect(result).toMatchObject({
      status: 'hard_failure',
      findings: expect.arrayContaining([
        { code: 'avoidance', severity: 'hard' },
        { code: 'max_words', severity: 'hard' },
      ]),
    })
    expect(JSON.stringify(result)).not.toContain(BODY)
    expect(JSON.stringify(result)).not.toContain('wait')
  })
  it('keeps strict keys, bounds and output order', () => {
    expect(Object.keys(replyDraftingV2OutputSchema.shape)).toEqual([
      'languageCode',
      'case',
      'mainPoint',
      'avoidTerms',
      'replyText',
    ])
    for (const patch of [
      { extra: true },
      { mainPoint: [] },
      { mainPoint: [1, 2, 3] },
      { mainPoint: [1.2] },
      { avoidTerms: ['I'] },
      { avoidTerms: [' a '] },
      { avoidTerms: Array(9).fill('term') },
      { avoidTerms: ['x'.repeat(41)] },
      { replyText: 'short' },
    ])
      expect(replyDraftingV2OutputSchema.safeParse({ ...OUTPUT, ...patch }).success).toBe(
        false,
      )
  })
  it('admits Spanish only in the additive profile and refuses wrong language', () => {
    expect(
      acceptReplyDraftingV2({
        ...INPUT,
        targetLanguageTag: 'es-Latn',
        output: {
          ...OUTPUT,
          languageCode: 'es-Latn',
          replyText:
            'Sentimos que la espera fuera tan larga. Su tiempo merece más atención.',
        },
      }).status,
    ).toBe('accepted')
    expect(acceptReplyDraftingV2({ ...INPUT, targetLanguageTag: 'bg-Cyrl' })).toEqual({
      status: 'refused',
      reason: 'language',
    })
  })
  it('does not rewrite when a scanner is unavailable', () => {
    const scanner = vi
      .spyOn(leakage, 'scanAiReplyOutput')
      .mockReturnValue('scanner_unavailable')
    try {
      expect(acceptReplyDraftingV2(INPUT)).toEqual({
        status: 'refused',
        reason: 'scanner_unavailable',
      })
    } finally {
      scanner.mockRestore()
    }
  })
  it.each([
    'Ofrecemos un reembolso.',
    'No ofrecemos reembolsos.',
    'Hemos reembolsado el importe.',
    'La devolución del dinero está garantizada.',
    'La devolucion del dinero.',
    'No habrá compensación.',
    'Vamos a compensar.',
    'Una noche gratis.',
    'No ofrecemos estancias gratuitas.',
    'Comida gratuita.',
    'Gratis una mejora.',
    'Un cupón.',
    'Un cupon.',
    'Un vale.',
    'Vales para otra visita.',
    'Un descuento.',
    'Garantizamos la calidad.',
    'No prometemos nada.',
    'Lo prometo.',
    'No prometimos nada.',
    'Hemos prometido.',
    'Garantizo el resultado.',
    'No garantizó nada.',
    'No garantice nada.',
    'Las devoluciones del dinero.',
    'Fue nuestra culpa.',
    'Asumimos la responsabilidad.',
    'Asumiremos la responsabilidad.',
    'Es responsabilidad nuestra.',
  ])('preserves the commitment authority even under negation: %s', (text) =>
    expect(hasSpanishReplyCommitment(text)).toBe(true),
  )
  it.each([
    'Lamentamos la espera.',
    'Sentimos lo ocurrido.',
    'El precio le preocupaba.',
    'La valencia es positiva.',
    'Una mirada gratificante.',
  ])('does not treat ordinary empathy as a commitment: %s', (text) => {
    expect(hasSpanishReplyCommitment(text)).toBe(false)
  })
})
