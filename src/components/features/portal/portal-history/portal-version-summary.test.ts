import { describe, expect, it } from 'vitest'
import type { PublicationContentChange } from '#/contexts/portal/application/public-api'
import { phraseText } from './portal-history-phrase'
import { summarizeChanges, summarizeVersion } from './portal-version-summary'

const added = (label: string, hasPhoto = false): PublicationContentChange => ({
  kind: 'link_added',
  label,
  hasPhoto,
})

describe('summarizeChanges', () => {
  it('names what was added, in the guests language where it is a language', () => {
    const summary = summarizeChanges([
      { kind: 'language_added', locale: 'de' },
      added('Getting here'),
    ])

    expect(phraseText(summary)).toBe('added Deutsch and ‘Getting here’')
    expect(summary[1]).toMatchObject({ text: 'Deutsch', lang: 'de' })
  })

  it('calls a tile with a photo a photo tile', () => {
    expect(phraseText(summarizeChanges([added('Discover the resort', true)]))).toBe(
      'added the ‘Discover the resort’ photo tile',
    )
  })

  it('groups additions, removals and other changes, in that order', () => {
    const summary = summarizeChanges([
      { kind: 'link_renamed', from: 'Dinner menu', to: 'Olive Terrace menu' },
      { kind: 'link_removed', label: 'Spa', hasPhoto: false },
      added('Getting here'),
    ])

    expect(phraseText(summary)).toBe(
      'added ‘Getting here’; removed ‘Spa’; renamed ‘Dinner menu’ to ‘Olive Terrace menu’',
    )
  })

  it('can start with a capital for the rail', () => {
    expect(phraseText(summarizeChanges([added('Menu')], { capitalised: true }))).toBe(
      'Added ‘Menu’',
    )
  })

  it('names at most four changes and counts the rest', () => {
    const summary = summarizeChanges([
      added('A'),
      added('B'),
      added('C'),
      added('D'),
      added('E'),
      added('F'),
    ])

    expect(phraseText(summary)).toBe('added ‘A’, ‘B’, ‘C’ and ‘D’ and 2 more changes')
  })

  it('says plainly that a version changed nothing guests see', () => {
    expect(phraseText(summarizeChanges([]))).toBe('nothing changed on the guest page')
    expect(phraseText(summarizeChanges([], { capitalised: true }))).toBe(
      'Nothing changed on the guest page',
    )
  })

  it('words every other kind of change', () => {
    const words = (change: PublicationContentChange) =>
      phraseText(summarizeChanges([change]))

    expect(words({ kind: 'primary_language_changed', from: 'en', to: 'bg' })).toBe(
      'made Български the main language',
    )
    expect(words({ kind: 'link_address_changed', label: 'Menu' })).toBe(
      'changed where ‘Menu’ goes',
    )
    expect(words({ kind: 'link_reworded', label: 'Menu', locale: 'es' })).toBe(
      'reworded ‘Menu’ in Spanish',
    )
    expect(words({ kind: 'links_reordered' })).toBe('reordered the tiles')
    expect(words({ kind: 'linktree_switched', enabled: false })).toBe(
      'turned the Linktree off',
    )
    expect(words({ kind: 'wording_changed', field: 'title', locale: 'es' })).toBe(
      'reworded the Spanish title',
    )
    expect(words({ kind: 'look_changed', facets: ['colours', 'photo'] })).toBe(
      'changed the colours and photo',
    )
    expect(words({ kind: 'design_changed', to: 'immersive' })).toBe(
      'moved to the new guest page design',
    )
    expect(words({ kind: 'feedback_threshold_changed', from: 3, to: 4 })).toBe(
      'changed the private feedback threshold to 4',
    )
    expect(words({ kind: 'review_address_changed' })).toBe(
      'changed the Google review address',
    )
    expect(words({ kind: 'link_photo_changed', label: 'Spa', how: 'added' })).toBe(
      'added a photo to ‘Spa’',
    )
    expect(words({ kind: 'link_photo_changed', label: 'Spa', how: 'removed' })).toBe(
      'took the photo off ‘Spa’',
    )
    expect(words({ kind: 'link_photo_changed', label: 'Spa', how: 'replaced' })).toBe(
      'replaced the photo on ‘Spa’',
    )
    expect(words({ kind: 'link_icon_changed', label: 'Menu' })).toBe(
      'changed the icon on ‘Menu’',
    )
    expect(words({ kind: 'heading_renamed', from: 'Links', to: 'Around us' })).toBe(
      'renamed the heading ‘Links’ to ‘Around us’',
    )
    expect(words({ kind: 'hero_photo_changed', locale: 'bg' })).toBe(
      'changed the Bulgarian hero photo',
    )
    expect(words({ kind: 'wording_changed', field: 'link_preview', locale: 'en' })).toBe(
      'reworded the English link preview text',
    )
    expect(words({ kind: 'look_changed', facets: ['photo_focus'] })).toBe(
      'changed the photo position',
    )
  })
})

describe('summarizeVersion', () => {
  it('names the languages of the first version', () => {
    const summary = summarizeVersion(
      { isFirst: true, languages: ['en', 'bg'], changes: [] },
      { capitalised: true },
    )

    expect(phraseText(summary)).toBe('First version · English and Български')
    expect(summary.at(-1)).toMatchObject({ lang: 'bg' })
  })

  it('reads a later version as what it added', () => {
    expect(
      phraseText(
        summarizeVersion({
          isFirst: false,
          languages: ['en'],
          changes: [{ kind: 'language_added', locale: 'es' }],
        }),
      ),
    ).toBe('added Español')
  })
})
