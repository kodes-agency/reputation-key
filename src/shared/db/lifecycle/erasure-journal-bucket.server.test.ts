import { expect, it, vi } from 'vitest'
import { ErasureJournalBucket } from './erasure-journal-bucket.server'
import {
  encodeErasureJournalEntry,
  erasureJournalKey,
  ERASURE_JOURNAL_PREFIX,
} from './erasure-journal.server'

const key = erasureJournalKey('30000000-0000-4000-8000-00000000000a')
const bytes = encodeErasureJournalEntry({
  id: '30000000-0000-4000-8000-00000000000a',
  recordedBeforeErasure: true,
  subjectClass: 'organization',
  organizationId: 'org-journal',
  context: 'guest',
  closureLineageId: '30000000-0000-4000-8000-000000000001',
  lifecycleRevision: 1,
  effectiveErasureAt: new Date('2026-11-07T12:00:00.000Z'),
  erasedRowCount: 0,
  evidenceRef: 'guest:purge:batch-1',
})
const expiry = {
  Rules: [
    {
      ID: 'erasure-journal-expiry',
      Status: 'Enabled',
      Filter: { Prefix: ERASURE_JOURNAL_PREFIX },
      Expiration: { Days: 45 },
      NoncurrentVersionExpiration: { NoncurrentDays: 45 },
    },
  ],
}
it('accepts an immutable retry only when the existing bytes are identical', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(expiry)
    .mockRejectedValueOnce({ name: 'PreconditionFailed' })
    .mockResolvedValueOnce({
      ContentLength: 4,
      Body: { transformToString: async () => 'same' },
    })
  const bucket = new ErasureJournalBucket({ send }, 'test-bucket')
  await expect(bucket.put(key, bytes)).rejects.toThrow('different bytes')
})

it('accepts exact immutable retries without replacing the journal evidence', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce(expiry)
    .mockRejectedValueOnce({ name: 'PreconditionFailed' })
    .mockResolvedValueOnce({
      ContentLength: bytes.length,
      Body: { transformToString: async () => bytes },
    })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').put(key, bytes),
  ).resolves.toBeUndefined()
})

it('refuses writes when expiry is unconfigured or another rule expires evidence early', async () => {
  for (const rules of [
    [],
    [{ ID: 'all', Status: 'Enabled', Filter: { Prefix: '' }, Expiration: { Days: 7 } }],
  ]) {
    const send = vi.fn().mockResolvedValue({ Rules: rules })
    await expect(
      new ErasureJournalBucket({ send }, 'test-bucket').put(key, bytes),
    ).rejects.toThrow(/expiry|too early/u)
    expect(send).toHaveBeenCalledTimes(1)
  }
})

it('configures only journal expiry, preserves other rules, and verifies read-back', async () => {
  const unrelated = {
    ID: 'exports',
    Status: 'Enabled',
    Filter: { Prefix: 'private/exports/' },
    Expiration: { Days: 7 },
  }
  const send = vi
    .fn()
    .mockResolvedValueOnce({ Rules: [unrelated] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ Rules: [unrelated, ...expiry.Rules] })
  await new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true)
  expect(send.mock.calls[1]?.[0].input.LifecycleConfiguration.Rules).toEqual([
    unrelated,
    ...expiry.Rules,
  ])
})

it('fails if the bucket accepts but does not keep the expiry rule', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ Rules: [] })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({ Rules: [] })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true),
  ).rejects.toThrow('not configured')
})

