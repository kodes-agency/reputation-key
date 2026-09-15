import { describe, expect, it } from 'vitest'
import {
  replySuggestionOffersTemplate,
  replySuggestionUnavailableMessage,
  replyTemplateLoadedMessage,
} from './reply-suggestion-contract'

describe('replySuggestionUnavailableMessage', () => {
  it('explains a missing public display name without blaming the manager', () => {
    expect(replySuggestionUnavailableMessage('brand_profile_unavailable')).toBe(
      "Reply suggestions need this property's public display name before they can be generated.",
    )
  })

  it('asks for regeneration after a display-name change', () => {
    expect(replySuggestionUnavailableMessage('brand_profile_changed')).toBe(
      "This property's display name was updated. Generate the suggestion again to use the latest name.",
    )
  })

  it('directs a missing template language to property settings', () => {
    expect(replySuggestionUnavailableMessage('target_language_unavailable')).toBe(
      'Set a property default reply language in property settings before loading a template.',
    )
  })
})

describe('replyTemplateLoadedMessage', () => {
  it('explains that undetectable text used the property default language', () => {
    expect(
      replyTemplateLoadedMessage(
        {
          reason: 'language_undetermined',
          languageSource: 'property_default',
          concreteLanguageTag: 'bg-Cyrl-BG',
        },
        'bg-Cyrl-BG',
      ),
    ).toBe(
      "Review language couldn't be detected — template loaded in Bulgarian (property default).",
    )
  })

  it('explains that a textless review used the explicitly selected property language', () => {
    expect(
      replyTemplateLoadedMessage(
        {
          reason: 'no_review_text',
          languageSource: 'explicit',
          concreteLanguageTag: 'bg-Cyrl-BG',
        },
        'bg-Cyrl',
      ),
    ).toBe('This review has no text — template loaded in Bulgarian (property default).')
  })

  it('explains nothing for a template the manager asked for', () => {
    expect(
      replyTemplateLoadedMessage(
        {
          reason: 'template_requested',
          languageSource: 'explicit',
          concreteLanguageTag: 'en-Latn',
        },
        null,
      ),
    ).toBeNull()
  })

  it('says a template was loaded because the language has no personalized drafting', () => {
    expect(
      replyTemplateLoadedMessage(
        {
          reason: 'language_not_personalized',
          languageSource: 'explicit',
          concreteLanguageTag: 'en-Latn',
        },
        null,
      ),
    ).toMatch(/Personalized drafts aren't available in English/)
  })

  it('offers the template only after refusals it can still help with', () => {
    expect(replySuggestionOffersTemplate('busy')).toBe(true)
    expect(replySuggestionOffersTemplate('provider_unavailable')).toBe(true)
    expect(replySuggestionOffersTemplate('not_authorized')).toBe(true)
    expect(replySuggestionOffersTemplate('source_changed')).toBe(false)
    expect(replySuggestionOffersTemplate('target_language_unavailable')).toBe(false)
  })

  it('names busy and provider failures without blaming anyone', () => {
    expect(replySuggestionUnavailableMessage('busy')).toBe(
      'AI drafting is handling other requests for this property.',
    )
    expect(replySuggestionUnavailableMessage('provider_unavailable')).toBe(
      "AI couldn't write a personalized draft this time.",
    )
  })
})
