import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod/v4'
import {
  AI_PROPERTY_TREND_CONTRACT_DIGEST,
  AI_PROPERTY_TREND_CONTRACT_VERSION,
  AI_TREND_RENDER_PROFILE_DIGEST,
  AI_TREND_RENDER_PROFILE_VERSION,
  CLOSED_TREND_SIGNAL_IDS,
  computeDeterministicTrendCandidates,
  renderPropertyTrendReport,
  validateDeterministicAggregateWindow,
  validateTrendSelection,
  type DeterministicAggregateWindow,
  type DeterministicTrendCandidate,
} from './ai-property-trend-contract'

function window(
  overrides: Partial<DeterministicAggregateWindow> = {},
): DeterministicAggregateWindow {
  const reviewCount = overrides.reviewCount ?? 100
  return {
    reviewCount,
    valenceSum: overrides.valenceSum ?? 0,
    sentimentCounts: overrides.sentimentCounts ?? {
      positive: 0,
      neutral: reviewCount,
      negative: 0,
      mixed: 0,
    },
    attentionCounts: overrides.attentionCounts ?? {
      urgent: 0,
      high: 0,
      medium: 0,
      low: reviewCount,
    },
    categoryCounts: overrides.categoryCounts ?? {
      service: 0,
      staff: 0,
      quality: 0,
      value: 0,
      cleanliness: 0,
      waitTime: 0,
      atmosphere: 0,
      location: 0,
      accessibility: 0,
      other: reviewCount,
    },
  }
}

function candidate(
  id: DeterministicTrendCandidate['id'],
  values: Partial<Omit<DeterministicTrendCandidate, 'id'>> = {},
): DeterministicTrendCandidate {
  return {
    id,
    baselineNumerator: values.baselineNumerator ?? 0,
    baselineDenominator: values.baselineDenominator ?? 100,
    currentNumerator: values.currentNumerator ?? 10,
    currentDenominator: values.currentDenominator ?? 100,
  }
}

