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
  describe('with an AI update leading the modal', () => {
    const leading = { hasLeadingItem: true }
    it('shows only what is unseen, so an AI update alone is not padded with old entries', () => {
      expect(selectModalUpdates({ ...view, unseenIds: [] }, leading)).toEqual({
        highlights: [],
        fixes: [],
      })
    })
    it('still shows the unseen highlights and fixes beneath it', () => {
      const unseen = [PRODUCT_UPDATES[1]!.id, PRODUCT_UPDATES[4]!.id]
      const result = selectModalUpdates({ ...view, unseenIds: unseen }, leading)
      expect(result.highlights.map(({ id }) => id)).toEqual([PRODUCT_UPDATES[1]!.id])
      expect(result.fixes.map(({ id }) => id)).toEqual([PRODUCT_UPDATES[4]!.id])
    })
  })
  it('groups history newest first without losing earlier entries', () => {
    const previous = { ...PRODUCT_UPDATES[0]!, id: 'previous', publishedOn: '2026-09-01' }
    const october = PRODUCT_UPDATES.filter(({ publishedOn }) =>
      publishedOn.startsWith('2026-10'),
    )
    const groups = updatesByMonth([previous, ...october])
    expect(groups.map(([month]) => month)).toEqual(['2026-10', '2026-09'])
    expect(groups[1]?.[1]).toEqual([previous])
  })
})
