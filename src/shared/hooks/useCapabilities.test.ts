// The contract worth pinning here is the FAIL-OPEN decision, not the lookup.
//
// `useCapabilities` deliberately returns true for every capability when no set
// resolved at all, on the reasoning recorded in the module: an affordance that
// vanishes because resolution is missing is a worse bug than one that is shown
// and then refused by the real gate. That is a defensible call precisely
// BECAUSE navigation visibility is not a security boundary — but it is only
// safe while the second half holds: once a set exists, absence means off.
//
// If someone ever "hardens" this by failing open on an EMPTY set too, every
// capability in the product silently turns on for every tenant whose set
// resolved to none, and no route gate change would be needed to cause it. So
// the empty-set case is the load-bearing test in this file.

import { describe, it, expect, vi } from 'vitest'
import type { Capability } from '#/shared/auth/beta-capabilities'

const routeContext = vi.hoisted(() => ({ value: undefined as unknown }))

vi.mock('@tanstack/react-router', () => ({
  useRouteContext: () => routeContext.value,
}))

// Static, not `await import(...)`: `vi.mock` is hoisted above imports by the
// transform, so the mock is in place either way — but the changed-code gate
// only counts a STATIC runtime import as contract evidence, and a dynamic one
// leaves this module reading as untested.
import { useCapabilities } from './useCapabilities'

const cap = (name: string) => name as Capability

describe('useCapabilities', () => {
  it('fails OPEN when no capability set resolved at all', () => {
    // Storybook decorators and unit harnesses reach the hook with no set.
    routeContext.value = { capabilities: undefined }
    const { has, all } = useCapabilities()

    expect(has(cap('portal.guest_media'))).toBe(true)
    expect(has(cap('anything.at.all'))).toBe(true)
    // …but it must not invent a list to go with the permissive answer.
    expect(all).toEqual([])
  })

  it('fails CLOSED for an unlisted capability once a set exists', () => {
    routeContext.value = { capabilities: { allowed: [cap('portal.publish')] } }
    const { has } = useCapabilities()

    expect(has(cap('portal.publish'))).toBe(true)
    expect(has(cap('portal.guest_media'))).toBe(false)
  })

  it('treats a RESOLVED EMPTY set as everything-off, not as unresolved', () => {
    // The whole safety of the fail-open branch rests on this distinction.
    // `[]` is a real answer — this tenant holds nothing — and must deny.
    routeContext.value = { capabilities: { allowed: [] } }
    const { has, all } = useCapabilities()

    expect(has(cap('portal.publish'))).toBe(false)
    expect(all).toEqual([])
  })

  it('exposes the resolved set as `all`', () => {
    const allowed = [cap('portal.publish'), cap('team.manage')]
    routeContext.value = { capabilities: { allowed } }

    expect(useCapabilities().all).toEqual(allowed)
  })
})
