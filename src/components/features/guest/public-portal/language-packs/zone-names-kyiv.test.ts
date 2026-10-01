import { describe, expect, it } from 'vitest'
import { deV2 } from './de-v2'
import { enV2 } from './en-v2'
import { esV2 } from './es-v2'
import { frV2 } from './fr-v2'
import { itV2 } from './it-v2'

// Owner question 10, ADR 0061: one spelling in every Latin-script pack, the one
// the IANA zone id uses. Bulgarian is Cyrillic and keeps its own word.
const LATIN_SCRIPT_PACKS = [
  { locale: 'en', pack: enV2 },
  { locale: 'es', pack: esV2 },
  { locale: 'it', pack: itV2 },
  { locale: 'fr', pack: frV2 },
  { locale: 'de', pack: deV2 },
] as const

describe('the spelling of Kyiv', () => {
  it.each(LATIN_SCRIPT_PACKS)('$locale writes Kyiv for both zone ids', ({ pack }) => {
    expect(pack.zoneNames['Europe/Kyiv']).toBe('Kyiv')
    expect(pack.zoneNames['Europe/Kiev']).toBe('Kyiv')
  })
})
