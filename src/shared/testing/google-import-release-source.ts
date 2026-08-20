import { createHash } from 'node:crypto'

const FULL_GIT_COMMIT = /^[a-f0-9]{40}$/

const RELEASE_SECRET_ENV = new Set([
  'BETTER_AUTH_SECRET',
  'DATABASE_URL',
  'ENCRYPTION_KEY',
  'GOOGLE_CLIENT_SECRET',
  'OAUTH_STATE_SECRET',
  'POSTGRES_PASSWORD',
  'REVIEW_PROVIDER_SUBJECT_HMAC_MIGRATOR_KEYS',
])

export function redactedReleaseCommandText(
  command: string,
  args: readonly string[],
): string {
  const redacted = args.map((arg) => {
    const separator = arg.indexOf('=')
    if (separator <= 0) return arg
    const name = arg.slice(0, separator)
    return RELEASE_SECRET_ENV.has(name) ? `${name}=[redacted]` : arg
  })
  return [command, ...redacted].join(' ')
}

export type GoogleImportReleaseSourcePlan = Readonly<{
  schemaVersion: 'google-import-release-source-v1'
  baselineCommit: string
  compatibilityCommit: string
  finalCommit: string
}>

export type GoogleImportReleaseImageIdentity = Readonly<{
  tag: string
  sourceRevision: string | null
  user: string
}>

export function assertGoogleImportReleaseImageIdentity(
  proof: GoogleImportReleaseImageIdentity,
  expectedRevision: string,
  options: Readonly<{ allowUnlabeledMaterializedSource?: boolean }> = {},
): void {
  const unlabeledMaterializedSource =
    options.allowUnlabeledMaterializedSource === true && proof.sourceRevision === null
  if (proof.sourceRevision !== expectedRevision && !unlabeledMaterializedSource) {
    throw new Error(`${proof.tag} source revision label mismatch`)
  }
  if (proof.user !== 'node') throw new Error(`${proof.tag} does not run as node`)
}

export type GoogleImportRuntimePackageProof = Readonly<{
  tag: string
  hasScripts: boolean
}>

export function assertGoogleImportRuntimePackagePurity(
  proof: GoogleImportRuntimePackageProof,
  options: Readonly<{ scriptPolicy?: 'forbid' | 'allow' }> = {},
): void {
  if (proof.hasScripts && options.scriptPolicy !== 'allow') {
    throw new Error(`${proof.tag} contains package scripts`)
  }
}

function assertFullCommit(value: string, field: string): void {
  if (!FULL_GIT_COMMIT.test(value)) {
    throw new Error(`${field} must be a full lowercase 40-character Git commit`)
  }
}

export function createGoogleImportReleaseSourcePlan(
  input: Readonly<{
    baselineCommit: string
    compatibilityCommit: string
    finalCommit: string
  }>,
): GoogleImportReleaseSourcePlan {
  assertFullCommit(input.baselineCommit, 'baselineCommit')
  assertFullCommit(input.compatibilityCommit, 'compatibilityCommit')
  assertFullCommit(input.finalCommit, 'finalCommit')

  if (new Set(Object.values(input)).size !== 3) {
    throw new Error('Release source commits must be distinct')
  }

  return Object.freeze({
    schemaVersion: 'google-import-release-source-v1',
    baselineCommit: input.baselineCommit,
    compatibilityCommit: input.compatibilityCommit,
    finalCommit: input.finalCommit,
  })
}

export function releaseSourcePlanSha256(plan: GoogleImportReleaseSourcePlan): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}
