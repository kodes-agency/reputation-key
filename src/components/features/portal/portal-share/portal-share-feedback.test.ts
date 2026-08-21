// Share-tab feedback rules from portal-share-state.ts: what the error banner
// reports while three mutations share it, and what the sr-only live region says.
//
// The tab drives issue, rotate and revoke through one banner and one live
// region, so both rules are about precedence between simultaneous truths —
// which failure is named, and whether an in-flight change or a finished copy is
// announced. (Split from portal-share-state.test.ts to stay inside the 200-line
// limit that eslint applies to everything under src/components.)

import { describe, it, expect } from 'vitest'
import { liveStatusMessage, resolveMutationState } from './portal-share-state'
import type { PortalShareMutations } from './portal-share-types'

type MutationFlags = Readonly<{ error?: unknown; isPending?: boolean }>

function stubMutations(
  issue: MutationFlags = {},
  rotate: MutationFlags = {},
  revoke: MutationFlags = {},
): PortalShareMutations {
  const stub = (flags: MutationFlags) =>
    Object.assign(
      async () => {
        throw new Error('the Share-tab rules must not invoke a mutation')
      },
      {
        error: flags.error ?? null,
        isPending: flags.isPending ?? false,
        isSuccess: false,
        data: null,
      },
    )

  return {
    issueMutation: stub(issue),
    rotateMutation: stub(rotate),
    revokeMutation: stub(revoke),
  }
}

describe('resolveMutationState', () => {
  it('reports the first failure in issue → rotate → revoke order', () => {
    // One banner, three mutations: the order has to be fixed or the banner
    // attributes a failure to whichever mutation happened to be checked first.
    const issueFirst = resolveMutationState(
      stubMutations({ error: new Error('issue') }, { error: new Error('rotate') }),
    )
    expect((issueFirst.error as Error).message).toBe('issue')

    const rotateBeatsRevoke = resolveMutationState(
      stubMutations({}, { error: new Error('rotate') }, { error: new Error('revoke') }),
    )
    expect((rotateBeatsRevoke.error as Error).message).toBe('rotate')
  })

  it('falls through the mutations that did not fail', () => {
    const onlyRevoke = resolveMutationState(
      stubMutations({}, {}, { error: new Error('revoke') }),
    )
    expect((onlyRevoke.error as Error).message).toBe('revoke')
    expect(resolveMutationState(stubMutations()).error).toBeNull()
  })

  it('treats any one pending mutation as the whole tab being busy', () => {
    // The pending flag disables every control, so a revoke in flight must lock
    // the issue form too — not only the mutation that owns the button.
    expect(resolveMutationState(stubMutations({ isPending: true })).isPending).toBe(true)
    expect(resolveMutationState(stubMutations({}, { isPending: true })).isPending).toBe(
      true,
    )
    expect(
      resolveMutationState(stubMutations({}, {}, { isPending: true })).isPending,
    ).toBe(true)
    expect(resolveMutationState(stubMutations()).isPending).toBe(false)
  })
})

describe('liveStatusMessage', () => {
  it('announces the in-flight change over a stale copy confirmation', () => {
    // Copy-then-rotate leaves `copied` true while the rotate runs; announcing
    // "copied" then would tell a screen reader the clipboard holds a link that
    // is being replaced.
    expect(liveStatusMessage(true, true)).toBe('Updating the portal public link')
    expect(liveStatusMessage(true, false)).toBe('Updating the portal public link')
  })

  it('confirms a copy only while nothing else is happening, and is otherwise silent', () => {
    expect(liveStatusMessage(false, true)).toBe('Portal link copied')
    // Empty keeps the live region from re-announcing on every unrelated render.
    expect(liveStatusMessage(false, false)).toBe('')
  })
})
