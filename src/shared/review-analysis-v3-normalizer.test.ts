import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from './merchant-ai-notice-contract'
import { REVIEW_ANALYSIS_V3_STORED_SCHEMA } from './review-analysis-v3'
import {
  REVIEW_ANALYSIS_NORMALIZATION_DIGEST,
  REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
  REVIEW_ANALYSIS_NORMALIZATION_MANIFEST,
  REVIEW_ANALYSIS_NORMALIZATION_VERSION,
  normalizeReviewAnalysisV3,
  type ReviewAnalysisNormalizationFlag,
  type ReviewAnalysisV3NormalizationContext,
  type ReviewAnalysisV3NormalizationResult,
} from './review-analysis-v3-normalizer'

const context: ReviewAnalysisV3NormalizationContext = Object.freeze({
  sentences: Object.freeze([
    'The invented room had weak cooling.',
    'The invented desk team replied quickly.',
    'The invented lobby was calm.',
  ]),
})

function mention(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    topic: 'facilities_equipment',
    polarity: 'negative',
    strength: 'clear',
    thing: 'air conditioning',
    issue: 'not working',
    sentences: [1],
    names_person: null,
    ...overrides,
  }
}

function answer(
  mentions: readonly unknown[],
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return { sentiment: 'negative', mentions, urgent: null, ...overrides }
}

function expectNormalized(
  value: ReviewAnalysisV3NormalizationResult,
): asserts value is Extract<
  ReviewAnalysisV3NormalizationResult,
  { status: 'normalized' }
> {
  expect(value.status).toBe('normalized')
  if (value.status !== 'normalized') {
    throw new TypeError(`expected normalized result, received ${value.reason}`)
  }
}

function numbersFrom(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_value, index) => first + index)
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

describe('review analysis v3 normalization contract', () => {
  it('passes a clean answer through and returns new frozen values', () => {
    const raw = answer([mention()])
    const result = normalizeReviewAnalysisV3(raw, context)

    expectNormalized(result)
    expect(result).toEqual({
      status: 'normalized',
      answer: {
        sentiment: 'negative',
        mentions: [
          {
            topic: 'facilities_equipment',
            polarity: 'negative',
            strength: 'clear',
            thing: 'air conditioning',
            issue: 'not working',
            sentences: [1],
            names_person: null,
          },
        ],
        urgent: null,
      },
      flags: [],
      droppedMentionCount: 0,
    })
    expect(result.answer).not.toBe(raw)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.answer)).toBe(true)
    expect(Object.isFrozen(result.answer.mentions)).toBe(true)
    expect(Object.isFrozen(result.answer.mentions[0])).toBe(true)
    expect(Object.isFrozen(result.answer.mentions[0]?.sentences)).toBe(true)
    expect(Object.isFrozen(result.flags)).toBe(true)
  })

  it('accepts zero mentions and ignores unknown top-level keys', () => {
    const result = normalizeReviewAnalysisV3(
      answer([], { sentiment: 'neutral', invented_field: 'never copied' }),
      context,
    )
    expect(result).toEqual({
      status: 'normalized',
      answer: { sentiment: 'neutral', mentions: [], urgent: null },
      flags: [],
      droppedMentionCount: 0,
    })
    expect(canonicalizeRfc8785(result)).not.toContain('invented_field')
  })

  it.each([
    ['null', null, 'answer_not_an_object'],
    ['array', [], 'answer_not_an_object'],
    ['number', 8, 'answer_not_an_object'],
    ['invalid sentiment', answer([], { sentiment: 'uncertain' }), 'sentiment_invalid'],
    ['missing sentiment', { mentions: [], urgent: null }, 'sentiment_invalid'],
    [
      'non-array mentions',
      { sentiment: 'neutral', mentions: {}, urgent: null },
      'mentions_not_an_array',
    ],
  ] as const)('returns output_invalid for %s', (_name, raw, reason) => {
    expect(normalizeReviewAnalysisV3(raw, context)).toEqual({
      status: 'output_invalid',
      reason,
    })
  })

  it('repairs sentence references above the governed maximum before validation', () => {
    const longContext = {
      sentences: Array.from({ length: 10_001 }, () => 'Invented sentence.'),
    }
    const result = normalizeReviewAnalysisV3(
      answer([mention({ sentences: [10_001] })]),
      longContext,
    )
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([])
    expect(result.flags).toEqual(['mention_dropped_sentences', 'sentence_refs_repaired'])
    expect(result.droppedMentionCount).toBe(1)
    expect(Object.isFrozen(result)).toBe(true)
  })
})

