import { describe, expect, it } from 'vitest'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import type { ProductUpdate } from '#/shared/whats-new/types'
import {
  eligibleProductUpdates,
  productUpdatesView,
  type ProductUpdateState,
} from './product-updates-policy'

const now = new Date('2026-10-31T12:00:00Z')
const state: ProductUpdateState = {
  membershipStartedAt: new Date('2026-10-01'),
  autoShow: true,
  lastAutoOpenedAt: null,
  seenIds: [],
}
// The entries published on the day these cases are written around: a later entry
// must not change what they pin.
const THAT_DAYS_ENTRIES = PRODUCT_UPDATES.filter(
  ({ publishedOn }) => publishedOn === '2026-10-31',
)
const view = (override: Partial<ProductUpdateState> = {}, entries = THAT_DAYS_ENTRIES) =>
  productUpdatesView(entries, { ...state, ...override }, now)

describe('personal product update eligibility', () => {
  it('defaults to unread for a person who was here when published', () => {
    expect(view().unseenIds).toHaveLength(6)
    expect(view().shouldAutoOpen).toBe(true)
  })
  it('gives new people history without a backlog, even on their joining day', () => {
    const result = view({ membershipStartedAt: new Date('2026-10-31T01:00:00Z') })
    expect(result.entries).toHaveLength(6)
    expect(result.unseenIds).toEqual([])
    expect(result.shouldAutoOpen).toBe(false)
  })
  it('includes the publication instant and excludes receipted entries', () => {
    expect(
      view({
        membershipStartedAt: new Date('2026-10-31'),
        seenIds: [PRODUCT_UPDATES[0]!.id],
      }).unseenIds,
    ).toHaveLength(5)
  })
  it('does not open for fixes alone or for an opt-out', () => {
    expect(
      view(
        {},
        THAT_DAYS_ENTRIES.filter(({ kind }) => kind === 'fix'),
      ).shouldAutoOpen,
    ).toBe(false)
    expect(view({ autoShow: false }).shouldAutoOpen).toBe(false)
  })
  it('requires strictly more than seven days after an automatic opening', () => {
    expect(
      view({ lastAutoOpenedAt: new Date('2026-10-24T12:00:00Z') }).shouldAutoOpen,
    ).toBe(false)
    expect(
      view({ lastAutoOpenedAt: new Date('2026-10-24T11:59:59Z') }).shouldAutoOpen,
    ).toBe(true)
  })
  it('uses the inclusive sixty-day highlight boundary', () => {
    const old: ProductUpdate = { ...PRODUCT_UPDATES[0]!, publishedOn: '2026-09-01' }
    const s = { ...state, membershipStartedAt: new Date('2026-01-01') }
    expect(productUpdatesView([old], s, new Date('2026-10-31')).shouldAutoOpen).toBe(true)
    expect(productUpdatesView([old], s, new Date('2026-11-01')).shouldAutoOpen).toBe(
      false,
    )
  })
  it('filters audience, capabilities and future publications before unseen rules', () => {
    const admin: ProductUpdate = {
      ...PRODUCT_UPDATES[1]!,
      id: 'admin',
      audience: 'account-admins',
    }
    const future: ProductUpdate = { ...admin, id: 'future', publishedOn: '2026-11-01' }
    expect(
      eligibleProductUpdates(
        [...PRODUCT_UPDATES, admin, future],
        'PropertyManager',
        () => false,
        now,
      ),
    ).toHaveLength(5)
    const eligible = eligibleProductUpdates(
      [...PRODUCT_UPDATES, admin, future],
      'AccountAdmin',
      () => true,
      now,
    )
    expect(eligible.map(({ id }) => id)).toContain('admin')
    expect(eligible.map(({ id }) => id)).not.toContain('future')
  })
})
