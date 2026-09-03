// Resolved capability set for the authenticated client (ADR 0049).
//
// Navigation visibility is not a security boundary. This resolver exists so
// navigation can render a dead end as unavailable instead of routing the user
// into /unavailable; every route gate (controlled-route-gate.ts) and every
// server function still asserts its capability independently.
//
// One round trip resolves the whole vocabulary rather than one call per
// affordance: the decision itself is a pure in-memory policy lookup
// (checkScopedCapability), so the cost is the tenant resolution, not the
// per-capability checks. It reuses checkBetaCapability — the same decision
// machinery controlled-route-check.ts calls — so the client can never disagree
// with the gate about what is on.

import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from './headers'
import { resolveTenantContext } from './middleware'
import {
  checkBetaCapability,
  listAllCapabilities,
  type Capability,
} from './beta-capabilities'
import {
  refusalCategory,
  type CapabilityRefusalCategory,
} from './capability-refusal-category'

export type CapabilitySetInput = Readonly<{
  /**
   * Property the decisions are scoped to. Capability policy is allowlisted per
   * property (`property_not_allowlisted`), so an org-only set would be wrong
   * for a tenant whose properties differ. Omitted only when no property is in
   * scope, in which case the org-level posture is returned.
   */
  propertyId?: string
}>

export type CapabilitySet = Readonly<{
  /** Property the decisions were resolved for; null when none was in scope. */
  propertyId: string | null
  /**
   * Allowed capabilities only. A plain array, not a Set, because the value is
   * carried on the router context and has to survive SSR dehydration.
   */
  allowed: ReadonlyArray<Capability>
  /** Denied capabilities paired with their client-facing refusal category. */
  refused: ReadonlyArray<
    Readonly<{
      capability: Capability
      category: CapabilityRefusalCategory
    }>
  >
}>

/** Empty posture — used when the caller has no tenant context yet. */
export const EMPTY_CAPABILITY_SET: CapabilitySet = {
  propertyId: null,
  allowed: [],
  refused: [],
}

/** Plain-data server boundary read by the `_authenticated` route context. */
export const getCapabilitySet = createServerFn({ method: 'GET' })
  .validator((data: CapabilitySetInput) => data)
  .handler(async ({ data }): Promise<CapabilitySet> => {
    const headers = await headersFromContext()
    const ctx = await resolveTenantContext(headers)
    const allowed: Capability[] = []
    const refused: Array<
      Readonly<{
        capability: Capability
        category: CapabilityRefusalCategory
      }>
    > = []

    for (const capability of listAllCapabilities()) {
      const decision = checkBetaCapability(ctx, capability, data.propertyId)
      const category = refusalCategory(decision)
      if (decision.allowed) allowed.push(capability)
      if (category !== null) refused.push({ capability, category })
    }

    return {
      propertyId: data.propertyId ?? null,
      allowed,
      refused,
    }
  })
