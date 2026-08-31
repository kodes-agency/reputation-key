import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createGenerateOrganizationExportHandler,
  JOB_NAME,
} from './generate-organization-export.job'

describe('generate Organization Export job', () => {
  it('owns a one-claim quarantined one-minute schedule', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toEqual([
      expect.objectContaining({
        queue: 'background',
        schedule: 'every:60000',
        registration: 'quarantined',
      }),
    ])
  })

  it('returns only content-free booleans and has a no-mutation safety result', async () => {
    const logger = { info: vi.fn() }
    await expect(
      createGenerateOrganizationExportHandler({
        generateNext: async () => null,
        logger,
      })({} as Job),
    ).resolves.toEqual({ configured: true, claimed: false })
    await expect(
      createGenerateOrganizationExportHandler({ logger })({} as Job),
    ).resolves.toEqual({ configured: false, claimed: false })
  })

  it('replaces provider or storage details with a fixed tagged error', async () => {
    const handler = createGenerateOrganizationExportHandler({
      generateNext: async () => {
        throw new Error('provider response included protected details')
      },
      logger: { info: vi.fn() },
    })
    await expect(handler({} as Job)).rejects.toMatchObject({
      _tag: 'OrganizationLifecycleJobError',
      code: 'export_generation_failed',
      message: 'Organization Export generation could not complete',
    })
  })
})
