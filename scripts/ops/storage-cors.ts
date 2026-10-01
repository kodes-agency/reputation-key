// `pnpm ops storage-cors [--apply]` — make the object-store bucket accept the
// browser's upload of an avatar or an organization logo.
//
// A browser PUT to the bucket is cross-origin, so the bucket needs a CORS rule
// that lets the app's own origin (BETTER_AUTH_URL) PUT. Without it the
// preflight is refused and the upload fails in the browser even though the
// signature is right, and nothing in the app can see that. It is set through
// the S3 API with the repository-pinned SDK, from the web service's own
// variables, so there is no hand-built payload and no aws CLI.
//
// Report mode (the default) only reads. `--apply` adds the rule when no rule
// lets the origin PUT, keeps every rule the bucket already has, then reads the
// bucket back and fails unless the rule is there. Idempotent. `deploy-ci-images`
// runs it after every deploy: report-only when it only reports, applying when it
// deploys.

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { buildS3ClientConfigs } from '../../src/contexts/portal/infrastructure/adapters/s3-storage.adapter'
import {
  CLOSED_BETA_IMAGE_SERVICES,
  defaultCommandRunner,
  railwayTargetArgs,
  type CommandRunner,
} from './deploy-ci-images'

export type CorsRule = Readonly<{
  AllowedOrigins: readonly string[]
  AllowedMethods: readonly string[]
  AllowedHeaders?: readonly string[]
  MaxAgeSeconds?: number
}>

/** The bucket's CORS configuration, as the two calls the command needs. */
export type CorsStore = Readonly<{
  /** The rules, or null when the bucket has none. */
  getRules: () => Promise<readonly CorsRule[] | null>
  putRules: (rules: readonly CorsRule[]) => Promise<void>
}>

export type StorageCorsState = 'in_place' | 'applied' | 'missing' | 'not_kept' | 'failed'
export type StorageCorsResult = Readonly<{
  state: StorageCorsState
  detail: string
  ok: boolean
}>

const PREFLIGHT_CACHE_SECONDS = 3000

/** What an upload needs: the app's origin may PUT, with the headers a browser sends. */
export const desiredCorsRule = (origin: string): CorsRule => ({
  AllowedOrigins: [origin],
  AllowedMethods: ['PUT'],
  AllowedHeaders: ['*'],
  MaxAgeSeconds: PREFLIGHT_CACHE_SECONDS,
})

/** Whether some rule already lets `origin` PUT a typed body (a presigned upload). */
export const satisfiesCors = (rules: readonly CorsRule[], origin: string): boolean =>
  rules.some(
    (rule) =>
      rule.AllowedOrigins.includes(origin) &&
      rule.AllowedMethods.includes('PUT') &&
      (rule.AllowedHeaders ?? []).some(
        (header) => header === '*' || header.toLowerCase() === 'content-type',
      ),
  )

const message = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

const result = (state: StorageCorsState, detail: string): StorageCorsResult => ({
  state,
  detail,
  ok: state === 'in_place' || state === 'applied',
})

export async function ensureStorageCors(
  input: Readonly<{ store: CorsStore; origin: string; apply: boolean }>,
): Promise<StorageCorsResult> {
  const { store, origin } = input
  let existing: readonly CorsRule[]
  try {
    existing = (await store.getRules()) ?? []
  } catch (error) {
    return result('failed', `could not read the bucket's CORS rules (${message(error)})`)
  }
  if (satisfiesCors(existing, origin)) {
    return result('in_place', `a rule already lets ${origin} PUT`)
  }
  if (!input.apply) return result('missing', `no rule lets ${origin} PUT`)

  try {
    await store.putRules([...existing, desiredCorsRule(origin)])
  } catch (error) {
    return result('failed', `the store refused the rule (${message(error)})`)
  }
  try {
    const after = (await store.getRules()) ?? []
    return satisfiesCors(after, origin)
      ? result('applied', `added a rule that lets ${origin} PUT, and read it back`)
      : result('not_kept', 'the store accepted the rule but did not keep it')
  } catch (error) {
    return result('failed', `could not read the rule back (${message(error)})`)
  }
}

export function formatStorageCorsReport(
  report: StorageCorsResult,
  origin: string,
): string[] {
  switch (report.state) {
    case 'in_place':
    case 'applied':
      return [`Storage CORS: ok — ${report.detail}`]
    case 'missing':
      return [
        `Storage CORS: MISSING — ${report.detail}, so avatar and logo uploads fail in the browser`,
        `  Add it with \`pnpm ops storage-cors --apply\` (origin ${origin}, method PUT only)`,
      ]
    default:
      return [`Storage CORS: FAIL — ${report.detail}`]
  }
}

const REQUIRED_VARIABLES = [
  'AWS_S3_ACCESS_KEY',
  'AWS_S3_SECRET_ACCESS_KEY',
  'AWS_S3_BUCKET_NAME',
  'AWS_S3_REGION',
  'BETTER_AUTH_URL',
] as const

