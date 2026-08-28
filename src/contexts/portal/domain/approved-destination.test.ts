import { describe, expect, it } from 'vitest'
import { validatePortalDestinationUri } from './approved-destination'

describe('approved Portal destination admission', () => {
  it('normalizes recognized public HTTPS destinations', () => {
    expect(
      validatePortalDestinationUri(' https://WWW.Instagram.com/example?ref=portal '),
    ).toEqual({
      normalizedUri: 'https://www.instagram.com/example?ref=portal',
      hostname: 'www.instagram.com',
      sourceType: 'recognized',
    })
  })

  it('classifies an otherwise safe property domain as custom', () => {
    expect(
      validatePortalDestinationUri('https://hotel.example.com/offers'),
    ).toMatchObject({
      hostname: 'hotel.example.com',
      sourceType: 'custom',
    })
  })

  it.each([
    'http://example.com',
    'https://user:password@example.com',
    'https://127.0.0.1/admin',
    'https://127.1/admin',
    'https://2130706433/admin',
    'https://[::1]/admin',
    'https://[2001:db8::1]/admin',
    'https://service.internal/admin',
    'https://example.com/path#misleading',
    'not a url',
  ])('rejects unsafe destination %s', (uri) => {
    expect(() => validatePortalDestinationUri(uri)).toThrow(
      expect.objectContaining({ code: 'invalid_url' }),
    )
  })
})
