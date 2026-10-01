import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  FONT_SUBSET_RANGES,
  splitIntoFontRuns,
  stripUnsupportedCharacters,
  type FontSubset,
} from './print-kit-font-ranges'

const GUEST_FONTS_CSS = readFileSync(
  new URL('../../../../../public/fonts/guest/guest-fonts.css', import.meta.url),
  'utf8',
)

/** The `unicode-range` of each subset as the guest stylesheet declares it. */
function declaredRanges(): Map<string, Set<string>> {
  const bySubset = new Map<string, Set<string>>()
  for (const block of GUEST_FONTS_CSS.split('@font-face').slice(1)) {
    const file = /url\(([^)]+)\)/u.exec(block)?.[1] ?? ''
    const subset = /-(latin-ext|latin|cyrillic-ext|cyrillic)-\d/u.exec(file)?.[1]
    const range = /unicode-range:([^;]+);/u.exec(block)?.[1]
    if (subset === undefined || range === undefined) continue
    const normalised = range.replace(/\s+/gu, ' ').trim()
    bySubset.set(subset, (bySubset.get(subset) ?? new Set()).add(normalised))
  }
  return bySubset
}

const formatRange = ([from, to]: readonly [number, number]) =>
  from === to
    ? `U+${from.toString(16).toUpperCase().padStart(4, '0')}`
    : `U+${from.toString(16).toUpperCase().padStart(4, '0')}-${to
        .toString(16)
        .toUpperCase()
        .padStart(4, '0')}`

describe('FONT_SUBSET_RANGES', () => {
  it('is the unicode-range the guest stylesheet declares, for all four subsets', () => {
    const declared = declaredRanges()
    for (const subset of Object.keys(FONT_SUBSET_RANGES) as FontSubset[]) {
      const ranges = declared.get(subset)
      expect(ranges, subset).toBeDefined()
      // Every face of a subset declares the same range, so one string remains.
      expect(ranges?.size, subset).toBe(1)
      const ours = FONT_SUBSET_RANGES[subset].map(formatRange).join(', ')
      expect([...(ranges ?? [])][0]?.replace(/, /gu, ', ')).toBe(ours)
    }
  })
})

describe('splitIntoFontRuns', () => {
  it('keeps a Latin text in one run', () => {
    expect(splitIntoFontRuns('Rate your visit')).toEqual([
      { subset: 'latin', text: 'Rate your visit' },
    ])
  })

  it('sets Cyrillic letters in the Cyrillic subset and the spaces between them in Latin', () => {
    expect(splitIntoFontRuns('Оценете си')).toEqual([
      { subset: 'cyrillic', text: 'Оценете' },
      { subset: 'latin', text: ' ' },
      { subset: 'cyrillic', text: 'си' },
    ])
  })

  it('reaches the extended subsets', () => {
    expect(splitIntoFontRuns('Łódź').map((run) => run.subset)).toEqual([
      'latin-ext',
      'latin',
      'latin-ext',
    ])
  })

  it('returns no runs for an empty text', () => {
    expect(splitIntoFontRuns('')).toEqual([])
  })
})

describe('stripUnsupportedCharacters', () => {
  it('drops what no subset carries and keeps the rest', () => {
    expect(stripUnsupportedCharacters('Pool 🏊 Bar 酒')).toBe('Pool  Bar ')
    expect(stripUnsupportedCharacters('Басейн и тераса')).toBe('Басейн и тераса')
  })
})
