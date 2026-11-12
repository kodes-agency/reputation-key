// The ops harness shim boots the policy runtime: it opens the database and
// builds the operator container, whose queue handles connect to the Redis the
// environment names. A command whose spec is `isolatedRestore` is refused
// before any of that unless it is a database-only isolated restore, and every
// other command boots as it always did.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  RESTORE_PREFLIGHT_SPEC,
  RESTORE_VERIFY_SPEC,
} from '../../src/shared/ops/restore-verify'
import { runDatabaseOperatorCommand, runOperatorCommand } from './operator-command'

const fakes = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  databaseEnv: {} as Record<string, string | undefined>,
  getDb: vi.fn(),
  bootOrder: [] as string[],
  createContainer: vi.fn(() => ({
    shutdown: { run: fakes.shutdown },
    opsQueues: { background: { close: fakes.closeQueue } },
  })),
  runCore: vi.fn(async () => ({ exitCode: 0 })),
  closePool: vi.fn(async () => {}),
  closeJobQueueConnections: vi.fn(async () => {}),
  releaseProcessContainer: vi.fn(),
  shutdown: vi.fn(async () => {}),
  closeQueue: vi.fn(async () => {}),
}))

vi.mock('../../src/shared/config/env', () => ({
  getEnv: () => fakes.env,
  getDatabaseOperatorEnv: () => {
    fakes.bootOrder.push('settings')
    return fakes.databaseEnv
  },
}))
vi.mock('../../src/shared/db', () => ({ getDb: fakes.getDb }))
vi.mock('../../src/shared/db/pool', () => ({ closePool: fakes.closePool }))
vi.mock('../../src/shared/observability/logger', () => ({ getLogger: vi.fn() }))
vi.mock('../../src/contexts/identity/infrastructure/policy-store-init', () => ({
  buildCapabilityPolicyHandle: () => ({ refresh: vi.fn(async () => {}) }),
}))
vi.mock('../../src/composition', () => ({
  claimProcessContainer: vi.fn(),
  releaseProcessContainer: fakes.releaseProcessContainer,
}))
vi.mock('../../src/composition/operator-container', () => ({
  createOperatorContainer: fakes.createContainer,
}))
vi.mock('../../src/shared/jobs/queue', () => ({
  closeJobQueueConnections: fakes.closeJobQueueConnections,
}))
vi.mock('../../src/shared/auth/process-policy-binding', () => ({
  bindProcessPolicies: vi.fn(),
  releaseProcessPolicies: vi.fn(),
}))
vi.mock('../../src/shared/ops/operator-command', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/shared/ops/operator-command')>()),
  runOperatorCommand: fakes.runCore,
}))

const ISOLATED_RESTORE_ENV = {
  RESTORE_MODE: 'isolated',
  DATABASE_URL:
    'postgresql://u:p@postgres-restored-20260825-1015.railway.internal/restored',
  RESTORE_DATABASE_SERVICE_NAME: 'Postgres-restored-20260825-1015',
  RAILWAY_PROJECT_ID: 'project-id',
  RAILWAY_ENVIRONMENT_ID: 'beta-id',
  RAILWAY_ENVIRONMENT_NAME: 'closed-beta-v2',
}

