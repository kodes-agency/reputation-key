import type { ReactFormExtendedApi } from '@tanstack/react-form'
import type {
  GoogleConnectionDto,
  ImportAccountDto,
  ImportCandidateDto,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import type {
  googleImportReviewDraftSchema,
  GoogleImportReviewDraftInput,
} from '#/contexts/integration/application/dto/google-import-v2.dto'
import type { ImportReviewDraft } from './google-import-review-model'
import type {
  cancelPropertyImportV2,
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  renewImportAuthorizationLease,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'
import type {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import type {
  enableMerchantAiFn,
  getMerchantAiAuthorizationFn,
} from '#/contexts/identity/server/merchant-ai'

export type GoogleImportStep = 'discover' | 'review' | 'progress'
export type GoogleImportGetAuthUrl = typeof getGoogleAuthUrl

export type GoogleImportFns = Readonly<{
  getGoogleAuthUrl: typeof getGoogleAuthUrl
  listGoogleConnections: typeof listGoogleConnections
  listImportAccounts: typeof listImportAccounts
  listImportCandidates: typeof listImportCandidates
  renewImportAuthorizationLease: typeof renewImportAuthorizationLease
  startPropertyImportV2: typeof startPropertyImportV2
  recoverPropertyImportV2: typeof recoverPropertyImportV2
  getPropertyImportV2Status: typeof getPropertyImportV2Status
  retryPropertyImportItem: typeof retryPropertyImportItem
  cancelPropertyImportV2: typeof cancelPropertyImportV2
}>

/** The AI-analysis step of the flow reuses the Settings consent commands. */
export type GoogleImportAiFns = Readonly<{
  getMerchantAiAuthorization: typeof getMerchantAiAuthorizationFn
  enableMerchantAi: typeof enableMerchantAiFn
}>

export type GoogleImportReviewFormApi = ReactFormExtendedApi<
  GoogleImportReviewDraftInput,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  typeof googleImportReviewDraftSchema,
  undefined,
  undefined,
  undefined,
  undefined,
  never
>

type GoogleImportPageQueryState = Readonly<{
  isPending: boolean
  isFetchingNextPage: boolean
  hasNextPage: boolean
  error: Error | null
  fetchNextPage: () => Promise<unknown>
}>

export type GoogleImportDiscoveryController = Readonly<{
  accounts: readonly ImportAccountDto[]
  accountsQuery: GoogleImportPageQueryState
  candidatesQuery: GoogleImportPageQueryState
  lifecycle: Readonly<{
    clear: (reason: 'route_left') => void
    epoch: () => number
  }>
  step: GoogleImportStep
  setStep: (step: GoogleImportStep) => void
  connectionId: string | null
  contentActive: boolean
  accountRef: string | null
  selectedIds: ReadonlySet<string>
  search: string
  selectAllPending: boolean
  selectAllError: string | null
  setSearch: (value: string) => void
  visibleCandidates: readonly ImportCandidateDto[]
  reviewDraft: ImportReviewDraft | null
  reviewCandidates: readonly ImportCandidateDto[]
  changeConnection: (connectionId: string) => Promise<void>
  resumeDiscovery: () => void
  selectAccount: (accountRef: string) => void
  toggleCandidate: (candidate: ImportCandidateDto, checked: boolean) => void
  toggleLoaded: (checked: boolean) => void
  selectAllEligible: () => Promise<void>
  review: () => void
}>

export type GoogleImportManagerProps = Readonly<{
  organizationId: string
  connections: readonly GoogleConnectionDto[]
  initialConnectionId?: string
  initialProgress?: ImportProgressDto | null
  initialRequestId?: string
  initialError?: 'connection_failed' | 'denied' | 'account_already_connected'
  importFns: GoogleImportFns
  aiFns: GoogleImportAiFns
}>

export type GoogleImportReviewOptions = Readonly<{
  initialDraft: GoogleImportReviewDraftInput | null
  onSubmit: (draft: GoogleImportReviewDraftInput) => void | Promise<void>
}>

export type GoogleImportDiscoveryOptions = Pick<
  GoogleImportManagerProps,
  | 'organizationId'
  | 'connections'
  | 'initialConnectionId'
  | 'initialProgress'
  | 'initialRequestId'
  | 'importFns'
> &
  Readonly<{ onClearStartError: () => void }>

export type GoogleImportContentOptions = Readonly<{
  organizationId: string
  connectionId: string | null
  accountRef: string | null
  step: GoogleImportStep
  enabled: boolean
  importFns: Pick<
    GoogleImportFns,
    'listImportAccounts' | 'listImportCandidates' | 'renewImportAuthorizationLease'
  >
  clearProviderState: () => void
}>
