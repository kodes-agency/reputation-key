import { describe, expect, it } from 'vitest'
import {
  computePortalLanguageCoverage,
  type PortalLanguageCoverageInput,
} from './portal-language-coverage'

const base = (
  overrides: Partial<PortalLanguageCoverageInput> = {},
): PortalLanguageCoverageInput => ({
  portalId: 'portal-1',
  primaryLocale: 'en',
  additionalLocales: [],
  propertyContent: [
    { locale: 'en', title: 'Avela Resort', shortDescription: 'By the sea' },
  ],
  overrides: [],
  links: [],
  linkTexts: [],
  ...overrides,
})

describe('computePortalLanguageCoverage', () => {
  it('lists the fallback language first, then the others in the order they were added', () => {
    const coverage = computePortalLanguageCoverage(
      base({ primaryLocale: 'bg', additionalLocales: ['en', 'de'] }),
    )
    expect(coverage.languages.map((row) => row.locale)).toEqual(['bg', 'en', 'de'])
    expect(coverage.fallbackLocale).toBe('bg')
    expect(coverage.languages.map((row) => row.isFallback)).toEqual([true, false, false])
  })

  it('counts a title and a description per language, and nothing missing when both exist', () => {
    const [row] = computePortalLanguageCoverage(base()).languages
    expect(row).toMatchObject({ locale: 'en', total: 2, present: 2, missing: [] })
  })

  it('names the wording a language has not got', () => {
    const coverage = computePortalLanguageCoverage(base({ additionalLocales: ['bg'] }))
    const bg = coverage.languages[1]
    expect(bg).toMatchObject({ locale: 'bg', total: 2, present: 0 })
    expect(bg?.missing.map((text) => text.kind)).toEqual(['title', 'description'])
    expect(coverage.missingTotal).toBe(2)
  })

  it('counts a portal override when the Property has wording for that language', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        additionalLocales: ['bg'],
        propertyContent: [
          { locale: 'en', title: 'Avela Resort', shortDescription: 'By the sea' },
          { locale: 'bg', title: 'Авела', shortDescription: 'До морето' },
        ],
        overrides: [{ locale: 'bg', title: 'Авела Вила', shortDescription: null }],
      }),
    )
    expect(coverage.languages[1]).toMatchObject({ present: 2, missing: [] })
  })

  it('an override without Property wording still leaves the language incomplete', () => {
    // Publishing drops a language that has no Property content row, whatever the
    // Portal's own overrides say, so the title and description are still missing.
    const coverage = computePortalLanguageCoverage(
      base({
        additionalLocales: ['bg'],
        overrides: [{ locale: 'bg', title: 'Авела', shortDescription: 'До морето' }],
      }),
    )
    const bg = coverage.languages[1]
    expect(bg?.missing.map((text) => text.kind)).toEqual(['title', 'description'])
    expect(bg?.present).toBe(0)
  })

  it('marks a missing title or description as blocking publishing, and a link label as not', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        additionalLocales: ['bg'],
        links: [{ id: 'l-1', label: 'Menu' }],
        linkTexts: [{ linkId: 'l-1', locale: 'en', label: 'Menu' }],
      }),
    )
    expect(
      coverage.languages[1]?.missing.map((text) => [text.kind, text.blocksPublish]),
    ).toEqual([
      ['title', true],
      ['description', true],
      ['link_label', false],
    ])
  })

  it('falls back to the property wording when the override is blank', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        overrides: [{ locale: 'en', title: '   ', shortDescription: null }],
      }),
    )
    expect(coverage.languages[0]?.missing).toEqual([])
  })

  it('treats blank property wording as missing', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        propertyContent: [{ locale: 'en', title: ' ', shortDescription: 'By the sea' }],
      }),
    )
    expect(coverage.languages[0]?.missing.map((text) => text.kind)).toEqual(['title'])
  })

  it('asks for a label per link in every language', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        additionalLocales: ['bg'],
        propertyContent: [
          { locale: 'en', title: 'A', shortDescription: 'B' },
          { locale: 'bg', title: 'А', shortDescription: 'Б' },
        ],
        links: [
          { id: 'l-1', label: 'Menu' },
          { id: 'l-2', label: 'Spa' },
        ],
        linkTexts: [
          { linkId: 'l-1', locale: 'en', label: 'Menu' },
          { linkId: 'l-2', locale: 'en', label: 'Spa' },
          { linkId: 'l-1', locale: 'bg', label: 'Меню' },
        ],
      }),
    )
    const [en, bg] = coverage.languages
    expect(en).toMatchObject({ total: 4, present: 4 })
    expect(bg).toMatchObject({ total: 4, present: 3 })
    expect(bg?.missing).toEqual([
      {
        key: 'link:l-2',
        kind: 'link_label',
        linkId: 'l-2',
        linkLabel: 'Spa',
        blocksPublish: false,
      },
    ])
  })

  it('names a missing label by the fallback language text of its link', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        additionalLocales: ['de'],
        links: [{ id: 'l-1', label: 'legacy label' }],
        linkTexts: [{ linkId: 'l-1', locale: 'en', label: 'Book a table' }],
      }),
    )
    const de = coverage.languages[1]
    expect(de?.missing.find((text) => text.kind === 'link_label')?.linkLabel).toBe(
      'Book a table',
    )
  })

  it('does not count a blank label as written', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        links: [{ id: 'l-1', label: 'Menu' }],
        linkTexts: [{ linkId: 'l-1', locale: 'en', label: '  ' }],
      }),
    )
    expect(coverage.languages[0]?.missing.map((text) => text.kind)).toEqual([
      'link_label',
    ])
  })

  it('ignores texts written for a language the portal does not offer', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        links: [{ id: 'l-1', label: 'Menu' }],
        linkTexts: [
          { linkId: 'l-1', locale: 'en', label: 'Menu' },
          { linkId: 'l-1', locale: 'fr', label: 'Carte' },
        ],
      }),
    )
    expect(coverage.languages).toHaveLength(1)
    expect(coverage.missingTotal).toBe(0)
  })

  it('counts gaps in the fallback language too, and sums them', () => {
    const coverage = computePortalLanguageCoverage(
      base({
        propertyContent: [],
        additionalLocales: ['bg'],
      }),
    )
    expect(coverage.languages.map((row) => row.missing.length)).toEqual([2, 2])
    expect(coverage.missingTotal).toBe(4)
  })

  it('never repeats a language that is both primary and additional', () => {
    const coverage = computePortalLanguageCoverage(
      base({ additionalLocales: ['en', 'bg', 'bg'] }),
    )
    expect(coverage.languages.map((row) => row.locale)).toEqual(['en', 'bg'])
  })

  it('carries no wording except the link name a manager needs to find the row', () => {
    const coverage = computePortalLanguageCoverage(base({ additionalLocales: ['bg'] }))
    expect(JSON.stringify(coverage)).not.toContain('Avela Resort')
    expect(JSON.stringify(coverage)).not.toContain('By the sea')
  })
})
