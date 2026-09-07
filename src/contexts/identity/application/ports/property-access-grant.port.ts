// PropertyAccessGrant contracts owned by Identity.
//
// The application layer owns these record shapes; infrastructure implements
// them and other contexts consume them through Identity's public seams.

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
