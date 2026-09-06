// PropertyAccessGrant + org policy state contracts (identity-owned).
//
// Type contracts for the grant repository and the policy-state repository —
// the application layer imports records from here (boundary rule); the
// infrastructure repositories implement them.
//
// OrgPolicyRecord/PropertyPolicyRecord are imported from
// shared/domain/policy-records — the single home legal for application,
// shared/auth, and infrastructure alike (BQC-5.8; previously mirrored here).
// The policy tables are the single source of truth for both.

import type {
  OrgPolicyRecord,
  PropertyPolicyRecord,
} from '#/shared/domain/policy-records'

export type GrantSource = 'operator' | 'migration' | 'invitation'

export type PropertyAccessGrantRecord = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  userId: string
  source: GrantSource
  createdBy: string | null
  createdAt: Date
  expiresAt: Date | null
  revokedAt: Date | null
  revokeReason: string | null
}>

export type OrgPolicyState = Readonly<{
  policy: OrgPolicyRecord | null
  capabilities: ReadonlyArray<string>
  propertyPolicies: ReadonlyArray<PropertyPolicyRecord>
}>

/**
 * Mirror of the PolicyDecisionExplanation in shared/auth/policy-diagnostic
 * (same shape, separate home: shared/auth types are unreachable from
 * application under the boundary rules). Structural typing keeps them
 * interchangeable at the composition seam.
 */
export type PolicyAdminExplanation = Readonly<{
  allowed: boolean
  reason: string
  action: string
  capability: string
  checks: Readonly<{
    capability: Readonly<{ allowed: boolean; reason: string }>
    permission: Readonly<{ allowed: boolean }>
    scope: Readonly<{
      outcome: 'not_applicable' | 'organization' | 'granted' | 'missing_grant' | 'none'
    }>
  }>
}>
