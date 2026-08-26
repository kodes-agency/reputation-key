import { describe, expect, it } from 'vitest'
import {
  createReading,
  findDuplicate,
  getEffectiveValue,
  type MetricCorrection,
  type MetricReading,
} from './metric-reading'
import { createMetricReading, VALID_METRIC_KEYS } from './constructors'
import { isMetricError, metricError } from './errors'
import {
  metricReadingId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

const NOW = new Date('2026-01-16T00:00:00Z')

const makeReadingParams = (
  overrides: Partial<Parameters<typeof createReading>[0]> = {},
): Parameters<typeof createReading>[0] => ({
  id: metricReadingId('d4000000-0000-4000-8000-000000000071'),
  definitionVersionId: 'ver-1',
  metricKey: 'portal.content_review.completed',
  organizationId: organizationId('org-1'),
  propertyId: propertyId('d4000000-0000-4000-8000-000000000051'),
  value: 42,
  sampleCount: 10,
  sourceEventId: 'evt-1',
  sourcePolicy: 'first_party_workflow',
  occurredAt: new Date('2026-01-15T00:00:00Z'),
  propertyLocalDate: '2026-01-15',
  attributionQuality: 'exact',
  retentionClass: 'standard',
  now: NOW,
  ...overrides,
})

const correction = (
  kind: MetricCorrection['kind'],
  operand: number | null,
  overrides: Partial<MetricCorrection> = {},
): MetricCorrection => ({
  id: 'corr-1',
  correctedReadingId: 'd4000000-0000-4000-8000-000000000071',
  sourceEventId: 'correction-event-1',
  kind,
  reason: 'source_correction',
  actorType: 'system',
  actorId: 'metric-reconciliation',
  exactDelta: kind === 'adjust' ? operand : null,
  replacementValue: kind === 'replace' ? operand : null,
  occurredAt: NOW,
  recordedAt: NOW,
  supersedesCorrectionId: null,
  ...overrides,
})

describe('MetricReading', () => {
  it('creates a provenance-complete reading', () => {
    const reading = createReading(makeReadingParams())
    expect(reading).toMatchObject({
      value: 42,
      recordedAt: NOW,
      sampleCount: 10,
      sourcePolicy: 'first_party_workflow',
    })
  })

  it('validates values, timestamps, and the closed metric catalogue', () => {
    expect(createMetricReading(makeReadingParams()).metricKey).toBe(
      'portal.content_review.completed',
    )
    expect(VALID_METRIC_KEYS.has('portal.content_review.completed')).toBe(true)

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => createMetricReading(makeReadingParams({ value }))).toThrow(
        `Metric value must be finite and >= 0, got ${value}`,
      )
    }
    expect(() =>
      createMetricReading(
        Object.assign(makeReadingParams(), { occurredAt: 'not-a-date' }),
      ),
    ).toThrow('occurredAt must be a valid Date')
    expect(() =>
      createMetricReading(
        Object.assign(makeReadingParams(), { occurredAt: new Date(Number.NaN) }),
      ),
    ).toThrow('occurredAt must be a valid Date')
    expect(() =>
      createMetricReading(
        Object.assign(makeReadingParams(), { metricKey: 'unknown.metric' }),
      ),
    ).toThrow('Invalid metricKey: unknown.metric')
  })

  it('constructs and recognizes closed metric errors', () => {
    const error = metricError('repo_insert_failed', 'write failed', { retry: false })
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({
      _tag: 'MetricError',
      code: 'repo_insert_failed',
      message: 'write failed',
      context: { retry: false },
    })
    expect(metricError('invalid_value', 'bad value')).not.toHaveProperty('context')
    expect(isMetricError(error)).toBe(true)
    expect(isMetricError(null)).toBe(false)
    expect(isMetricError('MetricError')).toBe(false)
    expect(isMetricError({})).toBe(false)
    expect(isMetricError({ _tag: 'OtherError' })).toBe(false)
  })

  it('deduplicates by immutable version and source event across dimensions', () => {
    const reading = createReading(
      makeReadingParams({ portalId: portalId('d4000000-0000-4000-8000-000000000081') }),
    )
    expect(findDuplicate([reading], 'ver-1', 'evt-1')?.id).toBe(reading.id)
    expect(findDuplicate([reading], 'ver-1', 'evt-2')).toBeNull()
  })

  describe('append-only corrections', () => {
    const baseReading: MetricReading = createReading(makeReadingParams())

    it('uses the original value without a correction', () => {
      expect(getEffectiveValue(baseReading, [])).toBe(42)
    })

    it.each([
      ['retract', null, null],
      ['replace', 50, 50],
      ['adjust', 5, 47],
    ] as const)('applies the latest %s correction', (kind, operand, expected) => {
      expect(getEffectiveValue(baseReading, [correction(kind, operand)])).toBe(expected)
    })

    it('follows supersession lineage without mutating the original reading', () => {
      const first = correction('replace', 50)
      const latest = correction('adjust', 5, {
        id: 'corr-2',
        sourceEventId: 'correction-event-2',
        supersedesCorrectionId: first.id,
      })

      expect(getEffectiveValue(baseReading, [first, latest])).toBe(47)
      expect(baseReading.value).toBe(42)
    })
  })
})
