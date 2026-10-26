// The one quiet line under each section name. Each line is a decision — "no
// links yet" versus "1 link", a threshold read as "3★ or below" — so the words
// are pinned here rather than left to whatever the JSX happens to interpolate.

import { describe, expect, it } from 'vitest'
import { PROPERTY_LOOK_SOURCES } from '#/contexts/portal/application/public-api'
import {
  countLanguagesWithoutWording,
  findPortalGroup,
  lookSummaryOf,
  responsibleManagerNames,
  summarizePortalEditorSections,
  type PortalEditorSummaryInput,
} from './portal-editor-summary'

const base: PortalEditorSummaryInput = {
  portalName: 'Pool & Terrace',
  privateFeedbackThreshold: 3,
  linkCount: 4,
  languageCount: 4,
  groupName: 'Pool side',
  responsibleNames: ['Georgi Petrov', 'Elena Petrova'],
}

describe('summarizePortalEditorSections', () => {
  it('describes every section the way board 02 does', () => {
    expect(summarizePortalEditorSections(base)).toEqual({
      look: { text: 'The property look', locked: false },
      welcome: { text: 'Pool & Terrace', locked: false },
      rating: { text: 'Always included', locked: true },
      'private-note': { text: '3★ or below', locked: false },
      linktree: { text: '4 links', locked: false },
      footer: { text: 'Privacy notice', locked: true },
      languages: { text: '4 languages', locked: false },
      group: { text: 'Pool side', locked: false },
      responsible: { text: 'Georgi, Elena', locked: false },
    })
  })

  it('flags what a language is missing beside the language count', () => {
    const flagged = summarizePortalEditorSections({ ...base, missingTextCount: 1 })
    expect(flagged.languages).toEqual({
      text: '4 languages',
      locked: false,
      attention: '1 missing',
    })
  })

  it('flags nothing when no text is missing, or when coverage is not known', () => {
    expect(
      summarizePortalEditorSections({ ...base, missingTextCount: 0 }).languages,
    ).not.toHaveProperty('attention')
    expect(summarizePortalEditorSections(base).languages).not.toHaveProperty('attention')
  })

  // Text typed into this portal's own welcome line does not count in a language
  // the property has no wording in, so Welcome itself says so, not only Languages.
  it('flags Welcome while a language has no property wording', () => {
    expect(
      summarizePortalEditorSections({ ...base, languagesWithoutWording: 1 }).welcome,
    ).toEqual({
      text: 'Pool & Terrace',
      locked: false,
      attention: '1 language without wording',
    })
    expect(
      summarizePortalEditorSections({ ...base, languagesWithoutWording: 2 }).welcome
        .attention,
    ).toBe('2 languages without wording')
    expect(
      summarizePortalEditorSections({ ...base, languagesWithoutWording: 0 }).welcome,
    ).not.toHaveProperty('attention')
  })

  it('says "No links yet" rather than "0 links"', () => {
    expect(summarizePortalEditorSections({ ...base, linkCount: 0 }).linktree.text).toBe(
      'No links yet',
    )
  })

  it('names the tiles guests cannot see, in the words the links list uses', () => {
    expect(
      summarizePortalEditorSections({ ...base, hiddenLinkCount: 1 }).linktree.text,
    ).toBe('4 links · 1 hidden from guests')
    expect(
      summarizePortalEditorSections({ ...base, hiddenLinkCount: 0 }).linktree.text,
    ).toBe('4 links')
  })

  it('uses the singular for one link and one language', () => {
    const one = summarizePortalEditorSections({ ...base, linkCount: 1, languageCount: 1 })
    expect(one.linktree.text).toBe('1 link')
    expect(one.languages.text).toBe('1 language')
  })

  it('reads the private-note threshold as "N★ or below" for every allowed value', () => {
    for (const threshold of [1, 2, 3, 4, 5]) {
      expect(
        summarizePortalEditorSections({ ...base, privateFeedbackThreshold: threshold })[
          'private-note'
        ].text,
      ).toBe(`${threshold}★ or below`)
    }
  })

  it('says a portal outside any group is not in one', () => {
    expect(summarizePortalEditorSections({ ...base, groupName: null }).group.text).toBe(
      'Not in a group',
    )
  })

  it('says nobody is assigned when there are no responsible managers', () => {
    expect(
      summarizePortalEditorSections({ ...base, responsibleNames: [] }).responsible.text,
    ).toBe('No one assigned')
  })

  it('uses first names only, and skips a blank name', () => {
    expect(
      summarizePortalEditorSections({
        ...base,
        responsibleNames: ['  Georgi   Petrov ', '', 'Elena'],
      }).responsible.text,
    ).toBe('Georgi, Elena')
  })

  it('keeps an unnamed portal readable', () => {
    expect(
      summarizePortalEditorSections({ ...base, portalName: '  ' }).welcome.text,
    ).toBe('Untitled portal')
  })
})

