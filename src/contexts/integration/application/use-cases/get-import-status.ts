// Integration context — get import status use case
// Simple: find job by ID, return it. Minimal auth (just verify job exists).

import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { GbpImportJob } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { ImportStatusInput } from '../dto/import-status.dto'
import { gbpImportJobId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type GetImportStatusDeps = Readonly<{
  importRepo: GbpImportRepository
}>

export const getImportStatus =
  (deps: GetImportStatusDeps) =>
  async (input: ImportStatusInput, ctx: AuthContext): Promise<GbpImportJob> => {
    const importJobId = gbpImportJobId(input.importId)

    // Find job
    const job = await deps.importRepo.findById(importJobId)
    if (!job) {
      throw integrationError('import_not_found', 'Import job not found')
    }

    // Verify job belongs to the user's organization
    if (job.organizationId !== ctx.organizationId) {
      throw integrationError('import_not_found', 'Import job not found')
    }

    return job
  }

export type GetImportStatus = ReturnType<typeof getImportStatus>
