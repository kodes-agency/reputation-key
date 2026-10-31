import { describe, expect, it } from 'vitest'
import {
  lintReplyDraftingV2Body,
  hasReplyAvoidanceTerm,
  type LintInput,
} from './reply-drafting-v2-lint'
import { REPLY_BODY_RULES } from './domain/reply-body-lint-policy'

const BASE: LintInput = {
  body: '',
  reviewText: '',
  language: 'en',
  rating: 5,
  modelCase: 'praise',
  avoidTerms: [],
  reviewWordCount: 20,
}
const codes = (input: Partial<LintInput>) =>
  lintReplyDraftingV2Body({ ...BASE, ...input }).map((f) => f.code)

describe('AI body lint, content-free findings', () => {
  it.each([
    ['empty_body', '', {}],
    ['digits', 'We waited ٢ days.', {}],
    ['symbols', 'Room & breakfast.', {}],
    ['emoji', 'Lovely service 😊', {}],
    ['avoidance', 'The cucarachas were there.', { avoidTerms: ['cucarach'] }],
    ['damaging_words', 'We are sorry you became unwell.', {}],
    ['singular_voice', 'I appreciate your review.', {}],
    ['singular_voice', 'Yo lamento lo ocurrido.', { language: 'es' }],
    ['singular_voice', 'Аз съжалявам за това.', { language: 'bg' }],
    ['invitation', 'Please contact us.', {}],
    ['invitation', 'Puede ponerse en contacto con nosotros.', { language: 'es' }],
    ['invitation', 'Моля, пишете ни.', { language: 'bg' }],
    ['greeting', 'Hello there.', {}],
    ['greeting', 'Hola, muchas gracias.', { language: 'es' }],
    ['greeting', 'Здравейте, благодарим Ви.', { language: 'bg' }],
    ['sign_off', 'We are sorry. Kind regards', {}],
    ['sign_off', 'Lo sentimos. Atentamente', { language: 'es' }],
    ['sign_off', 'Съжаляваме. С уважение', { language: 'bg' }],
    ['complaint_exclamation', 'We are sorry!', { rating: 1 }],
    ['gendered_guest', 'Радваме се, че сте останали доволни.', { language: 'bg' }],
    ['gendered_guest', 'Sentimos que se sintiera ignorada.', { language: 'es' }],
    [
      'invented_name',
      'Радваме се, че Ирина Ви е помогнала.',
      { language: 'bg', reviewText: 'Ирена беше любезна.' },
    ],
    ['serious_praise', 'We are glad you enjoyed the room.', { modelCase: 'serious' }],
    [
      'serious_praise',
      'Nos alegra que disfrutara.',
      { language: 'es', modelCase: 'serious' },
    ],
    ['serious_praise', 'Радваме се за това.', { language: 'bg', modelCase: 'serious' }],
    ['bulgarian_calque', 'Това е разбираемо разочароващо.', { language: 'bg' }],
    ['bulgarian_unwell', 'Съжаляваме, че сте се почувствали зле.', { language: 'bg' }],
    ['multiple_apologies', "We're sorry about the wait and we regret the delay.", {}],
    [
      'multiple_apologies',
      'Sentimos la espera y le pedimos disculpas.',
      { language: 'es' },
    ],
    ['multiple_apologies', 'Съжаляваме и се извиняваме за чакането.', { language: 'bg' }],
    ['max_words', 'one two three four five six seven eight nine', { maxWords: 8 }],
    ['stock_phrase', 'Your words mean a lot.', {}],
    ['stock_phrase', 'Sus palabras nos importan.', { language: 'es' }],
    ['stock_phrase', 'Вашето мнение е важно.', { language: 'bg' }],
    ['length_band', 'Good.', {}],
    ['paragraphs', 'Good service.\nLovely room.', {}],
    ['informal_spanish', 'Esperamos que tú disfrutes.', { language: 'es' }],
    ['lowercase_bulgarian', 'Радваме се, че ви харесва.', { language: 'bg' }],
    ['repeated_exclamation', 'Lovely! Great!', {}],
    ['praise_apology', 'We are sorry.', {}],
  ] as const)('detects %s in %s', (code, body, overrides) => {
    const found = lintReplyDraftingV2Body({ ...BASE, body, ...overrides })
    expect(found).toContainEqual({ code, severity: REPLY_BODY_RULES[code][0] })
    for (const finding of found)
      expect(Object.keys(finding)).toEqual(['code', 'severity'])
  })

  it.each([
    ['en', "We're sincerely sorry the wait took so long."],
    ['es', 'Tratamos atentamente cada comentario recibido.'],
    ['bg', 'Отнасяме се с уважение към всяко мнение.'],
  ] as const)('anchors greetings and sign-offs at body edges in %s', (language, body) => {
    expect(codes({ language, body })).not.toContain('sign_off')
    const greeting = { en: 'Hello', es: 'Hola', bg: 'Здравейте' }[language]
    expect(codes({ language, body: `${body} ${greeting} again.` })).not.toContain(
      'greeting',
    )
    expect(codes({ language, body: `${body}\n${greeting} again.` })).not.toContain(
      'greeting',
    )
  })

  it.each([
    ['en', 'We thank Jean-Luc for the care.', 'Jean-Luc was helpful.'],
    ['en', 'We thank Jean for the care.', 'Jean-Luc was helpful.'],
    ['en', 'We thank José for the care.', 'JOSE was helpful.'],
    ['bg', 'Благодарим на Иван за помощта.', 'Ивана беше любезна.'],
    ['bg', 'Благодарим Ви за Вашето време.', ''],
    ['bg', 'Благодарим на Вие Ви Вас Вам Вашия Вашите.', ''],
    ['es', 'Agradecemos a Usted y Ud.', ''],
  ] as const)(
    'accepts Phase 0 source substrings and polite pronouns in %s',
    (language, body, reviewText) => {
      expect(codes({ language, body, reviewText })).not.toContain('invented_name')
    },
  )

  it('preserves safe empathy, correct names, polite voice and short-review bands', () => {
    expect(
      codes({
        body: 'We are glad Irena made your stay comfortable. Thank you for sharing this.',
        reviewText: 'Irena made our stay comfortable.',
      }),
    ).not.toContain('invented_name')
    expect(
      codes({
        body: 'Радваме се, че Ирена Ви е помогнала.',
        language: 'bg',
        reviewText: 'Ирена беше любезна.',
      }),
    ).not.toContain('invented_name')
    expect(
      codes({ body: 'Thank you for sharing this.', reviewWordCount: 4 }),
    ).not.toContain('length_band')
    expect(
      codes({
        body: 'We are sorry the wait took so long.',
        modelCase: 'complaint',
        rating: 2,
      }),
    ).not.toContain('multiple_apologies')
  })

  it.each([
    ['café', 'The CAFÉ was busy.', true],
    ['rata', 'Las ratas corren.', false],
    ['rata', 'Una RÁTA.', true],
    ['I', 'I appreciate this.', false],
    ['é', 'The é was mentioned.', false],
    [' a ', 'A thoughtful review.', false],
    ['rat', 'The rating was fair.', false],
    ['cucarach', 'Las cucarachas.', true],
    ['Ирена', 'Това е Ирена.', true],
    ['Ирена', 'Ирина беше тук.', false],
    ['a+b', 'There was a+b.', true],
    ['sick$', 'We are sick.', false],
    ['rat$', 'A rat$ was mentioned.', true],
  ])('matches avoidance %s with Unicode word edges', (term, body, expected) => {
    expect(hasReplyAvoidanceTerm(body, [term])).toBe(expected)
  })
})
