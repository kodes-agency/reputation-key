// Which inline form is allowed to render the shared mutation's error.
//
// Every inline add/edit form in the link tree reads ONE mutation object, and
// `useActionMutation` has no `reset()`, so a failed "add link under category A"
// stayed on the mutation and rendered under category B's untouched inputs —
// blaming a form the user never submitted. The hook now remembers which form
// fired, and this is the rule that turns that memory into per-form visibility.

import { describe, it, expect } from 'vitest'
import { categoryRowSlots, scopedError, type ErrorScope } from './link-tree-state-rules'
import type { LinkTreeCategory, LinkTreeLink } from './link-tree-types'

const ALL_SCOPES: readonly ErrorScope[] = [
  'create-category',
  'create-link',
  'update-category',
  'update-link',
]

describe('scopedError', () => {
  it('shows the failure only in the form that caused it', () => {
    const failure = new Error('A link with that title already exists')

    for (const active of ALL_SCOPES) {
      for (const scope of ALL_SCOPES) {
        expect(scopedError(active, scope, failure), `${active} → ${scope}`).toBe(
          active === scope ? failure : null,
        )
      }
    }
  })

  it('silences every form once no form owns the error', () => {
    // The hook clears the scope whenever a form opens, cancels or succeeds; from
    // then on the stale mutation error must reach nobody.
    const failure = new Error('Failed to update category')

    for (const scope of ALL_SCOPES) {
      expect(scopedError(null, scope, failure), scope).toBeNull()
    }
  })

  it('hands back the error itself, not a description of it', () => {
    // The forms re-derive their own message from this value, so it must arrive
    // unwrapped — the identity check is what keeps that contract.
    const failure = { code: 'CONFLICT' } as const
    expect(scopedError('create-link', 'create-link', failure)).toBe(failure)
  })
})

// What a single category row shows, derived from tree-wide editing state.
//
// The editing ids are tree-wide while the rows are per-category, so the only
// thing stopping every row from opening the same edit form is this rule's
// ownership check.
describe('categoryRowSlots', () => {
  const work: LinkTreeCategory = { id: 'cat-work', title: 'Work', sortKey: 'a' }
  const play: LinkTreeCategory = { id: 'cat-play', title: 'Play', sortKey: 'b' }

  const link = (id: string, categoryId: string, sortKey: string): LinkTreeLink => ({
    id,
    label: id,
    url: `https://example.com/${id}`,
    sortKey,
    categoryId,
  })

  // Deliberately interleaved by category so a partition that leaked, or one
  // that sorted, would show up.
  const links = [
    link('link-1', work.id, 'a'),
    link('link-2', play.id, 'a'),
    link('link-3', work.id, 'b'),
  ]

  const editable = { editingCategory: null, editingLink: null, canEdit: true }

  it('gives a row its own links, in the order they arrived', () => {
    expect(categoryRowSlots(work, links, editable).links.map((l) => l.id)).toEqual([
      'link-1',
      'link-3',
    ])
    expect(categoryRowSlots(play, links, editable).links.map((l) => l.id)).toEqual([
      'link-2',
    ])
  })

  it('opens the link form only under the category that owns the link', () => {
    // `link-2` is Play's. Work renders the same tree-wide `editingLink` and
    // must not claim it — the negative half is the discriminating one.
    const editing = { ...editable, editingLink: 'link-2' }

    expect(categoryRowSlots(play, links, editing).linkBeingEdited?.id).toBe('link-2')
    expect(categoryRowSlots(work, links, editing).linkBeingEdited).toBeUndefined()
  })

  it('opens the title form only on the category being renamed', () => {
    const editing = { ...editable, editingCategory: work.id }

    expect(categoryRowSlots(work, links, editing).isEditingTitle).toBe(true)
    expect(categoryRowSlots(play, links, editing).isEditingTitle).toBe(false)
  })

  it('opens nothing while no row is being edited', () => {
    // The null ids must not degenerate into "matches the first link": a falsy
    // comparison here would open a form nobody asked for.
    const slots = categoryRowSlots(work, links, editable)

    expect(slots.isEditingTitle).toBe(false)
    expect(slots.linkBeingEdited).toBeUndefined()
  })

  it('withholds both forms from a viewer who cannot edit', () => {
    // The ids outlive a permission change, so they can still point at this row
    // when `portal.update` is gone — and an open form is an edit affordance.
    const slots = categoryRowSlots(work, links, {
      editingCategory: work.id,
      editingLink: 'link-1',
      canEdit: false,
    })

    expect(slots.isEditingTitle).toBe(false)
    expect(slots.linkBeingEdited).toBeUndefined()
    // The read-only row still lists its links.
    expect(slots.links.map((l) => l.id)).toEqual(['link-1', 'link-3'])
  })
})
