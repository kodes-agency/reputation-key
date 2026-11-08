import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ErasureJournalBucket } from '#/shared/db/lifecycle/erasure-journal-bucket.server'
import { createMockLogger } from '#/shared/testing/mock-logger'
import {
  createGuestWithdrawalJournal,
  type GuestWithdrawalJournalConfig,
} from './guest-withdrawal-journal.server'

const { env, capture } = vi.hoisted(() => ({
  env: {} as {
    -readonly [K in keyof GuestWithdrawalJournalConfig]: GuestWithdrawalJournalConfig[K]
  },
  capture: vi.fn(),
}))
vi.mock('#/shared/observability/telemetry', () => ({
  captureObservabilityException: capture,
}))

const deps = () => ({ logger: createMockLogger(), idGen: () => 'unused', config: env })

beforeEach(() => {
  for (const key of Object.keys(env))
    delete env[key as keyof GuestWithdrawalJournalConfig]
  Object.assign(env, {
    AWS_S3_REGION: 'us-east-1',
    AWS_S3_ACCESS_KEY: 'fake-key',
    AWS_S3_SECRET_ACCESS_KEY: 'fake-secret',
    AWS_S3_BUCKET_NAME: 'private-bucket',
  })
  capture.mockClear()
})
afterEach(() => vi.restoreAllMocks())

it('ships with guest journaling inactive and does not construct a bucket writer', () => {
  const put = vi.spyOn(ErasureJournalBucket.prototype, 'put')
  expect(createGuestWithdrawalJournal(deps())).toBeUndefined()
  expect(put).not.toHaveBeenCalled()
})

it('uses the existing journal bucket adapter when activated', async () => {
  const put = vi.spyOn(ErasureJournalBucket.prototype, 'put').mockResolvedValue()
  const journal = createGuestWithdrawalJournal(deps(), true)!
  await journal.put('private/erasure-journal/test', 'IDs-only evidence')
  expect(put).toHaveBeenCalledWith('private/erasure-journal/test', 'IDs-only evidence')
})

it('refuses bucket access during isolated restore', async () => {
  const put = vi.spyOn(ErasureJournalBucket.prototype, 'put').mockResolvedValue()
  env.RESTORE_MODE = 'isolated'
  await expect(
    createGuestWithdrawalJournal(deps(), true)!.put('unused', 'unused'),
  ).rejects.toThrow('Bucket access is refused during restore')
  expect(put).not.toHaveBeenCalled()
})

it('refuses missing credentials without attempting a bucket write', async () => {
  const put = vi.spyOn(ErasureJournalBucket.prototype, 'put').mockResolvedValue()
  delete env.AWS_S3_SECRET_ACCESS_KEY
  await expect(
    createGuestWithdrawalJournal(deps(), true)!.put('unused', 'unused'),
  ).rejects.toThrow('Required bucket credentials are missing')
  expect(put).not.toHaveBeenCalled()
})

it('reports journal failure to monitoring without any subject identifiers', () => {
  const dependency = deps()
  const errorLog = vi.spyOn(dependency.logger, 'error')
  createGuestWithdrawalJournal(dependency, true)!.alert({
    journalId: 'private-journal-identity',
    context: 'guest',
  })
  expect(errorLog).toHaveBeenCalledWith('guest.erasure_journal_write_failed')
  expect(capture).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'GuestErasureJournalWriteFailed' }),
    {
      source: 'alert-dispatcher',
      alert: { name: 'guest.erasure_journal_write_failed', severity: 'P2' },
    },
  )
})
