import { describe, expect, it } from 'vitest'
import { deCopy } from './de'
import { enCopy } from './en'
import { esCopy } from './es'
import { frCopy } from './fr'
import { itCopy } from './it'

// Owner question 10, ADR 0061: one spelling in every Latin-script pack, the one
// the IANA zone id uses. Bulgarian is Cyrillic and keeps its own word.
const LATIN_SCRIPT_PACKS = [
  { locale: 'en', pack: enCopy },
  { locale: 'es', pack: esCopy },
  { locale: 'it', pack: itCopy },
  { locale: 'fr', pack: frCopy },
  { locale: 'de', pack: deCopy },
] as const

describe('the spelling of Kyiv', () => {
  it.each(LATIN_SCRIPT_PACKS)('$locale writes Kyiv for both zone ids', ({ pack }) => {
    expect(pack.zoneNames['Europe/Kyiv']).toBe('Kyiv')
    expect(pack.zoneNames['Europe/Kiev']).toBe('Kyiv')
  })
})
