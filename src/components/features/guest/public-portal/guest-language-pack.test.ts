import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from './guest-language-pack'

describe('guest Portal language packs', () => {
  it('resolves the exact immutable English and Bulgarian v1 packs', () => {
    expect(getGuestPortalCopy('en', 'guest-ui-en-v1')).toMatchObject({
      locale: 'en',
      version: 'guest-ui-en-v1',
      submitPrivateRating: 'Submit private rating',
    })
    expect(getGuestPortalCopy('bg', 'guest-ui-bg-v1')).toMatchObject({
      locale: 'bg',
      version: 'guest-ui-bg-v1',
      submitPrivateRating: 'Изпрати непубличната оценка',
    })
  })

  it('fails closed instead of rendering copy from a different pinned locale', () => {
    expect(() => getGuestPortalCopy('bg', 'guest-ui-en-v1')).toThrow(
      'Guest locale and immutable language pack do not match',
    )
  })
})
