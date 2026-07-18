// PropertyAccessGrant + org policy state contracts (identity-owned).
//
// Type contracts for the grant repository and the policy-state repository —
// the application layer imports records from here (boundary rule); the
// infrastructure repositories implement them.
//
// OrgPolicyRecord/PropertyPolicyRecord mirror the snapshot records in
// shared/auth/persisted-policy-store (same shape, separate home: shared/auth
// types are unreachable from application under the boundary rules). The
// policy tables are the single source of truth for both.

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

export type OrgPolicyRecord = Readonly<{
  organizationId: string
  cohort: string
  suspendedAt: Date | null
  suspendedReason: string | null
}>

export type PropertyPolicyRecord = Readonly<{
  propertyId: string
  suspendedAt: Date | null
  suspendedReason: string | null
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

/**
 * Mirror of the PropertyRegionDiagnostic in shared/auth/policy-diagnostic
 * (same shape, separate home: shared/auth types are unreachable from
 * application under the boundary rules). BQC-4.4: content-free region
 * state for the operator diagnostic surface — region facts, the router's
 * blocked reason, and the current cell + logical provider ref (no URLs).
 */
export type PolicyAdminRegionDiagnostic = Readonly<{
  propertyId: string
  processingRegion: string | null
  processingRegionSource: string | null
  routingPolicyVersion: number | null
  processable: boolean
  blockedReason: 'region_unresolved' | 'region_denied' | 'property_missing' | null
  cell: string
  providerRef: string | null
}>
