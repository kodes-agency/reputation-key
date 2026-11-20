import { describe, expect, it } from 'vitest'
import { trackedLinkHref } from './portal-link-href'

describe('trackedLinkHref', () => {
  it('points at the navigation-only click route of the token and link', () => {
    expect(trackedLinkHref('tok_123', 'link-1')).toBe(
      '/api/public/p/tok_123/click/link-1',
    )
  })

  it('encodes a token that is not path safe, so it cannot add a path segment', () => {
    expect(trackedLinkHref('a/b?c', 'link-1')).toBe(
      '/api/public/p/a%2Fb%3Fc/click/link-1',
    )
  })
})
