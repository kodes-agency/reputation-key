// Client-side capability hook — reads the capability set resolved in the
// `_authenticated` route context and exposes has().
//
// Capabilities are NOT permissions. Permissions are role-based ("may this role
// do X?") and stay in usePermissions(); capabilities are feature-gate-based
// ("is this feature on for this org/property?") — see the header of
// `#/shared/auth/beta-capabilities`. The two concepts must not be merged.
//
// Navigation visibility is not a security boundary (same note as
// `controlled-route-gate.ts`): this hook only prevents dead ends. Every route
// gate and every server function still asserts the capability itself.

import { useRouteContext } from '@tanstack/react-router'
import type { Capability } from '#/shared/auth/beta-capabilities'
import type { CapabilitySet } from '#/shared/auth/capability-set'

type RouteCtx = { capabilities: CapabilitySet | undefined }

export type Capabilities = Readonly<{
  has: (capability: Capability) => boolean
  /** Allowed capabilities for the property in scope; empty when unresolved. */
  all: ReadonlyArray<Capability>
}>

export function useCapabilities(): Capabilities {
  // Cast to minimal shape — avoids importing AuthRouteContext from the routes
  // layer, mirroring usePermissions.
  const { capabilities } = useRouteContext({ from: '/_authenticated' }) as RouteCtx

  // Fail OPEN when no set was resolved at all (Storybook decorators, unit
  // harnesses). An affordance that vanishes because resolution is missing is a
  // worse bug than one that is shown and then refused by the gate — and the
  // gate is the boundary. Once a set exists, absence of a capability means off.
  const resolved = capabilities?.allowed
  return {
    has: (capability: Capability) =>
      resolved === undefined || resolved.includes(capability),
    all: resolved ?? [],
  }
}