describe.each([RESTORE_PREFLIGHT_SPEC, RESTORE_VERIFY_SPEC])(
  '$name boot isolation',
  (spec) => {
    const action = vi.fn(async () => 0)

    beforeEach(() => {
      vi.clearAllMocks()
      fakes.env = { ...ISOLATED_RESTORE_ENV }
    })

    it('boots the harness for a database-only isolated restore', async () => {
      expect(await runOperatorCommand(spec, action, ['--operator', 'operator'])).toEqual({
        exitCode: 0,
      })
      expect(fakes.getDb).toHaveBeenCalledOnce()
      expect(fakes.createContainer).toHaveBeenCalledOnce()
      expect(fakes.runCore).toHaveBeenCalledOnce()
    })

    // Planted faults: each leaves the harness unbooted. Opening the database or
    // building the container would connect the queue handles to the Redis the
    // environment names, which is the live one when the environment is a copy.
    it.each([
      ['not an isolated restore', 'RESTORE_MODE', undefined],
      [
        'the live database',
        'DATABASE_URL',
        'postgresql://u:p@postgres.railway.internal/live',
      ],
      ['a different environment', 'RAILWAY_ENVIRONMENT_NAME', 'production'],
      ['production Redis', 'REDIS_URL', 'redis://redis.railway.internal:6379'],
      [
        'production Redis (provider)',
        'PROVIDER_EPHEMERAL_REDIS_URL',
        'rediss://provider.railway.internal:6380',
      ],
      [
        'production queue namespace',
        'QUEUE_REDIS_URL',
        'redis://queues.railway.internal:6379',
      ],
      [
        'production bucket endpoint',
        'S3_INTERNAL_ENDPOINT',
        'https://objects.example.com',
      ],
      [
        'production bucket endpoint (browser)',
        'S3_PRESIGN_ENDPOINT',
        'https://public-objects.example.com',
      ],
      ['production bucket', 'AWS_S3_BUCKET_NAME', 'live-bucket'],
      ['production bucket credentials', 'AWS_S3_ACCESS_KEY', 'inherited-access-key'],
      [
        'production bucket credentials (secret)',
        'AWS_S3_SECRET_ACCESS_KEY',
        'inherited-secret-key',
      ],
    ])('refuses %s before opening any runtime handle', async (_label, setting, value) => {
      fakes.env[setting] = value

      await expect(
        runOperatorCommand(spec, action, ['--operator', 'operator']),
      ).rejects.toThrow(/RESTORE MODE/)
      expect(fakes.getDb).not.toHaveBeenCalled()
      expect(fakes.createContainer).not.toHaveBeenCalled()
      expect(fakes.runCore).not.toHaveBeenCalled()
      expect(action).not.toHaveBeenCalled()
    })

    it('refuses --help too: the environment check runs before the help text', async () => {
      fakes.env.QUEUE_REDIS_URL = 'redis://queues.railway.internal:6379'

      await expect(runOperatorCommand(spec, action, ['--help'])).rejects.toThrow(
        /RESTORE MODE/,
      )
      expect(fakes.createContainer).not.toHaveBeenCalled()
    })
  },
)

describe('a command that is not a restore command', () => {
  it('boots with the queue and bucket settings the environment carries', async () => {
    vi.clearAllMocks()
    fakes.env = {
      DATABASE_URL: 'postgresql://u:p@postgres.railway.internal/live',
      QUEUE_REDIS_URL: 'redis://queues.railway.internal:6379',
      AWS_S3_BUCKET_NAME: 'live-bucket',
    }
    const spec = { name: 'ops:inspect', scope: 'global' as const, usage: 'ops:inspect' }

    expect(
      await runOperatorCommand(
        spec,
        vi.fn(async () => 0),
        [],
      ),
    ).toEqual({
      exitCode: 0,
    })
    expect(fakes.createContainer).toHaveBeenCalledOnce()
  })
})

describe('--help', () => {
  it('prints usage and opens no settings, database or container', async () => {
    vi.clearAllMocks()
    fakes.env = {}
    const spec = {
      name: 'ops:inspect',
      scope: 'global' as const,
      usage: 'ops:inspect <id>',
    }
    const io = { out: vi.fn(), err: vi.fn() }

    expect(await runOperatorCommand(spec, vi.fn(), ['--help'], io)).toEqual({
      exitCode: 0,
    })
    expect(io.out).toHaveBeenCalledWith('usage: ops:inspect <id>')
    expect(fakes.getDb).not.toHaveBeenCalled()
    expect(fakes.createContainer).not.toHaveBeenCalled()
    expect(fakes.runCore).not.toHaveBeenCalled()
    expect(fakes.closePool).not.toHaveBeenCalled()
  })
})

