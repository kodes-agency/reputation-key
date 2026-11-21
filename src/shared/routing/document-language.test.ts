import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES } from '#/shared/domain/guest-locale'
import { documentLanguageOfMatches } from './document-language'

const portal = (selectedLocale: unknown) => ({
  routeId: '/p/$token',
  loaderData: { localization: { selectedLocale } },
})

describe('document language of a route match list', () => {
  it.each(GUEST_LOCALES)('is %s when the portal is rendered in it', (locale) => {
    expect(documentLanguageOfMatches([{ routeId: '__root__' }, portal(locale)])).toBe(
      locale,
    )
  })

  it('is English for every page that is not the guest portal', () => {
    expect(documentLanguageOfMatches([])).toBe('en')
    expect(
      documentLanguageOfMatches([
        { routeId: '__root__' },
        { routeId: '/login', loaderData: { localization: { selectedLocale: 'bg' } } },
      ]),
    ).toBe('en')
  })

  it('is English when the portal loader has no usable locale', () => {
    expect(documentLanguageOfMatches([portal(undefined)])).toBe('en')
    expect(documentLanguageOfMatches([portal('zh')])).toBe('en')
    expect(documentLanguageOfMatches([portal(7)])).toBe('en')
    expect(documentLanguageOfMatches([{ routeId: '/p/$token', loaderData: null }])).toBe(
      'en',
    )
  })
})
