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
import { runOperatorCommand } from './operator-command'

const fakes = vi.hoisted(() => ({
  env: {} as Record<string, string | undefined>,
  getDb: vi.fn(),
  createContainer: vi.fn(() => ({
    shutdown: { run: vi.fn(async () => {}) },
    opsQueues: {},
  })),
  runCore: vi.fn(async () => ({ exitCode: 0 })),
}))

vi.mock('../../src/shared/config/env', () => ({ getEnv: () => fakes.env }))
vi.mock('../../src/shared/db', () => ({ getDb: fakes.getDb }))
vi.mock('../../src/shared/db/pool', () => ({ closePool: vi.fn(async () => {}) }))
vi.mock('../../src/shared/observability/logger', () => ({ getLogger: vi.fn() }))
vi.mock('../../src/contexts/identity/infrastructure/policy-store-init', () => ({
  buildCapabilityPolicyHandle: () => ({ refresh: vi.fn(async () => {}) }),
}))
vi.mock('../../src/composition', () => ({
  claimProcessContainer: vi.fn(),
  releaseProcessContainer: vi.fn(),
}))
vi.mock('../../src/composition/operator-container', () => ({
  createOperatorContainer: fakes.createContainer,
}))
vi.mock('../../src/shared/jobs/queue', () => ({
  closeJobQueueConnections: vi.fn(async () => {}),
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

    it('refuses --help too: the runtime opens before the help text is printed', async () => {
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