describe('a command that runs', () => {
  const spec = {
    name: 'ops:inspect',
    scope: 'global' as const,
    usage: 'ops:inspect <id>',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    fakes.env = {}
  })

  it.each([0, 1, 2])(
    'passes exit code %i through and closes everything',
    async (exitCode) => {
      fakes.runCore.mockResolvedValueOnce({ exitCode })

      expect(await runOperatorCommand(spec, vi.fn(), ['x'])).toEqual({ exitCode })
      expect(fakes.shutdown).toHaveBeenCalledOnce()
      expect(fakes.closeQueue).toHaveBeenCalledOnce()
      expect(fakes.releaseProcessContainer).toHaveBeenCalledOnce()
      expect(fakes.closeJobQueueConnections).toHaveBeenCalledOnce()
      expect(fakes.closePool).toHaveBeenCalledOnce()
    },
  )

  it('still closes the queues and pool when the command throws', async () => {
    fakes.runCore.mockRejectedValueOnce(new Error('boom'))

    await expect(runOperatorCommand(spec, vi.fn(), ['x'])).rejects.toThrow('boom')
    expect(fakes.releaseProcessContainer).toHaveBeenCalledOnce()
    expect(fakes.closeJobQueueConnections).toHaveBeenCalledOnce()
    expect(fakes.closePool).toHaveBeenCalledOnce()
  })
})

describe('restore apply confirmation before boot', () => {
  it.each([undefined, 'production', 'ops:restore-verify'])(
    'refuses %s without opening any runtime handle',
    async (confirmation) => {
      vi.clearAllMocks()
      fakes.env = { ...ISOLATED_RESTORE_ENV }
      const argv = [
        '--operator',
        'operator',
        '--reason',
        'restore',
        '--apply',
        ...(confirmation === undefined ? [] : ['--yes', confirmation]),
      ]
      const io = { out: vi.fn(), err: vi.fn() }
      expect(await runOperatorCommand(RESTORE_VERIFY_SPEC, vi.fn(), argv, io)).toEqual({
        exitCode: 1,
      })
      expect(io.err).toHaveBeenCalledWith(expect.stringContaining('--yes closed-beta-v2'))
      expect(fakes.getDb).not.toHaveBeenCalled()
      expect(fakes.createContainer).not.toHaveBeenCalled()
      expect(fakes.runCore).not.toHaveBeenCalled()
    },
  )
  it('boots with the exact environment confirmation', async () => {
    vi.clearAllMocks()
    fakes.env = { ...ISOLATED_RESTORE_ENV }
    expect(
      await runOperatorCommand(RESTORE_VERIFY_SPEC, vi.fn(), [
        '--operator',
        'operator',
        '--reason',
        'restore',
        '--apply',
        '--yes',
        'closed-beta-v2',
      ]),
    ).toEqual({ exitCode: 0 })
    expect(fakes.getDb).toHaveBeenCalledOnce()
  })
})

describe('a command that needs only the database and queue settings', () => {
  const spec = { name: 'ops:queue', scope: 'global' as const, usage: 'ops:queue' }

  beforeEach(() => {
    vi.clearAllMocks()
    fakes.env = {}
    fakes.databaseEnv = {}
  })

  it('runs without building the application container and closes the pool', async () => {
    const action = vi.fn(async () => 0)

    expect(await runDatabaseOperatorCommand(spec, action, [])).toEqual({ exitCode: 0 })
    expect(fakes.getDb).toHaveBeenCalledOnce()
    expect(fakes.runCore).toHaveBeenCalledOnce()
    expect(fakes.createContainer).not.toHaveBeenCalled()
    expect(fakes.closeJobQueueConnections).toHaveBeenCalledOnce()
    expect(fakes.closePool).toHaveBeenCalledOnce()
  })

  it('reads the database settings before the pool reads its own', async () => {
    fakes.bootOrder.length = 0
    fakes.getDb.mockImplementationOnce(() => {
      fakes.bootOrder.push('pool')
    })

    await runDatabaseOperatorCommand(spec, vi.fn(), [])
    expect(fakes.bootOrder).toEqual(['settings', 'pool'])
  })

  it('closes the pool when the command throws', async () => {
    fakes.runCore.mockRejectedValueOnce(new Error('boom'))

    await expect(runDatabaseOperatorCommand(spec, vi.fn(), [])).rejects.toThrow('boom')
    expect(fakes.closePool).toHaveBeenCalledOnce()
  })

  it('prints usage on --help and opens nothing', async () => {
    const io = { out: vi.fn(), err: vi.fn() }

    expect(await runDatabaseOperatorCommand(spec, vi.fn(), ['--help'], io)).toEqual({
      exitCode: 0,
    })
    expect(io.out).toHaveBeenCalledWith('usage: ops:queue')
    expect(fakes.getDb).not.toHaveBeenCalled()
  })
})