it('exports every page and refuses an incomplete listing or a foreign namespace', async () => {
  const object = {
    ContentLength: bytes.length,
    Body: { transformToString: async () => bytes },
  }
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      Contents: [],
      IsTruncated: true,
      NextContinuationToken: 'next',
    })
    .mockResolvedValueOnce({ Contents: [{ Key: key }], IsTruncated: false })
    .mockResolvedValueOnce(object)
  const entries = await new ErasureJournalBucket({ send }, 'test-bucket').readEntries()
  expect(entries).toHaveLength(1)
  expect(entries[0]?.organizationId).toBe('org-journal')
  expect(send.mock.calls[1]?.[0].input.ContinuationToken).toBe('next')
  const stuck = vi.fn().mockResolvedValue({ IsTruncated: true })
  await expect(
    new ErasureJournalBucket({ send: stuck }, 'test-bucket').readEntries(),
  ).rejects.toThrow('no progress')
  const foreign = vi
    .fn()
    .mockResolvedValueOnce({ Contents: [{ Key: 'private/another-area/file.json' }] })
  await expect(
    new ErasureJournalBucket({ send: foreign }, 'test-bucket').readEntries(),
  ).rejects.toThrow('Invalid erasure journal ID')
  expect(foreign).toHaveBeenCalledTimes(1)
})

it('preserves the bucket-wide minimum transition size policy when adding expiry', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      Rules: [],
      TransitionDefaultMinimumObjectSize: 'varies_by_storage_class',
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      ...expiry,
      TransitionDefaultMinimumObjectSize: 'varies_by_storage_class',
    })
  await new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true)
  expect(send.mock.calls[1]?.[0].input.TransitionDefaultMinimumObjectSize).toBe(
    'varies_by_storage_class',
  )
})

it('accepts an explicit provider default when no prior lifecycle policy existed', async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      ...expiry,
      TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K',
    })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true),
  ).resolves.toBeUndefined()
})

it.each([
  { Filter: { And: { Prefix: 'private/' } }, Expiration: { Days: 44 } },
  { Prefix: `${ERASURE_JOURNAL_PREFIX}nested/`, Expiration: { Days: 44 } },
  { Filter: { Prefix: ERASURE_JOURNAL_PREFIX }, Expiration: { Date: new Date() } },
])('refuses overlapping early expiry before applying any rule: %j', async (rule) => {
  const send = vi.fn().mockResolvedValue({
    Rules: [...expiry.Rules, { ID: 'overlapping', Status: 'Enabled', ...rule }],
  })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true),
  ).rejects.toThrow('Bucket lifecycle expires journal evidence too early')
  expect(send).toHaveBeenCalledTimes(1)
})

it('refuses to replace an expiry rule ID belonging to another prefix', async () => {
  const send = vi.fn().mockResolvedValue({
    Rules: [{ ...expiry.Rules[0], Filter: { Prefix: 'private/exports/' } }],
  })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true),
  ).rejects.toThrow('Journal expiry rule ID is already used by another filter')
  expect(send).toHaveBeenCalledTimes(1)
})

it('refuses a read-back that changes the prior transition size policy', async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({
      Rules: [],
      TransitionDefaultMinimumObjectSize: 'varies_by_storage_class',
    })
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce({
      ...expiry,
      TransitionDefaultMinimumObjectSize: 'all_storage_classes_128K',
    })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').ensureExpiry(true),
  ).rejects.toThrow('Bucket transition size policy was not preserved')
})

it('refuses repeated pagination tokens instead of returning an incomplete export', async () => {
  const send = vi.fn().mockResolvedValue({
    Contents: [],
    IsTruncated: true,
    NextContinuationToken: 'repeated',
  })
  await expect(
    new ErasureJournalBucket({ send }, 'test-bucket').readEntries(),
  ).rejects.toThrow('Journal listing made no progress')
  expect(send).toHaveBeenCalledTimes(2)
})

it.each([[{ Key: key }, { Key: key }], [{}]])(
  'refuses duplicate or missing object keys: %j',
  async (...contents) => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: contents })
      .mockResolvedValueOnce({
        ContentLength: bytes.length,
        Body: { transformToString: async () => bytes },
      })
    await expect(
      new ErasureJournalBucket({ send }, 'test-bucket').readEntries(),
    ).rejects.toThrow('Erasure journal listing is invalid or exceeds the export bound')
    expect(send).toHaveBeenCalledTimes(contents.length)
  },
)
