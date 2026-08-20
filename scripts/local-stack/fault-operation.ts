import { randomUUID } from 'node:crypto'
import Redis from 'ioredis'
import { Pool } from 'pg'
import { createGbpApiAdapter } from '../../src/contexts/integration/infrastructure/adapters/gbp-api.adapter'
import { createS3StorageAdapter } from '../../src/contexts/portal/infrastructure/adapters/s3-storage.adapter'

const dependency = process.argv[2]
const phase = process.argv[3]
if (!dependency || (phase !== 'fault' && phase !== 'recovery')) {
  throw new Error(
    'Usage: fault-operation <db|redis|object-store|gbp|mail|web> <fault|recovery>',
  )
}

async function operation(): Promise<void> {
  switch (dependency) {
    case 'db': {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        connectionTimeoutMillis: 2_000,
      })
      try {
        await pool.query('SELECT 1')
      } finally {
        await pool.end()
      }
      return
    }
    case 'redis': {
      const redis = new Redis(process.env.REDIS_URL!, {
        connectTimeout: 2_000,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      })
      redis.on('error', () => {
        // The failed operation below is the fault evidence. Prevent ioredis from
        // emitting an additional unhandled-error diagnostic after disconnect.
      })
      try {
        const key = `local-fault:${randomUUID()}`
        await redis.set(key, '1', 'EX', 30)
        if ((await redis.get(key)) !== '1') throw new Error('Redis readback mismatch')
        await redis.del(key)
      } finally {
        redis.disconnect()
      }
      return
    }
    case 'object-store': {
      const storage = createS3StorageAdapter({
        accessKey: process.env.AWS_S3_ACCESS_KEY,
        secretKey: process.env.AWS_S3_SECRET_ACCESS_KEY,
        bucketName: process.env.AWS_S3_BUCKET_NAME,
        region: process.env.AWS_S3_REGION ?? 'us-east-1',
        internalEndpoint: process.env.S3_INTERNAL_ENDPOINT,
        presignEndpoint: process.env.S3_PRESIGN_ENDPOINT,
        forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      })
      const key = `fault-probe/${randomUUID()}.txt`
      await storage.putObject(
        key,
        Buffer.from('local application fault probe'),
        'text/plain',
      )
      await storage.inspectObject(key)
      await storage.deleteObject(key)
      return
    }
    case 'gbp': {
      await createGbpApiAdapter({
        baseUrl:
          process.env.GBP_ACCOUNT_MANAGEMENT_BASE_URL ??
          'https://provider-sandbox:4100/v1',
      }).listAccounts('local-fault-token')
      return
    }
    case 'mail': {
      const response = await fetch(
        `${process.env.RESEND_BASE_URL ?? 'http://mail-stub:4101'}/emails`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'content-type': 'application/json',
            'idempotency-key': `local-fault-${phase}`,
          },
          body: JSON.stringify({
            from: 'Reputation Key <info@kodes.agency>',
            to: 'fault-probe@example.com',
            subject: 'Local fault probe',
            html: '<p>probe</p>',
          }),
          signal: AbortSignal.timeout(2_000),
        },
      )
      if (!response.ok) throw new Error(`Mail provider returned ${response.status}`)
      return
    }
    case 'web': {
      const response = await fetch('http://web:3000/api/health/started', {
        signal: AbortSignal.timeout(2_000),
      })
      if (!response.ok) throw new Error(`Web returned ${response.status}`)
      return
    }
    default:
      throw new Error(`Unsupported fault dependency: ${dependency}`)
  }
}

async function main(): Promise<void> {
  try {
    await operation()
    if (phase === 'fault') {
      throw new Error(`${dependency} operation unexpectedly succeeded during fault`)
    }
    process.stdout.write(
      `${JSON.stringify({ dependency, phase, observed: 'success' })}\n`,
    )
  } catch (error: unknown) {
    if (
      phase === 'fault' &&
      !(error instanceof Error && error.message.includes('unexpectedly succeeded'))
    ) {
      process.stdout.write(
        `${JSON.stringify({
          dependency,
          phase,
          observed: 'failed-closed',
          error: error instanceof Error ? error.message : String(error),
        })}\n`,
      )
      return
    }
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
