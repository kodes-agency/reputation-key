/**
 * Provider record identities allocated and persisted before an invited
 * registration starts. Values are identifiers only; no credential material.
 */
export type RegistrationAuthIds = Readonly<{
  userId: string
  credentialAccountId: string
  initialSessionId: string
}>
