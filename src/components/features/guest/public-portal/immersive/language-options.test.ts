import { describe, expect, it } from 'vitest'
import { GUEST_LOCALES, type GuestLocale } from '#/shared/domain/guest-locale'
import { bgV2 } from '../language-packs/bg-v2'
import { enV2 } from '../language-packs/en-v2'
import {
  buildLanguageOptions,
  chipAccessibleName,
  chipCode,
  offersLanguageChoice,
  previewLanguageOptions,
} from './language-options'

const TOKEN = 'tok_abc'

const optionsOf = (locales: readonly GuestLocale[], selected: GuestLocale = 'en') =>
  buildLanguageOptions({
    locales,
    selectedLocale: selected,
    token: TOKEN,
    accessArtifactId: undefined,
    copy: enV2.copy,
  })

describe('offersLanguageChoice', () => {
  it('is false for a portal with one language, however it is listed', () => {
    expect(offersLanguageChoice(['en'])).toBe(false)
    expect(offersLanguageChoice([])).toBe(false)
  })

  it.each([2, 4, 6])('is true for a portal with %i languages', (count) => {
    expect(offersLanguageChoice(GUEST_LOCALES.slice(0, count))).toBe(true)
  })
})

describe('buildLanguageOptions', () => {
  it.each([2, 4, 6])('lists exactly the portal’s %i languages, in its order', (count) => {
    const locales = GUEST_LOCALES.slice(0, count)
    expect(optionsOf(locales).map((option) => option.locale)).toEqual(locales)
  })

  it('keeps the portal’s own order, not the catalogue’s', () => {
    expect(optionsOf(['de', 'en', 'bg'], 'de').map((o) => o.locale)).toEqual([
      'de',
      'en',
      'bg',
    ])
  })

  it('marks only the selected language as current', () => {
    const options = optionsOf(['en', 'bg', 'es', 'de'], 'es')
    expect(options.filter((o) => o.isCurrent).map((o) => o.locale)).toEqual(['es'])
  })

  it('gives each row its native name and its name in the page’s language', () => {
    const [english, bulgarian, spanish, german] = optionsOf(['en', 'bg', 'es', 'de'])
    expect(english).toMatchObject({ nativeName: 'English', secondaryName: null })
    expect(bulgarian).toMatchObject({
      nativeName: 'Български',
      secondaryName: 'Bulgarian',
    })
    expect(spanish).toMatchObject({ nativeName: 'Español', secondaryName: 'Spanish' })
    expect(german).toMatchObject({ nativeName: 'Deutsch', secondaryName: 'German' })
  })

  it('names the languages in a Bulgarian page in Bulgarian', () => {
    const options = buildLanguageOptions({
      locales: ['bg', 'en'],
      selectedLocale: 'bg',
      token: TOKEN,
      accessArtifactId: undefined,
      copy: bgV2.copy,
    })
    expect(options[0]).toMatchObject({ nativeName: 'Български', secondaryName: null })
    expect(options[1]).toMatchObject({
      nativeName: 'English',
      secondaryName: 'Английски',
    })
  })

  it('links each row to the same portal in that language, with the channel marker', () => {
    const options = buildLanguageOptions({
      locales: ['en', 'fr'],
      selectedLocale: 'en',
      token: TOKEN,
      accessArtifactId: 'art_7',
      copy: enV2.copy,
    })
    expect(options.map((o) => o.href)).toEqual([
      '/p/tok_abc?locale=en&accessArtifact=art_7',
      '/p/tok_abc?locale=fr&accessArtifact=art_7',
    ])
  })
})

describe('the chip', () => {
  it.each([
    ['en', 'EN'],
    ['es', 'ES'],
    ['it', 'IT'],
    ['fr', 'FR'],
    ['de', 'DE'],
    ['bg', 'БГ'],
  ] as const)('shows %s as %s', (locale, code) => {
    expect(chipCode(locale)).toBe(code)
  })

  it('is named by its visible code, the word for language and the language', () => {
    expect(chipAccessibleName('en', enV2.copy)).toBe('EN, Language: English')
    expect(chipAccessibleName('bg', bgV2.copy)).toBe('БГ, Език: Български')
  })
})

describe('previewLanguageOptions (the admin preview’s sheet)', () => {
  const preview = (locales: readonly GuestLocale[], selected: GuestLocale = 'en') =>
    previewLanguageOptions({ locales, selectedLocale: selected, copy: enV2.copy })

  it('lists the same rows as the page does, in the same order', () => {
    const locales: readonly GuestLocale[] = ['bg', 'en', 'de']
    const names = (options: ReturnType<typeof preview>) =>
      options.map(({ locale, nativeName, secondaryName, isCurrent }) => ({
        locale,
        nativeName,
        secondaryName,
        isCurrent,
      }))
    expect(names(preview(locales, 'bg'))).toEqual(names(optionsOf(locales, 'bg')))
  })

  it('gives a row no address: a preview has no token and goes nowhere', () => {
    expect(preview(['en', 'bg']).map((option) => option.href)).toEqual([null, null])
  })
})
