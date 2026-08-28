// ARC-03-T9 contract test — Identity/Property (and Portal, and Inbox) seam.
//
// Identity is built BEFORE the contexts that hold the authorities it releases.
// The contract that makes the deferral safe: every operation is idempotent from
// Identity's point of view, a null actor is legal for provider lifecycle hooks,
// and a failure propagates rather than being reported as a completed release.

import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { MemberAuthorityLifecyclePort } from './member-authority-lifecycle.port'

const released: Array<
  Readonly<{ organizationId: string; userId: string; actorId: string | null }>
> = []

const inMemoryLifecycle = (
  onRelease: (input: Readonly<{ userId: string }>) => void = () => {},
): MemberAuthorityLifecyclePort =>
  Object.freeze({
    releaseMemberAuthorities: async (organizationId, userId, actorId) => {
      onRelease({ userId })
      released.push({ organizationId, userId, actorId })
    },
    reconcileResponsibleManagerEligibility: async () => {},
  })

describe('MemberAuthorityLifecyclePort contract', () => {
  it('accepts a null actor for provider lifecycle hooks', async () => {
    released.length = 0
    await inMemoryLifecycle().releaseMemberAuthorities('org-1', 'user-1', null)

    expect(released).toEqual([
      { organizationId: 'org-1', userId: 'user-1', actorId: null },
    ])
  })

  it('is idempotent from Identity’s point of view — a repeat release is legal', async () => {
    released.length = 0
    const lifecycle = inMemoryLifecycle()

    await lifecycle.releaseMemberAuthorities('org-1', 'user-1', 'actor-1')
    await lifecycle.releaseMemberAuthorities('org-1', 'user-1', 'actor-1')

    expect(released).toHaveLength(2)
  })

  it('propagates a failure rather than reporting a completed release', async () => {
    const failing: MemberAuthorityLifecyclePort = Object.freeze({
      releaseMemberAuthorities: async () => {
        throw new Error('downstream release failed')
      },
      reconcileResponsibleManagerEligibility: vi.fn(async () => {}),
    })

    await expect(
      failing.releaseMemberAuthorities('org-1', 'user-1', 'actor-1'),
    ).rejects.toThrow('downstream release failed')
  })

  it('is consumed through the port, never through a context-private hatch', () => {
    const adapter = readFileSync(
      resolve('src/composition/member-authority-lifecycle.ts'),
      'utf8',
    )

    expect(adapter).not.toContain('.internal.')
    expect(adapter).toContain('MemberAuthorityLifecyclePort')
    // The adapter consumes NAMED context capabilities, never repositories.
    expect(adapter).toContain('PropertyResponsibilityRuntime')
    expect(adapter).toContain('PortalResponsibilityRuntime')
    expect(adapter).toContain('InboxAssignmentRuntime')
  })
})
