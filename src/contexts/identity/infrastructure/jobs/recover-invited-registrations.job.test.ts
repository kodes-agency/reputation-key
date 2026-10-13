import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, run: () => Promise<unknown>) => run(),
}))

import { organizationId } from '#/shared/domain/ids'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import type { RecoverInvitedRegistrationsRun } from '../../application/use-cases/recover-invited-registrations'
import {
  createRecoverInvitedRegistrationsHandler,
  JOB_NAME,
} from './recover-invited-registrations.job'

const authorizeScope = vi.fn(async (_organizationId: string) => true)

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
      // Recovery accepts invitations, so it runs under their capability.
      capability: 'identity.invite',
      action: 'system:identity.accept_invitation',
    })
  })

  it('runs one bounded recovery pass and logs counts only', async () => {
    const recover = vi.fn().mockResolvedValue({
      claimed: 4,
      accepted: 1,
      denied: 1,
      awaitingProvider: 1,
      compensated: 1,
      manualReview: 0,
      failures: 0,
    })

    await createRecoverInvitedRegistrationsHandler({
      recover,
      authorizeScope,
      logger: mockLogger,
    })({} as never)

    expect(recover).toHaveBeenCalledOnce()
    expect(mockLogger.info).toHaveBeenCalledWith(
      {
        job: JOB_NAME,
        claimed: 4,
        accepted: 1,
        denied: 1,
        awaitingProvider: 1,
        compensated: 1,
        manualReview: 0,
        failures: 0,
      },
      'Invited registration recovery completed',
    )
  })

  it("hands the pass the schedule's own authorizer, one Organization at a time", async () => {
    const asked: boolean[] = []
    const recover = vi.fn(async (run: RecoverInvitedRegistrationsRun) => {
      asked.push(await run.authorizeOrganization(organizationId('org-open')))
      asked.push(await run.authorizeOrganization(organizationId('org-stopped')))
      return {
        claimed: 2,
        accepted: 1,
        denied: 1,
        awaitingProvider: 0,
        compensated: 0,
        manualReview: 0,
        failures: 0,
      }
    })
    authorizeScope.mockImplementation(async (id: string) => id === 'org-open')

    await createRecoverInvitedRegistrationsHandler({
      recover,
      authorizeScope,
      logger: mockLogger,
    })({} as never)

    expect(asked).toEqual([true, false])
    expect(authorizeScope.mock.calls).toEqual([['org-open'], ['org-stopped']])
  })

  it('fails the job after recording a partial batch failure', async () => {
    const recover = vi.fn().mockResolvedValue({
      claimed: 1,
      accepted: 0,
      denied: 0,
      awaitingProvider: 0,
      compensated: 0,
      manualReview: 0,
      failures: 1,
    })

    await expect(
      createRecoverInvitedRegistrationsHandler({
        recover,
        authorizeScope,
        logger: mockLogger,
      })({} as never),
    ).rejects.toThrow(
      'Invited registration recovery left 1 verification record unresolved',
    )
  })
})
