import { describe, expect, it } from 'vitest'
import { PORTAL_EDITOR_SECTIONS } from '../portal-editor/portal-editor-sections'
import {
  PREVIEW_PART_SECTIONS,
  PREVIEW_PART_SELECTORS,
  previewPartOf,
  stateIdForPart,
} from './preview-parts'

describe('previewPartOf', () => {
  it.each(PREVIEW_PART_SECTIONS)(
    'maps the %s section to its part of the page',
    (section) => {
      expect(previewPartOf(section)).toBe(section)
    },
  )

  it.each(['look', 'group', 'responsible'] as const)(
    'has no part for %s, which is not drawn on the page',
    (section) => {
      expect(previewPartOf(section)).toBeNull()
    },
  )

  it('has no part when no section is asked for', () => {
    expect(previewPartOf(undefined)).toBeNull()
  })

  it('only ever names sections the editor has', () => {
    for (const section of PREVIEW_PART_SECTIONS) {
      expect(PORTAL_EDITOR_SECTIONS).toContain(section)
    }
  })
})

describe('PREVIEW_PART_SELECTORS', () => {
  it('has a way to find every part on the page', () => {
    for (const section of PREVIEW_PART_SECTIONS) {
      expect(PREVIEW_PART_SELECTORS[section].length).toBeGreaterThan(0)
    }
  })

  it('finds the language sheet before the chip, so an open sheet is the part', () => {
    const [first, second] = PREVIEW_PART_SELECTORS.languages
    expect(first).toContain('language-sheet')
    expect(second).toContain('ih-chip')
  })
})

describe('stateIdForPart', () => {
  it('keeps the state the manager chose when the part is drawn in it', () => {
    expect(stateIdForPart('linktree', 'high')).toBe('high')
    expect(stateIdForPart('rating', 'arrival')).toBe('arrival')
    expect(stateIdForPart('private-note', 'low')).toBe('low')
    expect(stateIdForPart('private-note', 'done')).toBe('done')
  })

  it('moves to the state that draws the private note, which a guest meets after a low rating', () => {
    expect(stateIdForPart('private-note', 'arrival')).toBe('low')
    expect(stateIdForPart('private-note', 'high')).toBe('low')
  })

  it('changes nothing when no part is selected', () => {
    expect(stateIdForPart(null, 'high')).toBe('high')
  })
})
