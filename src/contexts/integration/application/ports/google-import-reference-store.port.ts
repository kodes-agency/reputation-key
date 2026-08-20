import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'
import type {
  ImportAccountPageDto,
  ImportCandidateEligibility,
  ImportCandidatePageDto,
} from '../google-import-v2-contract'

export type ImportAuthorizationVectorValue = string | number | boolean | null

export type ImportDiscoveryAuthorization = Readonly<{
  organizationId: string
  userId: string
  connectionId: string
  connectionLifecycleVersion: number
  connectionAccessVersion: number
  credentialGeneration: number
  approvalBindingId: string
  authorizationVector: Readonly<Record<string, ImportAuthorizationVectorValue>>
}>

export type ImportDiscoveryAccount = Readonly<{
  accountId: string
  displayName: string
  role: 'primary_owner' | 'owner' | 'manager' | 'site_manager' | 'unknown'
}>

export type ImportDiscoveryCandidate = Readonly<{
  accountId: string
  locationId: string
  accountDisplayName: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  countryCode: string | null
  eligibility: ImportCandidateEligibility
  expectedSourceEpoch?: number | null
  expectedProfileVersion?: number | null
  affectedPropertyId?: string | null
}>

export type ImportReferenceFailureCode =
  | 'malformed'
  | 'not_found'
  | 'expired'
  | 'binding_mismatch'
  | 'budget_exhausted'
  | 'capacity_exceeded'
  | 'runtime_unavailable'

export type ImportReferenceResult<T> =
  | Readonly<{ ok: true } & T>
  | Readonly<{ ok: false; code: ImportReferenceFailureCode }>
export type ResolvedImportCandidate = Omit<ImportDiscoveryCandidate, 'eligibility'> &
  Readonly<{
    candidateId: string
    accountRef: string
    eligibility:
      | Readonly<{ kind: 'create' }>
      | Readonly<{
          kind: 'relink'
          propertyId: string
          profile: Readonly<{
            name: string
            address: string | null
            countryCode: string | null
            timezone: string
            profileVersion: number
          }>
        }>
      | Readonly<{ kind: 'already_imported'; propertyId: string }>
      | Readonly<{ kind: 'active_binding_conflict' }>
      | Readonly<{ kind: 'region_unavailable' }>
      | Readonly<{ kind: 'unavailable' }>
  }>
export type ClaimedImportCandidate = Readonly<{
  candidateRef: string
  authorization: ImportDiscoveryAuthorization
  candidate: ResolvedImportCandidate
}>

export type GoogleImportReferenceStore = Readonly<{
  publishAccountPage(
    input: Readonly<{
      authorization: ImportDiscoveryAuthorization
      accounts: readonly ImportDiscoveryAccount[]
      nextPageToken: string | null
      contentDeadlineMs: number
      cursorRedemptionBudget?: number
    }>,
  ): Promise<ImportReferenceResult<{ value: ImportAccountPageDto }>>
  resolveAccount(
    input: Readonly<{
      accountRef: string
      authorization: ImportDiscoveryAuthorization
    }>,
  ): Promise<
    ImportReferenceResult<{
      accountId: string
      displayName: string
      role: ImportDiscoveryAccount['role']
    }>
  >
  redeemAccountsCursor(
    input: Readonly<{
      cursorRef: string
      authorization: ImportDiscoveryAuthorization
    }>,
  ): Promise<ImportReferenceResult<{ pageToken: string }>>
  publishCandidatePage(
    input: Readonly<{
      authorization: ImportDiscoveryAuthorization
      account: Readonly<{
        accountRef: string
        accountId: string
        displayName: string
      }>
      candidates: readonly ImportDiscoveryCandidate[]
      nextPageToken: string | null
      contentDeadlineMs: number
      cursorRedemptionBudget?: number
    }>,
  ): Promise<ImportReferenceResult<{ value: ImportCandidatePageDto }>>
  redeemLocationsCursor(
    input: Readonly<{
      cursorRef: string
      authorization: ImportDiscoveryAuthorization
    }>,
  ): Promise<
    ImportReferenceResult<{
      accountRef: string
      accountId: string
      accountDisplayName: string
      pageToken: string
    }>
  >
  resolveCandidate(
    input: Readonly<{
      candidateRef: string
      authorization: ImportDiscoveryAuthorization
    }>,
  ): Promise<ImportReferenceResult<{ candidate: ResolvedImportCandidate }>>
  claimCandidates(
    input: Readonly<{
      candidateRefs: readonly string[]
      organizationId: string
      userId: string
      requestId: string
    }>,
  ): Promise<ImportReferenceResult<{ candidates: readonly ClaimedImportCandidate[] }>>
  releaseCandidateClaims(
    input: Readonly<{
      candidateRefs: readonly string[]
      organizationId: string
      userId: string
      requestId: string
    }>,
  ): Promise<boolean>
  consumeCandidateClaims(
    input: Readonly<{
      candidateRefs: readonly string[]
      organizationId: string
      userId: string
      requestId: string
    }>,
  ): Promise<boolean>
  renewLease(
    input: Readonly<{
      leaseRef: string
      authorization: ImportDiscoveryAuthorization
    }>,
  ): Promise<ImportReferenceResult<{ lease: ProviderContentLeaseDto }>>
  invalidateOrganization(input: Readonly<{ organizationId: string }>): Promise<boolean>
  invalidateUser(
    input: Readonly<{
      organizationId: string
      userId: string
    }>,
  ): Promise<boolean>
  invalidateConnection(
    input: Readonly<{
      organizationId: string
      connectionId: string
    }>,
  ): Promise<boolean>
  invalidateProperty(
    input: Readonly<{
      organizationId: string
      propertyId: string
    }>,
  ): Promise<boolean>
}>
