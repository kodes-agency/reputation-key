import { describe, expect, it } from 'vitest'
import { isPortalLinkIconKey } from './portal-link-icon'
import {
  isPortalContactUri,
  parsePortalContactInput,
  portalContactOf,
  PORTAL_CONTACT_ICON_KEYS,
} from './portal-contact-address'

const stored = (input: string) => {
  const parsed = parsePortalContactInput(input)
  return parsed?.ok === true ? parsed.contact : parsed
}

describe('parsePortalContactInput: phone numbers', () => {
  it.each([
    ['+1 (555) 123-4567', 'tel:+15551234567', '+15551234567'],
    ['+359 88 123 4567', 'tel:+359881234567', '+359881234567'],
    ['555.123.4567', 'tel:5551234567', '5551234567'],
    ['(02) 981 23 45', 'tel:029812345', '029812345'],
    ['tel:+15551234567', 'tel:+15551234567', '+15551234567'],
    ['TEL:+1-555-123-4567', 'tel:+15551234567', '+15551234567'],
    ['  +44 20 7946 0958  ', 'tel:+442079460958', '+442079460958'],
    // No-break and narrow no-break spaces, an en dash and a minus sign, as pasted.
    ['+33\u00a01\u202f23\u201345\u221267\u00a089', 'tel:+33123456789', '+33123456789'],
  ])('stores %s as %s', (input, uri, address) => {
    expect(stored(input)).toEqual({ kind: 'phone', uri, address })
  })

  it('takes 7 to 15 digits and no more or fewer', () => {
    expect(stored('123 4567')).toMatchObject({ uri: 'tel:1234567' })
    expect(stored('+123456789012345')).toMatchObject({ uri: 'tel:+123456789012345' })
    expect(stored('123 456')).toEqual({ ok: false, kind: 'phone' })
    expect(stored('+1234567890123456')).toEqual({ ok: false, kind: 'phone' })
  })

  it.each([
    'tel:+1555123456;ext=12',
    'tel:+1555123456,1',
    'tel:%2B15551234567',
    'tel:+1-555-CALL-NOW',
    'tel://+15551234567',
    'tel:+1555123456?body=hi',
    'tel:+1 555 123 4567#',
    'tel:',
    'tel:++15551234567',
  ])('refuses %s as a phone number', (input) => {
    expect(stored(input)).toEqual({ ok: false, kind: 'phone' })
  })

  it('reads a + in the middle, or letters, as no phone number at all', () => {
    expect(parsePortalContactInput('1+5551234567')).toBeNull()
    expect(parsePortalContactInput('+1 555 123 4567 ext 8')).toBeNull()
    expect(parsePortalContactInput('reception')).toBeNull()
  })
})

describe('parsePortalContactInput: email addresses', () => {
  it.each([
    ['front@hotel.com', 'mailto:front@hotel.com'],
    ['Front.Desk@Hotel.COM', 'mailto:Front.Desk@hotel.com'],
    ['mailto:front@hotel.com', 'mailto:front@hotel.com'],
    ['MAILTO:events+spa@sub.hotel.co.uk', 'mailto:events+spa@sub.hotel.co.uk'],
    ["o'brien@example.ie", "mailto:o'brien@example.ie"],
    ['info@xn--htel-cpa.fr', 'mailto:info@xn--htel-cpa.fr'],
  ])('stores %s as %s, the domain in lower case', (input, uri) => {
    expect(stored(input)).toEqual({ kind: 'email', uri, address: uri.slice(7) })
  })

  it.each([
    // A query, headers or a body.
    'mailto:front@hotel.com?subject=Hello',
    'mailto:front@hotel.com?bcc=spy@evil.com',
    'mailto:?to=front@hotel.com',
    'front@hotel.com&cc=spy@evil.com',
    // More than one recipient.
    'mailto:front@hotel.com,spy@evil.com',
    'front@hotel.com;spy@evil.com',
    'front@hotel.com spy@evil.com',
    'a@b@hotel.com',
    // Encoded characters that could become any of those.
    'mailto:front%40hotel.com',
    'front@hotel.com%3Fbcc%3Dspy%40evil.com',
    // Line breaks that would start a header.
    'mailto:front@hotel.com\r\nBcc:spy@evil.com',
    'front@hotel.com\nspy',
    // Not an address.
    'mailto:',
    'mailto://front@hotel.com',
    '@hotel.com',
    'front@',
    'front@localhost',
    'front@hotel',
    'front@hotel.c',
    'front@127.0.0.1',
    'front@[127.0.0.1]',
    'front@-hotel.com',
    'front@hotel..com',
    '.front@hotel.com',
    'front.@hotel.com',
    'fr..ont@hotel.com',
    'frönt@hotel.com',
    'front@hötel.com',
    '"front"@hotel.com',
    `${'a'.repeat(65)}@hotel.com`,
    `front@${'a'.repeat(250)}.com`,
  ])('refuses %j as an email address', (input) => {
    expect(stored(input)).toEqual({ ok: false, kind: 'email' })
  })
})

describe('parsePortalContactInput: anything else', () => {
  it.each([
    'https://hotel.com/contact',
    'https://user@hotel.com',
    'http://hotel.com',
    'javascript:alert(1)',
    "javascript:alert('front@hotel.com')",
    'data:text/html,<script>alert(1)</script>@x.com',
    'sms:+15551234567',
    'whatsapp://send?phone=15551234567',
    'vbscript:msgbox(1)',
    'www.hotel.com',
    // A website typed without its scheme, with an @ in its path.
    'instagram.com/@hotel',
    'tiktok.com/@hotel/video/1',
    '',
    '   ',
  ])('reads %j as no phone number or email address', (input) => {
    expect(parsePortalContactInput(input)).toBeNull()
  })
})

describe('portalContactOf and isPortalContactUri', () => {
  it('accepts only the stored form', () => {
    expect(portalContactOf('tel:+15551234567')).toEqual({
      kind: 'phone',
      uri: 'tel:+15551234567',
      address: '+15551234567',
    })
    expect(isPortalContactUri('mailto:front@hotel.com')).toBe(true)
    for (const uri of [
      'TEL:+15551234567',
      'tel:+1 555 123 4567',
      ' tel:+15551234567',
      '+15551234567',
      'front@hotel.com',
      'mailto:front@HOTEL.com',
      'MAILTO:front@hotel.com',
      'mailto:front@hotel.com?bcc=spy@evil.com',
      'https://hotel.com',
      'javascript:alert(1)',
    ]) {
      expect(isPortalContactUri(uri), uri).toBe(false)
    }
  })
})

describe('PORTAL_CONTACT_ICON_KEYS', () => {
  it('uses icons the closed catalogue already has', () => {
    expect(PORTAL_CONTACT_ICON_KEYS).toEqual({ phone: 'phone', email: 'mail' })
    for (const key of Object.values(PORTAL_CONTACT_ICON_KEYS)) {
      expect(isPortalLinkIconKey(key)).toBe(true)
    }
  })
})
