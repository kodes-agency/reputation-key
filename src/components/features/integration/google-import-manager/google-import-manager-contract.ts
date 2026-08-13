import type {
  GoogleConnectionDto,
  ImportProgressDto,
} from '#/contexts/integration/application/public-api'
import type {
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  renewImportAuthorizationLease,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'

export type GoogleImportStep = 'discover' | 'review' | 'progress'
export type GoogleImportGetAuthUrl = (opts: {
  data: { visibility: 'private' | 'organization' }
}) => Promise<{ url: string }>

export type GoogleImportManagerProps = Readonly<{
  organizationId: string
  connections: readonly GoogleConnectionDto[]
  initialConnectionId?: string
  initialProgress?: ImportProgressDto | null
  getAuthUrl: GoogleImportGetAuthUrl
  listAccounts: typeof listImportAccounts
  listCandidates: typeof listImportCandidates
  renewAuthorizationLease: typeof renewImportAuthorizationLease
  startImport: typeof startPropertyImportV2
  recoverImport: typeof recoverPropertyImportV2
  getImportStatus: typeof getPropertyImportV2Status
  retryImportItem: typeof retryPropertyImportItem
}>
