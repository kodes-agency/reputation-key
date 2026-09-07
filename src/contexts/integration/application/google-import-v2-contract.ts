import type { PropertyId } from '#/shared/domain/ids'
import type { ProviderContentLeaseDto } from '#/shared/domain/provider-content-lease'

export const GOOGLE_PROPERTY_IMPORT_REQUESTED_EVENT =
  'integration.property_import.requested' as const
export const PROPERTY_IMPORT_RETENTION_RELEASED_EVENT =
  'integration.property_import.retention_released' as const
export const GOOGLE_PROPERTY_IMPORT_ITEM_JOB = 'import-gbp-property-item-v2' as const
export const GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION = 3 as const

export type IntegrationPropertyImportRequestedV1 = Readonly<{
  organizationId: string
  importJobId: string
}>

export type IntegrationPropertyImportRetentionReleasedV1 = Readonly<{
  organizationId: string
  /** Added compatibly during ARC-01; absent only on pre-cutover v1 facts. */
  importJobId?: string
  idempotencyKeys: readonly string[]
}>

export type GooglePropertyImportItemJobId =
  `import-item-${string}-l${number}-e${number | 'new'}-r${number}`

export const IMPORT_PARENT_STATUSES = [
  'queued',
  'processing',
  'completed',
  'completed_with_issues',
  'failed',
  'cancelled',
] as const
export type ImportParentStatus = (typeof IMPORT_PARENT_STATUSES)[number]

export const GBP_IMPORT_ITEM_STATUSES = [
  'pending',
  'processing',
  'imported',
  'relinked',
  'already_exists',
  'failed',
  'cancelled',
] as const
export type GbpImportItemStatus = (typeof GBP_IMPORT_ITEM_STATUSES)[number]

export const IMPORT_OUTCOME_CODES = [
  'imported',
  'relinked',
  'already_exists',
  'active_binding_conflict',
  'stale_binding',
  'reauthentication_required',
  'reconnect_required',
  'authorization_changed',
  'user_cancelled',
  'policy_disabled',
  'organization_suspended',
  'property_suspended',
  'property_deleted',
  'temporarily_unavailable',
  'cleanup_required',
  'internal_error',
] as const
export type ImportOutcomeCode = (typeof IMPORT_OUTCOME_CODES)[number]

/**
 * The outcome codes a property-operation receipt can reconcile an import item
 * to. Narrower than `ImportOutcomeCode`: the remaining codes describe failures
 * the receipt path never produces.
 */
export type ReconciledOutcomeCode = Extract<
  ImportOutcomeCode,
  'imported' | 'relinked' | 'property_deleted'
>

/**
 * How a receipt reports itself when reconciling an import item.
 *
 * A tombstoned receipt reconciles as `property_deleted` whatever outcome it
 * recorded: the property it described is gone, and reporting `imported` would
 * leave the item advertising a property the tenant cannot open. Shared because
 * both the item processor and the lifecycle cancel path reconcile receipts, and
 * a tombstone honoured in one but not the other is a visible lie in the import
 * report.
 */
export function reconciledOutcomeCode(
  receipt: Readonly<{ tombstone: boolean; outcome: ReconciledOutcomeCode }>,
): ReconciledOutcomeCode {
  return receipt.tombstone || receipt.outcome === 'property_deleted'
    ? 'property_deleted'
    : receipt.outcome
}

export const IMPORT_ITEM_USER_ACTIONS = [
  'none',
  'rediscover',
  'reauthenticate',
  'reconnect',
  'retry',
] as const
export type ImportItemUserAction = (typeof IMPORT_ITEM_USER_ACTIONS)[number]

export type ImportReducerClass = 'success' | 'benign_skip' | 'failure' | 'cancellation'
export type ImportOutcomePresentation = Readonly<{
  status: GbpImportItemStatus
  reducerClass: ImportReducerClass
  retryable: boolean
  userAction: ImportItemUserAction
}>

export const IMPORT_OUTCOME_PRESENTATION = {
  imported: {
    status: 'imported',
    reducerClass: 'success',
    retryable: false,
    userAction: 'none',
  },
  relinked: {
    status: 'relinked',
    reducerClass: 'success',
    retryable: false,
    userAction: 'none',
  },
  already_exists: {
    status: 'already_exists',
    reducerClass: 'benign_skip',
    retryable: false,
    userAction: 'none',
  },
  active_binding_conflict: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'rediscover',
  },
  stale_binding: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'rediscover',
  },
  reauthentication_required: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'reauthenticate',
  },
  reconnect_required: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'reconnect',
  },
  authorization_changed: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  user_cancelled: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  policy_disabled: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  organization_suspended: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  property_suspended: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  property_deleted: {
    status: 'cancelled',
    reducerClass: 'cancellation',
    retryable: false,
    userAction: 'none',
  },
  temporarily_unavailable: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: true,
    userAction: 'retry',
  },
  cleanup_required: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'none',
  },
  internal_error: {
    status: 'failed',
    reducerClass: 'failure',
    retryable: false,
    userAction: 'none',
  },
} as const satisfies Readonly<Record<ImportOutcomeCode, ImportOutcomePresentation>>

