// Inbox aspect filter — the deep-link contract for
// `/inbox?aspect=<aspect>&polarity=<positive|neutral|negative>`.

import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { ASPECT_POLARITIES_V1, ASPECT_TAXONOMY_V1 } from '#/shared/aspect-taxonomy'
import {
  ASPECT_LABELS,
  ASPECT_OPTIONS,
  ASPECT_POLARITY_OPTIONS,
} from '#/shared/aspect-labels'
import { inboxSearchSchema } from './inbox-search-schema'

describe('inboxSearchSchema aspect and polarity params', () => {
  it('preserves the readable drill-down pair through parse', () => {
    expect(
      inboxSearchSchema.parse({ aspect: 'wait_time', polarity: 'negative' }),
    ).toEqual({
      aspect: 'wait_time',
      polarity: 'negative',
    })
  })

  it('strips undeclared params rather than silently activating a filter', () => {
    expect(inboxSearchSchema.parse({ notAnAspect: 'wait_time' })).toEqual({})
  })

  it('rejects unknown aspect, polarity, and attention values at their paths', () => {
    for (const [input, path] of [
      [{ aspect: 'brunch' }, 'aspect'],
      [{ polarity: 'urgent' }, 'polarity'],
      [{ attention: 'panic' }, 'attention'],
    ] as const) {
      expect(() => inboxSearchSchema.parse(input)).toThrow(z.ZodError)
      expect(inboxSearchSchema.safeParse(input).error?.issues[0]?.path).toEqual([path])
    }
  })

  it('accepts every canonical aspect and polarity', () => {
    for (const aspect of ASPECT_TAXONOMY_V1) {
      expect(inboxSearchSchema.parse({ aspect })).toEqual({ aspect })
    }
    for (const polarity of ASPECT_POLARITIES_V1) {
      expect(inboxSearchSchema.parse({ polarity })).toEqual({ polarity })
    }
  })

  it('keeps the aspect pair alongside attention so both narrow the query', () => {
    expect(
      inboxSearchSchema.parse({
        attention: 'urgent',
        aspect: 'service',
        polarity: 'negative',
      }),
    ).toEqual({
      attention: 'urgent',
      aspect: 'service',
      polarity: 'negative',
    })
  })
})

describe('inboxSearchSchema sort param', () => {
  it('preserves both supported server sort orders', () => {
    expect(inboxSearchSchema.parse({ sort: 'newest' })).toEqual({ sort: 'newest' })
    expect(inboxSearchSchema.parse({ sort: 'oldest' })).toEqual({ sort: 'oldest' })
  })

  it('rejects unsupported sort orders', () => {
    expect(() => inboxSearchSchema.parse({ sort: 'highest' })).toThrow(z.ZodError)
  })
})

describe('inboxSearchSchema rating presets', () => {
  it.each([
    [{ ratingMin: 5 }, { ratingMin: 5, ratingMax: 5 }],
    [{ ratingMin: 4, ratingMax: 5 }, { ratingMin: 4 }],
    [{ ratingMin: 1, ratingMax: 3 }, { ratingMax: 3 }],
  ])('normalizes an equivalent route range', (input, expected) => {
    expect(inboxSearchSchema.parse(input)).toEqual(expected)
  })

  it.each([
    { ratingMin: 2, ratingMax: 4 },
    { ratingMin: 4, ratingMax: 4 },
    { ratingMax: 5 },
  ])('clears a range the preset control cannot represent: %o', (input) => {
    expect(inboxSearchSchema.parse(input)).toEqual({})
  })
})

describe('inbox aspect labels', () => {
  it('labels every canonical aspect in canonical order', () => {
    expect(ASPECT_OPTIONS.map((option) => option.value)).toEqual([...ASPECT_TAXONOMY_V1])
    for (const option of ASPECT_OPTIONS) {
      expect(option.label).toBe(ASPECT_LABELS[option.value])
      expect(option.label).not.toContain('_')
    }
  })

  it('pins polarity option identity and order', () => {
    expect(ASPECT_POLARITY_OPTIONS.map((option) => option.value)).toEqual([
      ...ASPECT_POLARITIES_V1,
    ])
  })

  it('renders technical ids as polished labels', () => {
    expect(ASPECT_LABELS.wait_time).toBe('Wait time')
    expect(ASPECT_LABELS.wifi_and_tech).toBe('Wi-Fi and tech')
    expect(ASPECT_LABELS.check_in_out).toBe('Check-in/out')
  })
})
