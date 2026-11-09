// The section list is the editor's whole navigation contract: which sections
// exist, the order guests meet them in, which are offered, and what a stale or
// forged `?section=` resolves to. The types cannot catch a wrong *order* or a
// section quietly missing from a group.

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PORTAL_EDITOR_SECTION,
  PORTAL_EDITOR_SECTIONS,
  PORTAL_EDITOR_SECTION_GROUPS,
  PORTAL_EDITOR_SECTION_LABELS,
  availablePortalEditorSections,
  isPortalEditorSection,
  resolvePortalEditorSection,
} from './portal-editor-sections'

describe('the portal editor section registry', () => {
  it('lists the sections in the order guests meet them, then the ones behind the page', () => {
    expect(PORTAL_EDITOR_SECTIONS).toEqual([
      'look',
      'welcome',
      'rating',
      'private-note',
      'linktree',
      'footer',
      'languages',
      'group',
      'responsible',
    ])
  })

  it('groups them as "On the page" and "Behind the page" without losing or repeating one', () => {
    expect(PORTAL_EDITOR_SECTION_GROUPS.map((group) => group.heading)).toEqual([
      'On the page',
      'Behind the page',
    ])
    expect(PORTAL_EDITOR_SECTION_GROUPS.flatMap((group) => group.sections)).toEqual(
      PORTAL_EDITOR_SECTIONS,
    )
  })

  it('names every section with the words the board uses', () => {
    expect(
      PORTAL_EDITOR_SECTIONS.map((section) => PORTAL_EDITOR_SECTION_LABELS[section]),
    ).toEqual([
      'Look',
      'Welcome',
      'Rating & Google',
      'Private note',
      'Linktree',
      'Footer',
      'Languages',
      'Group',
      'Responsible',
    ])
  })

  it('opens Welcome when the URL names no section', () => {
    expect(DEFAULT_PORTAL_EDITOR_SECTION).toBe('welcome')
  })
})

describe('isPortalEditorSection', () => {
  it.each(PORTAL_EDITOR_SECTIONS)('accepts %s', (section) => {
    expect(isPortalEditorSection(section)).toBe(true)
  })

  it.each([['nonsense'], [''], [42], [null], [undefined], [['look']], ['LOOK']])(
    'rejects %j',
    (value) => {
      expect(isPortalEditorSection(value)).toBe(false)
    },
  )
})

describe('availablePortalEditorSections', () => {
  it('offers every section when the group and the managers are known', () => {
    expect(availablePortalEditorSections({ group: true, responsible: true })).toEqual(
      PORTAL_EDITOR_SECTIONS,
    )
  })

  it('withholds Group and Responsible when their data is not there, keeping the order', () => {
    expect(availablePortalEditorSections({ group: false, responsible: true })).toEqual(
      PORTAL_EDITOR_SECTIONS.filter((section) => section !== 'group'),
    )
    expect(availablePortalEditorSections({ group: true, responsible: false })).toEqual(
      PORTAL_EDITOR_SECTIONS.filter((section) => section !== 'responsible'),
    )
  })
})

describe('resolvePortalEditorSection', () => {
  const everything = PORTAL_EDITOR_SECTIONS

  it('keeps a requested section that is offered', () => {
    expect(resolvePortalEditorSection('linktree', everything)).toBe('linktree')
  })

  it('falls back to the default when nothing is requested', () => {
    expect(resolvePortalEditorSection(undefined, everything)).toBe('welcome')
  })

  it('falls back to the default for a section that is not offered, never to a dead panel', () => {
    const withoutGroup = availablePortalEditorSections({
      group: false,
      responsible: true,
    })
    expect(resolvePortalEditorSection('group', withoutGroup)).toBe('welcome')
  })

  it('falls back to the first offered section if even the default is withheld', () => {
    expect(resolvePortalEditorSection(undefined, ['look', 'footer'])).toBe('look')
  })
})
