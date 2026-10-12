import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import type { CommandRunner } from './deploy-ci-images'
import {
  createCorsStore,
  desiredCorsRule,
  ensureStorageCors,
  formatStorageCorsReport,
  readStorageCorsConfig,
  satisfiesCors,
  type CorsRule,
  type CorsStore,
} from './storage-cors'

const ORIGIN = 'https://web-closed-beta-v2.up.railway.app'

const rule = (overrides: Partial<CorsRule> = {}): CorsRule => ({
  AllowedOrigins: [ORIGIN],
  AllowedMethods: ['PUT'],
  AllowedHeaders: ['*'],
  MaxAgeSeconds: 3000,
  ...overrides,
})

/** A bucket that keeps what it is given, like the real thing. */
function fakeStore(
  initial: readonly CorsRule[] | null,
  overrides: Partial<CorsStore> = {},
) {
  let rules = initial
  return {
    getRules: vi.fn(async () => rules),
    putRules: vi.fn(async (next: readonly CorsRule[]) => {
      rules = next
    }),
    current: () => rules,
    ...overrides,
  }
}

describe('desiredCorsRule', () => {
  it('lets the app origin PUT, and nothing else', () => {
    expect(desiredCorsRule(ORIGIN)).toEqual({
      AllowedOrigins: [ORIGIN],
      AllowedMethods: ['PUT'],
      AllowedHeaders: ['*'],
      MaxAgeSeconds: 3000,
    })
  })
})

describe('satisfiesCors', () => {
  it('accepts a rule that lets the origin PUT with any header', () => {
    expect(satisfiesCors([rule()], ORIGIN)).toBe(true)
  })

  it('accepts a rule that names the content-type header, whatever its case', () => {
    expect(satisfiesCors([rule({ AllowedHeaders: ['Content-Type'] })], ORIGIN)).toBe(true)
  })

  it.each([
    ['no rule', []],
    ['another origin', [rule({ AllowedOrigins: ['https://other.example.com'] })]],
    ['GET only', [rule({ AllowedMethods: ['GET'] })]],
    ['no header allowed', [rule({ AllowedHeaders: [] })]],
    ['a header that is not content-type', [rule({ AllowedHeaders: ['x-other'] })]],
  ])('refuses %s', (_label, rules) => {
    expect(satisfiesCors(rules, ORIGIN)).toBe(false)
  })
})

describe('ensureStorageCors', () => {
  it('reports a bucket that has no rule, and writes nothing without apply', async () => {
    const store = fakeStore(null)

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: false })

    expect(result.state).toBe('missing')
    expect(store.putRules).not.toHaveBeenCalled()
  })

  it('leaves a bucket that already allows the origin as it is', async () => {
    const store = fakeStore([rule()])

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: true })

    expect(result.state).toBe('in_place')
    expect(store.putRules).not.toHaveBeenCalled()
  })

  it('writes the rule on apply and reads it back', async () => {
    const store = fakeStore(null)

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: true })

    expect(result.state).toBe('applied')
    expect(store.putRules).toHaveBeenCalledExactlyOnceWith([desiredCorsRule(ORIGIN)])
    expect(satisfiesCors(store.current() ?? [], ORIGIN)).toBe(true)
    expect(store.getRules).toHaveBeenCalledTimes(2)
  })

  it('keeps the rules the bucket already has when it adds its own', async () => {
    const other = rule({
      AllowedOrigins: ['https://other.example.com'],
      AllowedMethods: ['GET'],
    })
    const store = fakeStore([other])

    await ensureStorageCors({ store, origin: ORIGIN, apply: true })

    expect(store.current()).toEqual([other, desiredCorsRule(ORIGIN)])
  })

  it('fails when the store does not keep what it was given', async () => {
    const store = fakeStore(null, { putRules: vi.fn(async () => {}) })

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: true })

    expect(result.state).toBe('not_kept')
  })

  it('fails, with the store’s own message, when the store refuses the rule', async () => {
    const store = fakeStore(null, {
      putRules: vi.fn(async () => {
        throw new Error('NotImplemented: PutBucketCors')
      }),
    })

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: true })

    expect(result).toMatchObject({
      state: 'failed',
      detail: expect.stringContaining('NotImplemented'),
    })
  })

  it('fails when the bucket cannot be read', async () => {
    const store = fakeStore(null, {
      getRules: vi.fn(async () => {
        throw new Error('AccessDenied')
      }),
    })

    const result = await ensureStorageCors({ store, origin: ORIGIN, apply: false })

    expect(result).toMatchObject({
      state: 'failed',
      detail: expect.stringContaining('AccessDenied'),
    })
  })
})

