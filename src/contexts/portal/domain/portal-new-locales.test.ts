import { describe, expect, it } from 'vitest'
import { resolveNewPortalLocales } from './portal-new-locales'
import { isPortalError } from './errors'

const codeOf = (run: () => unknown): string | undefined => {
  try {
    run()
  } catch (error) {
    return isPortalError(error) ? error.code : 'not-a-portal-error'
  }
  return undefined
}

describe('resolveNewPortalLocales', () => {
  it('uses the requested languages, the first being the primary', () => {
    expect(
      resolveNewPortalLocales({ requested: ['bg', 'en'], propertyDefaults: ['en'] }),
    ).toEqual({ primary: 'bg', additional: ['en'] })
  })

  it('starts from the Property defaults when nothing was requested', () => {
    expect(resolveNewPortalLocales({ propertyDefaults: ['bg', 'en'] })).toEqual({
      primary: 'bg',
      additional: ['en'],
    })
  })

  it('falls back to English when the Property has no offered default', () => {
    expect(resolveNewPortalLocales({ propertyDefaults: [] })).toEqual({
      primary: 'en',
      additional: [],
    })
    // A default language nobody may offer yet does not leak into a new Portal.
    expect(resolveNewPortalLocales({ propertyDefaults: ['de', 'fr'] })).toEqual({
      primary: 'en',
      additional: [],
    })
  })

  it('keeps only the offered Property defaults, in order', () => {
    expect(resolveNewPortalLocales({ propertyDefaults: ['de', 'bg', 'en'] })).toEqual({
      primary: 'bg',
      additional: ['en'],
    })
  })

  it('takes the languages of the Portal being copied when none were requested', () => {
    expect(
      resolveNewPortalLocales({
        source: { primary: 'bg', additional: ['en'] },
        propertyDefaults: ['en'],
      }),
    ).toEqual({ primary: 'bg', additional: ['en'] })
  })

  it('lets a request override the languages of the copied Portal', () => {
    expect(
      resolveNewPortalLocales({
        requested: ['en'],
        source: { primary: 'bg', additional: ['en'] },
        propertyDefaults: ['bg'],
      }),
    ).toEqual({ primary: 'en', additional: [] })
  })

  it('rejects an empty request', () => {
    expect(
      codeOf(() => resolveNewPortalLocales({ requested: [], propertyDefaults: [] })),
    ).toBe('locale_not_offered')
  })

  it('rejects a language given twice', () => {
    expect(
      codeOf(() =>
        resolveNewPortalLocales({ requested: ['en', 'en'], propertyDefaults: [] }),
      ),
    ).toBe('locale_not_offered')
  })

  it('rejects a language that is not offered today', () => {
    expect(
      codeOf(() =>
        resolveNewPortalLocales({
          requested: ['en', 'de'] as never,
          propertyDefaults: [],
        }),
      ),
    ).toBe('locale_not_offered')
  })
})
