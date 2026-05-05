// Integration context — list Google connections use case
// Simple: call connectionRepo.listByOrganization. No auth check needed — the repo already filters by visibility.

import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'

export type ListGoogleConnectionsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
}>

export const listGoogleConnections =
  (deps: ListGoogleConnectionsDeps) =>
  async (_input: void, ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
    return deps.connectionRepo.listByOrganization(ctx.organizationId, ctx.userId)
  }

export type ListGoogleConnections = ReturnType<typeof listGoogleConnections>
