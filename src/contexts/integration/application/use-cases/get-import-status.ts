// Integration context — get import status use case
// Simple: find job by ID, return it. Minimal auth (just verify job exists).

import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { GbpImportJob } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ImportStatusInput } from '../dto/import-status.dto'
import { gbpImportJobId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { integrationError } from '../../domain/errors'

export type GetImportStatusDeps = Readonly<{
  importRepo: GbpImportRepository
}>

export const getImportStatus =
  (deps: GetImportStatusDeps) =>
  async (input: ImportStatusInput, ctx: AuthContext): Promise<GbpImportJob> => {
    if (!can(ctx.role, 'property.create')) {
      throw integrationError(
        'forbidden',
        'Insufficient permissions to view import status',
      )
    }

    const importJobId = gbpImportJobId(input.importId)

    // Find job scoped to organization
    const job = await deps.importRepo.findById(ctx.organizationId, importJobId)
    if (!job) {
      throw integrationError('import_not_found', 'Import job not found')
    }

    return job
  }

export type GetImportStatus = ReturnType<typeof getImportStatus>