describe('review analysis v3 mention repairs and drops', () => {
  it('caps mentions at 48 before normalizing them', () => {
    const rawMentions = Array.from({ length: 49 }, () => mention())
    const result = normalizeReviewAnalysisV3(answer(rawMentions), context)
    expectNormalized(result)
    expect(result.answer.mentions).toHaveLength(1)
    expect(result.flags).toEqual(['mentions_capped', 'mentions_merged'])
    expect(result.droppedMentionCount).toBe(0)
  })

  it('caps sentence references at 16 before repairing them', () => {
    const sentences = Array.from(
      { length: 17 },
      (_value, index) => `Invented sentence ${String.fromCharCode(97 + index)}.`,
    )
    const result = normalizeReviewAnalysisV3(
      answer([
        mention({ sentences: Array.from({ length: 17 }, (_value, index) => index + 1) }),
      ]),
      { sentences },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]?.sentences).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
    ])
    expect(result.flags).toEqual(['sentence_refs_capped'])
  })

  it('repairs enum casing, cause text, sentence references and names-person casing', () => {
    const result = normalizeReviewAnalysisV3(
      answer(
        [
          mention({
            topic: ' Facilities_Equipment ',
            polarity: ' NEGATIVE ',
            strength: ' CLEAR ',
            thing: ' ＡＩＲ—CONDITIONING ',
            issue: ' NOT\tWORKING ',
            sentences: ['3', 1, '1', 0, 'x', 2],
            names_person: ' TEAM_MEMBER ',
          }),
        ],
        { sentiment: ' NEGATIVE ' },
      ),
      context,
    )
    expectNormalized(result)
    expect(result.answer).toEqual({
      sentiment: 'negative',
      mentions: [
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'clear',
          thing: 'air-conditioning',
          issue: 'not working',
          sentences: [1, 2, 3],
          names_person: 'team_member',
        },
      ],
      urgent: null,
    })
    expect(result.flags).toEqual(['enum_case_repaired', 'sentence_refs_repaired'])
  })

  it.each([
    ['non-object', 'bad mention', 'mention_dropped_malformed'],
    ['array', [], 'mention_dropped_malformed'],
    ['unknown topic', mention({ topic: 'room' }), 'mention_dropped_enum'],
    ['unknown polarity', mention({ polarity: 'complaint' }), 'mention_dropped_enum'],
    ['unknown strength', mention({ strength: 'severe' }), 'mention_dropped_enum'],
    ['non-array sentences', mention({ sentences: 1 }), 'mention_dropped_sentences'],
    [
      'no valid sentences',
      mention({ sentences: [0, 4, 'x'] }),
      'mention_dropped_sentences',
    ],
  ] as const)('drops a mention with %s', (_name, rawMention, flag) => {
    const result = normalizeReviewAnalysisV3(answer([rawMention]), context)
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([])
    expect(result.flags).toContain(flag)
    expect(result.droppedMentionCount).toBe(1)
  })

  it.each([
    ['non-string thing', mention({ thing: 9 })],
    ['overlong thing', mention({ thing: 'a'.repeat(81) })],
    ['four-word thing', mention({ thing: 'one two three four' })],
    ['digit in thing', mention({ thing: '30-minute wait', issue: 'long' })],
    ['digit in issue', mention({ issue: 'failed 2 times' })],
    ['comma in issue', mention({ issue: 'cold, wet' })],
    ['apostrophe in issue', mention({ issue: "didn't work" })],
    ['punctuation in issue', mention({ issue: 'failed/broken' })],
    ['empty issue', mention({ issue: '' })],
    ['thing without issue', mention({ issue: null })],
  ] as const)(
    'keeps a mention with %s and empties its cause instead of dropping it',
    (_name, rawMention) => {
      const result = normalizeReviewAnalysisV3(answer([rawMention]), context)
      expectNormalized(result)
      expect(result.answer.mentions).toEqual([
        {
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'clear',
          thing: null,
          issue: null,
          sentences: [1],
          names_person: null,
        },
      ])
      expect(result.flags).toEqual(['cause_refused_shape'])
      expect(result.droppedMentionCount).toBe(0)
    },
  )

  it('empties both parts of the cause when only one of them is invalid', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'shower', issue: 'cold after 2 minutes' })]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(result.flags).toEqual(['cause_refused_shape'])
  })

  it('merges two mentions whose invalid causes were emptied, as it does for a refused name', () => {
    const result = normalizeReviewAnalysisV3(
      answer([
        mention({ thing: '30 minute wait', issue: 'long', sentences: [1] }),
        mention({ thing: '45 minute wait', issue: 'long', sentences: [2] }),
      ]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([
      {
        topic: 'facilities_equipment',
        polarity: 'negative',
        strength: 'clear',
        thing: null,
        issue: null,
        sentences: [1, 2],
        names_person: null,
      },
    ])
    expect(result.flags).toEqual(['cause_refused_shape', 'mentions_merged'])
  })

  it('leaves a valid cause alone and raises no shape flag', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'check-in', issue: 'slow' })]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: 'check-in', issue: 'slow' })
    expect(result.flags).toEqual([])
  })

  it('normalizes invalid names_person to null without dropping the mention', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ names_person: 'guest_name' })]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]?.names_person).toBe(null)
    expect(result.flags).toEqual(['names_person_invalid'])
    expect(result.droppedMentionCount).toBe(0)
  })
})

