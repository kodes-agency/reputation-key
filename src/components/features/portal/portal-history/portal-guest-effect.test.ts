import { describe, expect, it } from 'vitest'
import type { PublicationContentChange } from '#/contexts/portal/application/public-api'
import { describeGuestEffect } from './portal-guest-effect'
import { phraseText } from './portal-history-phrase'

describe('describeGuestEffect', () => {
  it('says a language goes away and what its guests see instead', () => {
    const effect = describeGuestEffect({ kind: 'language_removed', locale: 'de' }, 'en')

    expect(effect.topic).toBe('Languages')
    expect(phraseText(effect.text)).toBe('Deutsch goes away; German guests see English')
  })

  it('says a tile goes away or comes back', () => {
    expect(
      phraseText(
        describeGuestEffect(
          { kind: 'link_removed', label: 'Getting here', hasPhoto: false },
          'en',
        ).text,
      ),
    ).toBe('‘Getting here’ goes away')
    expect(
      phraseText(
        describeGuestEffect({ kind: 'link_added', label: 'Spa', hasPhoto: true }, 'en')
          .text,
      ),
    ).toBe('the ‘Spa’ photo tile comes back')
  })

  it('words a move to a later version as what it brings, not what comes back', () => {
    const forward = (change: PublicationContentChange) =>
      phraseText(describeGuestEffect(change, 'en', 5).text)

    expect(forward({ kind: 'link_address_changed', label: 'Menu' })).toBe(
      '‘Menu’ goes to the address it has in version 5',
    )
    expect(forward({ kind: 'links_reordered' })).toBe("Tiles take version 5's order")
    expect(forward({ kind: 'link_added', label: 'Spa', hasPhoto: false })).toBe(
      '‘Spa’ is added',
    )
    expect(forward({ kind: 'language_added', locale: 'de' })).toBe('Deutsch is added')
    expect(forward({ kind: 'look_changed', facets: ['colours'] })).toBe(
      'The colours change',
    )
    expect(forward({ kind: 'wording_changed', field: 'title', locale: 'en' })).toBe(
      'The English title reads as it does in version 5',
    )
    expect(forward({ kind: 'link_renamed', from: 'A', to: 'B' })).toBe(
      '‘A’ is called ‘B’',
    )
  })

  it('words the new kinds of change in both directions', () => {
    const back = (change: PublicationContentChange) =>
      phraseText(describeGuestEffect(change, 'en').text)

    expect(back({ kind: 'link_photo_changed', label: 'Spa', how: 'replaced' })).toBe(
      '‘Spa’ shows its earlier photo',
    )
    expect(back({ kind: 'link_icon_changed', label: 'Menu' })).toBe(
      '‘Menu’ shows its earlier icon',
    )
    expect(back({ kind: 'heading_renamed', from: 'A', to: 'B' })).toBe(
      'The heading ‘A’ is called ‘B’ again',
    )
    expect(back({ kind: 'hero_photo_changed', locale: 'bg' })).toBe(
      'The Bulgarian hero photo changes back',
    )
    expect(
      phraseText(
        describeGuestEffect({ kind: 'hero_photo_changed', locale: 'bg' }, 'en', 5).text,
      ),
    ).toBe('The Bulgarian hero photo changes')
  })

  it('files every kind of change under a topic a manager knows', () => {
    const topics = (
      [
        { kind: 'primary_language_changed', from: 'bg', to: 'en' },
        { kind: 'link_renamed', from: 'A', to: 'B' },
        { kind: 'link_address_changed', label: 'A' },
        { kind: 'link_reworded', label: 'A', locale: 'bg' },
        { kind: 'links_reordered' },
        { kind: 'linktree_switched', enabled: true },
        { kind: 'wording_changed', field: 'description', locale: 'en' },
        { kind: 'look_changed', facets: ['name'] },
        { kind: 'design_changed', to: 'legacy' },
        { kind: 'feedback_threshold_changed', from: 4, to: 3 },
        { kind: 'review_address_changed' },
        { kind: 'link_photo_changed', label: 'A', how: 'added' },
        { kind: 'link_icon_changed', label: 'A' },
        { kind: 'heading_renamed', from: 'A', to: 'B' },
        { kind: 'hero_photo_changed', locale: 'en' },
      ] satisfies PublicationContentChange[]
    ).map((change) => describeGuestEffect(change, 'en').topic)

    expect(topics).toEqual([
      'Languages',
      'Linktree',
      'Linktree',
      'Linktree',
      'Linktree',
      'Linktree',
      'Wording',
      'Look',
      'Page design',
      'Settings',
      'Settings',
      'Linktree',
      'Linktree',
      'Wording',
      'Look',
    ])
  })
})
