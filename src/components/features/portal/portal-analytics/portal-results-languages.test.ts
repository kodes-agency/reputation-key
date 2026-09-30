import { describe, expect, it } from 'vitest'
import { languageRows } from './portal-results-languages'

describe('languageRows', () => {
  it('names each language in its own script, most ratings first', () => {
    const { rows } = languageRows({
      total: 118,
      languages: [
        { locale: 'en', count: 68 },
        { locale: 'bg', count: 28 },
        { locale: 'es', count: 13 },
        { locale: 'de', count: 9 },
      ],
      unrecorded: 0,
    })

    expect(rows.map((row) => [row.label, row.detail])).toEqual([
      ['English', '68 · 58%'],
      ['Български', '28 · 24%'],
      ['Español', '13 · 11%'],
      ['Deutsch', '9 · 8%'],
    ])
  })

  it('counts private ratings, and says so, never scans', () => {
    const { caption } = languageRows({
      total: 118,
      languages: [{ locale: 'en', count: 118 }],
      unrecorded: 0,
    })

    expect(caption).toBe('From 118 private ratings, by page language.')
  })

  it('merges regional tags into the language they belong to', () => {
    const { rows } = languageRows({
      total: 10,
      languages: [
        { locale: 'en-GB', count: 4 },
        { locale: 'en', count: 3 },
        { locale: 'de', count: 3 },
      ],
      unrecorded: 0,
    })

    expect(rows.map((row) => [row.label, row.count])).toEqual([
      ['English', 7],
      ['Deutsch', 3],
    ])
  })

  it('shows a language the catalogue does not know by its tag, not a guess', () => {
    const { rows } = languageRows({
      total: 2,
      languages: [{ locale: 'pt-BR', count: 2 }],
      unrecorded: 0,
    })

    expect(rows[0]?.label).toBe('PT-BR')
  })

  it('counts ratings with no recorded language on their own last line', () => {
    const { rows } = languageRows({
      total: 10,
      languages: [{ locale: 'en', count: 6 }],
      unrecorded: 4,
    })

    expect(rows.map((row) => [row.label, row.detail])).toEqual([
      ['English', '6 · 60%'],
      ['Language not recorded', '4 · 40%'],
    ])
  })

  it('draws each bar as a share of the largest, so the top row fills the track', () => {
    const { rows } = languageRows({
      total: 100,
      languages: [
        { locale: 'en', count: 60 },
        { locale: 'bg', count: 30 },
      ],
      unrecorded: 10,
    })

    expect(rows.map((row) => row.barPercent)).toEqual([100, 50, 17])
  })

  it('is empty, with a reason, when no rating was counted', () => {
    const result = languageRows({ total: 0, languages: [], unrecorded: 0 })

    expect(result.rows).toEqual([])
    expect(result.caption).toBe('No private ratings in this period.')
  })

  it('reads one rating in the singular', () => {
    const { caption } = languageRows({
      total: 1,
      languages: [{ locale: 'en', count: 1 }],
      unrecorded: 0,
    })

    expect(caption).toBe('From 1 private rating, by page language.')
  })
})
