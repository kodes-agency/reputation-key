// Authenticated controlled-feature route preloader (ADR 0049).
//
// Navigation visibility is not a security boundary. This preloader gives
// direct navigation an intentional unavailable state while each loader and
// server function still authorizes independently against the selected
// property.

import { redirect } from '@tanstack/react-router'
import { checkControlledRoute, type ControlledRouteInput } from './controlled-route-check'

/** Convert a plain capability decision into the owning router transition. */
export function redirectDeniedControlledRoute(
  decision: Readonly<{ allowed: boolean }>,
  input: ControlledRouteInput,
): void {
  if (!decision.allowed) {
    throw redirect({
      to: '/unavailable',
      search: { feature: input.featureLabel },
    })
  }
}

/**
 * Keep the server function transport plain-data-only. Client-side navigation
 * cannot deserialize a redirect thrown inside a server function reliably;
 * throw it here, on the same side that owns the router transition.
 */
export async function gateControlledRoute(
  input: Readonly<{
    data: ControlledRouteInput
  }>,
): Promise<void> {
  const decision = await checkControlledRoute(input)
  redirectDeniedControlledRoute(decision, input.data)
}
