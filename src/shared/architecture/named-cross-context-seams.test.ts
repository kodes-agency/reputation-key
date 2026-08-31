// ARC-03-T9 — every cross-context seam is NAMED.
//
// The composition root used to express three of these seams as mutable `let`
// bindings holding throwing placeholders, reassigned hundreds of lines later,
// plus one repository reach-through issued before the owning context existed.
// A build-order cycle hidden in a mutable variable is not a seam: nothing
// declares it, nothing tests it, and nothing stops the next one.
//
// SEAM_AUTHORITY is executable: a new cross-context seam that skips a port
// module or its contract test fails here, so it cannot be added undocumented.

import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

type Seam = Readonly<{
  /** "<consumer>/<provider>" in the program's vocabulary. */
  name: string
  /** The context that OWNS the contract (declares what it needs). */
  owner: string
  /** Port module, relative to src/contexts/<owner>/application/ports/. */
  port: string
  /** Modules that consume the port. They must speak the port, never `.internal.`. */
  consumers: readonly string[]
}>

export const SEAM_AUTHORITY: readonly Seam[] = [
  {
    name: 'Staff/Portal',
    owner: 'staff',
    port: 'portal-lookup.port.ts',
    consumers: [
      'src/contexts/staff/application/use-cases/list-staff-portals.ts',
      'src/contexts/staff/application/use-cases/update-staff-portals.ts',
    ],
  },
  {
    name: 'Identity/Property',
    owner: 'identity',
    port: 'member-authority-lifecycle.port.ts',
    consumers: ['src/composition/member-authority-lifecycle.ts'],
  },
  {
    name: 'Identity/Integration',
    owner: 'integration',
    port: 'google-connector-departure.port.ts',
    consumers: ['src/contexts/identity/application/use-cases/remove-member.ts'],
  },
  {
    name: 'Property/Integration',
    owner: 'integration',
    port: 'property-lookup.port.ts',
    consumers: ['src/contexts/integration/build.ts'],
  },
  {
    name: 'Integration/Review',
    owner: 'review',
    port: 'google-review-api.port.ts',
    consumers: ['src/contexts/review/build.ts'],
  },
] as const

const portPath = (seam: Seam): string =>
  `src/contexts/${seam.owner}/application/ports/${seam.port}`

/**
 * The port's colocated contract test. The repository's filename standard
 * requires a test to MIRROR its source (`x.port.ts` -> `x.port.test.ts`), so the
 * contract test uses that name rather than a `.contract.` infix; adding four
 * accepted exceptions to the digest-pinned filename register to gain a suffix
 * would weaken a governance control for no behavioural benefit.
 */
const contractTestPath = (seam: Seam): string =>
  portPath(seam).replace(/\.port\.ts$/u, '.port.test.ts')

const read = (path: string): string => readFileSync(resolve(path), 'utf8')

describe('named cross-context seams (ARC-03-T9)', () => {
  const composition = () => read('src/composition.ts')

  it('has no late-bound build-order cycle left in the root', () => {
    const source = composition()

    expect(source).not.toContain('let releaseMemberAuthorities')
    expect(source).not.toContain('let reconcileResponsibleManagerEligibility')
    expect(source).not.toContain('portal.internal.repos.portalRepo')
  })

  it('names the seam instead, through an Identity-owned port', () => {
    const source = composition()

    expect(source).toContain('createDeferredMemberAuthorityLifecycle()')
    expect(source).toContain('memberAuthorityLifecycle.port.releaseMemberAuthorities')
    expect(source).toContain('memberAuthorityLifecycle.provide(')
    expect(source).toContain('createMemberAuthorityLifecycle({')
  })

  it('satisfies the Staff/Portal seam from a typed StaffPortalLookupPort', () => {
    const source = composition()

    expect(source).toContain('satisfies StaffPortalLookupPort')
    expect(source).toContain(
      "import type { StaffPortalLookupPort } from '#/contexts/staff/application/ports/portal-lookup.port'",
    )
    expect(source).toContain('portal.publicApi.portal.listPortalIdsByProperty')
  })

  it('detects a seam whose port module is missing', () => {
    expect(
      existsSync(resolve('src/contexts/staff/application/ports/absent.port.ts')),
    ).toBe(false)
  })

  it.each(SEAM_AUTHORITY.map((seam) => [seam.name, seam] as const))(
    'the %s seam has an owned port module and a colocated contract test',
    (_name, seam) => {
      expect(existsSync(resolve(portPath(seam))), portPath(seam)).toBe(true)
      expect(existsSync(resolve(contractTestPath(seam))), contractTestPath(seam)).toBe(
        true,
      )
    },
  )

  it.each(SEAM_AUTHORITY.map((seam) => [seam.name, seam] as const))(
    'the %s seam consumers speak the port, not a context-private hatch',
    (_name, seam) => {
      for (const consumer of seam.consumers) {
        expect(existsSync(resolve(consumer)), consumer).toBe(true)
        expect(read(consumer), consumer).not.toContain('.internal.')
      }
    },
  )
})
