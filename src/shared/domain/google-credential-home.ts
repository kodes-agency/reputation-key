import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
  type DataCellId,
} from './data-cell-catalogue'

export type GoogleCredentialHome = Readonly<{
  homeCellId: DataCellId
  cataloguePolicyVersion: number
}>

export type GoogleCredentialHomeBinding = GoogleCredentialHome &
  Readonly<{
    authorityGeneration: number
  }>

export function canReplaceGoogleCredentialHome(
  current: GoogleCredentialHome | null,
  next: GoogleCredentialHome,
  reason: 'new_grant' | 'credential_rotation' | 'governed_reconnect',
): boolean {
  if (!isDataCellAccepting(next.homeCellId)) return false
  if (next.cataloguePolicyVersion !== DATA_CELL_CATALOGUE_POLICY_VERSION) return false
  if (!current) return reason === 'new_grant' || reason === 'governed_reconnect'
  if (
    current.homeCellId === next.homeCellId &&
    current.cataloguePolicyVersion === next.cataloguePolicyVersion
  ) {
    return true
  }
  return reason === 'governed_reconnect'
}
