import { describe, expect, it } from 'vitest'
import { guestLocaleHref } from './guest-locale-href'

describe('guestLocaleHref', () => {
  it('points at the same portal with the chosen locale', () => {
    expect(guestLocaleHref('tok_123', 'de', undefined)).toBe('/p/tok_123?locale=de')
  })

  it('keeps the public channel marker so a switch does not lose how the guest arrived', () => {
    expect(guestLocaleHref('tok_123', 'bg', 'art_9')).toBe(
      '/p/tok_123?locale=bg&accessArtifact=art_9',
    )
  })

  it('encodes a token and a marker that carry reserved characters', () => {
    expect(guestLocaleHref('a/b?c', 'en', 'x&y=z')).toBe(
      '/p/a%2Fb%3Fc?locale=en&accessArtifact=x%26y%3Dz',
    )
  })

  it('treats an empty marker as none', () => {
    expect(guestLocaleHref('tok', 'es', '')).toBe('/p/tok?locale=es')
  })
})
