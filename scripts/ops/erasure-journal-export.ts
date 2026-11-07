import { S3Client } from '@aws-sdk/client-s3'
import { open, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ErasureJournalBucket } from '../../src/shared/db/lifecycle/erasure-journal-bucket.server'
import {
  encodeErasureJournalExport,
  type ErasureJournalEntry,
} from '../../src/shared/db/lifecycle/erasure-journal.server'

type Environment = Readonly<Record<string, string | undefined>>
type JournalBucket = Readonly<{
  readEntries(): Promise<readonly ErasureJournalEntry[]>
  ensureExpiry(apply?: boolean): Promise<void>
}>

function createBucket(env: Environment): JournalBucket {
  const required = (key: string): string => {
    const value = env[key]
    if (!value?.trim()) throw new Error('Required bucket credentials are missing')
    return value
  }
  return new ErasureJournalBucket(
    new S3Client({
      region: required('AWS_S3_REGION'),
      credentials: {
        accessKeyId: required('AWS_S3_ACCESS_KEY'),
        secretAccessKey: required('AWS_S3_SECRET_ACCESS_KEY'),
      },
      endpoint: env.S3_PRESIGN_ENDPOINT || env.S3_INTERNAL_ENDPOINT || undefined,
      forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true',
    }),
    required('AWS_S3_BUCKET_NAME'),
  )
}

/** Run on the operator's machine, with their bucket credentials, before restoring. */
export async function runErasureJournalCommand(
  argv: readonly string[],
  env: Environment,
  bucketFor: (env: Environment) => JournalBucket = createBucket,
): Promise<void> {
  if (env.RESTORE_MODE)
    throw new Error('Bucket access is refused in an isolated restore process')
  const expiry = argv[0] === 'expiry'
  if (expiry) {
    if (argv.length > 2 || (argv[1] !== undefined && argv[1] !== '--apply')) {
      throw new Error('usage: pnpm ops erasure-journal-expiry [--apply]')
    }
    await bucketFor(env).ensureExpiry(argv[1] === '--apply')
    return
  }
  if (
    argv.length !== 2 ||
    argv[0] !== '--output' ||
    !argv[1] ||
    argv[1].startsWith('--')
  ) {
    throw new Error('usage: pnpm ops erasure-journal-export --output <file>')
  }
  const bucket = bucketFor(env)
  const exportedAt = new Date()
  const bytes = encodeErasureJournalExport(await bucket.readEntries(), exportedAt)
  const output = argv[1]
  const file = await open(output, 'wx', 0o600)
  try {
    await file.writeFile(bytes, 'utf8')
    await file.sync()
  } catch (error) {
    await file.close()
    await unlink(output)
    throw error
  }
  await file.close()
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void runErasureJournalCommand(process.argv.slice(2), process.env)
    .then(() => {
      console.log('Erasure journal command completed')
    })
    .catch(() => {
      console.error('Erasure journal command failed; no erasure was activated')
      process.exitCode = 1
    })
}
