// Authenticated controlled-feature route preloader (ADR 0049).
//
// Navigation visibility is not a security boundary. This preloader gives
// direct navigation an intentional unavailable state while each loader and
// server function still authorizes independently against the selected
// property.
//
// The state is drawn in the app shell (see `route-notice`): a manager whose
// feature is switched off keeps the sidebar and top bar and is told which
// feature, why, and where to go.

import { checkControlledRoute, type ControlledRouteInput } from './controlled-route-check'
import type { CapabilityDecision } from './beta-capabilities'
import { refusalCategory } from './capability-refusal-category'
import { routeNotice } from './route-notice'

/** Answer a denied controlled feature in the shell. Allowed decisions pass through. */
export function denyControlledRoute(
  decision: CapabilityDecision,
  input: ControlledRouteInput,
): void {
  if (decision.allowed) return
  throw routeNotice({
    cause: 'feature',
    title: input.featureLabel,
    category: refusalCategory(decision) ?? 'not_in_beta',
    ...(input.propertyId ? { propertyId: input.propertyId } : {}),
  })
}

/**
 * Keep the server function transport plain-data-only. Client-side navigation
 * cannot deserialize a router transition thrown inside a server function
 * reliably; throw it here, on the same side that owns the router transition.
 */
export async function gateControlledRoute(
  input: Readonly<{
    data: ControlledRouteInput
  }>,
): Promise<void> {
  const decision = await checkControlledRoute(input)
  denyControlledRoute(decision, input.data)
}
