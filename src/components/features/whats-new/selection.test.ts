import { describe, expect, it } from 'vitest'
import { PRODUCT_UPDATES } from '#/shared/whats-new/entries'
import type { ProductUpdatesView } from '#/shared/whats-new/types'
import { selectModalUpdates, updatesByMonth } from './selection'

const view: ProductUpdatesView = {
  entries: PRODUCT_UPDATES,
  unseenIds: PRODUCT_UPDATES.map(({ id }) => id),
  autoShow: true,
  shouldAutoOpen: true,
}
describe('update presentation selection', () => {
  it('limits unseen highlights to three and retains every unseen fix', () => {
    const extra = { ...PRODUCT_UPDATES[0]!, id: 'extra' }
    const result = selectModalUpdates({
      ...view,
      entries: [...view.entries, extra],
      unseenIds: [...view.unseenIds, extra.id],
    })
    expect(result.highlights).toHaveLength(3)
    expect(result.fixes).toHaveLength(3)
  })
  it('prefers unseen highlights without filling spare places with seen ones', () => {
    expect(
      selectModalUpdates({ ...view, unseenIds: [PRODUCT_UPDATES[0]!.id] }).highlights.map(
        ({ id }) => id,
      ),
    ).toEqual([PRODUCT_UPDATES[0]!.id])
  })
  it('falls back to the latest highlights and a few fixes', () => {
    const result = selectModalUpdates({ ...view, unseenIds: [] })
    expect(result.highlights).toHaveLength(3)
    expect(result.fixes).toHaveLength(3)
  })
  it('groups history newest first without losing earlier entries', () => {
    const previous = { ...PRODUCT_UPDATES[0]!, id: 'previous', publishedOn: '2026-09-01' }
    const groups = updatesByMonth([previous, ...PRODUCT_UPDATES])
    expect(groups.map(([month]) => month)).toEqual(['2026-10', '2026-09'])
    expect(groups[1]?.[1]).toEqual([previous])
  })
})
