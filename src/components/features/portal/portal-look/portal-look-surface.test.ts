// Which surface a portal's Look section shows, and the words that go with each.
import { describe, expect, it } from 'vitest'
import {
  PROPERTY_LOOK_SOURCES,
  type PortalLookSources,
} from '#/contexts/portal/application/public-api'
import {
  FACTS_NOTE,
  hasOwnLook,
  lookFactsNoteOf,
  lookFactsOf,
  lookIntroOf,
  portalLookSurfaceOf,
  type PortalLookSurfaceInput,
} from './portal-look-surface'

const sources = (own: Partial<PortalLookSources>): PortalLookSources => ({
  ...PROPERTY_LOOK_SOURCES,
  ...own,
})

const ADMIN_WITH_SIBLINGS: PortalLookSurfaceInput = {
  enabled: true,
  canChange: true,
  siblingPortalCount: 2,
  sources: PROPERTY_LOOK_SOURCES,
}

describe('which surface the section shows', () => {
  it('offers the editor to an Account Admin once the property has a second portal', () => {
    expect(portalLookSurfaceOf(ADMIN_WITH_SIBLINGS)).toBe('editor')
  })

  it('shows a property with one portal today’s summary, whoever looks', () => {
    expect(portalLookSurfaceOf({ ...ADMIN_WITH_SIBLINGS, siblingPortalCount: 1 })).toBe(
      'summary',
    )
    expect(
      portalLookSurfaceOf({
        ...ADMIN_WITH_SIBLINGS,
        siblingPortalCount: 1,
        canChange: false,
      }),
    ).toBe('summary')
  })

  it('keeps the editor for a portal that already has a look of its own, so it can be given back', () => {
    const owner = sources({ colours: 'portal' })
    expect(
      portalLookSurfaceOf({
        ...ADMIN_WITH_SIBLINGS,
        siblingPortalCount: 1,
        sources: owner,
      }),
    ).toBe('editor')
  })

  it('counts a photo taken away as a look of its own', () => {
    expect(hasOwnLook(sources({ photo: 'none' }))).toBe(true)
    expect(hasOwnLook(PROPERTY_LOOK_SOURCES)).toBe(false)
  })

  it('shows facts, not disabled controls, to someone who may not change the look', () => {
    expect(portalLookSurfaceOf({ ...ADMIN_WITH_SIBLINGS, canChange: false })).toBe(
      'facts',
    )
    // An archived portal is read-only for everyone; its own look is still told.
    expect(
      portalLookSurfaceOf({
        ...ADMIN_WITH_SIBLINGS,
        canChange: false,
        siblingPortalCount: 1,
        sources: sources({ photo: 'portal' }),
      }),
    ).toBe('facts')
  })

  it('offers nothing while the switch is off, but still tells what a portal owns', () => {
    expect(portalLookSurfaceOf({ ...ADMIN_WITH_SIBLINGS, enabled: false })).toBe(
      'summary',
    )
    expect(
      portalLookSurfaceOf({
        ...ADMIN_WITH_SIBLINGS,
        enabled: false,
        sources: sources({ identity: 'portal' }),
      }),
    ).toBe('facts')
  })
})

describe('the words', () => {
  it('tells what a portal owns and what it takes, in a property manager’s terms', () => {
    expect(lookFactsOf(sources({ photo: 'portal' }))).toEqual([
      { term: 'Photo', value: 'This portal’s own' },
      { term: 'Colours', value: 'The property’s' },
      { term: 'Name and logo', value: 'The property’s' },
    ])
    expect(lookFactsOf(sources({ photo: 'none', identity: 'portal' }))).toEqual([
      { term: 'Photo', value: 'None on this portal' },
      { term: 'Colours', value: 'The property’s' },
      { term: 'Name and logo', value: 'This portal’s own' },
    ])
  })

  it('names an Account Admin only while one could change the look', () => {
    const NOT_NOW = 'A portal’s own look cannot be changed at the moment.'
    const RESTORE = 'An archived portal’s look can be changed once it is restored.'
    // A viewer whose role does not change portals, or an admin who could: ask an admin.
    expect(lookFactsNoteOf({ enabled: true, readOnlyReason: null })).toBe(FACTS_NOTE)
    expect(lookFactsNoteOf({ enabled: true, readOnlyReason: 'role' })).toBe(FACTS_NOTE)
    // Nobody can: the switch is off, or the organisation's portal changes are.
    expect(lookFactsNoteOf({ enabled: false, readOnlyReason: null })).toBe(NOT_NOW)
    expect(lookFactsNoteOf({ enabled: true, readOnlyReason: 'capability' })).toBe(NOT_NOW)
    expect(lookFactsNoteOf({ enabled: false, readOnlyReason: 'role' })).toBe(NOT_NOW)
    // An archived portal is restored first, whatever the switch says.
    expect(lookFactsNoteOf({ enabled: true, readOnlyReason: 'archived' })).toBe(RESTORE)
    expect(lookFactsNoteOf({ enabled: false, readOnlyReason: 'archived' })).toBe(RESTORE)
  })

  it('introduces a portal that follows everything as one that can be given a look', () => {
    expect(lookIntroOf('Spa', PROPERTY_LOOK_SOURCES)).toEqual({
      before: 'Spa uses ',
      after:
        '. Give it its own photo, colours, or name and logo. Changes are drafts until you publish Spa.',
    })
  })

  it('introduces a portal with a look of its own as one that follows the rest', () => {
    expect(lookIntroOf('Spa', sources({ photo: 'portal' }))).toEqual({
      before: 'Spa follows ',
      after: ' except for what is set here. Changes are drafts until you publish Spa.',
    })
  })
})