describe('the Look line', () => {
  const sources = (own: Partial<typeof PROPERTY_LOOK_SOURCES>) => ({
    ...PROPERTY_LOOK_SOURCES,
    ...own,
  })

  it('says a portal that owns nothing has the property look', () => {
    expect(lookSummaryOf(PROPERTY_LOOK_SOURCES)).toBe('The property look')
    expect(summarizePortalEditorSections(base).look).toEqual({
      text: 'The property look',
      locked: false,
    })
  })

  it('names what a portal owns, one group or two', () => {
    expect(lookSummaryOf(sources({ photo: 'portal' }))).toBe('Own photo')
    expect(lookSummaryOf(sources({ colours: 'portal' }))).toBe('Own colours')
    expect(lookSummaryOf(sources({ identity: 'portal' }))).toBe('Own name and logo')
    expect(lookSummaryOf(sources({ photo: 'portal', colours: 'portal' }))).toBe(
      'Own photo and colours',
    )
    expect(lookSummaryOf(sources({ photo: 'portal', identity: 'portal' }))).toBe(
      'Own photo, name and logo',
    )
    expect(lookSummaryOf(sources({ colours: 'portal', identity: 'portal' }))).toBe(
      'Own colours, name and logo',
    )
  })

  it('says "Own look" once all three groups are the portal’s', () => {
    expect(
      lookSummaryOf({ photo: 'portal', colours: 'portal', identity: 'portal' }),
    ).toBe('Own look')
    // Going without a photo is the portal’s own choice too.
    expect(lookSummaryOf({ photo: 'none', colours: 'portal', identity: 'portal' })).toBe(
      'Own look',
    )
  })

  it('says a portal told to go without a photo has none, and what else it owns', () => {
    expect(lookSummaryOf(sources({ photo: 'none' }))).toBe('No photo')
    expect(lookSummaryOf(sources({ photo: 'none', colours: 'portal' }))).toBe(
      'No photo, own colours',
    )
    expect(lookSummaryOf(sources({ photo: 'none', identity: 'portal' }))).toBe(
      'No photo, own name and logo',
    )
  })

  it('follows the sources the settings read gives the editor', () => {
    const line = summarizePortalEditorSections({
      ...base,
      lookSources: sources({ photo: 'portal', colours: 'portal' }),
    }).look.text
    expect(line).toBe('Own photo and colours')
  })
})

describe('findPortalGroup', () => {
  const groups = [
    { id: 'g1', name: 'Pool side', portalIds: ['p1', 'p2'] },
    { id: 'g2', name: 'Front of house', portalIds: ['p3'] },
  ]

  it('finds the group that holds the portal', () => {
    expect(findPortalGroup(groups, 'p3')?.name).toBe('Front of house')
  })

  it('is null for a portal outside every group', () => {
    expect(findPortalGroup(groups, 'p9')).toBeNull()
    expect(findPortalGroup([], 'p1')).toBeNull()
  })
})

describe('responsibleManagerNames', () => {
  const members = [
    { userId: 'u1', name: 'Georgi Petrov' },
    { userId: 'u2', name: 'Elena Petrova' },
  ]

  it('names the assigned managers in assignment order', () => {
    expect(
      responsibleManagerNames([{ userId: 'u2' }, { userId: 'u1' }], members),
    ).toEqual(['Elena Petrova', 'Georgi Petrov'])
  })

  it('leaves out an assignment whose member is gone rather than showing an id', () => {
    expect(
      responsibleManagerNames([{ userId: 'u1' }, { userId: 'gone' }], members),
    ).toEqual(['Georgi Petrov'])
  })
})

describe('countLanguagesWithoutWording', () => {
  const row = (locale: string, title: string, shortDescription = '') => ({
    locale,
    title,
    shortDescription,
  })

  it('counts the languages with no row, or only blank wording', () => {
    expect(
      countLanguagesWithoutWording(
        ['en', 'bg', 'de'],
        [row('en', 'Welcome to Avela'), row('bg', '  ', ' ')],
      ),
    ).toBe(2)
  })

  it('counts none when every language has wording', () => {
    expect(countLanguagesWithoutWording(['en'], [row('en', '', 'Rate your visit')])).toBe(
      0,
    )
  })
})
