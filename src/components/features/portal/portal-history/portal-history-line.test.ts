import { describe, expect, it } from 'vitest'
import type {
  PortalHistoryDetail,
  PortalHistoryEntry,
} from '#/contexts/portal/application/public-api'
import { phraseText, plain, type Phrase } from './portal-history-phrase'
import { describeHistoryEntry } from './portal-history-line'

const entry = (
  detail: PortalHistoryDetail,
  actor: PortalHistoryEntry['actor'] = { userId: 'u1', displayName: 'Elena Petrova' },
): PortalHistoryEntry => ({
  key: 'key',
  category: 'edits',
  occurredAt: '2026-09-30T08:05:00.000Z',
  actor,
  detail,
})

const line = (
  detail: PortalHistoryDetail,
  actor?: PortalHistoryEntry['actor'],
  versionSummary: Phrase | null = null,
) => {
  const described = describeHistoryEntry(entry(detail, actor), {
    portalName: 'Pool & Terrace',
    versionSummary,
  })
  return {
    ...described,
    action: phraseText(described.action),
    detail: described.detail === null ? null : phraseText(described.detail),
  }
}

const edited = (
  subject: Extract<PortalHistoryDetail, { kind: 'page_edited' }>['subject'],
  over: Partial<Extract<PortalHistoryDetail, { kind: 'page_edited' }>> = {},
): PortalHistoryDetail => ({
  kind: 'page_edited',
  subject,
  propertyWide: false,
  previousText: null,
  newText: null,
  editCount: 1,
  ...over,
})

describe('describeHistoryEntry: publishing', () => {
  it('says who published a version and what it added', () => {
    expect(
      line({ kind: 'version_published', version: 5 }, undefined, [
        plain('added Deutsch'),
      ]),
    ).toMatchObject({
      glyph: 'published',
      actor: 'Elena Petrova',
      action: 'published version 5',
      detail: 'added Deutsch',
    })
  })

  it('says who made a version live again', () => {
    expect(line({ kind: 'version_restored', version: 4 })).toMatchObject({
      glyph: 'restored',
      action: 'made version 4 live again',
      detail: null,
    })
  })

  it('names a publisher the directory cannot name as someone', () => {
    expect(
      line(
        { kind: 'version_published', version: 2 },
        { userId: 'u9', displayName: null },
      ),
    ).toMatchObject({ actor: 'Someone' })
  })

  it('says who created the portal, or that it was created when nobody is recorded', () => {
    expect(line({ kind: 'portal_created' })).toMatchObject({
      glyph: 'created',
      actor: 'Elena Petrova',
      action: 'created Pool & Terrace',
    })
    expect(line({ kind: 'portal_created' }, null)).toMatchObject({
      actor: null,
      action: 'Pool & Terrace was created',
    })
  })
})