export type StorageCorsConfig = Readonly<{
  accessKey: string
  secretKey: string
  bucketName: string
  region: string
  /** The bucket's public endpoint: this runs on an operator's machine, not inside the cell. */
  endpoint: string | undefined
  forcePathStyle: boolean
  appOrigin: string
}>

/** The bucket and the app origin, read from the deployed web service's variables. */
export function readStorageCorsConfig(
  runner: CommandRunner,
  targetArgs: readonly string[],
): StorageCorsConfig {
  const args = ['variable', 'list', ...targetArgs, '--kv']
  const listed = runner('railway', args)
  if (listed.status !== 0) {
    // stderr only: stdout of a variable listing holds secrets.
    throw new Error(
      `railway ${args.join(' ')} failed: ${listed.stderr.trim() || 'no diagnostic output'}`,
    )
  }
  const values = new Map<string, string>()
  for (const line of listed.stdout.split('\n')) {
    const separator = line.indexOf('=')
    if (separator > 0)
      values.set(line.slice(0, separator), line.slice(separator + 1).trim())
  }
  const missing = REQUIRED_VARIABLES.filter((name) => !values.get(name))
  if (missing.length > 0) {
    throw new Error(`the web service is missing ${missing.join(', ')}`)
  }
  return {
    accessKey: values.get('AWS_S3_ACCESS_KEY')!,
    secretKey: values.get('AWS_S3_SECRET_ACCESS_KEY')!,
    bucketName: values.get('AWS_S3_BUCKET_NAME')!,
    region: values.get('AWS_S3_REGION')!,
    endpoint: values.get('S3_PRESIGN_ENDPOINT') || values.get('S3_INTERNAL_ENDPOINT'),
    forcePathStyle: values.get('S3_FORCE_PATH_STYLE')?.toLowerCase() === 'true',
    appOrigin: new URL(values.get('BETTER_AUTH_URL')!).origin,
  }
}

/** The bucket's CORS configuration through the pinned SDK, signed like the adapter's own client. */
export function createCorsStore(config: StorageCorsConfig): CorsStore {
  const { presign } = buildS3ClientConfigs({
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    bucketName: config.bucketName,
    region: config.region,
    presignEndpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
  })
  const client = new S3Client(presign)
  const bucket = config.bucketName
  return {
    getRules: async () => {
      try {
        const out = await client.send(new GetBucketCorsCommand({ Bucket: bucket }))
        return (out.CORSRules ?? []).map((rule) => ({
          AllowedOrigins: rule.AllowedOrigins ?? [],
          AllowedMethods: rule.AllowedMethods ?? [],
          ...(rule.AllowedHeaders ? { AllowedHeaders: rule.AllowedHeaders } : {}),
          ...(rule.MaxAgeSeconds === undefined
            ? {}
            : { MaxAgeSeconds: rule.MaxAgeSeconds }),
        }))
      } catch (error) {
        if (
          error instanceof S3ServiceException &&
          error.name === 'NoSuchCORSConfiguration'
        ) {
          return null
        }
        throw error
      }
    },
    putRules: async (rules) => {
      await client.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: rules.map((rule) => ({
              AllowedOrigins: [...rule.AllowedOrigins],
              AllowedMethods: [...rule.AllowedMethods],
              ...(rule.AllowedHeaders
                ? { AllowedHeaders: [...rule.AllowedHeaders] }
                : {}),
              ...(rule.MaxAgeSeconds === undefined
                ? {}
                : { MaxAgeSeconds: rule.MaxAgeSeconds }),
            })),
          },
        }),
      )
    },
  }
}

/** Reads the web service's bucket, checks (or applies) the rule and prints; true when it is in place. */
export async function runStorageCors(
  input: Readonly<{
    apply: boolean
    out: (line: string) => void
    runner?: CommandRunner
    storeFor?: (config: StorageCorsConfig) => CorsStore
  }>,
): Promise<boolean> {
  const web = CLOSED_BETA_IMAGE_SERVICES.find(({ serviceName }) => serviceName === 'web')!
  const config = readStorageCorsConfig(
    input.runner ?? defaultCommandRunner,
    railwayTargetArgs(web.serviceId),
  )
  const report = await ensureStorageCors({
    store: (input.storeFor ?? createCorsStore)(config),
    origin: config.appOrigin,
    apply: input.apply,
  })
  for (const line of formatStorageCorsReport(report, config.appOrigin)) input.out(line)
  return report.ok
}

const USAGE = 'pnpm ops storage-cors [--apply]'

async function main(argv: readonly string[]): Promise<number> {
  const unknown = argv.filter((token) => token !== '--apply')
  if (unknown.length > 0) throw new Error(`usage: ${USAGE}`)
  return (await runStorageCors({ apply: argv.includes('--apply'), out: console.log }))
    ? 0
    : 1
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  void main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code
    })
    .catch((error: unknown) => {
      process.stderr.write(`ops:storage-cors failed: ${message(error)}\n`)
      process.exitCode = 1
    })
}