describe('ai-property-trend-contract', () => {
  it('publishes the exact 38 closed IDs in lexical order', () => {
    expect(CLOSED_TREND_SIGNAL_IDS).toHaveLength(38)
    expect(CLOSED_TREND_SIGNAL_IDS).toEqual([...CLOSED_TREND_SIGNAL_IDS].sort())
    expect(new Set(CLOSED_TREND_SIGNAL_IDS).size).toBe(38)
  })

  it('binds candidate formulas and rendering to stable profile digests', () => {
    expect(AI_PROPERTY_TREND_CONTRACT_VERSION).toBe('property-trend-v1')
    expect(AI_TREND_RENDER_PROFILE_VERSION).toBe('trend-render-v1')
    expect(AI_TREND_RENDER_PROFILE_DIGEST).toBe(
      'd4b992311020947c2bdefdd4569088c0126f2629d823ff5c7d302248a1e628c7',
    )
    expect(AI_PROPERTY_TREND_CONTRACT_DIGEST).toBe(
      '7277e410dcdd0f6a4861e11707a5c165ca3e1bbbf800fa0bab00681a37e87ce4',
    )
  })

  it('strictly validates safe aggregate counts, family sums, and valence bounds', () => {
    expect(validateDeterministicAggregateWindow(window())).toEqual(window())

    expect(() => validateDeterministicAggregateWindow({ ...window(), extra: 1 })).toThrow(
      ZodError,
    )
    expect(() =>
      validateDeterministicAggregateWindow(window({ reviewCount: 9 })),
    ).toThrow(/at least ten ready analyses/)
    expect(() =>
      validateDeterministicAggregateWindow({
        ...window(),
        sentimentCounts: { positive: 1, neutral: 100, negative: 0, mixed: 0 },
      }),
    ).toThrow(/sentiment counts must sum to reviewCount/)
    expect(() =>
      validateDeterministicAggregateWindow(window({ valenceSum: 10_001 })),
    ).toThrow(/outside the aggregate reviewCount bounds/)
    expect(() =>
      validateDeterministicAggregateWindow({
        ...window(),
        reviewCount: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow(ZodError)
  })

  it('admits share changes at exactly ten points and rejects just below', () => {
    const exact = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        sentimentCounts: { positive: 10, neutral: 90, negative: 0, mixed: 0 },
      }),
    })
    const below = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        sentimentCounts: { positive: 9, neutral: 91, negative: 0, mixed: 0 },
      }),
    })

    expect(exact.map(({ id }) => id)).toEqual([
      'sentiment.neutral.down',
      'sentiment.positive.up',
    ])
    expect(below).toEqual([])
  })

  it('compares unequal window denominators by exact cross multiplication', () => {
    const baseline = window({
      reviewCount: 10,
      sentimentCounts: { positive: 1, neutral: 9, negative: 0, mixed: 0 },
    })
    const exact = window({
      reviewCount: 20,
      sentimentCounts: { positive: 4, neutral: 16, negative: 0, mixed: 0 },
    })
    const below = window({
      reviewCount: 20,
      sentimentCounts: { positive: 3, neutral: 17, negative: 0, mixed: 0 },
    })

    expect(
      computeDeterministicTrendCandidates({
        baselineWindow: baseline,
        currentWindow: exact,
      }).map(({ id }) => id),
    ).toEqual(['sentiment.neutral.down', 'sentiment.positive.up'])
    expect(
      computeDeterministicTrendCandidates({
        baselineWindow: baseline,
        currentWindow: below,
      }),
    ).toEqual([])
  })

  it('requires category prevalence at exactly one tenth in either window', () => {
    const exact = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        categoryCounts: {
          service: 10,
          staff: 0,
          quality: 0,
          value: 0,
          cleanliness: 0,
          waitTime: 0,
          atmosphere: 0,
          location: 0,
          accessibility: 0,
          other: 90,
        },
      }),
    })
    const below = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        categoryCounts: {
          service: 9,
          staff: 0,
          quality: 0,
          value: 0,
          cleanliness: 0,
          waitTime: 0,
          atmosphere: 0,
          location: 0,
          accessibility: 0,
          other: 91,
        },
      }),
    })

    expect(exact.map(({ id }) => id)).toContain('category.service.up')
    expect(below.map(({ id }) => id)).not.toContain('category.service.up')
  })

  it('admits mean valence changes at exactly fifteen and rejects just below', () => {
    const exact = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({ valenceSum: 1_500 }),
    })
    const below = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({ valenceSum: 1_499 }),
    })

    expect(exact.map(({ id }) => id)).toEqual(['valence.overall.up'])
    expect(below).toEqual([])
  })

  it('ties share and valence normalized magnitudes lexicographically', () => {
    const result = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        valenceSum: 1_500,
        sentimentCounts: { positive: 10, neutral: 90, negative: 0, mixed: 0 },
      }),
    })

    expect(result.map(({ id }) => id)).toEqual([
      'sentiment.neutral.down',
      'sentiment.positive.up',
      'valence.overall.up',
    ])
  })

  it('uses exact BigInt rational ordering, lexical tie breaks, and the top twelve cap', () => {
    const baseline = window({
      sentimentCounts: { positive: 25, neutral: 25, negative: 25, mixed: 25 },
      attentionCounts: { urgent: 25, high: 25, medium: 25, low: 25 },
      categoryCounts: {
        service: 10,
        staff: 10,
        quality: 10,
        value: 10,
        cleanliness: 10,
        waitTime: 10,
        atmosphere: 10,
        location: 10,
        accessibility: 10,
        other: 10,
      },
    })
    const current = window({
      sentimentCounts: { positive: 0, neutral: 0, negative: 50, mixed: 50 },
      attentionCounts: { urgent: 0, high: 0, medium: 50, low: 50 },
      categoryCounts: {
        service: 20,
        staff: 20,
        quality: 20,
        value: 20,
        cleanliness: 20,
        waitTime: 0,
        atmosphere: 0,
        location: 0,
        accessibility: 0,
        other: 0,
      },
    })
    const result = computeDeterministicTrendCandidates({
      baselineWindow: baseline,
      currentWindow: current,
    })

    expect(result).toHaveLength(12)
    expect(result.slice(0, 4).map(({ id }) => id)).toEqual([
      'attention.high.down',
      'attention.low.up',
      'attention.medium.up',
      'attention.urgent.down',
    ])
  })

  it('validates one to four unique selected IDs against the exact candidates', () => {
    const candidates = [
      candidate('attention.urgent.down', {
        baselineNumerator: 20,
        currentNumerator: 0,
      }),
      candidate('sentiment.positive.up'),
    ]

    expect(
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.up', 'attention.urgent.down'],
        candidates,
      }),
    ).toEqual(['sentiment.positive.up', 'attention.urgent.down'])
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.up'],
        candidates: [...candidates].reverse(),
      }),
    ).toThrow(/deterministic order/)
    expect(() => validateTrendSelection({ selectedSignalIds: [], candidates })).toThrow(
      ZodError,
    )
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.up', 'sentiment.positive.up'],
        candidates,
      }),
    ).toThrow(/duplicate selected trend signal/)
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['category.staff.up'],
        candidates,
      }),
    ).toThrow(/selected signal is not a candidate/)
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: [
          'sentiment.positive.up',
          'attention.urgent.down',
          'sentiment.neutral.up',
          'sentiment.mixed.up',
          'sentiment.negative.up',
        ],
        candidates: [
          ...candidates,
          candidate('sentiment.neutral.up'),
          candidate('sentiment.mixed.up'),
          candidate('sentiment.negative.up'),
        ],
      }),
    ).toThrow(ZodError)

    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.down'],
        candidates: [
          {
            ...candidate('sentiment.positive.down'),
            currentNumerator: -1,
          },
        ],
      }),
    ).toThrow(/invalid share candidate/)
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.down'],
        candidates: [
          {
            ...candidate('sentiment.positive.down'),
            currentNumerator: 10,
          },
        ],
      }),
    ).toThrow(/candidate direction does not match its exact rational delta/)
    const unexpectedCandidate = {
      ...candidate('sentiment.positive.up'),
    }
    Reflect.set(unexpectedCandidate, 'unexpected', true)
    expect(() =>
      validateTrendSelection({
        selectedSignalIds: ['sentiment.positive.up'],
        candidates: [unexpectedCandidate],
      }),
    ).toThrow(ZodError)
  })

  it('renders improved, attention, and notable headings from closed polarity', () => {
    const improved = renderPropertyTrendReport({
      selectedSignalIds: ['sentiment.positive.up'],
      candidates: [candidate('sentiment.positive.up')],
    })
    const attention = renderPropertyTrendReport({
      selectedSignalIds: ['sentiment.negative.up'],
      candidates: [candidate('sentiment.negative.up')],
    })
    const notable = renderPropertyTrendReport({
      selectedSignalIds: ['category.service.up'],
      candidates: [candidate('category.service.up')],
    })
    const mixed = renderPropertyTrendReport({
      selectedSignalIds: ['sentiment.positive.up', 'sentiment.negative.up'],
      candidates: [
        candidate('sentiment.negative.up'),
        candidate('sentiment.positive.up'),
      ],
    })

    expect(improved.headline).toBe('Review signals improved')
    expect(attention.headline).toBe('Review signals need attention')
    expect(notable.headline).toBe('Notable review changes')
    expect(mixed.headline).toBe('Notable review changes')
  })

  it('rounds exact rational values half away from zero to one decimal', () => {
    const share = renderPropertyTrendReport({
      selectedSignalIds: ['sentiment.positive.up'],
      candidates: [
        candidate('sentiment.positive.up', {
          baselineNumerator: 0,
          baselineDenominator: 16,
          currentNumerator: 3,
          currentDenominator: 16,
        }),
      ],
    })
    const valence = renderPropertyTrendReport({
      selectedSignalIds: ['valence.overall.down'],
      candidates: [
        candidate('valence.overall.down', {
          baselineNumerator: 0,
          baselineDenominator: 20,
          currentNumerator: -305,
          currentDenominator: 20,
        }),
      ],
    })

    expect(share.sentences).toEqual(['Positive sentiment rose from 0.0% to 18.8%'])
    expect(valence.sentences).toEqual([
      'Average sentiment score declined from 0.0 to -15.3',
    ])
  })

  it('renders no more than four closed sentences and remains under 600 characters', () => {
    const candidates = [
      candidate('attention.urgent.down', { baselineNumerator: 20, currentNumerator: 0 }),
      candidate('category.cleanliness.down', {
        baselineNumerator: 30,
        currentNumerator: 10,
      }),
      candidate('valence.overall.up', { currentNumerator: 2_000 }),
      candidate('category.accessibility.up'),
    ]
    const rendered = renderPropertyTrendReport({
      selectedSignalIds: candidates.map(({ id }) => id) as [
        DeterministicTrendCandidate['id'],
        DeterministicTrendCandidate['id'],
        DeterministicTrendCandidate['id'],
        DeterministicTrendCandidate['id'],
      ],
      candidates,
    })

    expect(rendered.sentences).toHaveLength(4)
    expect(rendered.summary.length).toBeLessThan(600)
    expect(rendered.summary).toBe(rendered.sentences.join('. ') + '.')
  })
})
