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
//
// A route calls `gateControlledRoute` (`#/shared/shell-context/remembered-route-gate`),
// which asks `checkControlledRoute`, or remembers its answer in the browser (ADR 0072),
// and hands the decision here.

import type { ControlledRouteInput } from './controlled-route-check'
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
