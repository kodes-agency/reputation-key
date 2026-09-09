import { describe, expect, it } from 'vitest'
import { ASPECT_POLARITIES_V1, ASPECT_TAXONOMY_V1 } from './aspect-taxonomy'
import {
  CLOSED_TREND_SIGNAL_IDS,
  computeDeterministicTrendCandidates,
  renderPropertyTrendReport,
  validateTrendSelection,
  type DeterministicAggregateWindow,
} from './ai-property-trend-contract'

function window(
  overrides: Partial<DeterministicAggregateWindow> = {},
): DeterministicAggregateWindow {
  return {
    reviewCount: 20,
    sentimentCounts: { positive: 5, neutral: 5, negative: 5, mixed: 5 },
    attentionCounts: { urgent: 5, high: 5, medium: 5, low: 5 },
    aspectCounts: [{ aspect: 'service', polarity: 'negative', count: 2 }],
    ...overrides,
  }
}

describe('AI property trend contract', () => {
  it('uses exact rational thresholds and deterministic score/id ordering', () => {
    const baseline = window({
      sentimentCounts: { positive: 4, neutral: 8, negative: 6, mixed: 2 },
      attentionCounts: { urgent: 4, high: 6, medium: 6, low: 4 },
    })
    const current = window({
      sentimentCounts: { positive: 12, neutral: 4, negative: 2, mixed: 2 },
      attentionCounts: { urgent: 1, high: 2, medium: 5, low: 12 },
      aspectCounts: [
        { aspect: 'service', polarity: 'negative', count: 8 },
        { aspect: 'quality', polarity: 'positive', count: 4 },
      ],
    })

    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: baseline,
      currentWindow: current,
    })

    expect(candidates.every(({ id }) => !id.startsWith('valence.'))).toBe(true)
    expect(candidates.map(({ id }) => id).slice(0, 3)).toEqual([
      'attention.low.up',
      'sentiment.positive.up',
      'aspect.service.negative.up',
    ])
    expect(Object.isFrozen(candidates)).toBe(true)
  })

  it('closes aspect signals over exactly the governed aspect and polarity vocabulary', () => {
    const aspectSignals = CLOSED_TREND_SIGNAL_IDS.filter((id) => id.startsWith('aspect.'))

    expect(aspectSignals).toHaveLength(
      ASPECT_TAXONOMY_V1.length * ASPECT_POLARITIES_V1.length * 2,
    )
    expect(
      aspectSignals.every((id) => {
        const [, aspect, polarity] = id.split('.')
        return (
          ASPECT_TAXONOMY_V1.includes(aspect as (typeof ASPECT_TAXONOMY_V1)[number]) &&
          ASPECT_POLARITIES_V1.includes(polarity as (typeof ASPECT_POLARITIES_V1)[number])
        )
      }),
    ).toBe(true)
  })

  it('excludes a share below fifteen points with unequal denominators', () => {
    const baseline = window({
      reviewCount: 20,
      sentimentCounts: { positive: 0, neutral: 8, negative: 6, mixed: 6 },
      attentionCounts: { urgent: 4, high: 6, medium: 6, low: 4 },
    })
    const current = window({
      reviewCount: 21,
      sentimentCounts: { positive: 1, neutral: 8, negative: 6, mixed: 6 },
      attentionCounts: { urgent: 4, high: 6, medium: 6, low: 5 },
      aspectCounts: [{ aspect: 'service', polarity: 'negative', count: 3 }],
    })

    expect(
      computeDeterministicTrendCandidates({
        baselineWindow: baseline,
        currentWindow: current,
      }).some(({ id }) => id === 'sentiment.positive.up'),
    ).toBe(false)
  })

  it('requires twenty analyses and includes an exact fifteen-point share change', () => {
    expect(() =>
      computeDeterministicTrendCandidates({
        baselineWindow: window({
          reviewCount: 19,
          sentimentCounts: { positive: 4, neutral: 5, negative: 5, mixed: 5 },
          attentionCounts: { urgent: 4, high: 5, medium: 5, low: 5 },
        }),
        currentWindow: window(),
      }),
    ).toThrow('at least twenty ready analyses')

    const baseline = window({
      reviewCount: 100,
      sentimentCounts: { positive: 25, neutral: 25, negative: 25, mixed: 25 },
      attentionCounts: { urgent: 25, high: 25, medium: 25, low: 25 },
      aspectCounts: [{ aspect: 'service', polarity: 'negative', count: 10 }],
    })
    const below = window({
      ...baseline,
      sentimentCounts: { positive: 39, neutral: 11, negative: 25, mixed: 25 },
    })
    const exact = window({
      ...baseline,
      sentimentCounts: { positive: 40, neutral: 10, negative: 25, mixed: 25 },
    })

    expect(
      computeDeterministicTrendCandidates({
        baselineWindow: baseline,
        currentWindow: below,
      }).some(({ id }) => id === 'sentiment.positive.up'),
    ).toBe(false)
    expect(
      computeDeterministicTrendCandidates({
        baselineWindow: baseline,
        currentWindow: exact,
      }).some(({ id }) => id === 'sentiment.positive.up'),
    ).toBe(true)
  })

  it('rejects duplicate or out-of-candidate selections', () => {
    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        sentimentCounts: { positive: 10, neutral: 0, negative: 5, mixed: 5 },
      }),
    })

    expect(() =>
      validateTrendSelection({
        candidates,
        selectedSignalIds: ['sentiment.positive.up', 'sentiment.positive.up'],
      }),
    ).toThrow('duplicate selected trend signal')
    expect(() =>
      validateTrendSelection({
        candidates,
        selectedSignalIds: ['attention.urgent.up'],
      }),
    ).toThrow('selected signal is not a candidate')
  })

  it('renders only fixed application-owned copy from selected IDs', () => {
    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: window(),
      currentWindow: window({
        sentimentCounts: { positive: 10, neutral: 0, negative: 5, mixed: 5 },
      }),
    })
    const report = renderPropertyTrendReport({
      candidates,
      selectedSignalIds: ['sentiment.positive.up'],
    })

    expect(report).toEqual({
      headline: 'Review signals improved',
      direction: 'improving',
      sentences: ['Positive sentiment rose from 25.0% to 50.0%'],
      summary: 'Positive sentiment rose from 25.0% to 50.0%.',
    })
    expect(JSON.stringify(report)).not.toMatch(/provider|model|prompt/i)
  })

  it('renders aspect and polarity signals without an average sentiment score', () => {
    const baseline = window({
      sentimentCounts: { positive: 0, neutral: 10, negative: 10, mixed: 0 },
      attentionCounts: { urgent: 10, high: 10, medium: 0, low: 0 },
      aspectCounts: [{ aspect: 'service', polarity: 'negative', count: 20 }],
    })
    const current = window({
      sentimentCounts: { positive: 10, neutral: 0, negative: 0, mixed: 10 },
      attentionCounts: { urgent: 0, high: 0, medium: 10, low: 10 },
      aspectCounts: [{ aspect: 'staff', polarity: 'neutral', count: 20 }],
    })
    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: baseline,
      currentWindow: current,
    })

    for (const candidate of candidates) {
      const rendered = renderPropertyTrendReport({
        candidates,
        selectedSignalIds: [candidate.id],
      })
      expect(rendered.summary).not.toMatch(/average sentiment score/i)
      expect(rendered.summary).toMatch(/ (rose|fell) from /)
    }
    expect(
      renderPropertyTrendReport({
        candidates,
        selectedSignalIds: ['aspect.service.negative.down'],
      }).summary,
    ).toBe('Service complaints fell from 100.0% to 0.0%.')
  })

  it('never reports a material mixed change as stable', () => {
    const baseline = window({
      sentimentCounts: { positive: 0, neutral: 10, negative: 10, mixed: 0 },
      attentionCounts: { urgent: 10, high: 10, medium: 0, low: 0 },
    })
    const current = window({
      sentimentCounts: { positive: 10, neutral: 0, negative: 10, mixed: 0 },
      attentionCounts: { urgent: 10, high: 0, medium: 0, low: 10 },
    })
    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: baseline,
      currentWindow: current,
    })

    const favorable = renderPropertyTrendReport({
      candidates,
      selectedSignalIds: ['sentiment.positive.up', 'attention.high.down'],
    })
    expect(favorable.headline).toBe('Review signals improved')
    expect(favorable.direction).toBe('improving')

    const leadingDirectionless = renderPropertyTrendReport({
      candidates,
      selectedSignalIds: ['sentiment.neutral.down', 'sentiment.positive.up'],
    })
    expect(leadingDirectionless.headline).toBe('Notable review changes')
    expect(leadingDirectionless.direction).toBe('improving')
  })

  it('reserves stable for neutral aspect signals', () => {
    const baseline = window({
      aspectCounts: [{ aspect: 'service', polarity: 'neutral', count: 20 }],
    })
    const current = window({
      aspectCounts: [{ aspect: 'staff', polarity: 'neutral', count: 20 }],
    })
    const candidates = computeDeterministicTrendCandidates({
      baselineWindow: baseline,
      currentWindow: current,
    })
    const report = renderPropertyTrendReport({
      candidates,
      selectedSignalIds: ['aspect.staff.neutral.up', 'aspect.service.neutral.down'],
    })

    expect(report.headline).toBe('Notable review changes')
    expect(report.direction).toBe('stable')
  })
})
