
export type SetOrganizationCapabilityCommand =
  Readonly<{
    organizationId: string
    capability: string
    enabled: boolean
    createdBy?: string
  }>

export type SetPropertyCapabilityCommand =
  Readonly<{
    organizationId: string
    propertyId: string
    capability: string
    enabled: boolean
    createdBy?: string
  }>

export type SetOrganizationSuspensionCommand =
  Readonly<{
    organizationId: string
    suspendedAt: Date | null
    suspendedReason: string | null
  }>

export type SetPropertySuspensionCommand =
  Readonly<{
    organizationId: string
    propertyId: string
    suspendedAt: Date | null
    suspendedReason: string | null
  }>

export type GrantPropertyAccessCommand =
  Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    source: 'operator'
    createdBy?: string
    expiresAt?: Date
  }>

export type RevokePropertyAccessCommand =
  Readonly<{
    organizationId: string
    propertyId: string
    userId: string
    reason: string
  }>

/** Identity's atomic policy-admin persistence seam. */
export type PolicyAdminCommandStore = Readonly<{
  setOrganizationCapability: (command: SetOrganizationCapabilityCommand) => Promise<void>
  setPropertyCapability: (command: SetPropertyCapabilityCommand) => Promise<void>
  setOrganizationSuspension: (command: SetOrganizationSuspensionCommand) => Promise<void>
  setPropertySuspension: (command: SetPropertySuspensionCommand) => Promise<void>
  grantPropertyAccess: (command: GrantPropertyAccessCommand) => Promise<void>
  revokePropertyAccess: (command: RevokePropertyAccessCommand) => Promise<void>
}>
