import { describe, expect, it } from 'vitest'
import { replySuggestionUnavailableMessage } from './reply-suggestion-contract'

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
})
