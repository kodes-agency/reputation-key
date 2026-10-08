import { describe, expect, it } from 'vitest'
import type { PortalReview } from '#/contexts/portal/application/public-api'
import { changeMixOf, describeMix, hasOtherEdits } from './property-look-batch-changes'

type Change = PortalReview['changes'][number]

const edit = (area: 'look' | 'links' | 'welcome_text' | 'display_name'): Change => ({
  type: 'edit',
  kind: area === 'look' ? 'property_brand_profile' : 'portal_links',
  subject:
    area === 'look'
      ? { area: 'look', facet: 'accent' }
      : area === 'links'
        ? { area: 'links' }
        : area === 'welcome_text'
          ? { area: 'welcome_text', locale: 'en' }
          : { area: 'display_name' },
  propertyWide: area !== 'links',
  actor: null,
  occurredAt: '2026-10-01T09:00:00.000Z',
  previousText: null,
  newText: null,
  editCount: 1,
})

const unrecorded = (kind: 'property_brand_profile' | 'portal_links'): Change => ({
  type: 'unrecorded',
  kind,
  actor: null,
  occurredAt: '2026-10-01T09:00:00.000Z',
})

describe('changeMixOf', () => {
  it('counts edits to the property look apart from every other saved edit', () => {
    expect(
      changeMixOf([
        edit('look'),
        edit('look'),
        edit('links'),
        edit('welcome_text'),
        edit('display_name'),
      ]),
    ).toEqual({ look: 2, other: 3, hasUnlisted: false })
  })

  it('reads an unrecorded move of the brand profile as the look, any other as another edit', () => {
    expect(
      changeMixOf([unrecorded('property_brand_profile'), unrecorded('portal_links')]),
    ).toEqual({ look: 1, other: 1, hasUnlisted: false })
  })

  it('does not count what the review adds as a reason: those are not edits anyone saved', () => {
    expect(
      changeMixOf([
        { type: 'earlier_design' },
        { type: 'google_destination_moved' },
        { type: 'no_visible_change' },
      ]),
    ).toEqual({ look: 0, other: 0, hasUnlisted: false })
  })

  it('notes a draft that differs in ways the list cannot name', () => {
    expect(changeMixOf([{ type: 'unlisted' }])).toEqual({
      look: 0,
      other: 0,
      hasUnlisted: true,
    })
  })
})

describe('hasOtherEdits and describeMix', () => {
  it('has other edits when any are counted or cannot be listed', () => {
    expect(hasOtherEdits({ look: 1, other: 0, hasUnlisted: false })).toBe(false)
    expect(hasOtherEdits({ look: 1, other: 1, hasUnlisted: false })).toBe(true)
    expect(hasOtherEdits({ look: 1, other: 0, hasUnlisted: true })).toBe(true)
  })

  it('says "at least" when the list cannot be trusted to be whole', () => {
    expect(describeMix({ look: 1, other: 3, hasUnlisted: true }, false)).toBe(
      'also publishes at least 3 other draft edits',
    )
    expect(describeMix({ look: 1, other: 3, hasUnlisted: false }, true)).toBe(
      'also publishes at least 3 other draft edits',
    )
  })

  it('says nothing about edits when there are none to name', () => {
    expect(describeMix({ look: 0, other: 0, hasUnlisted: false }, false)).toBeNull()
  })
})
