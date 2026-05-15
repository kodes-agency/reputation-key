/**
 * Shared types for the identity registration feature.
 */

export type PendingInvitation = Readonly<{
  id: string
  organizationName: string
  role: string
  expiresAt: Date
}>