describe('review analysis v3 cause privacy rules', () => {
  it('refuses a detected name without retaining or flagging its text', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'hilton', issue: 'noisy' })]),
      { sentences: ['We found Hilton noisy after sunset.'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(result.flags).toEqual(['cause_refused_name'])
    expect(canonicalizeRfc8785(result)).not.toContain('hilton')
    expect(result.droppedMentionCount).toBe(0)
  })

  it('refuses a name found through a hyphenated token part', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'marina', issue: 'noisy' })]),
      { sentences: ['We visited Marina-Bay yesterday evening.'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(result.flags).toEqual(['cause_refused_name'])
  })

  it('allows a capitalized common word', () => {
    const result = normalizeReviewAnalysisV3(answer([mention()]), {
      sentences: ['We found Air conditioning weak overnight.'],
    })
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({
      thing: 'air conditioning',
      issue: 'not working',
    })
    expect(result.flags).toEqual([])
  })

  it('allows a capitalized vocabulary-hint word', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'hydrojet', issue: 'too weak' })]),
      {
        sentences: ['We tried Hydrojet pressure during treatment.'],
        vocabularyHints: { facilities_equipment: ['hydrojet system'] },
      },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({
      thing: 'hydrojet',
      issue: 'too weak',
    })
    expect(result.flags).toEqual([])
  })

  it('uses extra name tokens without persisting them', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'solara', issue: 'too loud' })]),
      { sentences: ['The invented device was loud.'], extraNameTokens: ['Solara'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(canonicalizeRfc8785(result)).not.toContain('solara')
  })

  it('reads a brand in a title-case or shouting sentence as a name', () => {
    for (const sentence of [
      'Hilton Marina Bay Hotel',
      'HILTON MARINA BAY HOTEL',
      'Lovely Hilton Marina Bay Stay',
    ]) {
      const result = normalizeReviewAnalysisV3(
        answer([mention({ thing: 'hilton', issue: 'too loud' })]),
        { sentences: [sentence] },
      )
      expectNormalized(result)
      expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
      expect(result.flags).toEqual(['cause_refused_name'])
    }
  })

  it.each([
    ['a name opening the only sentence', ['Maria at reception was lovely.'], 'maria'],
    [
      'a name opening a later sentence',
      ['The room was clean.', 'Maria at reception was lovely.'],
      'maria',
    ],
    ['a brand opening a sentence', ['Hilton staff were lovely.'], 'hilton'],
  ] as const)('refuses %s', (_name, sentences, thing) => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing, issue: 'lovely' })]),
      { sentences },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(result.flags).toEqual(['cause_refused_name'])
    expect(canonicalizeRfc8785(result)).not.toContain(thing)
  })

  it('never lets a named person become a complaint cause', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ topic: 'staff_service', thing: 'maria', issue: 'rude' })]),
      { sentences: ['Maria at reception was rude.'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([
      {
        topic: 'staff_service',
        polarity: 'negative',
        strength: 'clear',
        thing: null,
        issue: null,
        sentences: [1],
        names_person: null,
      },
    ])
    expect(result.flags).toEqual(['cause_refused_name'])
  })

  it('still allows a common word or a hint word that opens a sentence', () => {
    const common = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'air conditioning', issue: 'weak' })]),
      { sentences: ['Air conditioning was weak overnight.'] },
    )
    expectNormalized(common)
    expect(common.answer.mentions[0]).toMatchObject({
      thing: 'air conditioning',
      issue: 'weak',
    })
    expect(common.flags).toEqual([])

    const hinted = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'hydrojet', issue: 'too weak' })]),
      {
        sentences: ['Hydrojet pressure was weak during treatment.'],
        vocabularyHints: { facilities_equipment: ['hydrojet system'] },
      },
    )
    expectNormalized(hinted)
    expect(hinted.answer.mentions[0]).toMatchObject({
      thing: 'hydrojet',
      issue: 'too weak',
    })
    expect(hinted.flags).toEqual([])
  })

  it('allows a three-word quotation boundary', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'air conditioning', issue: 'failed' })]),
      { sentences: ['The air conditioning failed overnight.'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({
      thing: 'air conditioning',
      issue: 'failed',
    })
    expect(result.flags).toEqual([])
  })

  it('refuses a four-word quotation boundary without dropping the mention', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ thing: 'air conditioning', issue: 'didnt work' })]),
      { sentences: ["The air-conditioning didn't work overnight."] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]).toMatchObject({ thing: null, issue: null })
    expect(result.flags).toEqual(['cause_refused_quotation'])
    expect(result.droppedMentionCount).toBe(0)
  })

  it('collapses refused causes into one topic-level dedupe key', () => {
    const result = normalizeReviewAnalysisV3(
      answer([
        mention({ thing: 'hilton', issue: 'noisy', sentences: [1] }),
        mention({ thing: 'maria', issue: 'unhelpful', sentences: [2] }),
      ]),
      {
        sentences: [
          'We found Hilton noisy after sunset.',
          'We met Maria near the invented desk.',
        ],
      },
    )
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([
      {
        topic: 'facilities_equipment',
        polarity: 'negative',
        strength: 'clear',
        thing: null,
        issue: null,
        sentences: [1, 2],
        names_person: null,
      },
    ])
    expect(result.flags).toEqual(['cause_refused_name', 'mentions_merged'])
  })
})