describe('describeHistoryEntry: page edits', () => {
  it('quotes the wording before and after in the guests language', () => {
    const described = describeHistoryEntry(
      entry(
        edited(
          { area: 'portal_text', locale: 'es' },
          { previousText: 'Zona de piscina', newText: 'Piscina y terraza' },
        ),
      ),
      { portalName: 'P', versionSummary: null },
    )

    expect(phraseText(described.action)).toBe('reworded the Spanish wording of the page')
    expect(phraseText(described.detail ?? [])).toBe(
      '‘Zona de piscina’ → ‘Piscina y terraza’',
    )
    expect(described.detail?.[0]).toMatchObject({ lang: 'es' })
  })

  it('names the welcome line of a language', () => {
    expect(line(edited({ area: 'welcome_text', locale: 'es' }))).toMatchObject({
      action: 'reworded the Spanish welcome line',
    })
    expect(line(edited({ area: 'welcome_text', locale: null }))).toMatchObject({
      action: 'reworded the welcome line',
    })
  })

  it('names a renamed tile by its old and new name', () => {
    expect(
      line(
        edited(
          { area: 'link', linkId: 'l1', change: 'updated' },
          { previousText: 'Dinner menu', newText: 'Olive Terrace menu' },
        ),
        { userId: 'u2', displayName: 'Georgi Ivanov' },
      ),
    ).toMatchObject({
      actor: 'Georgi Ivanov',
      action: 'renamed ‘Dinner menu’ to ‘Olive Terrace menu’',
      detail: null,
    })
  })

  it('names an added and a removed tile', () => {
    expect(
      line(
        edited(
          { area: 'link', linkId: 'l1', change: 'created' },
          { newText: 'Getting here' },
        ),
      ),
    ).toMatchObject({ action: 'added ‘Getting here’' })
    expect(
      line(
        edited(
          { area: 'link', linkId: 'l1', change: 'deleted' },
          { previousText: 'Spa' },
        ),
      ),
    ).toMatchObject({ action: 'removed ‘Spa’' })
    expect(line(edited({ area: 'link', linkId: 'l1', change: 'created' }))).toMatchObject(
      {
        action: 'added a tile',
      },
    )
  })

  it('says a tile was reworded in a language, with the wording', () => {
    expect(
      line(
        edited(
          { area: 'link_text', linkId: 'l1', locale: 'bg' },
          { previousText: 'Меню', newText: 'Менюто' },
        ),
      ),
    ).toMatchObject({
      action: 'reworded a tile in Bulgarian',
      detail: '‘Меню’ → ‘Менюто’',
    })
  })

  it('names the page setting that changed', () => {
    expect(line(edited({ area: 'page_settings', field: 'hero_image' }))).toMatchObject({
      action: 'changed the hero photo',
    })
    expect(line(edited({ area: 'page_settings', field: null }))).toMatchObject({
      action: 'changed the page settings',
    })
  })

  it('names a look facet and says a property-wide change reaches every portal', () => {
    expect(
      line(edited({ area: 'look', facet: 'accent' }, { propertyWide: true })),
    ).toMatchObject({
      action: 'changed the accent colour',
      detail: 'for every portal of this property',
    })
  })

  it('counts saves that were folded into one entry', () => {
    expect(
      line(
        edited(
          { area: 'welcome_text', locale: 'en' },
          { editCount: 3, previousText: 'a', newText: 'b' },
        ),
      ),
    ).toMatchObject({ detail: '‘a’ → ‘b’ · 3 saves' })
  })

  it('attributes an edit nobody made to the system', () => {
    expect(
      line(edited({ area: 'destination', destinationId: null }), null),
    ).toMatchObject({ actor: 'The system', action: 'changed an approved destination' })
  })

  it('words every remaining part of the page', () => {
    const action = (subject: Parameters<typeof edited>[0]) => line(edited(subject)).action

    expect(action({ area: 'link_section_title', locale: 'de' })).toBe(
      'reworded the German Linktree title',
    )
    expect(action({ area: 'link_section_switch' })).toBe(
      'changed whether the Linktree shows',
    )
    expect(action({ area: 'links_reordered', categoryId: 'c' })).toBe(
      'reordered the tiles',
    )
    expect(action({ area: 'categories_reordered' })).toBe('reordered the tiles')
    expect(action({ area: 'category', categoryId: 'c', change: 'renamed' })).toBe(
      'renamed a group of links',
    )
    expect(action({ area: 'links' })).toBe('changed the links')
    expect(action({ area: 'display_name' })).toBe('renamed the property’s public name')
    expect(action({ area: 'profile' })).toBe('changed the property’s look')
  })
})

describe('describeHistoryEntry: codes', () => {
  it('words each code event, with the person when there is one', () => {
    expect(line({ kind: 'code_issued', version: 1 })).toMatchObject({
      glyph: 'code',
      action: 'made a code',
    })
    expect(line({ kind: 'code_issued', version: 1 }, null)).toMatchObject({
      actor: null,
      action: 'A code was made',
    })
    expect(line({ kind: 'codes_revoked', reason: 'Tags lost' })).toMatchObject({
      glyph: 'stopped',
      action: 'stopped all codes',
      detail: 'Tags lost',
    })
  })

  it('says until when the replaced code keeps working', () => {
    expect(
      line({
        kind: 'code_replaced',
        version: 2,
        previousCodesWorkUntil: '2026-10-14T00:00:00.000Z',
      }),
    ).toMatchObject({
      action: 'replaced the code',
      detail: 'the old one works until 14 Oct 2026',
    })
    expect(
      line({ kind: 'code_replaced', version: 2, previousCodesWorkUntil: null }),
    ).toMatchObject({ detail: 'the old one stopped working' })
  })

  it('says what a download was for', () => {
    expect(
      line({ kind: 'code_downloaded', version: 1, purpose: 'download' }),
    ).toMatchObject({
      glyph: 'download',
      action: 'downloaded the code again',
    })
    expect(line({ kind: 'code_downloaded', version: 1, purpose: 'copy' })).toMatchObject({
      glyph: 'copy',
      action: 'copied the NFC address',
    })
    expect(line({ kind: 'code_downloaded', version: 1, purpose: 'show' })).toMatchObject({
      action: 'viewed the address',
    })
  })
})

describe('describeHistoryEntry: health', () => {
  it('has no person and says back to working', () => {
    expect(
      line({ kind: 'health_changed', status: 'healthy', reason: 'operational' }, null),
    ).toMatchObject({
      glyph: 'health_ok',
      actor: null,
      action: 'Health: back to working',
    })
  })

  it('says what needs attention, or what is not available', () => {
    expect(
      line(
        {
          kind: 'health_changed',
          status: 'degraded',
          reason: 'google_destination_unavailable',
        },
        null,
      ),
    ).toMatchObject({
      glyph: 'health_warn',
      action: 'Health: needs attention',
      detail: 'the Google link is not available',
    })
    expect(
      line(
        {
          kind: 'health_changed',
          status: 'unavailable',
          reason: 'public_address_unavailable',
        },
        null,
      ),
    ).toMatchObject({ glyph: 'health_off', detail: 'it has no working code' })
  })
})
