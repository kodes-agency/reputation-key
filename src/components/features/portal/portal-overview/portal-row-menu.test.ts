import { describe, expect, it } from 'vitest'
import { NO_CODE, overviewRow } from './portal-overview-fixtures'
import { portalRowMenu, type PortalRowAccess } from './portal-row-menu'

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

  it('marks disabling and archiving as the destructive choices', () => {
    const items = portalRowMenu(overviewRow('a'), manager)
    expect(items.find((item) => item.id === 'disable')?.destructive).toBe(true)
    expect(items.find((item) => item.id === 'archive')?.destructive).toBe(true)
    expect(items.find((item) => item.id === 'results')?.destructive).toBe(false)
  })
})
