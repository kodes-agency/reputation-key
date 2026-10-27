import { describe, expect, it } from 'vitest'
import { errorFactTags } from '#/shared/observability/error-facts'
import { scrubErrorEvent } from '#/shared/observability/sentry-event-scrub'
import type { PropertyTrendRetryCode } from '../../application/use-cases/generate-property-trend'
import { PropertyTrendRetryRequired } from './property-trend-retry-required'

/**
 * Every code a trend run asks to be retried with. The `satisfies` makes a code
 * added to the union a compile error here until it is listed, so the cases below
 * always cover the whole set.
 */
const RETRY_CODES = {
  trend_sequence_or_aggregate_gap: true,
  trend_evidence_reconciling: true,
  trend_population_limit_exceeded: true,
  trend_population_policy_unavailable: true,
} as const satisfies Record<PropertyTrendRetryCode, true>

const ALL_CODES = Object.keys(RETRY_CODES) as PropertyTrendRetryCode[]

describe('PropertyTrendRetryRequired', () => {
  it('keeps the message quarantine reasons and runbooks match on, and adds a name and a code', () => {
    const failure = new PropertyTrendRetryRequired('trend_population_policy_unavailable')

    expect(failure).toBeInstanceOf(Error)
    expect(failure.name).toBe('PropertyTrendRetryRequired')
    expect(failure.message).toBe(
      'AI property trend retry required: trend_population_policy_unavailable',
    )
    expect(failure.failureCode).toBe('trend_population_policy_unavailable')
  })

  it.each(ALL_CODES)('says %s in its message and in its code', (code) => {
    const failure = new PropertyTrendRetryRequired(code)

    expect(failure.message).toBe(`AI property trend retry required: ${code}`)
    expect(failure.failureCode).toBe(code)
  })

  it('starts its stack at the code that raised it, so an issue groups by the job', () => {
    const failure = new PropertyTrendRetryRequired('trend_evidence_reconciling')

    const [, firstFrame = ''] = (failure.stack ?? '').split('\n')
    expect(firstFrame).not.toContain('property-trend-retry-required.ts')
  })

  it.each(ALL_CODES)('is tagged with failure_code %s', (code) => {
    expect(errorFactTags(new PropertyTrendRetryRequired(code))).toEqual({
      failure_code: code,
    })
  })

  it('reaches the event as a tag while the message is still replaced', () => {
    const failure = new PropertyTrendRetryRequired('trend_sequence_or_aggregate_gap')

    const scrubbed = scrubErrorEvent(
      {
        message: failure.message,
        exception: {
          values: [{ type: failure.name, value: failure.message }],
        },
        tags: { runtime_source: 'bullmq-job', job_name: 'generate-property-ai-trend' },
      },
      { originalException: failure },
    ) as Record<string, unknown>

    expect(scrubbed.tags).toEqual({
      runtime_source: 'bullmq-job',
      job_name: 'generate-property-ai-trend',
      failure_code: 'trend_sequence_or_aggregate_gap',
    })
    expect(scrubbed.message).toBe('[REDACTED]')
    expect(JSON.stringify(scrubbed.exception)).not.toContain(
      'trend_sequence_or_aggregate_gap',
    )
  })
})
