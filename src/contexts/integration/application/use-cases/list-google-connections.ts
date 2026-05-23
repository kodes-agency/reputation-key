// Integration context — list Google connections use case
// Authorization: hasRole check lives here (use-case layer), not in the repo.

import type {
  GoogleConnectionRepository,
  ConnectionVisibilityFilter,
} from '../ports/google-connection.repository'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import { can } from '#/shared/domain/permissions'
import { hasRole } from '#/shared/domain/roles'
import { integrationError } from '../../domain/errors'

export type ListGoogleConnectionsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
}>

export const listGoogleConnections =
  (deps: ListGoogleConnectionsDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError(
        'forbidden',
        'Insufficient permissions to manage integrations',
      )
    }

    const filter: ConnectionVisibilityFilter = hasRole(ctx.role, 'AccountAdmin')
      ? { showAll: true }
      : { showAll: false, userId: ctx.userId }

    return deps.connectionRepo.listByOrganization(ctx.organizationId, filter)
  }

export type ListGoogleConnections = ReturnType<typeof listGoogleConnections>
