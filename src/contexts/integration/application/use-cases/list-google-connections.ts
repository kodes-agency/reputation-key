// Integration context — list Google connections use case
// Authorization: can() check lives here (use-case layer), not in the repo.

import type {
  GoogleConnectionRepository,
  ConnectionVisibilityFilter,
} from '../ports/google-connection.repository'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { integrationError } from '../../domain/errors'
import { canManageOrganizationGoogleConnections } from '../google-organization-authority'

export type ListGoogleConnectionsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
}>

export const listGoogleConnections =
  (deps: ListGoogleConnectionsDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
    if (!canManageOrganizationGoogleConnections(ctx)) {
      throw integrationError(
        'forbidden',
        'Insufficient permissions to manage integrations',
      )
    }

    const filter: ConnectionVisibilityFilter = { showAll: true }

    return deps.connectionRepo.listByOrganization(ctx.organizationId, filter)
  }

export type ListGoogleConnections = ReturnType<typeof listGoogleConnections>
