import { describe, expect, it } from 'vitest'
import type { SetupPropertyFacts } from './setup-plan'
import {
  countLabel,
  eligibleManagerChoices,
  languageSuggestionSummary,
  mostSuggestedLanguage,
  namesPhrase,
  replyLanguageLabel,
} from './setup-summaries'

function property(
  propertyName: string,
  countryCode: string | null,
  eligible = ['admin'],
): SetupPropertyFacts {
  return {
    propertyId: propertyName.toLowerCase().replaceAll(' ', '-'),
    propertyName,
    publicDisplayName: null,
    publicDisplayNameConfirmed: false,
    countryCode,
    replyLanguage: null,
    aiDecided: false,
    managerIds: [],
    eligibleManagerIds: eligible,
  }
}

describe('setup summaries', () => {
  it('names reply languages and counts properties', () => {
    expect(replyLanguageLabel('de-Latn')).toBe('German')
    expect(replyLanguageLabel('zh-Hant')).toBe('Traditional Chinese')
    expect(countLabel(1)).toBe('1 property')
    expect(countLabel(3)).toBe('3 properties')
  })

  it('shortens long name lists', () => {
    expect(namesPhrase(['A'])).toBe('A')
    expect(namesPhrase(['A', 'B'])).toBe('A and B')
    expect(namesPhrase(['A', 'B', 'C', 'D'])).toBe('A, B and 2 more')
  })

  it('summarises the country suggestions', () => {
    expect(languageSuggestionSummary([property('Hotel Berlin', 'DE')])).toBe(
      "Suggested from the property's country.",
    )
    expect(
      languageSuggestionSummary([
        property('Hotel Berlin', 'DE'),
        property('Hotel Wien', 'AT'),
      ]),
    ).toBe('German for all 2, based on their country.')
    expect(
      languageSuggestionSummary([
        property('Hotel Berlin', 'DE'),
        property('Hotel Wien', 'AT'),
        property('Athens Rooms', 'GR'),
      ]),
    ).toBe(
      'Based on each country: German for Hotel Berlin and Hotel Wien; English for Athens Rooms.',
    )
    expect(
      mostSuggestedLanguage([
        property('A', 'GR'),
        property('B', 'DE'),
        property('C', 'AT'),
      ]),
    ).toBe('de-Latn')
  })

  it('offers every manager eligible somewhere, by name, with their reach', () => {
    const members = new Map([
      ['admin', { userId: 'admin', name: 'Zoe Admin', email: 'zoe@example.com' }],
      ['manager', { userId: 'manager', name: 'Adam Manager', email: 'adam@example.com' }],
    ])

    expect(
      eligibleManagerChoices(
        [
          property('A', 'DE', ['admin', 'manager']),
          property('B', 'DE', ['admin', 'gone']),
        ],
        members,
      ),
    ).toEqual([
      { userId: 'manager', label: 'Adam Manager', eligibleCount: 1 },
      { userId: 'admin', label: 'Zoe Admin', eligibleCount: 2 },
    ])
  })
})
