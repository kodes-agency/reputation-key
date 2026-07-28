// Policy snapshot records — single source of truth for the org/property
// policy-table row shapes (BQC-5.8; previously mirrored in
// shared/auth/persisted-policy-store and identity/application/ports).
//
// Lives in shared/domain so every legal consumer can reach it: the
// shared/auth snapshot store (shared-auth → shared-domain), the identity
// application port (application → shared-domain), and the identity
// infrastructure repository that maps DB rows (infrastructure → shared-domain).

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
