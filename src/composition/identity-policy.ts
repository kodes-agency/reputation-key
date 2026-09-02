// The Identity policy dependency slice (BQC-2.2/2.7/4.4).
//
// Identity owns the policy store, the admin operations and the operator audit
// sink; the composition root only supplies env plus the shared routing
// primitives — the property region loader, the router decision, the Data Cell
// admission fence, the cell's provider reference, and the narrow Google Content
// slice the capability refusal explainer needs (issue #408).
//
// This lives outside `src/composition.ts` because the root has a hard line
// budget (`composition-container-boundary.test.ts`) whose whole purpose is to
// push assembled dependency bags into named composition modules rather than
// letting the root accumulate them. The three late-bound callbacks stay with
// the caller: they close over contexts that are constructed after Identity.

import { createPropertyRegionLoader } from '#/contexts/property/infrastructure/property-region-loader'
import { providerRefForCell } from '#/shared/routing/processing-router'
import { googleContentCapabilityRefusal } from './google-provider-authority'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { Database } from '#/shared/db'
import type { Env } from '#/shared/config/env'

type IdentityPolicyDeps = Parameters<typeof buildIdentityContext>[0]['policy']

export function buildIdentityPolicyDeps(
  input: Readonly<{
    env: Env
    db: Database
    /**
     * Late-bound: Identity is constructed before the Property context, so this
     * runs only after the container is fully composed.
     */
    propertyBelongsToOrganization: IdentityPolicyDeps['propertyBelongsToOrganization']
    resolveRouting: IdentityPolicyDeps['resolveRouting']
    admitPropertyExecution: IdentityPolicyDeps['admitPropertyExecution']
  }>,
): IdentityPolicyDeps {
  return {
    env: input.env,
    loadPropertyRegion: createPropertyRegionLoader({ db: input.db }),
    propertyBelongsToOrganization: input.propertyBelongsToOrganization,
    resolveRouting: input.resolveRouting,
    cell: input.env.PROCESSING_CELL,
    admitPropertyExecution: input.admitPropertyExecution,
    providerRef: providerRefForCell(input.env.PROCESSING_CELL) ?? null,
    capabilityRefusal: googleContentCapabilityRefusal(input.env),
  }
}
