// The Identity policy dependency slice (BQC-2.2/2.7).
//
// Identity owns the policy store, the admin operations and the operator audit
// sink; the composition root only supplies env plus the late-bound property
// membership check.
//
// This lives outside `src/composition.ts` because the root has a hard line
// budget (`composition-container-boundary.test.ts`) whose whole purpose is to
// push assembled dependency bags into named composition modules rather than
// letting the root accumulate them. The late-bound callback stays with the
// caller: it closes over a context that is constructed after Identity.

import type { buildIdentityContext } from '#/contexts/identity/build'
import type { Env } from '#/shared/config/env'

type IdentityPolicyDeps = Parameters<typeof buildIdentityContext>[0]['policy']

export function buildIdentityPolicyDeps(
  input: Readonly<{
    env: Env
    /**
     * Late-bound: Identity is constructed before the Property context, so this
     * runs only after the container is fully composed.
     */
    propertyBelongsToOrganization: IdentityPolicyDeps['propertyBelongsToOrganization']
  }>,
): IdentityPolicyDeps {
  return {
    env: input.env,
    propertyBelongsToOrganization: input.propertyBelongsToOrganization,
  }
}
