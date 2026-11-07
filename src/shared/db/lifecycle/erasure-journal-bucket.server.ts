import {
  GetBucketLifecycleConfigurationCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutBucketLifecycleConfigurationCommand,
  PutObjectCommand,
  type LifecycleRule,
  type ListObjectsV2CommandOutput,
  type S3Client,
  type TransitionDefaultMinimumObjectSize,
} from '@aws-sdk/client-s3'
import {
  decodeErasureJournalEntry,
  erasureJournalKey,
  ERASURE_JOURNAL_EXPIRY_DAYS,
  ERASURE_JOURNAL_PREFIX,
  type ErasureJournalEntry,
} from './erasure-journal.server'

const EXPIRY_RULE_ID = 'erasure-journal-expiry'
const MAX_OBJECT_BYTES = 16_384
const MAX_EXPORT_ENTRIES = 100_000
const DEADLINE_MS = 30_000

function named(error: unknown, name: string): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === name
  )
}

function assertKey(key: string): void {
  const id = key.slice(ERASURE_JOURNAL_PREFIX.length, -5)
  if (erasureJournalKey(id) !== key) throw new Error('Invalid erasure journal object key')
}

function assertJournalRetention(rules: readonly LifecycleRule[]): void {
  for (const rule of rules) {
    const prefix = rule.Filter?.Prefix ?? rule.Filter?.And?.Prefix ?? rule.Prefix ?? ''
    const overlaps =
      ERASURE_JOURNAL_PREFIX.startsWith(prefix) ||
      prefix.startsWith(ERASURE_JOURNAL_PREFIX)
    if (
      rule.Status === 'Enabled' &&
      overlaps &&
      rule.Expiration &&
      (rule.Expiration.Date ||
        (rule.Expiration.Days ?? Infinity) < ERASURE_JOURNAL_EXPIRY_DAYS)
    ) {
      throw new Error('Bucket lifecycle expires journal evidence too early')
    }
  }
}

const JOURNAL_EXPIRY_RULE: LifecycleRule = {
  ID: EXPIRY_RULE_ID,
  Status: 'Enabled',
  Filter: { Prefix: ERASURE_JOURNAL_PREFIX },
  Expiration: { Days: ERASURE_JOURNAL_EXPIRY_DAYS },
  NoncurrentVersionExpiration: { NoncurrentDays: ERASURE_JOURNAL_EXPIRY_DAYS },
}

function journalExpiryIsConfigured(rules: readonly LifecycleRule[]): boolean {
  const existing = rules.find(({ ID }) => ID === EXPIRY_RULE_ID)
  if (
    existing &&
    JSON.stringify(existing.Filter) !== JSON.stringify(JOURNAL_EXPIRY_RULE.Filter)
  ) {
    throw new Error('Journal expiry rule ID is already used by another filter')
  }
  return (
    existing?.Status === 'Enabled' &&
    existing.Expiration?.Days === ERASURE_JOURNAL_EXPIRY_DAYS &&
    !existing.Expiration.Date &&
    existing.NoncurrentVersionExpiration?.NoncurrentDays === ERASURE_JOURNAL_EXPIRY_DAYS
  )
}

function nextListingCursor(
  response: ListObjectsV2CommandOutput,
  cursors: Set<string>,
): string | undefined {
  const next = response.IsTruncated ? response.NextContinuationToken : undefined
  if (response.IsTruncated && (!next || cursors.has(next)))
    throw new Error('Journal listing made no progress')
  if (next) cursors.add(next)
  return next
}

/** Uses the existing bucket; only the journal prefix is ever written or listed. */
export class ErasureJournalBucket {
  constructor(
    private readonly client: Pick<S3Client, 'send'>,
    private readonly bucket: string,
  ) {}

  async ensureExpiry(apply = false): Promise<void> {
    await this.configureExpiry(apply)
  }

  private async configureExpiry(
    apply: boolean,
  ): Promise<TransitionDefaultMinimumObjectSize | undefined> {
    let transitionSize: TransitionDefaultMinimumObjectSize | undefined
    let rules: LifecycleRule[]
    try {
      const response = await this.client.send(
        new GetBucketLifecycleConfigurationCommand({ Bucket: this.bucket }),
        { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
      )
      rules = response.Rules ?? []
      transitionSize = response.TransitionDefaultMinimumObjectSize
    } catch (error) {
      if (!named(error, 'NoSuchLifecycleConfiguration')) throw error
      rules = []
    }
    assertJournalRetention(rules)
    if (journalExpiryIsConfigured(rules)) return transitionSize
    if (!apply) throw new Error('Erasure journal 45-day expiry is not configured')
    await this.client.send(
      new PutBucketLifecycleConfigurationCommand({
        Bucket: this.bucket,
        TransitionDefaultMinimumObjectSize: transitionSize,
        LifecycleConfiguration: {
          Rules: [
            ...rules.filter(({ ID }) => ID !== EXPIRY_RULE_ID),
            JOURNAL_EXPIRY_RULE,
          ],
        },
      }),
      { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
    )
    const afterTransitionSize = await this.configureExpiry(false)
    if (transitionSize !== undefined && afterTransitionSize !== transitionSize)
      throw new Error('Bucket transition size policy was not preserved')
    return afterTransitionSize
  }

  async put(key: string, bytes: string): Promise<void> {
    assertKey(key)
    const entry = decodeErasureJournalEntry(bytes)
    if (
      erasureJournalKey(entry.id) !== key ||
      Buffer.byteLength(bytes) > MAX_OBJECT_BYTES
    ) {
      throw new Error('Invalid erasure journal object')
    }
    await this.ensureExpiry()
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: 'application/json',
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
      )
    } catch (error) {
      if (!named(error, 'PreconditionFailed')) throw error
      if ((await this.read(key)) !== bytes)
        throw new Error('Journal ID is bound to different bytes', { cause: error })
    }
  }

  private async read(key: string): Promise<string> {
    assertKey(key)
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
    )
    if (!response.Body || (response.ContentLength ?? Infinity) > MAX_OBJECT_BYTES) {
      throw new Error('Invalid erasure journal object size')
    }
    const bytes = await response.Body.transformToString()
    if (Buffer.byteLength(bytes) > MAX_OBJECT_BYTES)
      throw new Error('Invalid erasure journal object size')
    return bytes
  }

  async readEntries(): Promise<readonly ErasureJournalEntry[]> {
    const entries: ErasureJournalEntry[] = []
    const seen = new Set<string>()
    let cursor: string | undefined
    const cursors = new Set<string>()
    let pages = 0
    do {
      if (++pages > 1000) throw new Error('Journal export page bound exceeded')
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: ERASURE_JOURNAL_PREFIX,
          ContinuationToken: cursor,
          MaxKeys: 1000,
        }),
        { abortSignal: AbortSignal.timeout(DEADLINE_MS) },
      )
      for (const object of response.Contents ?? []) {
        if (!object.Key || entries.length >= MAX_EXPORT_ENTRIES || seen.has(object.Key)) {
          throw new Error(
            'Erasure journal listing is invalid or exceeds the export bound',
          )
        }
        seen.add(object.Key)
        const entry = decodeErasureJournalEntry(await this.read(object.Key))
        if (erasureJournalKey(entry.id) !== object.Key)
          throw new Error('Journal ID does not match its object key')
        entries.push(entry)
      }
      cursor = nextListingCursor(response, cursors)
    } while (cursor)
    return entries.sort((a, b) => a.id.localeCompare(b.id))
  }
}