describe('formatStorageCorsReport', () => {
  it.each([
    ['in_place', true, 'ok'],
    ['applied', true, 'ok'],
    ['missing', false, 'MISSING'],
    ['not_kept', false, 'FAIL'],
    ['failed', false, 'FAIL'],
  ] as const)('says %s plainly', (state, ok, word) => {
    const report = { state, detail: 'x', ok } as const
    expect(formatStorageCorsReport(report, ORIGIN).join('\n')).toContain(word)
  })

  it('tells the operator how to fix a missing rule', () => {
    const lines = formatStorageCorsReport(
      { state: 'missing', detail: '', ok: false },
      ORIGIN,
    )

    expect(lines.join('\n')).toContain('pnpm ops storage-cors --apply')
  })
})

describe('readStorageCorsConfig', () => {
  const run = (stdout: string, status = 0): CommandRunner =>
    vi.fn(() => ({ status, stdout, stderr: '' }))
  const FULL = [
    'AWS_S3_ACCESS_KEY=access-never-printed',
    'AWS_S3_SECRET_ACCESS_KEY=secret-never-printed',
    'AWS_S3_BUCKET_NAME=object-store-ab12cd34',
    'AWS_S3_REGION=auto',
    'S3_INTERNAL_ENDPOINT=https://internal.example.com',
    'S3_PRESIGN_ENDPOINT=https://t3.storageapi.dev',
    'S3_FORCE_PATH_STYLE=false',
    `BETTER_AUTH_URL=${ORIGIN}/`,
  ].join('\n')

  it('reads the bucket and the app origin from the web service', () => {
    const runner = run(FULL)

    const config = readStorageCorsConfig(runner, ['--service', 'web'])

    expect(config).toMatchObject({
      bucketName: 'object-store-ab12cd34',
      region: 'auto',
      // The public endpoint: this runs on an operator's machine.
      endpoint: 'https://t3.storageapi.dev',
      forcePathStyle: false,
      appOrigin: ORIGIN,
    })
    expect(runner).toHaveBeenCalledWith('railway', [
      'variable',
      'list',
      '--service',
      'web',
      '--kv',
    ])
  })

  it('names what is missing, never a value', () => {
    expect(() =>
      readStorageCorsConfig(
        run('AWS_S3_BUCKET_NAME=b\nAWS_S3_SECRET_ACCESS_KEY=never'),
        [],
      ),
    ).toThrow(/AWS_S3_ACCESS_KEY, AWS_S3_REGION, BETTER_AUTH_URL/)
  })

  it('never puts the secret in a failure', () => {
    const runner: CommandRunner = () => ({
      status: 1,
      stdout: 'AWS_S3_SECRET_ACCESS_KEY=never',
      stderr: 'not logged in',
    })

    expect(() => readStorageCorsConfig(runner, [])).toThrow('not logged in')
    expect(() => readStorageCorsConfig(runner, [])).not.toThrow(/never/)
  })
})

describe('createCorsStore against an S3-compatible store', () => {
  /** A bucket that stores the CORS document it is sent, as S3 does. */
  async function withBucket<T>(run: (endpoint: string) => Promise<T>): Promise<T> {
    let stored: string | null = null
    const server = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        if (!req.url?.includes('cors')) return void res.writeHead(400).end()
        if (req.method === 'PUT') {
          stored = Buffer.concat(chunks).toString('utf8')
          return void res.writeHead(200).end()
        }
        if (stored === null) {
          res.writeHead(404, { 'content-type': 'application/xml' })
          return void res.end(
            '<Error><Code>NoSuchCORSConfiguration</Code><Message>none</Message></Error>',
          )
        }
        res.writeHead(200, { 'content-type': 'application/xml' })
        res.end(stored)
      })
    })
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    try {
      return await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
    } finally {
      await new Promise((done) => server.close(done))
    }
  }

  it('reads a bucket with no rules as none, writes the rule and reads it back', async () => {
    await withBucket(async (endpoint) => {
      const store = createCorsStore({
        accessKey: 'access',
        secretKey: 'secret',
        bucketName: 'repkey-test',
        region: 'auto',
        endpoint,
        forcePathStyle: true,
        appOrigin: ORIGIN,
      })
      expect(await store.getRules()).toBeNull()

      const result = await ensureStorageCors({ store, origin: ORIGIN, apply: true })

      expect(result.state).toBe('applied')
      expect(await store.getRules()).toEqual([desiredCorsRule(ORIGIN)])
    })
  })
})
