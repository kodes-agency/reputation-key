import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createPurgeExpiredOrganizationExportsHandler,
  JOB_NAME,
} from './purge-expired-organization-exports.job'

describe('purge expired Organization Exports job', () => {
  it('owns a one-object quarantined hourly schedule', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toEqual([
      expect.objectContaining({
        queue: 'background',
        schedule: 'every:3600000',
        registration: 'quarantined',
      }),
    ])
  })

  it('returns only content-free booleans and has a no-mutation safety result', async () => {
    const logger = { info: vi.fn() }
    await expect(
      createPurgeExpiredOrganizationExportsHandler({
        purgeNextExpired: async () => true,
        logger,
      })({} as Job),
    ).resolves.toEqual({ configured: true, deleted: true })
    await expect(
      createPurgeExpiredOrganizationExportsHandler({ logger })({} as Job),
    ).resolves.toEqual({ configured: false, deleted: false })
  })

  it('replaces storage details with a fixed tagged error', async () => {
    const handler = createPurgeExpiredOrganizationExportsHandler({
      purgeNextExpired: async () => {
        throw new Error('storage endpoint and key leaked here')
      },
      logger: { info: vi.fn() },
    })
    await expect(handler({} as Job)).rejects.toMatchObject({
      _tag: 'OrganizationLifecycleJobError',
      code: 'export_deletion_failed',
      message: 'Organization Export deletion could not complete',
    })
  })
})
