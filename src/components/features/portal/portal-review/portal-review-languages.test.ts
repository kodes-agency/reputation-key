import { describe, expect, it } from 'vitest'
import type { ReviewLanguageRow } from '#/contexts/portal/application/public-api'
import { describeReviewLanguage } from './portal-review-languages'

const row = (over: Partial<ReviewLanguageRow> = {}): ReviewLanguageRow => ({
  locale: 'es',
  isFallback: false,
  total: 14,
  present: 14,
  missingCount: 0,
  missing: [],
  status: 'complete',
  aiDraftCount: 0,
  ...over,
})

describe('describeReviewLanguage', () => {
  it('names the language by its own name and says everything is written', () => {
    expect(describeReviewLanguage(row())).toEqual({
      locale: 'es',
      chip: 'ES',
      native: 'Español',
      english: 'Spanish',
      tag: null,
      coverage: { tone: 'complete', text: 'All 14 texts' },
      aiDrafts: null,
    })
  })

  it('tags the fallback language', () => {
    expect(describeReviewLanguage(row({ locale: 'en', isFallback: true })).tag).toBe(
      'Fallback',
    )
  })

  it('counts what is missing', () => {
    const line = describeReviewLanguage(
      row({
        locale: 'de',
        present: 13,
        missingCount: 1,
        status: 'copied_from_fallback',
        missing: [
          {
            key: 'link:a',
            kind: 'link_label',
            linkId: 'a',
            linkLabel: 'Menu',
            blocksPublish: false,
          },
        ],
      }),
    )

    expect(line.coverage).toEqual({ tone: 'missing', text: '13 of 14 · 1 missing' })
  })

  it('counts drafts nobody has checked, in the singular and the plural', () => {
    expect(describeReviewLanguage(row({ aiDraftCount: 1 })).aiDrafts).toBe(
      '1 AI draft not checked',
    )
    expect(describeReviewLanguage(row({ aiDraftCount: 2 })).aiDrafts).toBe(
      '2 AI drafts not checked',
    )
  })
})
