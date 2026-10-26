import { describe, expect, it } from 'vitest'
import { linkAddressForField } from './link-address-field'

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
