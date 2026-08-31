import { describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import {
  createReleaseResponseTargetRemindersHandler,
  JOB_NAME,
} from './release-response-target-reminders.job'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

describe('release-response-target-reminders job', () => {
  it('is an enabled five-minute bounded background family', () => {
    expect(JOB_FAMILY_ROWS.filter((row) => row.jobName === JOB_NAME)).toEqual([
      expect.objectContaining({
        queue: 'background',
        processor:
          'src/contexts/inbox/infrastructure/jobs/release-response-target-reminders.job.ts',
        schedule: 'every:300000',
        capability: 'inbox.use',
        action: 'system:inbox.update',
        registration: 'enabled',
      }),
    ])
  })

  it('delegates one bounded pass and reports only content-free counts', async () => {
    const release = vi.fn(async () => ({ released: 5 }))
    const logger = { info: vi.fn() }
    const handler = createReleaseResponseTargetRemindersHandler({ release, logger })

    await expect(handler({ data: { ignored: true } } as Job)).resolves.toEqual({
      released: 5,
    })
    expect(release).toHaveBeenCalledTimes(1)
    expect(logger.info).toHaveBeenCalledWith(
      { job: JOB_NAME, released: 5 },
      'Response Target reminder release completed',
    )
  })

  it('propagates a failed authoritative release so the worker can retry', async () => {
    const release = vi.fn(async () => {
      throw new Error('database unavailable')
    })
    const logger = { info: vi.fn() }
    const handler = createReleaseResponseTargetRemindersHandler({ release, logger })

    await expect(handler({} as Job)).rejects.toThrow('database unavailable')
    expect(logger.info).not.toHaveBeenCalled()
  })
})
