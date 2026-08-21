// Drag-and-drop ordering rules for the manager-side link tree.
//
// Every one of these rules ends in a write: whatever order they compute is both
// rendered optimistically and sent to `reorderCategories` / `reorderLinks`. A
// wrong answer is therefore not a rendering glitch — it silently persists an
// order the user never chose, and the next refetch makes it look intentional.
// That is why the guards and the key chain are pinned rather than the shapes.

import { describe, it, expect } from 'vitest'
import {
  reorderById,
  planCategoryReorder,
  planLinkReorder,
} from './link-tree-reorder-rules'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

const cat = (id: string): LinkTreeCategory => ({
  id,
  title: `Category ${id}`,
  sortKey: id,
})

const link = (id: string, categoryId: string, sortKey = id): LinkTreeLink => ({
  id,
  label: `Link ${id}`,
  url: `https://example.com/${id}`,
  sortKey,
  categoryId,
})

/** The order a reader of the persisted keys — i.e. the server — would produce. */
const ascending = (a: { sortKey: string }, b: { sortKey: string }) =>
  a.sortKey < b.sortKey ? -1 : 1

describe('reorderById', () => {
  it('moves the dragged row to the drop position, in either direction', () => {
    const rows = [cat('a'), cat('b'), cat('c'), cat('d')]

    expect(reorderById(rows, 'a', 'c')?.map((r) => r.id)).toEqual(['b', 'c', 'a', 'd'])
    expect(reorderById(rows, 'd', 'b')?.map((r) => r.id)).toEqual(['a', 'd', 'b', 'c'])
  })

  it('refuses every drop that must not be persisted', () => {
    const rows = [cat('a'), cat('b')]

    // Dropped outside every sortable: dnd-kit reports no `over`, so no id.
    expect(reorderById(rows, 'a', undefined), 'no drop target').toBeNull()
    // Picked up and put back down — a click, not a reorder.
    expect(reorderById(rows, 'a', 'a'), 'dropped on itself').toBeNull()
    // The link handles are nested inside the category DndContext, so a link drag
    // ALSO fires the category handler with an id no category owns. Either end can
    // be the foreign one, and either alone is disqualifying: guarding these with
    // `&&` let a lone -1 through, arrayMove spliced at -1, and a category the
    // user never touched was reordered and then written to the server.
    expect(reorderById(rows, 'link-1', 'b'), 'foreign active id').toBeNull()
    expect(reorderById(rows, 'a', 'link-1'), 'foreign over id').toBeNull()
  })
})

describe('planCategoryReorder', () => {
  it('persists the order just dropped, not the one dragged away from', () => {
    const plan = planCategoryReorder([cat('a'), cat('b'), cat('c')], 'c', 'a')

    expect(plan).not.toBeNull()
    const items = plan?.items ?? []
    expect(plan?.nextCategories.map((c) => c.id)).toEqual(['c', 'a', 'b'])
    // The optimistic render and the mutation payload are two views of ONE
    // decision: key i must belong to row i of the list now on screen. Keying off
    // the pre-drag list instead lines the ids up the old way, and the refetch
    // then snaps the list back to an order the user never chose.
    expect(items.map((i) => i.id)).toEqual(['c', 'a', 'b'])
    // Ascending and distinct, so the server's own sort reproduces the drop —
    // a chain of equal keys leaves the persisted order undefined.
    expect([...items].sort(ascending).map((i) => i.id)).toEqual(['c', 'a', 'b'])
    expect(new Set(items.map((i) => i.sortKey)).size).toBe(3)
  })

  it('leaves an inert drop with nothing to render and nothing to write', () => {
    // Null all the way out, rather than a plan restating the current order: the
    // latter would fire a reorder mutation on every click of a drag handle.
    expect(planCategoryReorder([cat('a'), cat('b')], 'a', 'a')).toBeNull()
  })
})

describe('planLinkReorder', () => {
  it('rewrites one category and leaves the other categories alone', () => {
    const l1 = link('l1', 'c1')
    const l2 = link('l2', 'c1')
    const l3 = link('l3', 'c2')
    const plan = planLinkReorder([l1, l2, l3], 'c1', [l2, l1])

    // The mirror is one flat array across all categories, so the slice being
    // replaced has to be selected as the exact inverse of the one appended.
    // Select the same side by mistake and c1's links appear twice while c2's
    // vanish — from the list AND from every later reorder computed off it.
    expect(plan.nextLinks.filter((l) => l.categoryId === 'c2')).toEqual([l3])
    expect(plan.nextLinks.map((l) => l.id).sort()).toEqual(['l1', 'l2', 'l3'])
  })

  it('gives the moved links keys that reproduce the drop', () => {
    const l1 = link('l1', 'c1', 'a0')
    const l2 = link('l2', 'c1', 'a1')
    const l3 = link('l3', 'c1', 'a2')
    const plan = planLinkReorder([l1, l2, l3], 'c1', [l3, l1, l2])

    expect(plan.items.map((i) => i.id)).toEqual(['l3', 'l1', 'l2'])
    expect(new Set(plan.items.map((i) => i.sortKey)).size).toBe(3)
    // Carrying the pre-drag keys through would render the drop and then undo it
    // on the next refetch, because the server sorts by what was written.
    expect([...plan.nextLinks].sort(ascending).map((l) => l.id)).toEqual([
      'l3',
      'l1',
      'l2',
    ])
    // ...and the list on screen renders in ARRAY order, not key order, so the
    // moved slice also has to be appended in the order it was dropped. Get only
    // the keys right and the drop is persisted correctly but paints wrong until
    // the refetch lands.
    expect(plan.nextLinks.filter((l) => l.categoryId === 'c1').map((l) => l.id)).toEqual([
      'l3',
      'l1',
      'l2',
    ])
  })
})
