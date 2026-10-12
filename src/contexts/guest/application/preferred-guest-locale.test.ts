import { describe, expect, it } from 'vitest'
import { preferredGuestLocale } from './preferred-guest-locale'

describe('preferredGuestLocale from an Accept-Language header', () => {
  it('is the first language the guest surface can write', () => {
    expect(preferredGuestLocale('de-DE,de;q=0.9,en;q=0.8')).toBe('de')
    expect(preferredGuestLocale('bg')).toBe('bg')
    expect(preferredGuestLocale('es-MX')).toBe('es')
    expect(preferredGuestLocale('fr-CH, it;q=0.8')).toBe('fr')
  })

  it('skips languages it cannot write and takes the next the guest named', () => {
    expect(preferredGuestLocale('zh-CN,zh;q=0.9,it;q=0.5')).toBe('it')
    expect(preferredGuestLocale('ja, *;q=0.1, fr;q=0.2')).toBe('fr')
  })

  it('ranks by weight, and keeps the header’s own order for equal weights', () => {
    expect(preferredGuestLocale('en;q=0.4, de;q=0.9')).toBe('de')
    expect(preferredGuestLocale('it, fr')).toBe('it')
    expect(preferredGuestLocale('it;q=0.8, fr;q=0.8')).toBe('it')
  })

  it('drops a language refused with q=0, and one with a broken weight', () => {
    expect(preferredGuestLocale('de;q=0, fr;q=0.1')).toBe('fr')
    expect(preferredGuestLocale('de;q=abc, es;q=0.1')).toBe('es')
  })

  it('falls back to English for nothing, nonsense or languages with no pack', () => {
    expect(preferredGuestLocale(null)).toBe('en')
    expect(preferredGuestLocale(undefined)).toBe('en')
    expect(preferredGuestLocale('')).toBe('en')
    expect(preferredGuestLocale('*')).toBe('en')
    expect(preferredGuestLocale('ja,zh;q=0.8,ko;q=0.5')).toBe('en')
    expect(preferredGuestLocale(';;,,;q=')).toBe('en')
  })
})

describe('preferredGuestLocale from navigator.languages', () => {
  it('takes the list in the order the browser gives it', () => {
    expect(preferredGuestLocale(['bg-BG', 'en-US'])).toBe('bg')
    expect(preferredGuestLocale(['ja', 'de-AT', 'en'])).toBe('de')
  })

  it('falls back to English for an empty list or no pack', () => {
    expect(preferredGuestLocale([])).toBe('en')
    expect(preferredGuestLocale(['ja', 'ko'])).toBe('en')
  })
})
