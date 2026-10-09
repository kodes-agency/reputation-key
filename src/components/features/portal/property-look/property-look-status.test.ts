import { describe, expect, it } from 'vitest'
import {
  affectedPortals,
  describeLookStatus,
  type AffectedPortalRow,
} from './property-look-rules'

const row = (
  name: string,
  publicationState: AffectedPortalRow['publicationState'],
): AffectedPortalRow => ({
  portalId: name.toLowerCase(),
  name,
  publicationState,
  group: null,
})

describe('when the rows say what is waiting to go live', () => {
  const withPending = (counts: readonly number[]) =>
    affectedPortals(
      counts.map((count, index) => ({
        ...row(`P${index}`, 'published'),
        pendingChangeCount: count,
      })),
    )

  it('says the saved look is not live yet on the portals that still have changes waiting', () => {
    expect(
      describeLookStatus({ status: 'saved' }, withPending([2, 0, 1, 0, 0])).text,
    ).toBe('Saved as a draft · changes are waiting to go live on 2 of 5 portals')
    expect(describeLookStatus({ status: 'idle' }, withPending([1, 1, 1])).text).toBe(
      'Changes are waiting to go live on all 3 portals',
    )
    expect(describeLookStatus({ status: 'idle' }, withPending([4])).text).toBe(
      'Changes are waiting to go live on the live portal',
    )
  })

  it('says every live portal shows the look when nothing is waiting', () => {
    expect(
      describeLookStatus({ status: 'idle' }, withPending([0, 0, 0, 0, 0])).text,
    ).toBe('All 5 live portals show this look')
    expect(describeLookStatus({ status: 'idle' }, withPending([0])).text).toBe(
      'The live portal shows this look',
    )
  })

  it('counts only live portals: a draft with changes waiting is not live', () => {
    const result = affectedPortals([
      { ...row('A', 'published'), pendingChangeCount: 0 },
      { ...row('B', 'draft'), pendingChangeCount: 3 },
    ])

    expect(result.waiting).toBe(0)
  })

  it('does not guess when any live row does not say', () => {
    const result = affectedPortals([
      { ...row('A', 'published'), pendingChangeCount: 1 },
      row('B', 'published'),
    ])

    expect(result.waiting).toBeNull()
    expect(describeLookStatus({ status: 'idle' }, result).text).toBe(
      '2 live portals use this look',
    )
  })
})
