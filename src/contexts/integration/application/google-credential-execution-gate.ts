import {
  DATA_CELL_CATALOGUE_POLICY_VERSION,
  isDataCellAccepting,
  type DataCellId,
} from '#/shared/domain/data-cell-catalogue'
import type { DataCellExecutionDecision } from '#/shared/routing/data-cell-execution-fence'
import { integrationError } from '../domain/errors'
import type { GoogleConnection } from '../domain/types'

export type AssertDirectGoogleCredentialUse = (
  connection: GoogleConnection,
  propertyIds?: readonly string[],
) => Promise<void>

/**
 * Phase-A direct-use gate. A broker grant never reaches this seam: broker mode
 * must eventually obtain a sealed reference from the home service and must not
 * decrypt the refresh/access token in the target process.
 */
export function createDirectGoogleCredentialUseGate(
  deps: Readonly<{
    localCellId: DataCellId
    admitPropertyExecution(propertyId: string): Promise<DataCellExecutionDecision>
  }>,
): AssertDirectGoogleCredentialUse {
  return async (connection, propertyIds = []) => {
    if (
      !isDataCellAccepting(deps.localCellId) ||
      connection.credentialHomeCellId === null ||
      connection.credentialHomeAuthorityGeneration === null ||
      connection.credentialHomeAuthorityGeneration < 1 ||
      connection.credentialHomePolicyVersion !== DATA_CELL_CATALOGUE_POLICY_VERSION ||
      connection.credentialHomeCellId !== deps.localCellId
    ) {
      throw integrationError(
        'connection_disconnected',
        'Google credential is unavailable in this data cell',
      )
    }
    for (const propertyId of new Set(propertyIds)) {
      const decision = await deps.admitPropertyExecution(propertyId)
      if (decision.kind !== 'allow' || decision.cell !== deps.localCellId) {
        throw integrationError(
          'connection_disconnected',
          'Google credential is unavailable for this Property data cell',
        )
      }
    }
  }
}
