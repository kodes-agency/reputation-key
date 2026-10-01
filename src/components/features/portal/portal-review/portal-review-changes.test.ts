import { describe, expect, it } from 'vitest'
import type { PortalReviewChange } from '#/contexts/portal/application/public-api'
import { phraseText } from '../portal-history/portal-history-phrase'
import { describeReviewChange, type ReviewChangeLine } from './portal-review-changes'

type EditChange = Extract<PortalReviewChange, { type: 'edit' }>

const edit = (over: Partial<EditChange> & Pick<EditChange, 'subject'>): EditChange => ({
  type: 'edit',
  kind: 'portal_links',
  propertyWide: false,
  actor: { userId: 'u1', displayName: 'Georgi Ivanov' },
  occurredAt: '2026-09-30T08:05:00.000Z',
  previousText: null,
  newText: null,
  editCount: 1,
  ...over,
})

const text = (line: ReviewChangeLine) => ({
  headline: phraseText(line.headline),
  detail: line.detail === null ? null : phraseText(line.detail),
})

describe('describeReviewChange: edits', () => {
  it('names the part of the page, then what was done to the tile', () => {
    const line = describeReviewChange(
      edit({
        subject: { area: 'link', linkId: 'l1', change: 'updated' },
        previousText: 'Dinner menu',
        newText: 'Olive Terrace menu',
      }),
      0,
    )

    expect(text(line)).toEqual({
      headline: 'Linktree · renamed ‘Dinner menu’ to ‘Olive Terrace menu’',
      detail: null,
    })
    expect(line).toMatchObject({
      glyph: 'linktree',
      actor: 'Georgi Ivanov',
      at: '2026-09-30T08:05:00.000Z',
      part: 'linktree',
      locale: null,
    })
  })

  it('quotes the guests’ wording before and after in the language it is in', () => {
    const line = describeReviewChange(
      edit({
        kind: 'portal_localized_override',
        subject: { area: 'welcome_text', locale: 'es' },
        previousText: 'Zona de piscina',
        newText: 'Piscina y terraza',
      }),
      1,
    )

    expect(text(line)).toEqual({
      headline: 'Welcome · reworded the Spanish welcome line',
      detail: '‘Zona de piscina’ → ‘Piscina y terraza’',
    })
    expect(line).toMatchObject({ glyph: 'text', part: 'welcome', locale: 'es' })
    expect(line.detail?.some((piece) => piece.lang === 'es')).toBe(true)
  })

  it('says a change belongs to every portal of the property when it does', () => {
    const line = describeReviewChange(
      edit({
        kind: 'property_brand_profile',
        propertyWide: true,
        subject: { area: 'look', facet: 'accent' },
      }),
      2,
    )

    expect(text(line)).toEqual({
      headline: 'Look · changed the accent colour',
      detail: 'for every portal of this property',
    })
    expect(line).toMatchObject({ glyph: 'look', part: 'top' })
  })

  it('names nobody when the system made the change, and "Someone" for a person the directory cannot name', () => {
    const subject = { area: 'link_section_switch' } as const
    expect(describeReviewChange(edit({ subject, actor: null }), 0).actor).toBeNull()
    expect(
      describeReviewChange(
        edit({ subject, actor: { userId: 'u9', displayName: null } }),
        0,
      ).actor,
    ).toBe('Someone')
  })

  it('counts saves of one part', () => {
    const line = describeReviewChange(
      edit({
        kind: 'portal_configuration',
        subject: { area: 'page_settings', field: 'name' },
        previousText: 'Pool',
        newText: 'Pool & Terrace',
        editCount: 3,
      }),
      0,
    )

    expect(text(line).detail).toBe('‘Pool’ → ‘Pool & Terrace’ · 3 saves')
    expect(line).toMatchObject({ glyph: 'settings', part: 'top' })
  })

  it('keys each line by its place in the list', () => {
    const subject = { area: 'links' } as const
    expect(describeReviewChange(edit({ subject }), 0).id).not.toBe(
      describeReviewChange(edit({ subject }), 1).id,
    )
  })
})

describe('describeReviewChange: changes the ledger has no row for', () => {
  it('lists a recorded kind with the person and no wording', () => {
    const line = describeReviewChange(
      {
        type: 'unrecorded',
        kind: 'portal_links',
        actor: { userId: 'u1', displayName: 'Elena Petrova' },
        occurredAt: '2026-09-30T07:00:00.000Z',
      },
      0,
    )

    expect(text(line)).toEqual({ headline: 'Linktree · changed', detail: null })
    expect(line).toMatchObject({ actor: 'Elena Petrova', part: 'linktree' })
  })

  it('names each kind of change the fence can record', () => {
    const headline = (
      kind: Extract<PortalReviewChange, { type: 'unrecorded' }>['kind'],
    ) =>
      phraseText(
        describeReviewChange(
          {
            type: 'unrecorded',
            kind,
            actor: null,
            occurredAt: '2026-09-30T07:00:00.000Z',
          },
          0,
        ).headline,
      )

    expect(headline('portal_configuration')).toBe('Page settings · changed')
    expect(headline('property_brand_profile')).toBe('Look · changed')
    expect(headline('property_brand_content')).toBe('Welcome · changed')
    expect(headline('portal_localized_override')).toBe('Page wording · changed')
    expect(headline('approved_destination')).toBe('Linktree · changed')
  })
})

describe('describeReviewChange: reasons the live page differs', () => {
  it('explains that publishing moves guests off the earlier design', () => {
    const line = describeReviewChange({ type: 'earlier_design' }, 0)

    expect(text(line)).toEqual({
      headline: 'The live page is the earlier design',
      detail: 'Publishing moves guests to the new design.',
    })
    expect(line).toMatchObject({ glyph: 'page', actor: null, at: null, part: null })
  })

  it('explains that publishing fixes a Google address the property has left', () => {
    expect(text(describeReviewChange({ type: 'google_destination_moved' }, 0))).toEqual({
      headline: 'The Google address changed',
      detail:
        'The live page still sends guests to the old address. Publishing updates it.',
    })
  })

  it('says so when changes exist that cannot be named, rather than claiming none', () => {
    expect(text(describeReviewChange({ type: 'unlisted' }, 0))).toEqual({
      headline: 'Other changes to the page',
      detail: 'The draft differs from the live page in ways this list cannot name.',
    })
  })

  it('says when saved changes leave the page reading the same', () => {
    expect(text(describeReviewChange({ type: 'no_visible_change' }, 0))).toEqual({
      headline: 'Nothing guests would notice',
      detail: 'Changes were saved, but the page reads the same as the live version.',
    })
  })
})
