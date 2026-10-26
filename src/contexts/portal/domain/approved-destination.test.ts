import { describe, expect, it } from 'vitest'
import {
  defaultLinkIconKey,
  isConsistentDestinationKind,
  isSiteDestination,
  PORTAL_LINK_ADDRESS_REFUSALS,
  validatePortalDestinationUri,
  validatePortalLinkDestination,
  type PortalApprovedDestination,
  type PortalApprovedDestinationSource,
} from './approved-destination'

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

describe('Linktree tile address admission', () => {
  it('stores a phone number as a contact, named by the number itself', () => {
    expect(validatePortalLinkDestination('+1 (555) 123-4567')).toEqual({
      normalizedUri: 'tel:+15551234567',
      hostname: '+15551234567',
      sourceType: 'contact',
    })
  })

  it('stores an email address as a contact, with its domain in lower case', () => {
    expect(validatePortalLinkDestination('mailto:Front@Hotel.com')).toEqual({
      normalizedUri: 'mailto:Front@hotel.com',
      hostname: 'Front@hotel.com',
      sourceType: 'contact',
    })
  })

  it('leaves a website to the HTTPS admission', () => {
    expect(validatePortalLinkDestination('https://hotel.example.com/offers')).toEqual(
      validatePortalDestinationUri('https://hotel.example.com/offers'),
    )
  })

  it.each([
    ['tel:+1555123456;ext=1', PORTAL_LINK_ADDRESS_REFUSALS.phone],
    ['555 12', PORTAL_LINK_ADDRESS_REFUSALS.phone],
    ['mailto:front@hotel.com?bcc=spy@evil.com', PORTAL_LINK_ADDRESS_REFUSALS.email],
    ['front@hotel.com,spy@evil.com', PORTAL_LINK_ADDRESS_REFUSALS.email],
  ])('refuses %s and says what a good one looks like', (input, message) => {
    expect(() => validatePortalLinkDestination(input)).toThrow(
      expect.objectContaining({ code: 'invalid_url', message }),
    )
  })

  it.each([
    'javascript:alert(1)',
    "javascript:alert('front@hotel.com')",
    'data:text/html,<script>alert(1)</script>',
    'sms:+15551234567',
    'http://hotel.example.com',
  ])('never stores %s', (input) => {
    expect(() => validatePortalLinkDestination(input)).toThrow(
      expect.objectContaining({ code: 'invalid_url' }),
    )
  })
})

describe('contact destinations elsewhere', () => {
  const destination = (
    sourceType: PortalApprovedDestinationSource,
    normalizedUri: string,
  ) => ({ sourceType, normalizedUri })

  it('gives a contact tile a phone or a letter, and a site no icon', () => {
    expect(defaultLinkIconKey('tel:+15551234567')).toBe('phone')
    expect(defaultLinkIconKey('mailto:a@hotel.com')).toBe('mail')
    expect(defaultLinkIconKey('https://hotel.com')).toBeNull()
    expect(defaultLinkIconKey('tel:+1 555 123 4567')).toBeNull()
  })

  it('ties the contact source to a stored phone number or email address, both ways', () => {
    expect(isConsistentDestinationKind(destination('contact', 'tel:+15551234567'))).toBe(
      true,
    )
    expect(isConsistentDestinationKind(destination('custom', 'https://hotel.com'))).toBe(
      true,
    )
    for (const [sourceType, uri] of [
      ['contact', 'https://hotel.com'],
      ['contact', 'tel:+1 555 123 4567'],
      ['contact', 'mailto:a@hotel.com?bcc=b@evil.com'],
      ['custom', 'tel:+15551234567'],
      ['recognized', 'mailto:a@hotel.com'],
      ['provider', 'tel:+15551234567'],
    ] as const) {
      expect(isConsistentDestinationKind(destination(sourceType, uri)), uri).toBe(false)
    }
  })

  it('counts every kind but a contact as a site', () => {
    const row = (sourceType: PortalApprovedDestinationSource) =>
      ({ sourceType }) as PortalApprovedDestination
    expect(isSiteDestination(row('contact'))).toBe(false)
    for (const sourceType of ['recognized', 'custom', 'provider'] as const) {
      expect(isSiteDestination(row(sourceType))).toBe(true)
    }
  })
})
