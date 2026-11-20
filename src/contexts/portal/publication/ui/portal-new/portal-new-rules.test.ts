import { describe, expect, it } from 'vitest'
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import {
  languageChoices,
  languageNote,
  newPortalDefaults,
  responsibleSummary,
  sourceLocalesOf,
  toCreatePortalInput,
  toggleLocale,
  type PortalNewOptions,
} from './portal-new-rules'

const options: PortalNewOptions = {
  defaultGuestLocales: ['en', 'bg'],
  eligibleManagerUserIds: ['me', 'anna'],
  creatorIsEligible: true,
}

describe('newPortalDefaults', () => {
  it('starts from the Property wording, the Property languages and no group', () => {
    expect(newPortalDefaults(options)).toEqual({
      name: '',
      groupId: '',
      guestLocales: ['en', 'bg'],
      startFrom: 'property',
      sourcePortalId: '',
      responsibleManagerUserIds: null,
    })
  })

  it('starts in English until the Property languages have loaded', () => {
    expect(newPortalDefaults(undefined).guestLocales).toEqual(['en'])
  })
})

describe('toCreatePortalInput', () => {
  const values = { ...newPortalDefaults(options), name: '  Rooftop pool ' }

  it('sends the trimmed name, the languages and the Property wording', () => {
    const input = toCreatePortalInput('prop-1', values)
    expect(input).toEqual({
      propertyId: 'prop-1',
      name: 'Rooftop pool',
      guestLocales: ['en', 'bg'],
      startFrom: { kind: 'property' },
    })
    expect(createPortalInputSchema.safeParse(input).success).toBe(true)
  })

  it('names the group only when one was chosen', () => {
    expect(toCreatePortalInput('prop-1', { ...values, groupId: 'g1' }).groupId).toBe('g1')
    expect(toCreatePortalInput('prop-1', values)).not.toHaveProperty('groupId')
  })

  it('names the portal to copy', () => {
    const input = toCreatePortalInput('prop-1', {
      ...values,
      startFrom: 'portal',
      sourcePortalId: 'p-9',
    })
    expect(input.startFrom).toEqual({ kind: 'portal', portalId: 'p-9' })
    expect(createPortalInputSchema.safeParse(input).success).toBe(true)
  })

  it('ignores a leftover copy choice while starting from the Property wording', () => {
    const input = toCreatePortalInput('prop-1', { ...values, sourcePortalId: 'p-9' })
    expect(input.startFrom).toEqual({ kind: 'property' })
  })

  it('names the managers only when the default was changed, even to nobody', () => {
    expect(toCreatePortalInput('prop-1', values)).not.toHaveProperty(
      'responsibleManagerUserIds',
    )
    expect(
      toCreatePortalInput('prop-1', { ...values, responsibleManagerUserIds: [] })
        .responsibleManagerUserIds,
    ).toEqual([])
    expect(
      toCreatePortalInput('prop-1', { ...values, responsibleManagerUserIds: ['anna'] })
        .responsibleManagerUserIds,
    ).toEqual(['anna'])
  })
})

describe('language choices', () => {
  it('shows the Property languages and the selection as chips, the rest in the menu', () => {
    expect(languageChoices(['en'], ['en'])).toEqual({
      chips: ['en'],
      addable: ['es', 'it', 'fr', 'de', 'bg'],
      fallback: null,
    })
    expect(languageChoices(['en'], ['en', 'bg'])).toEqual({
      chips: ['en', 'bg'],
      addable: ['es', 'it', 'fr', 'de'],
      fallback: 'en',
    })
  })

  it('keeps a deselected default as a chip so it can be chosen again', () => {
    expect(languageChoices(['en', 'bg'], ['bg'])).toEqual({
      chips: ['en', 'bg'],
      addable: ['es', 'it', 'fr', 'de'],
      fallback: null,
    })
  })

  it('names the fallback when English is switched off and on again, the chips staying in place', () => {
    const defaults = ['en', 'bg'] as const
    const off = toggleLocale(['en', 'bg'], 'en')
    const back = toggleLocale(off, 'en')
    expect(back).toEqual(['bg', 'en'])
    const choices = languageChoices(defaults, back)
    // Bulgarian is now first chosen, so it is the fallback; the chip drawn
    // first is still English, so the fallback is marked rather than implied.
    expect(choices.chips).toEqual(['en', 'bg'])
    expect(choices.fallback).toBe('bg')
    expect(languageNote(back)).toContain('Bulgarian is the fallback')
  })

  it('has no fallback to mark when only one language is chosen', () => {
    expect(languageChoices(['en', 'bg'], ['en']).fallback).toBeNull()
  })

  it('toggles a language on and off, in the order chosen', () => {
    expect(toggleLocale(['en'], 'bg')).toEqual(['en', 'bg'])
    expect(toggleLocale(['en', 'bg'], 'en')).toEqual(['bg'])
  })

  it('never removes the last language', () => {
    expect(toggleLocale(['en'], 'en')).toEqual(['en'])
  })

  it('says what guests will get', () => {
    expect(languageNote(['en', 'bg'])).toBe(
      'Guests can switch between these. English is the fallback.',
    )
    expect(languageNote(['bg'])).toBe(
      'Guests see the page in Български. No language switch.',
    )
  })
})

describe('sourceLocalesOf', () => {
  it('reads a portal languages, primary first, including German and the other new ones', () => {
    expect(
      sourceLocalesOf({ primaryGuestLocale: 'bg', additionalGuestLocales: ['en', 'de'] }),
    ).toEqual(['bg', 'en', 'de'])
  })
})

describe('responsibleSummary', () => {
  const members = [
    { userId: 'me', name: 'Gina Iliev' },
    { userId: 'anna', name: 'Anna Petrova' },
  ]

  it('says the creator is responsible by default', () => {
    expect(responsibleSummary(null, options, 'me', members)).toBe(
      "You'll be responsible for this portal",
    )
  })

  it('says nobody is when the creator cannot be', () => {
    expect(
      responsibleSummary(null, { ...options, creatorIsEligible: false }, 'me', members),
    ).toBe('No one will be responsible yet')
  })

  it('says nobody is when the choice was emptied', () => {
    expect(responsibleSummary([], options, 'me', members)).toBe(
      'No one will be responsible yet',
    )
  })

  it('names the chosen managers, never their ids', () => {
    expect(responsibleSummary(['anna'], options, 'me', members)).toBe(
      'Anna Petrova will be responsible',
    )
    expect(responsibleSummary(['anna', 'me'], options, 'me', members)).toBe(
      'You and Anna Petrova will be responsible',
    )
    expect(responsibleSummary(['anna'], options, 'me', [])).toBe(
      '1 manager will be responsible',
    )
  })

  it('keeps saying "You" when only the creator is chosen', () => {
    expect(responsibleSummary(['me'], options, 'me', members)).toBe(
      "You'll be responsible for this portal",
    )
  })
})
