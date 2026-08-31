/**
 * The content-free evidence that must commit with a policy-admin mutation.
 * Keeping the audit entry on every command makes an unaudited policy change
 * unrepresentable at the application boundary.
 */
export type PolicyAdminAuditEntry = Readonly<{
  actorType: 'operator'
  actorId: string
  organizationId: string
  propertyId: string | null
  action: string
  capability: string | null
  executionKind: 'operator'
  decision: 'allow'
  reason: string
  policyVersion: string
  correlationId: null
}>

type AuditedCommand = Readonly<{ audit: PolicyAdminAuditEntry }>

export type SetOrganizationCapabilityCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    capability: string
    enabled: boolean
    createdBy?: string
  }>

export type SetPropertyCapabilityCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    propertyId: string
    capability: string
    enabled: boolean
    createdBy?: string
  }>

export type SetOrganizationSuspensionCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    suspendedAt: Date | null
    suspendedReason: string | null
  }>

export type SetPropertySuspensionCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    propertyId: string
    suspendedAt: Date | null
    suspendedReason: string | null
  }>

export type GrantPropertyAccessCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    source: 'operator'
    createdBy?: string
    expiresAt?: Date
  }>

export type RevokePropertyAccessCommand = AuditedCommand &
  Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    reason: string
  }>

/**
 * Identity's atomic policy-admin persistence seam. Implementations must use
 * one transaction for the policy row/grant, policy-version bump, and audit.
 */
export type PolicyAdminCommandStore = Readonly<{
  setOrganizationCapability: (command: SetOrganizationCapabilityCommand) => Promise<void>
  setPropertyCapability: (command: SetPropertyCapabilityCommand) => Promise<void>
  setOrganizationSuspension: (command: SetOrganizationSuspensionCommand) => Promise<void>
  setPropertySuspension: (command: SetPropertySuspensionCommand) => Promise<void>
  grantPropertyAccess: (command: GrantPropertyAccessCommand) => Promise<void>
  revokePropertyAccess: (command: RevokePropertyAccessCommand) => Promise<void>
}>
