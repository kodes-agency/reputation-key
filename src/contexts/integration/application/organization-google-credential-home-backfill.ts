import { createHash } from 'node:crypto'
import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import type { GoogleConnectionId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { GoogleCredentialHome } from '#/shared/domain/google-credential-home'
import type { GoogleCredentialUseState } from '../domain/types'
import type { OrganizationGoogleCredentialHome } from '../domain/organizationGoogleCredentialHome'

export type GoogleCredentialHomeBackfillConnectionFact = Readonly<{
  connectionId: GoogleConnectionId
  credentialUseState: GoogleCredentialUseState
  credentialHomeCellId: string | null
  credentialHomePolicyVersion: number | null
  credentialHomeAuthorityGeneration: number | null
}>

export type OrganizationGoogleCredentialHomeBackfillReport = Readonly<{
  organizationId: OrganizationId
  authorityPresent: boolean
  activeGrantCount: number
  activeMissingHomeCount: number
  malformedHomePairCount: number
  persistedHomeCounts: ReadonlyArray<
    Readonly<{
      homeCellId: string
      cataloguePolicyVersion: number
      count: number
    }>
  >
  reportDigestSha256: string
}>

function authorityValue(authority: OrganizationGoogleCredentialHome | null) {
  return authority
    ? [
        authority.homeCellId,
        authority.cataloguePolicyVersion,
        authority.authorityGeneration,
      ]
    : null
}

export function buildOrganizationGoogleCredentialHomeBackfillReport(
  input: Readonly<{
    organizationId: OrganizationId
    authority: OrganizationGoogleCredentialHome | null
    connections: ReadonlyArray<GoogleCredentialHomeBackfillConnectionFact>
  }>,
): OrganizationGoogleCredentialHomeBackfillReport {
  const connections = [...input.connections].sort((left, right) =>
    left.connectionId.localeCompare(right.connectionId),
  )
  const active = connections.filter(
    (connection) => connection.credentialUseState === 'active',
  )
  const malformed = active.filter(
    (connection) =>
      (connection.credentialHomeCellId === null) !==
        (connection.credentialHomePolicyVersion === null) ||
      (connection.credentialHomeAuthorityGeneration !== null &&
        (connection.credentialHomeCellId === null ||
          connection.credentialHomePolicyVersion === null)),
  )
  const missing = active.filter(
    (connection) =>
      connection.credentialHomeCellId === null &&
      connection.credentialHomePolicyVersion === null &&
      connection.credentialHomeAuthorityGeneration === null,
  )
  const counts = new Map<string, number>()
  for (const connection of active) {
    if (
      connection.credentialHomeCellId === null ||
      connection.credentialHomePolicyVersion === null
    ) {
      continue
    }
    const key = `${connection.credentialHomeCellId}\0${connection.credentialHomePolicyVersion}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const persistedHomeCounts = Object.freeze(
    [...counts.entries()]
      .map(([key, count]) => {
        const [homeCellId, policy] = key.split('\0')
        return Object.freeze({
          homeCellId: homeCellId!,
          cataloguePolicyVersion: Number(policy),
          count,
        })
      })
      .sort((left, right) =>
        `${left.homeCellId}\0${left.cataloguePolicyVersion}`.localeCompare(
          `${right.homeCellId}\0${right.cataloguePolicyVersion}`,
        ),
      ),
  )
  const reportDigestSha256 = createHash('sha256')
    .update(
      JSON.stringify([
        input.organizationId,
        authorityValue(input.authority),
        connections.map((connection) => [
          connection.connectionId,
          connection.credentialUseState,
          connection.credentialHomeCellId,
          connection.credentialHomePolicyVersion,
          connection.credentialHomeAuthorityGeneration,
        ]),
      ]),
    )
    .digest('hex')
  return Object.freeze({
    organizationId: input.organizationId,
    authorityPresent: input.authority !== null,
    activeGrantCount: active.length,
    activeMissingHomeCount: missing.length,
    malformedHomePairCount: malformed.length,
    persistedHomeCounts,
    reportDigestSha256,
  })
}

export type GoogleCredentialHomeBackfillApplyInput = Readonly<{
  organizationId: OrganizationId
  selectedHome: GoogleCredentialHome
  expectedReportDigestSha256: string
  operatorId: UserId
  ticket: string
}>

export type GoogleCredentialHomeBackfillApplyResult =
  | Readonly<{ kind: 'applied'; updatedCount: number }>
  | Readonly<{
      kind:
        | 'stale_report'
        | 'authority_exists'
        | 'no_active_legacy_grants'
        | 'malformed_home_pair'
        | 'persisted_home_conflict'
    }>

export type OrganizationGoogleCredentialHomeBackfillStore = Readonly<{
  report(
    organizationId: OrganizationId,
  ): Promise<OrganizationGoogleCredentialHomeBackfillReport>
  /** Must re-lock, re-report, compare the digest, and mutate in one transaction. */
  apply(
    input: GoogleCredentialHomeBackfillApplyInput,
  ): Promise<GoogleCredentialHomeBackfillApplyResult>
}>

export function googleCredentialHomeBackfillConfirmation(
  input: Pick<
    GoogleCredentialHomeBackfillApplyInput,
    'organizationId' | 'selectedHome' | 'expectedReportDigestSha256'
  >,
): string {
  return `credential-home:${input.organizationId}:${input.selectedHome.homeCellId}:${input.expectedReportDigestSha256}`
}

export function createOrganizationGoogleCredentialHomeBackfill(
  deps: Readonly<{
    store: OrganizationGoogleCredentialHomeBackfillStore
  }>,
) {
  return Object.freeze({
    report: (organizationId: OrganizationId) => deps.store.report(organizationId),
    apply: async (
      input: GoogleCredentialHomeBackfillApplyInput & Readonly<{ confirmation: string }>,
    ): Promise<GoogleCredentialHomeBackfillApplyResult> => {
      if (
        !isDataCellAccepting(input.selectedHome.homeCellId) ||
        input.selectedHome.cataloguePolicyVersion !== DATA_CELL_CATALOGUE_POLICY_VERSION
      ) {
        throw new Error('Credential-home backfill target is unavailable')
      }
      if (!/^[a-f0-9]{64}$/u.test(input.expectedReportDigestSha256)) {
        throw new Error('Credential-home backfill report digest is invalid')
      }
      if (input.ticket.trim().length < 3) {
        throw new Error('Credential-home backfill ticket is required')
      }
      if (input.confirmation !== googleCredentialHomeBackfillConfirmation(input)) {
        throw new Error('Credential-home backfill confirmation is invalid')
      }
      const { confirmation: _confirmation, ...command } = input
      return deps.store.apply(command)
    },
  })
}

export function googleCredentialHomeBackfillTarget(
  homeCellId: DataCellId,
): GoogleCredentialHome {
  return Object.freeze({
    homeCellId,
    cataloguePolicyVersion: DATA_CELL_CATALOGUE_POLICY_VERSION,
  })
}
