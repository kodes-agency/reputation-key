export type GrantPropertyAccessCommand = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  source: 'operator'
  createdBy?: string
  expiresAt?: Date
}>

export type RevokePropertyAccessCommand = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  reason: string
}>

/** Identity's atomic PropertyAccessGrant administration seam. */
export type PolicyAdminCommandStore = Readonly<{
  grantPropertyAccess: (command: GrantPropertyAccessCommand) => Promise<void>
  revokePropertyAccess: (command: RevokePropertyAccessCommand) => Promise<void>
}>
