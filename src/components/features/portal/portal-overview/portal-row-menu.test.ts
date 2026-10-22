import { describe, expect, it } from 'vitest'
import { NO_CODE, overviewRow } from './portal-overview-fixtures'
import { portalRowButtons, portalRowMenu, type PortalRowAccess } from './portal-row-menu'

const manager: PortalRowAccess = {
  canUpdate: true,
  canArchive: true,
  portalWriteEnabled: true,
}

const ids = (row: Parameters<typeof portalRowMenu>[0], access = manager) =>
  portalRowMenu(row, access).map((item) => item.id)

describe('portalRowMenu', () => {
  it('offers results and history for a live Portal, then disabling and archiving', () => {
    expect(ids(overviewRow('a'))).toEqual(['results', 'history', 'disable', 'archive'])
  })

  it('offers review only when something is waiting to go live', () => {
    expect(ids(overviewRow('a', { pendingChangeCount: 2 }))).toEqual([
      'results',
      'history',
      'review',
      'disable',
      'archive',
    ])
  })

  it('offers review to bring a disabled Portal back, and nothing to disable', () => {
    expect(ids(overviewRow('a', { publicationState: 'disabled' }))).toEqual([
      'results',
      'history',
      'review',
      'archive',
    ])
  })

  it('has no results to open for a draft, and offers review to finish it', () => {
    expect(ids(overviewRow('a', { publicationState: 'draft', token: NO_CODE }))).toEqual([
      'history',
      'review',
      'archive',
    ])
  })

  it('offers restore, not archive, for an archived Portal', () => {
    expect(ids(overviewRow('a', { publicationState: 'archived' }))).toEqual([
      'results',
      'history',
      'restore',
    ])
  })

  it('never offers review on an archived Portal', () => {
    expect(
      ids(overviewRow('a', { publicationState: 'archived', pendingChangeCount: 1 })),
    ).not.toContain('review')
  })

  it('keeps off what the role or the organisation cannot do', () => {
    const row = overviewRow('a', { pendingChangeCount: 1 })
    expect(ids(row, { ...manager, canUpdate: false })).toEqual([
      'results',
      'history',
      'archive',
    ])
    expect(ids(row, { ...manager, portalWriteEnabled: false })).toEqual([
      'results',
      'history',
    ])
    expect(ids(row, { ...manager, canArchive: false })).toEqual([
      'results',
      'history',
      'review',
      'disable',
    ])
    expect(
      ids(overviewRow('a', { publicationState: 'archived' }), {
        ...manager,
        canUpdate: false,
      }),
    ).toEqual(['results', 'history'])
    expect(
      ids(overviewRow('a', { publicationState: 'archived' }), {
        ...manager,
        portalWriteEnabled: false,
      }),
    ).toEqual(['results', 'history'])
  })

  it('offers disabling and archiving as neutral entries: both are undone', () => {
    const items = portalRowMenu(overviewRow('a'), manager)
    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining(['disable', 'archive']),
    )
    expect(items.some((item) => 'destructive' in item)).toBe(false)
  })
})

describe('portalRowButtons', () => {
  it('offers Edit and Share for a live Portal', () => {
    expect(portalRowButtons(overviewRow('a'), true)).toEqual({
      verb: 'Edit',
      canShare: true,
    })
  })

  it('offers Share for a draft: it needs a code before it can be published, and Share is where one is made', () => {
    expect(
      portalRowButtons(overviewRow('a', { publicationState: 'draft' }), true),
    ).toEqual({
      verb: 'Edit',
      canShare: true,
    })
  })

  it('offers Share for a Portal that was turned off, whose printed codes work again when it is published', () => {
    expect(
      portalRowButtons(overviewRow('a', { publicationState: 'disabled' }), true).canShare,
    ).toBe(true)
  })

  it('says View for an archived Portal, whose page opens read-only, and offers no Share', () => {
    expect(
      portalRowButtons(overviewRow('a', { publicationState: 'archived' }), true),
    ).toEqual({ verb: 'View', canShare: false })
  })

  it('says View to someone who cannot change portals, but still offers Share', () => {
    expect(portalRowButtons(overviewRow('a'), false)).toEqual({
      verb: 'View',
      canShare: true,
    })
  })
})
