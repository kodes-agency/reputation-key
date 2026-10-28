// The controlled-route gate a route's `beforeLoad` awaits (ADR 0049, ADR 0072).
//
// The server render always asks `checkControlledRoute`. The browser remembers each
// decision for 30 seconds under the signed-in person, the capability and the
// Property, so going back to a page soon after it was checked asks nothing. It is a
// decision of its own, not read from the shell's capability set: that set is resolved
// for the Property in the address (a `?propertyId=` too, which an Organization-wide
// page like Portals carries without being scoped to it), and it falls back to the
// empty set when its read fails, which here would refuse a page the gate would have
// opened. The boundary is still each page's server functions, which assert the
// capability on every call.
//
// Here rather than in `shared/auth` because it joins the auth gate to the browser's
// Query cache, and `shared/auth` stays free of the cache modules.

import type { QueryClient } from '@tanstack/react-query'
import {
  checkControlledRoute,
  type ControlledRouteInput,
} from '#/shared/auth/controlled-route-check'
import { denyControlledRoute } from '#/shared/auth/controlled-route-gate'
import type { CapabilityDecision } from '#/shared/auth/beta-capabilities'
import { shellCheckSide, shellContextKeys } from '#/shared/queries/shell-context-cache'
import { fetchRemembered } from './fetch-remembered'

type ControlledRouteGateContext = Readonly<{
  queryClient: QueryClient
  user: Readonly<{ id: string }>
}>

function controlledRouteDecision(
  data: ControlledRouteInput,
  context: ControlledRouteGateContext,
): Promise<CapabilityDecision> {
  if (shellCheckSide() === 'server') return checkControlledRoute({ data })
  // Keyed by what decides the answer: the person, the capability and the Property.
  // The label only names the feature in the notice, so it is not part of the key.
  return fetchRemembered(
    context.queryClient,
    shellContextKeys.routeGate(context.user.id, data.capability, data.propertyId ?? null),
    () => checkControlledRoute({ data }),
  )
}

/**
 * Keep the server function transport plain-data-only. Client-side navigation
 * cannot deserialize a router transition thrown inside a server function
 * reliably; throw it here, on the same side that owns the router transition.
 */
export async function gateControlledRoute(
  input: Readonly<{
    data: ControlledRouteInput
    /** The route's context: the router's QueryClient and the shell's signed-in person. */
    context: ControlledRouteGateContext
  }>,
): Promise<void> {
  const decision = await controlledRouteDecision(input.data, input.context)
  denyControlledRoute(decision, input.data)
}
