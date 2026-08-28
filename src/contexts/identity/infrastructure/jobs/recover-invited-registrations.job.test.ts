import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, run: () => Promise<unknown>) => run(),
}))

import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import {
  createRecoverInvitedRegistrationsHandler,
  JOB_NAME,
} from './recover-invited-registrations.job'

const MODULE_PATH = fileURLToPath(import.meta.url)
  .replace(/^.*?\/src\//, 'src/')
  .replace(/\.test\.ts$/, '.ts')

describe('recover invited registrations job', () => {
  beforeEach(() => vi.clearAllMocks())

  it('matches its governed repeatable job contract', () => {
    expect(
      JOB_FAMILY_ROWS.find(
        (row) => row.jobName === JOB_NAME && row.processor === MODULE_PATH,
      ),
    ).toMatchObject({
      queue: 'background',
      schedule: 'every:60000',
      registration: 'enabled',
    })
  })

  it('runs one bounded recovery pass and logs counts only', async () => {
    const recover = vi.fn().mockResolvedValue({
      claimed: 4,
      accepted: 1,
      awaitingProvider: 1,
      compensated: 1,
      manualReview: 0,
      claimsLost: 1,
      failures: 0,
    })

    await createRecoverInvitedRegistrationsHandler({ recover, logger: mockLogger })(
      {} as never,
    )

    expect(recover).toHaveBeenCalledOnce()
    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        job: JOB_NAME,
        claimed: 4,
        accepted: 1,
        awaitingProvider: 1,
        compensated: 1,
        manualReview: 0,
        claimsLost: 1,
        failures: 0,
      },
      'Invited registration recovery completed',
    )
  })

  it('fails the job after recording a partial batch failure', async () => {
    const recover = vi.fn().mockResolvedValue({
      claimed: 1,
      accepted: 0,
      awaitingProvider: 0,
      compensated: 0,
      manualReview: 0,
      claimsLost: 0,
      failures: 1,
    })

    await expect(
      createRecoverInvitedRegistrationsHandler({ recover, logger: mockLogger })(
        {} as never,
      ),
    ).rejects.toThrow('Invited registration recovery left 1 attempt unresolved')
  })
})
