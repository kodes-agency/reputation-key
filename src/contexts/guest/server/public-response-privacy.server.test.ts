import { beforeEach, describe, expect, it, vi } from 'vitest'

const setResponseHeader = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader }))

import {
  applyGuestPublicResponsePrivacy,
  guestPublicResponseValidator,
} from './public-response-privacy.server'

describe('Guest public-response privacy headers', () => {
  beforeEach(() => setResponseHeader.mockClear())

  it('makes cookie-bound public responses private, uncacheable, and referrer-free', () => {
    applyGuestPublicResponsePrivacy()

    expect(setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['Vary', 'Cookie'],
      ['Referrer-Policy', 'no-referrer'],
    ])
  })

  it('does not add Cookie variance to the cookie-independent link resolver', () => {
    applyGuestPublicResponsePrivacy({ varyCookie: false })

    expect(setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['Referrer-Policy', 'no-referrer'],
    ])
  })

  it('applies the response policy before input validation can fail', () => {
    const validator = guestPublicResponseValidator({
      parse: () => {
        throw new Error('invalid public input')
      },
    })

    expect(() => validator({})).toThrow('invalid public input')
    expect(setResponseHeader.mock.calls).toEqual([
      ['Cache-Control', 'private, no-store'],
      ['Vary', 'Cookie'],
      ['Referrer-Policy', 'no-referrer'],
    ])
  })
})
