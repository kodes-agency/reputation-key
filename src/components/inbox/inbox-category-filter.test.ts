// Inbox category filter — the deep-link contract for `/inbox?category=<id>`.
//
// `inboxSearchSchema` is a `z.object`, which STRIPS unknown keys: an undeclared
// search param reaches the page as `undefined` and silently filters nothing.
// These tests pin the declaration (and its label derivation) so the filter can
// never go inert without failing here.

import { describe, it, expect } from 'vitest'
import { z } from 'zod/v4'
import { AI_PRIMARY_CATEGORIES } from '#/shared/openai-route-output-schemas'
import { inboxSearchSchema } from './inbox-search-schema'
import { AI_CATEGORY_LABELS, AI_CATEGORY_OPTIONS } from '#/shared/ai-category-labels'

describe('inboxSearchSchema category param', () => {
  it('preserves a declared category through parse', () => {
    expect(inboxSearchSchema.parse({ category: 'wait_time' })).toEqual({
      category: 'wait_time',
    })
  })

  it('strips an undeclared param (the defect class this filter must avoid)', () => {
    expect(inboxSearchSchema.parse({ notACategory: 'wait_time' })).toEqual({})
  })

  it('rejects an unknown category the same way it rejects an unknown attention', () => {
    // A bare toThrow() would pass on a typo in the schema import, so pin the
    // zod failure and the offending path.
    expect(() => inboxSearchSchema.parse({ category: 'brunch' })).toThrow(z.ZodError)
    expect(
      inboxSearchSchema.safeParse({ category: 'brunch' }).error?.issues[0]?.path,
    ).toEqual(['category'])
    expect(() => inboxSearchSchema.parse({ attention: 'panic' })).toThrow(z.ZodError)
    expect(
      inboxSearchSchema.safeParse({ attention: 'panic' }).error?.issues[0]?.path,
    ).toEqual(['attention'])
  })

  it('accepts every canonical category', () => {
    for (const category of AI_PRIMARY_CATEGORIES) {
      expect(inboxSearchSchema.parse({ category })).toEqual({ category })
    }
  })

  it('survives alongside the attention filter (both narrow the same query)', () => {
    expect(inboxSearchSchema.parse({ attention: 'urgent', category: 'service' })).toEqual(
      {
        attention: 'urgent',
        category: 'service',
      },
    )
  })
})

describe('inbox category labels', () => {
  it('labels every canonical category in canonical order', () => {
    expect(AI_CATEGORY_OPTIONS.map((option) => option.value)).toEqual([
      ...AI_PRIMARY_CATEGORIES,
    ])
    for (const option of AI_CATEGORY_OPTIONS) {
      expect(option.label).toBe(AI_CATEGORY_LABELS[option.value])
      expect(option.label).not.toContain('_')
    }
  })

  it('renders snake_case ids as human words', () => {
    expect(AI_CATEGORY_LABELS.wait_time).toBe('Wait time')
    expect(AI_CATEGORY_LABELS.service).toBe('Service')
  })
})
