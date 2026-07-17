// Dark-route gate (BQC-2.6).
//
// Dark beta features (Team, Portal, Guest, Goal, Badge, Leaderboard, AI)
// render an intentional unavailable experience — never a partially live
// shell. Call from a dark route's beforeLoad:
//
//   beforeLoad: async () => {
//     await gateDarkRoute('goal.use', 'Goals')
//   }
//
// When the capability is globally dark, the user is redirected to
// /unavailable?feature=<label>. Global posture is the beta rule (non-core
// capabilities are globally off); per-org promotion of route gates arrives
// with the operator workflows in BQC-2.7.

import { redirect } from '@tanstack/react-router'
import { checkGlobalCapability, type Capability } from './beta-capabilities'

export async function gateDarkRoute(
  capability: Capability,
  featureLabel: string,
): Promise<void> {
  const decision = checkGlobalCapability(capability)
  if (!decision.allowed) {
    throw redirect({
      to: '/unavailable',
      search: { feature: featureLabel },
    })
  }
}