describe('review analysis v3 person marker and merge rules', () => {
  it('raises names_person only when a cited sentence contains [PERSON]', () => {
    const sentences = [
      'The invented host [PERSON] was welcoming.',
      'The invented room was quiet.',
    ]
    const cited = normalizeReviewAnalysisV3(answer([mention({ sentences: [1] })]), {
      sentences,
    })
    const uncited = normalizeReviewAnalysisV3(answer([mention({ sentences: [2] })]), {
      sentences,
    })
    expectNormalized(cited)
    expectNormalized(uncited)
    expect(cited.answer.mentions[0]?.names_person).toBe('other')
    expect(cited.flags).toEqual(['names_person_raised'])
    expect(uncited.answer.mentions[0]?.names_person).toBe(null)
    expect(uncited.flags).toEqual([])
  })

  it('does not replace an explicit team-member classification with the marker fallback', () => {
    const result = normalizeReviewAnalysisV3(
      answer([mention({ names_person: 'team_member' })]),
      { sentences: ['The invented host [PERSON] was welcoming.'] },
    )
    expectNormalized(result)
    expect(result.answer.mentions[0]?.names_person).toBe('team_member')
    expect(result.flags).toEqual([])
  })

  it('merges by first appearance with greatest strength, first greatest issue, names precedence and sentence union', () => {
    const result = normalizeReviewAnalysisV3(
      answer([
        mention({
          strength: 'mild',
          issue: 'too weak',
          sentences: [3],
          names_person: null,
        }),
        mention({
          topic: 'cleanliness',
          thing: 'room',
          issue: 'not clean',
          sentences: [2],
        }),
        mention({
          strength: 'strong',
          issue: 'very noisy',
          sentences: [1],
          names_person: 'team_member',
        }),
        mention({
          strength: 'strong',
          issue: 'bad airflow',
          sentences: [2],
          names_person: 'other',
        }),
      ]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions).toEqual([
      {
        topic: 'facilities_equipment',
        polarity: 'negative',
        strength: 'strong',
        thing: 'air conditioning',
        issue: 'very noisy',
        sentences: [1, 2, 3],
        names_person: 'other',
      },
      {
        topic: 'cleanliness',
        polarity: 'negative',
        strength: 'clear',
        thing: 'room',
        issue: 'not clean',
        sentences: [2],
        names_person: null,
      },
    ])
    expect(result.flags).toEqual(['mentions_merged'])
  })

  it.each([
    [
      'the first mention holds the lowest numbers',
      numbersFrom(1, 16),
      numbersFrom(17, 32),
      numbersFrom(1, 16),
      ['mentions_merged', 'sentence_refs_capped'],
    ],
    [
      'the second mention holds the lowest numbers',
      numbersFrom(17, 32),
      numbersFrom(1, 16),
      numbersFrom(1, 16),
      ['mentions_merged', 'sentence_refs_capped'],
    ],
    [
      'the two overlap',
      numbersFrom(1, 12),
      numbersFrom(5, 20),
      numbersFrom(1, 16),
      ['mentions_merged', 'sentence_refs_capped'],
    ],
    [
      'the union is exactly 16',
      numbersFrom(1, 8),
      numbersFrom(9, 16),
      numbersFrom(1, 16),
      ['mentions_merged'],
    ],
  ] as const)(
    'caps merged sentence references at 16 when %s, without failing the answer',
    (_name, first, second, expected, expectedFlags) => {
      const sentences = Array.from(
        { length: 40 },
        (_value, index) => `Invented sentence ${index + 1}.`,
      )
      const result = normalizeReviewAnalysisV3(
        answer([
          mention({ sentences: first }),
          mention({ sentences: second, strength: 'mild', issue: 'noisy' }),
        ]),
        { sentences },
      )
      expectNormalized(result)
      expect(result.answer.mentions).toHaveLength(1)
      expect(result.answer.mentions[0]?.sentences).toEqual(expected)
      expect(result.flags).toEqual(expectedFlags)
      expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(result.answer).success).toBe(true)
    },
  )

  it('keeps separate keys when topic, normalized thing or polarity differs', () => {
    const result = normalizeReviewAnalysisV3(
      answer([
        mention(),
        mention({ topic: 'main_service' }),
        mention({ thing: 'heating' }),
        mention({ polarity: 'positive', issue: 'working well' }),
      ]),
      context,
    )
    expectNormalized(result)
    expect(result.answer.mentions).toHaveLength(4)
    expect(result.flags).toEqual([])
  })
})

