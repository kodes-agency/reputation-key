// Integration context — get import status use case tests

import { describe, it, expect } from 'vitest'
import { getImportStatus } from './get-import-status'
import { createInMemoryGbpImportRepo } from '#/shared/testing/in-memory-gbp-import-repo'
import { buildTestAuthContext, buildTestGbpImportJob } from '#/shared/testing/fixtures'
import { isIntegrationError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'

const setup = () => {
  const importRepo = createInMemoryGbpImportRepo()
  const deps = { importRepo }
  const useCase = getImportStatus(deps)
  return { useCase, importRepo }
}

describe('getImportStatus', () => {
  it('returns job when found in same org', async () => {
    const { useCase, importRepo } = setup()
    const ctx = buildTestAuthContext()
    const job = buildTestGbpImportJob({
      organizationId: ctx.organizationId,
    })
    importRepo.seed([job])

    const result = await useCase({ importId: job.id as string }, ctx)

    expect(result.id).toBe(job.id)
    expect(result.organizationId).toBe(ctx.organizationId)
    expect(result.status).toBe('queued')
  })

  it("throws import_not_found when job doesn't exist", async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext()

    await expect(
      useCase({ importId: 'nonexistent-0000-0000-0000-000000000001' }, ctx),
    ).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'import_not_found',
    )
  })

  it('throws import_not_found when job exists in different org', async () => {
    const { useCase, importRepo } = setup()
    const ctx = buildTestAuthContext()
    // Job belongs to a different org
    const otherOrgJob = buildTestGbpImportJob({
      organizationId: organizationId('other-org-0000-0000-0000-000000000001'),
    })
    importRepo.seed([otherOrgJob])

    await expect(useCase({ importId: otherOrgJob.id as string }, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        isIntegrationError(e) && (e as { code: string }).code === 'import_not_found',
    )
  })
})