const IMPORT_OUTCOME_PRESENTATION_BY_CODE = new Map<string, ImportOutcomePresentation>(
  Object.entries(IMPORT_OUTCOME_PRESENTATION),
)

export function getImportOutcomePresentation(
  outcome: string,
): ImportOutcomePresentation | null {
  return IMPORT_OUTCOME_PRESENTATION_BY_CODE.get(outcome) ?? null
}

export type ImportAccountDto = Readonly<{
  accountRef: string
  displayName: string
  role: 'primary_owner' | 'owner' | 'manager' | 'site_manager' | 'unknown'
}>

export type ImportAccountPageDto = Readonly<{
  items: readonly ImportAccountDto[]
  nextCursor: string | null
  contentExpiresAt: string
  authorizationLease: ProviderContentLeaseDto
  contentTtlSeconds: number
}>

export type RelinkPropertyProfileDto = Readonly<{
  name: string
  address: string | null
  countryCode: string | null
  timezone: string
  profileVersion: number
}>

export type ImportCandidateEligibility =
  | Readonly<{ kind: 'create' }>
  | Readonly<{
      kind: 'relink'
      propertyId: PropertyId
      profile: RelinkPropertyProfileDto
    }>
  | Readonly<{ kind: 'already_imported'; propertyId: PropertyId }>
  | Readonly<{ kind: 'active_binding_conflict' }>
  /**
   * Google reports the location as lacking Voice of Merchant, so it is not
   * verified and cannot serve reviews or performance data. Importing it would
   * produce a Property that is permanently empty, so it is offered for display
   * only — never for selection, and never with a candidate reference.
   */
  | Readonly<{ kind: 'verification_required' }>
  | Readonly<{ kind: 'unavailable' }>

export type ImportCandidateDto = Readonly<{
  candidateId: string
  candidateRef: string | null
  accountRef: string
  accountDisplayName: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  countryCode: string | null
  eligibility: ImportCandidateEligibility
}>

export type ImportCandidatePageDto = Readonly<{
  items: readonly ImportCandidateDto[]
  nextCursor: string | null
  contentExpiresAt: string
  authorizationLease: ProviderContentLeaseDto
  contentTtlSeconds: number
}>

export type ConfirmedCreatePropertyProfileInput = Readonly<{
  name: string
  address: string | null
  countryCode: string
  timezone: string
  confirmed: true
}>

export type ConfirmedRelinkProfileInput =
  | Readonly<{
      timezone: string
      confirmed: true
      updateExistingProfile: false
    }>
  | Readonly<{
      name: string
      address: string | null
      timezone: string
      confirmed: true
      updateExistingProfile: true
    }>

export type StartPropertyImportItemInput =
  | Readonly<{
      candidateRef: string
      action: 'create'
      profile: ConfirmedCreatePropertyProfileInput
    }>
  | Readonly<{
      candidateRef: string
      action: 'relink'
      existingPropertyId: PropertyId
      profile: ConfirmedRelinkProfileInput
    }>

export type StartPropertyImportInput = Readonly<{
  requestId: string
  items: readonly StartPropertyImportItemInput[]
  confirmation: 'apply'
}>

/**
 * No destination Property ID: terminal writes scrub `destination_property_id`
 * for every non-retryable item, so an `imported`/`relinked` row can never carry
 * one by the time progress is read.
 */
export type ImportProgressItemDto = Readonly<{
  itemId: string
  propertyName: string
  action: 'create' | 'relink'
  status: GbpImportItemStatus
  outcomeCode: ImportOutcomeCode | null
  messageKey: `property_import.${GbpImportItemStatus | ImportOutcomeCode}`
  retryable: boolean
  retryRevision: number
  userAction: ImportItemUserAction
}>

export type ImportProgressDto = Readonly<{
  contractVersion: typeof GOOGLE_PROPERTY_IMPORT_CONTRACT_VERSION
  importJobId: string
  requestId: string
  status: ImportParentStatus
  totalCount: number
  processedCount: number
  counts: Readonly<Record<GbpImportItemStatus, number>>
  items: readonly ImportProgressItemDto[]
  canRetry: boolean
  pollAfterMs: number | null
  purgeAt: string | null
  updatedAt: string
}>