describe('review analysis v3 urgent normalization', () => {
  it('normalizes a known urgent reason and freezes it', () => {
    const result = normalizeReviewAnalysisV3(
      answer([], { sentiment: 'neutral', urgent: { reason: ' HEALTH ' } }),
      context,
    )
    expectNormalized(result)
    expect(result.answer.urgent).toEqual({ reason: 'health' })
    expect(result.flags).toEqual(['enum_case_repaired'])
    expect(Object.isFrozen(result.answer.urgent)).toBe(true)
  })

  it.each([
    ['unknown reason', { reason: 'billing' }],
    ['missing reason', {}],
    ['wrong object type', 'safety'],
  ])('repairs %s to null', (_name, urgent) => {
    const result = normalizeReviewAnalysisV3(
      answer([], { sentiment: 'neutral', urgent }),
      context,
    )
    expectNormalized(result)
    expect(result.answer.urgent).toBe(null)
    expect(result.flags).toEqual(['urgent_reason_unknown'])
  })
})

describe('review analysis v3 determinism and totality', () => {
  it('does not mutate a deeply frozen input', () => {
    const raw = deepFreeze(
      answer([
        mention({
          thing: ' AIR—CONDITIONING ',
          issue: ' NOT WORKING ',
          sentences: [3, 1, 1],
        }),
      ]),
    )
    const before = canonicalizeRfc8785(raw)
    const result = normalizeReviewAnalysisV3(raw, context)
    expectNormalized(result)
    expect(canonicalizeRfc8785(raw)).toBe(before)
  })

  it('returns equal output for the same input and context', () => {
    const raw = answer([mention({ sentences: [3, 1, 1] })])
    const first = normalizeReviewAnalysisV3(raw, context)
    const second = normalizeReviewAnalysisV3(raw, context)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
  })

  it('never throws across structured random answers and always stores a valid answer', () => {
    let state = 0x5eed1234
    const next = (): number => {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
      return state
    }
    const pick = <const Values extends readonly [unknown, ...unknown[]]>(
      values: Values,
    ): Values[number] => values[next() % values.length] ?? values[0]
    const sentencePool = [
      'The invented room had weak cooling.',
      'We met Maria near the invented desk.',
      'The invented host [PERSON] was welcoming.',
      'Hilton was loud after sunset!',
      'Wonderful Friendly Helpful Team',
      'Nobody came to fix it.',
    ] as const
    const phrase = (): unknown =>
      pick([
        null,
        null,
        'air conditioning',
        'not working',
        'front desk',
        'wait',
        'hilton',
        'maria',
        'check—in queue',
        'ＡＩＲ',
        'room 2',
        '',
        '   ',
        'very very slow service',
        'a'.repeat(90),
        42,
        {},
        [],
      ] as const)
    const sentenceRefs = (): unknown => {
      if (next() % 9 === 0) return pick([null, 3, 'x', {}] as const)
      return Array.from({ length: next() % 20 }, () =>
        pick([1, 2, 3, 4, 6, 7, 0, -1, 2.5, 99, '2', 'x', null] as const),
      )
    }
    const randomMention = (): unknown => {
      if (next() % 12 === 0) return pick([null, 7, 'bad', []] as const)
      return {
        topic: pick([
          'staff_service',
          'cleanliness',
          'safety',
          'Staff_Service',
          'room',
          '',
          null,
          7,
        ] as const),
        polarity: pick([
          'positive',
          'negative',
          'neutral',
          ' NEGATIVE ',
          'bad',
          null,
        ] as const),
        strength: pick(['mild', 'clear', 'strong', 'STRONG', 'severe', 1] as const),
        thing: phrase(),
        issue: phrase(),
        sentences: sentenceRefs(),
        names_person: pick([
          null,
          null,
          'team_member',
          'other',
          'OTHER',
          'guest',
          7,
        ] as const),
        extra: 'never copied',
      }
    }
    const randomAnswer = (): unknown => ({
      sentiment: pick([
        'positive',
        'neutral',
        'negative',
        'mixed',
        ' MIXED ',
        'unknown',
        null,
        3,
      ] as const),
      mentions: Array.from({ length: next() % 60 }, randomMention),
      urgent: pick([
        null,
        null,
        { reason: 'safety' },
        { reason: 'HEALTH' },
        { reason: 'billing' },
        {},
        'safety',
        4,
      ] as const),
    })

    let normalizedWithMentions = 0
    for (let index = 0; index < 300; index += 1) {
      const raw = deepFreeze(randomAnswer())
      const fuzzContext: ReviewAnalysisV3NormalizationContext = {
        sentences: Array.from({ length: next() % 7 }, () => pick(sentencePool)),
      }
      const result = normalizeReviewAnalysisV3(raw, fuzzContext)
      expect(normalizeReviewAnalysisV3(raw, fuzzContext)).toEqual(result)
      if (result.status === 'output_invalid') {
        expect(['sentiment_invalid', 'stored_contract_violated']).toContain(result.reason)
        continue
      }
      expect(REVIEW_ANALYSIS_V3_STORED_SCHEMA.safeParse(result.answer).success).toBe(true)
      expect(result.answer.mentions.length).toBeLessThanOrEqual(48)
      for (const mention of result.answer.mentions) {
        for (const number of mention.sentences) {
          expect(number).toBeLessThanOrEqual(fuzzContext.sentences.length)
        }
      }
      expect(result.flags).toEqual([...new Set(result.flags)].sort())
      for (const flag of result.flags) {
        expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toContain(flag)
      }
      expect(result.droppedMentionCount).toBeLessThanOrEqual(48)
      if (result.answer.mentions.length > 0) normalizedWithMentions += 1
    }
    expect(normalizedWithMentions).toBeGreaterThan(30)
  })

  it('rejects non-answer shapes without throwing', () => {
    for (const raw of [
      undefined,
      null,
      true,
      7,
      'text',
      [],
      [[]],
      () => 1,
      Symbol('x'),
    ]) {
      expect(normalizeReviewAnalysisV3(raw, context)).toEqual({
        status: 'output_invalid',
        reason: 'answer_not_an_object',
      })
    }
  })

  it('always emits sorted unique flags from the closed vocabulary', () => {
    const result = normalizeReviewAnalysisV3(
      answer(
        ['bad', 'bad', mention({ names_person: 'invalid', sentences: [3, 1, 1, 0] })],
        { urgent: { reason: 'billing' } },
      ),
      context,
    )
    expectNormalized(result)
    expect(result.flags).toEqual([
      'mention_dropped_malformed',
      'names_person_invalid',
      'sentence_refs_repaired',
      'urgent_reason_unknown',
    ])
    expect(result.flags).toEqual([...new Set(result.flags)].sort())
    for (const flag of result.flags) {
      const governed: ReviewAnalysisNormalizationFlag = flag
      expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toContain(governed)
    }
  })
})

