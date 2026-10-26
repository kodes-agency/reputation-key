import { describe, expect, it } from 'vitest'
import { isSavedLinkAddress, linkAddressForField } from './link-address-field'

describe('linkAddressForField', () => {
  it('shows a saved phone number or email address without its scheme', () => {
    expect(linkAddressForField('tel:+15551234567')).toBe('+15551234567')
    expect(linkAddressForField('mailto:front@hotel.com')).toBe('front@hotel.com')
  })

  it('shows a website, or anything not in the stored contact form, as it is', () => {
    for (const url of [
      'https://avela.bg/menu',
      'tel:+1 555 123 4567',
      'mailto:front@hotel.com?bcc=spy@evil.com',
    ]) {
      expect(linkAddressForField(url)).toBe(url)
    }
  })
})

describe('isSavedLinkAddress', () => {
  it('knows the saved phone number or email address in any spelling stored as it', () => {
    for (const value of ['+15551234567', ' +1 (555) 123-4567 ', 'tel:+1-555-123-4567']) {
      expect(isSavedLinkAddress(value, 'tel:+15551234567'), value).toBe(true)
    }
    expect(isSavedLinkAddress('MAILTO:front@HOTEL.com', 'mailto:front@hotel.com')).toBe(
      true,
    )
    expect(isSavedLinkAddress('https://avela.bg/menu', 'https://avela.bg/menu')).toBe(
      true,
    )
  })

  it('sees another number, another address or a website as a change', () => {
    expect(isSavedLinkAddress('+15551234568', 'tel:+15551234567')).toBe(false)
    expect(isSavedLinkAddress('5551234567', 'tel:+15551234567')).toBe(false)
    expect(isSavedLinkAddress('Front@hotel.com', 'mailto:front@hotel.com')).toBe(false)
    expect(isSavedLinkAddress('https://avela.bg/spa', 'https://avela.bg/menu')).toBe(
      false,
    )
    expect(isSavedLinkAddress('tel:+15551234567', 'https://avela.bg/menu')).toBe(false)
  })
})
