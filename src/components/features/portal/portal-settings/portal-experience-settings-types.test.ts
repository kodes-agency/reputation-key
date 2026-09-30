import { describe, expect, it } from 'vitest'
import {
  OPTIONAL_GUEST_LOCALE,
  guestLocalesWithOptional,
} from './portal-experience-settings-types'

describe('guestLocalesWithOptional', () => {
  it('is English alone when the optional locale is off', () => {
    expect(guestLocalesWithOptional(false)).toEqual(['en'])
  })

  it('is exactly English plus the optional locale when it is on', () => {
    expect(guestLocalesWithOptional(true)).toEqual(['en', OPTIONAL_GUEST_LOCALE])
    expect(guestLocalesWithOptional(true)).toEqual(['en', 'bg'])
  })
})
