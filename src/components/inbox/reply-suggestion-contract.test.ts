import { describe, expect, it } from 'vitest'
import {
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

  it('keeps provider fallbacks on their existing explanation', () => {
    expect(
      replyTemplateLoadedMessage(
        {
          reason: 'provider_or_output_unavailable',
          languageSource: 'explicit',
          concreteLanguageTag: 'en-Latn',
        },
        null,
      ),
    ).toBeNull()
  })
})
