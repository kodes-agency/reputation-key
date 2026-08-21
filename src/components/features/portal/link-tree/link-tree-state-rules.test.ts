// Which inline form is allowed to render the shared mutation's error.
//
// Every inline add/edit form in the link tree reads ONE mutation object, and
// `useActionMutation` has no `reset()`, so a failed "add link under category A"
// stayed on the mutation and rendered under category B's untouched inputs —
// blaming a form the user never submitted. The hook now remembers which form
// fired, and this is the rule that turns that memory into per-form visibility.

import { describe, it, expect } from 'vitest'
import { scopedError, type ErrorScope } from './link-tree-state-rules'

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
