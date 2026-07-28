// Dark-route gate (BQC-2.6).
//
// Dark beta features (Team, Portal, Guest, Goal, Badge, Leaderboard, AI)
// render an intentional unavailable experience — never a partially live
// shell. Call from a dark route's beforeLoad:
//
//   beforeLoad: async () => {
//     await gateDarkRoute({ data: { capability: 'goal.use', featureLabel: 'Goals' } })
//   }
//
// When the capability is globally dark, the user is redirected to
// /unavailable?feature=<label>. Global posture is the beta rule (non-core
// capabilities are globally off); per-org promotion of route gates arrives
// with the operator workflows in BQC-2.7.
//
// BQC-5.3: this is a server function — the capability store's lazy fallback
// reads process.env, which does not exist in the browser module graph
// (client-side navigation to a gated route crashed on `process`). The RPC
// boundary keeps the check server-side; TanStack propagates the thrown
// redirect to the client router. Deliberately NOT wrapped in tracedHandler:
// a thrown redirect is control flow, and tracedHandler's catchUntagged
// safety net would remap it to a 500.

import { createServerFn } from '@tanstack/react-start'
import { redirect } from '@tanstack/react-router'
import { checkGlobalCapability, type Capability } from './beta-capabilities'

export const gateDarkRoute = createServerFn({ method: 'GET' })
  .inputValidator((data: { capability: Capability; featureLabel: string }) => data)
  .handler(async ({ data }) => {
    const decision = checkGlobalCapability(data.capability)
    if (!decision.allowed) {
      throw redirect({
        to: '/unavailable',
        search: { feature: data.featureLabel },
      })
    }
  })