describe('review analysis v3 normalization governance', () => {
  it('pins the full manifest and computed digest', () => {
    expect(REVIEW_ANALYSIS_NORMALIZATION_VERSION).toBe('review-analysis-normalization-v1')
    expect(REVIEW_ANALYSIS_NORMALIZATION_DIGEST).toBe(
      'b786e88567c1121c9e4ddc38c8db1b0a0f58de3d5905453bb26f3e21435767a9',
    )
    expect(REVIEW_ANALYSIS_NORMALIZATION_DIGEST).toBe(
      createHash('sha256')
        .update('repkey-review-analysis-normalization-v1\0', 'utf8')
        .update(canonicalizeRfc8785(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST), 'utf8')
        .digest('hex'),
    )
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST).toMatchObject({
      version: 'review-analysis-normalization-v1',
      limits: { mentions: 48, sentenceReferences: 16, sentenceNumber: 10_000 },
      causePatternSource: '^[a-z]+(?:-[a-z]+)*(?: [a-z]+(?:-[a-z]+)*){0,2}$',
      causePhraseMaximumWords: 3,
      causePhraseMaximumLength: 80,
      invalidCausePolicy: 'empty-cause-keep-mention',
      quotationRunLength: 4,
      personMarker: '[PERSON]',
      commonWordCatalogueVersion: 'review-cause-common-words-v1',
    })
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.nameTokenRules).toEqual({
      wordPatternSource: "\\p{L}+(?:['’-]\\p{L}+)*",
      ignoredPlaceholderPatternSource: '\\[[A-Z_]+\\]',
      minimumCandidateLetters: 2,
      everyCapitalizedWordIsCandidate: true,
      lowercaseOccurrenceSuppressesCandidate: true,
      includeHyphenAndApostropheParts: true,
    })
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.normalizedDashCodePoints).toEqual([
      'U+2010',
      'U+2011',
      'U+2012',
      'U+2013',
      'U+2014',
      'U+2015',
      'U+2212',
      'U+FE58',
      'U+FE63',
      'U+FF0D',
    ])
    expect(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.flags).toEqual(
      REVIEW_ANALYSIS_NORMALIZATION_FLAGS,
    )
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST)).toBe(true)
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.limits)).toBe(true)
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.enumVocabularies)).toBe(
      true,
    )
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.commonWords)).toBe(true)
  })

  it('attests a sorted unique lowercase common-word catalogue', () => {
    const words = REVIEW_ANALYSIS_NORMALIZATION_MANIFEST.commonWords
    expect(words.length).toBeGreaterThan(500)
    expect(words).toEqual([...words].sort())
    expect(new Set(words).size).toBe(words.length)
    for (const word of words) expect(word).toMatch(/^[a-z]{2,}$/)
  })

  it('exports the exact closed flag vocabulary', () => {
    expect(REVIEW_ANALYSIS_NORMALIZATION_FLAGS).toEqual([
      'mentions_capped',
      'sentence_refs_capped',
      'enum_case_repaired',
      'mention_dropped_malformed',
      'mention_dropped_enum',
      'mention_dropped_cause',
      'mention_dropped_sentences',
      'sentence_refs_repaired',
      'cause_refused_name',
      'cause_refused_quotation',
      'cause_refused_shape',
      'names_person_invalid',
      'names_person_raised',
      'mentions_merged',
      'urgent_reason_unknown',
    ])
    expect(Object.isFrozen(REVIEW_ANALYSIS_NORMALIZATION_FLAGS)).toBe(true)
  })
})
