// Resolve server-function bindings only when a route or component reads them.
// Eager object members can capture `undefined` when Vite splits a cyclic chunk.
import {
  cancelPropertyImportV2,
  getPropertyImportV2Status,
  listImportAccounts,
  listImportCandidates,
  recoverPropertyImportV2,
  renewImportAuthorizationLease,
  retryPropertyImportItem,
  startPropertyImportV2,
} from '#/contexts/integration/server/gbp-import'
import {
  getGoogleAuthUrl,
  listGoogleConnections,
} from '#/contexts/integration/server/google-connections'
import type { GoogleImportFns } from '#/components/features/integration/google-import-manager/google-import-manager-contract'

export const importFns: GoogleImportFns = {
  get getGoogleAuthUrl() {
    return getGoogleAuthUrl
  },
  get listGoogleConnections() {
    return listGoogleConnections
  },
  get listImportAccounts() {
    return listImportAccounts
  },
  get listImportCandidates() {
    return listImportCandidates
  },
  get renewImportAuthorizationLease() {
    return renewImportAuthorizationLease
  },
  get startPropertyImportV2() {
    return startPropertyImportV2
  },
  get recoverPropertyImportV2() {
    return recoverPropertyImportV2
  },
  get getPropertyImportV2Status() {
    return getPropertyImportV2Status
  },
  get retryPropertyImportItem() {
    return retryPropertyImportItem
  },
  get cancelPropertyImportV2() {
    return cancelPropertyImportV2
  },
}
