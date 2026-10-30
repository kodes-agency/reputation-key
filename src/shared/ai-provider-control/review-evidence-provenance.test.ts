// Provenance of the evidence request path: the sentence number a provider cites
// is the sentence number the stored pointer holds and the sentence number the
// live display resolves. Every link is exercised with the code that runs it:
// the Review source numbers the RAW text, the gateway request carries it, the
// preparer redacts it and shows it to the provider, the normalizer keeps the
// numbers the provider cited, and the display splits the raw text again.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseAiGatewayRouteResponse } from '#/shared/ai-gateway-transport-contract'
import {
  AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
} from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  canonicalizeRawAiReviewSentences,
  canonicalizeRawAiReviewSource,
  type RawAiReviewSource,
} from '#/shared/ai-review-source-contract'
import { locateReviewSentences } from '#/shared/review-sentences'
import { REVIEW_ANALYSIS_V3_STORED_SCHEMA } from '#/shared/review-analysis-v3'
import {
  evidencePreparer,
  fakeGrant,
  fakeSettlementReceipt,
  openAiRequestOf,
  preparableV3Request,
  v3TestProfile,
} from './review-evidence.test-fixtures'

beforeEach(() => {
  vi.spyOn(process.versions, 'node', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
  )
  vi.spyOn(process.versions, 'icu', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_ICU_VERSION,
  )
  vi.spyOn(process.versions, 'unicode', 'get').mockReturnValue(
    AI_REVIEW_LANGUAGE_REGION_UNICODE_VERSION,
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

const preparer = () => evidencePreparer({ profiles: [v3TestProfile()] })

type ProviderPayload = { sentences: { number: number; text: string }[] }

/** What a provider reads and what the gateway stores, for one raw review. */
function runThroughTheGateway(
  rawText: string,
  reviewerDisplayName: string | null = null,
): Readonly<{
  read: readonly { number: number; text: string }[]
  stored: readonly number[][]
}> {
  const request = preparableV3Request({ rawText, reviewerDisplayName })
  const prepared = preparer().prepare(request)
  const payload = JSON.parse(
    openAiRequestOf(prepared).input[1].content,
  ) as ProviderPayload
  // A provider that cites, for every sentence it read, exactly that sentence.
  const mentions = payload.sentences.map((sentence) => ({
    topic: 'staff_service',
    polarity: 'positive',
    strength: 'mild',
    thing: `thing ${'abcdefghijklmnopqrstuvwxyz'[sentence.number % 26]}`,
    issue: 'fine',
    sentences: [sentence.number],
    names_person: null,
  }))
  const accepted = prepared.acceptProviderResult({
    sentiment: 'positive',
    mentions,
    urgent: null,
  })
  const response = parseAiGatewayRouteResponse(
    accepted?.buildResponse(fakeSettlementReceipt(), fakeGrant()),
  )
  if (response.status !== 'success' || !('answer' in response.result)) {
    throw new Error('expected a v3 answer')
  }
  const answer = REVIEW_ANALYSIS_V3_STORED_SCHEMA.parse(response.result.answer)
  return { read: payload.sentences, stored: answer.mentions.map((m) => [...m.sentences]) }
}

const reviews = [
  { name: 'plain', text: 'The room was clean. Breakfast was cold. We will return!' },
  { name: 'line breaks without stops', text: 'Great room\nTerrible bar\nNice staff' },
  { name: 'line breaks and stops', text: 'Great room.\nTerrible bar. Nice\nstaff!' },
  { name: 'blank lines', text: 'First.\n\n\nSecond line\n\nThird.' },
  { name: 'ellipsis', text: 'Stay was fine…\nBreakfast, though… could be better.' },
  { name: 'Bulgarian', text: 'Чудесно! Но бавно.\nБарът беше шумен?! Да.' },
  { name: 'emoji', text: 'Lovely 😊. Slow 🐢!\nBack soon' },
  { name: 'outer and inner spaces', text: '  Spaces   around.   And   inside.  ' },
  { name: 'CRLF', text: 'One.\r\nTwo!\r\nThree?' },
  { name: 'abbreviations', text: 'Ask Dr. Smith. Thanks. Mr. Brown was kind.' },
  {
    name: 'a marker in the middle',
    text: 'Good.\nCall +359 888 123 456 for a table. Bad bill.',
  },
  {
    name: 'tabs and no-break spaces',
    text: 'Tab\tseparated. Second\u00a0sentence. Third.',
  },
] as const

describe('review evidence provenance', () => {
  describe.each(reviews)('$name', ({ text }) => {
    it('shows the provider the sentences the display will underline, in the same order', () => {
      const { read } = runThroughTheGateway(text)
      const live = locateReviewSentences(text)

      expect(read.map(({ number }) => number)).toEqual(live.map(({ number }) => number))
      expect(read).toHaveLength(live.length)
    })

    it('stores the number the provider cited, and that number resolves to the sentence it read', () => {
      const { read, stored } = runThroughTheGateway(text)
      const live = locateReviewSentences(text)
      const canonical = canonicalizeRawAiReviewSentences({
        text,
        rating: 2,
        languageCode: 'en-Latn',
        reviewedAtEpochMillis: 1_780_000_000_000,
        reviewerDisplayName: null,
      } satisfies RawAiReviewSource)

      expect(stored).toHaveLength(read.length)
      for (const [index, pointers] of stored.entries()) {
        // One mention per sentence, each citing its own number: nothing moved.
        expect(pointers).toEqual([index + 1])
        const [pointer] = pointers
        const resolved = live[pointer! - 1]
        expect(resolved).toBeDefined()
        // The live sentence is the one the provider read, before redaction ...
        expect(
          canonicalizeRawAiReviewSource({
            text: resolved!.text,
            rating: 2,
            languageCode: 'en-Latn',
            reviewedAtEpochMillis: 1_780_000_000_000,
            reviewerDisplayName: null,
          }).text,
        ).toBe(canonical[pointer! - 1]?.text)
        // ... and the display can underline it in the original text.
        expect(text.slice(resolved!.start, resolved!.end)).toBe(resolved!.text)
      }
    })
  })

  it('keeps the number of a sentence whose text is entirely removed by redaction', () => {
    const text =
      'The room was lovely.\n+359 888 123 456 is the number. Check-in was slow.'
    const { read, stored } = runThroughTheGateway(text)
    const live = locateReviewSentences(text)

    expect(read.map(({ text: sentence }) => sentence)).toEqual([
      'The room was lovely.',
      '[CONTACT] is the number.',
      'Check-in was slow.',
    ])
    expect(stored).toEqual([[1], [2], [3]])
    expect(live[2]?.text).toBe('Check-in was slow.')
    expect(read[2]?.text).toBe(live[2]?.text)
  })

  it('keeps a stored pointer on the same live sentence when a marker spans two sentences', () => {
    const text = 'Great place.\nPhone +359 888\n123 456 anytime. Bad bill.'
    const { read, stored } = runThroughTheGateway(text)
    const live = locateReviewSentences(text)

    expect(read.map(({ text: sentence }) => sentence)).toEqual([
      'Great place.',
      'Phone [CONTACT]',
      '[CONTACT] anytime.',
      'Bad bill.',
    ])
    expect(live.map(({ text: sentence }) => sentence)).toEqual([
      'Great place.',
      'Phone +359 888',
      '123 456 anytime.',
      'Bad bill.',
    ])
    expect(stored).toEqual([[1], [2], [3], [4]])
  })

  it('keeps pointers after a reviewer name is masked across a sentence boundary', () => {
    const text = 'We asked Dr. Smith about it. He agreed. Lovely.'
    const { read, stored } = runThroughTheGateway(text, 'Dr. Smith')
    const live = locateReviewSentences(text)

    expect(read).toHaveLength(live.length)
    expect(read.map(({ text: sentence }) => sentence)).toEqual([
      'We asked [PERSON]',
      '[PERSON] about it.',
      'He agreed.',
      'Lovely.',
    ])
    expect(live.map(({ text: sentence }) => sentence)).toEqual([
      'We asked Dr.',
      'Smith about it.',
      'He agreed.',
      'Lovely.',
    ])
    expect(stored).toEqual([[1], [2], [3], [4]])
  })

  it('drops a pointer to a sentence the provider was never shown', () => {
    const text = 'One.\nTwo.'
    const request = preparableV3Request({ rawText: text })
    const prepared = preparer().prepare(request)
    const accepted = prepared.acceptProviderResult({
      sentiment: 'neutral',
      mentions: [
        {
          topic: 'staff_service',
          polarity: 'neutral',
          strength: 'mild',
          thing: null,
          issue: null,
          sentences: [2, 3],
          names_person: null,
        },
      ],
      urgent: null,
    })
    const response = parseAiGatewayRouteResponse(
      accepted?.buildResponse(fakeSettlementReceipt(), fakeGrant()),
    )

    expect(response).toMatchObject({
      result: { answer: { mentions: [{ sentences: [2] }] } },
    })
    expect(locateReviewSentences(text)).toHaveLength(2)
  })

  describe('across generated reviews', () => {
    // A small deterministic generator, so a failure names a reproducible input.
    function generator(seed: number) {
      let state = seed
      const next = () => {
        state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
        return state / 2 ** 32
      }
      return (items: readonly string[]) => items[Math.floor(next() * items.length)]!
    }
    const fragments = [
      'The room was clean',
      'Breakfast was cold',
      'Staff were kind',
      'Check-in took an hour',
      'Чудесно',
      'Но бавно',
      'Nice view 😊',
      'Too noisy at night',
      'Great value',
    ]
    const stops = ['.', '!', '?', '…', '', '...']
    const separators = [' ', '\n', '\n\n', '  ', '\t', ' \n ', '\u00a0', '\r\n']

    it('numbers every one of 300 generated reviews the way the display does', () => {
      const pick = generator(20_261_029)
      for (let index = 0; index < 300; index += 1) {
        const count = 1 + (index % 7)
        let text = ''
        for (let part = 0; part < count; part += 1) {
          text += pick(fragments) + pick(stops)
          if (part < count - 1) text += pick(separators)
        }
        const live = locateReviewSentences(text)
        const request = preparableV3Request({ rawText: text })
        if (live.length === 0) continue
        const sentences = request.source.sentences ?? []

        expect(
          sentences.map(({ number }) => number),
          JSON.stringify(text),
        ).toEqual(live.map(({ number }) => number))
        const { read, stored } = runThroughTheGateway(text)
        expect(read.length, JSON.stringify(text)).toBe(live.length)
        expect(stored.flat(), JSON.stringify(text)).toEqual(
          live.map(({ number }) => number),
        )
      }
    })
  })
})
