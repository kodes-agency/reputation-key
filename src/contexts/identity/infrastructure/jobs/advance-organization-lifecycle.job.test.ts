import type { Job } from 'bullmq'
import { describe, expect, it, vi } from 'vitest'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createAdvanceOrganizationLifecycleHandler,
  JOB_NAME,
} from './advance-organization-lifecycle.job'

const EMPTY_PASS = {
  examined: 0,
  transitioned: 0,
  failed: 0,
  closingPrepared: 0,
  purgePending: 0,
  closed: 0,
} as const

describe('advance Organization lifecycle job', () => {
  it('owns a bounded quarantined five-minute schedule', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toEqual([
      expect.objectContaining({
        queue: 'background',
        schedule: 'every:300000',
        registration: 'quarantined',
      }),
    ])
  })

  it('executes one bounded pass and rejects unresolved contributions safely', async () => {
    const logger = { info: vi.fn() }
    const advance = vi.fn(async () => EMPTY_PASS)
    const handler = createAdvanceOrganizationLifecycleHandler({ advance, logger })

    await expect(handler({} as Job)).resolves.toEqual({
      configured: true,
      ...EMPTY_PASS,
    })
    expect(advance).toHaveBeenCalledTimes(1)

    const failed = createAdvanceOrganizationLifecycleHandler({
      advance: async () => ({ ...EMPTY_PASS, examined: 1, failed: 1 }),
      logger,
    })
    await expect(failed({} as Job)).rejects.toMatchObject({
      _tag: 'OrganizationLifecycleJobError',
      code: 'context_contribution_failed',
      message: 'Organization lifecycle maintenance has unresolved context contributions',
    })
  })

  it('uses an explicit no-mutation safety result while contributor binding is absent', async () => {
    await expect(
      createAdvanceOrganizationLifecycleHandler({ logger: { info: vi.fn() } })({} as Job),
    ).resolves.toEqual({ configured: false })
  })
})
