import { expect, it, vi } from 'vitest'
import type { RightsRequestEffects } from '../../src/shared/ops/rights/run-rights-request'
import type { runOperatorCommand } from './operator-command'

const fakes = vi.hoisted(() => ({
  effects: undefined as RightsRequestEffects | undefined,
  deleteObject: vi.fn(async () => {}),
  storage: vi.fn(),
  exit: vi.fn(),
}))

vi.mock('./operator-command', () => ({
  runOperatorCommand: async (
    _spec: unknown,
    action: Parameters<typeof runOperatorCommand>[1],
  ) => ({
    exitCode: await action(
      { container: {} } as Parameters<typeof action>[0],
      {} as Parameters<typeof action>[1],
      { out: vi.fn(), err: vi.fn() },
    ),
  }),
}))
vi.mock('../../src/shared/ops/rights/run-rights-request', () => ({
  handleRightsRequest: async (effects: RightsRequestEffects) => {
    fakes.effects = effects
    return 0
  },
}))
vi.mock('../../src/shared/db', () => ({ getDb: () => ({}) }))
vi.mock('../../src/shared/config/env', () => ({
  getEnv: () => ({
    NODE_ENV: 'production',
    AWS_S3_ACCESS_KEY: 'test-access',
    AWS_S3_SECRET_ACCESS_KEY: 'test-secret',
    AWS_S3_BUCKET_NAME: 'test-images',
    AWS_S3_REGION: 'auto',
    S3_INTERNAL_ENDPOINT: 'https://internal.example.test',
    S3_PRESIGN_ENDPOINT: 'https://public.example.test',
    S3_FORCE_PATH_STYLE: true,
  }),
}))
vi.mock('../../src/contexts/portal/infrastructure/adapters/s3-storage.adapter', () => ({
  createS3StorageAdapter: fakes.storage,
}))

it('wires Portal and the configured image store into the operator command', async () => {
  fakes.storage.mockReturnValue({ deleteObject: fakes.deleteObject })
  const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
    fakes.exit()
  }) as typeof process.exit)
  try {
    await import('./rights-request')
    await vi.waitFor(() => expect(fakes.exit).toHaveBeenCalledOnce())
    expect(fakes.effects?.environment).toBe(process.env)
    const executors = fakes.effects!.executors(false)
    expect(executors.map(({ name }) => name)).toContain('portal')
    expect(fakes.storage).toHaveBeenCalledWith({
      accessKey: 'test-access',
      secretKey: 'test-secret',
      bucketName: 'test-images',
      region: 'auto',
      internalEndpoint: 'https://internal.example.test',
      presignEndpoint: 'https://public.example.test',
      forcePathStyle: true,
    })
  } finally {
    exit.mockRestore()
  }
})
