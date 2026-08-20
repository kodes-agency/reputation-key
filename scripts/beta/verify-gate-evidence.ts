import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type EvidenceFile = Readonly<{
  path: string
  content: string
  digest: string
  value: Record<string, unknown>
}>

function flagValue(args: readonly string[], name: string): string | undefined {
  const prefix = `${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function readEvidence(path: string): EvidenceFile {
  const absolutePath = resolve(path)
  const content = readFileSync(absolutePath, 'utf8')
  const digest = createHash('sha256').update(content, 'utf8').digest('hex')
  const checksum = readFileSync(`${absolutePath}.sha256`, 'utf8')
  if (checksum !== `${digest}  ${basename(absolutePath)}\n`)
    throw new Error(`Evidence checksum mismatch: ${path}`)
  const parsed = JSON.parse(content) as unknown
  if (typeof parsed !== 'object' || parsed == null || Array.isArray(parsed))
    throw new Error(`Evidence is not a JSON object: ${path}`)
  const value = parsed as Record<string, unknown>
  if (value.schemaVersion !== 'beta-local-1')
    throw new Error(`Evidence has wrong schema version: ${path}`)
  return { path, content, digest, value }
}

function requireKind(file: EvidenceFile, expected: string): void {
  if (file.value.evidenceKind !== expected)
    throw new Error(`Evidence ${file.path} is not ${expected}`)
}
function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value == null || Array.isArray(value))
    throw new Error(`${label} must be a JSON object`)
  return value as Record<string, unknown>
}

function migrationHeadTag(value: unknown, label: string): string {
  if (typeof value === 'string' && value.trim()) return value
  const proof = objectValue(value, label)
  if (typeof proof.expectedTag !== 'string' || !proof.expectedTag.trim())
    throw new Error(`${label} is missing expectedTag`)
  return proof.expectedTag
}

function verifyScale(path: string): void {
  const file = readEvidence(path)
  requireKind(file, 'synthetic-local-scale-and-bounded-query')
  for (const field of ['scaleFixtureFileSha256', 'fleetFixtureFileSha256']) {
    if (
      typeof file.value[field] !== 'string' ||
      !/^[0-9a-f]{64}$/.test(file.value[field])
    )
      throw new Error(`Scale evidence has invalid ${field}`)
  }
}

function verifyFaults(path: string): void {
  const file = readEvidence(path)
  requireKind(file, 'local-application-fault-smoke')
  const assertions = file.value.assertions
  if (typeof assertions !== 'object' || assertions == null || Array.isArray(assertions))
    throw new Error('Fault evidence is missing assertions')
  const required = [
    'allFaultsObserved',
    'allFailedClosed',
    'allRecovered',
    'noDuplicateExternalEffects',
    'idempotentRestarts',
  ]
  for (const name of required) {
    if ((assertions as Record<string, unknown>)[name] !== true)
      throw new Error(`Fault assertion did not pass: ${name}`)
  }
}

function verifyMigration(cleanPath: string, upgradePath: string): void {
  const clean = readEvidence(cleanPath)
  const upgrade = readEvidence(upgradePath)
  requireKind(clean, 'local-production-profile-clean-smoke')
  requireKind(upgrade, 'versioned-pre-cutover-local-upgrade')
  if (clean.value.sourceRevision !== upgrade.value.sourceRevision)
    throw new Error('Clean and upgrade evidence use different source revisions')
  if (
    clean.value.revisionIdentityChecked !== true ||
    upgrade.value.revisionIdentityChecked !== true
  )
    throw new Error('Clean or upgrade evidence did not verify image revision identity')
  if (
    typeof upgrade.value.pendingUpgradeCount !== 'number' ||
    upgrade.value.pendingUpgradeCount <= 0
  )
    throw new Error('Upgrade evidence did not prove pending migrations')
  const proof = objectValue(upgrade.value.legacyFixtureProof, 'legacyFixtureProof')
  const before = objectValue(proof.before, 'legacyFixtureProof.before')
  const after = objectValue(proof.after, 'legacyFixtureProof.after')
  if (
    proof.survived !== true ||
    before.fixtureVersion !== 'beta-local-1' ||
    before.oldMigrationHead !== '0021_demonic_misty_knight' ||
    after.fixtureVersion !== before.fixtureVersion ||
    after.oldMigrationHead !== before.oldMigrationHead ||
    JSON.stringify(after.legacySeedState) !== JSON.stringify(before.legacySeedState)
  )
    throw new Error('Legacy fixture did not survive the pending migration upgrade')
}

function verifyReleaseBundle(args: readonly string[]): void {
  const acceptanceIndex = readEvidence(flagValue(args, '--acceptance-index') ?? '')
  requireKind(acceptanceIndex, 'local-stack-acceptance-index')
  const identityObservation = readEvidence(
    flagValue(args, '--identity-observation') ?? '',
  )
  requireKind(identityObservation, 'observed-beta-smoke-identity')
  const files = {
    clean: readEvidence(flagValue(args, '--clean') ?? ''),
    scale: readEvidence(flagValue(args, '--scale') ?? ''),
    fault: readEvidence(flagValue(args, '--faults') ?? ''),
    upgrade: readEvidence(flagValue(args, '--upgrade') ?? ''),
    product: readEvidence(flagValue(args, '--product') ?? ''),
  }
  requireKind(files.clean, 'local-production-profile-clean-smoke')
  requireKind(files.scale, 'synthetic-local-scale-and-bounded-query')
  requireKind(files.fault, 'local-application-fault-smoke')
  requireKind(files.upgrade, 'versioned-pre-cutover-local-upgrade')
  requireKind(files.product, 'promoted-browser-product-journeys')
  const expectedDigests = {
    cleanDigest: files.clean.digest,
    scaleDigest: files.scale.digest,
    faultDigest: files.fault.digest,
    upgradeDigest: files.upgrade.digest,
  }
  for (const [name, digest] of Object.entries(expectedDigests)) {
    if (acceptanceIndex.value[name] !== digest)
      throw new Error(`Acceptance index ${name} does not match its evidence`)
  }
  const sourceRevision = files.clean.value.sourceRevision
  for (const file of Object.values(files)) {
    if (file.value.sourceRevision !== sourceRevision)
      throw new Error(`Release evidence has mixed source revisions: ${file.path}`)
  }
  if (identityObservation.value.acceptanceIndexSha256 !== acceptanceIndex.digest)
    throw new Error('Identity observation is bound to a different acceptance index')
  const identity = objectValue(identityObservation.value.identity, 'identity observation')
  const identityChecks: ReadonlyArray<readonly [string, unknown]> = [
    ['sourceRevision', acceptanceIndex.value.sourceRevision],
    [
      'cleanMigrationHead',
      migrationHeadTag(
        acceptanceIndex.value.cleanMigrationHead,
        'acceptance cleanMigrationHead',
      ),
    ],
    [
      'upgradeMigrationHead',
      migrationHeadTag(
        acceptanceIndex.value.upgradeMigrationHead,
        'acceptance upgradeMigrationHead',
      ),
    ],
    ['stackContractHash', acceptanceIndex.value.stackContractSha256],
    ['scaleHash', acceptanceIndex.value.scaleFixtureSha256],
    ['fleetHash', acceptanceIndex.value.fleetFixtureSha256],
    ['productHash', files.product.value.productContractSha256],
  ]
  for (const [field, observed] of identityChecks) {
    if (identity[field] !== observed)
      throw new Error(`Identity ${field} does not match observed gate evidence`)
  }
  const identityImages = objectValue(identity.imageDigests, 'identity imageDigests')
  const observedImages = objectValue(acceptanceIndex.value.images, 'acceptance images')
  for (const name of ['web', 'worker', 'provider', 'perf']) {
    const observed = objectValue(observedImages[name], `acceptance image ${name}`)
    if (identityImages[name] !== observed.imageId)
      throw new Error(`Identity image ${name} does not match acceptance evidence`)
  }
}

export function runGateEvidenceVerifier(args: readonly string[]): number {
  try {
    const kind = flagValue(args, '--kind')
    if (kind === 'faults') {
      verifyFaults(flagValue(args, '--path') ?? '')
    } else if (kind === 'scale') {
      verifyScale(flagValue(args, '--path') ?? '')
    } else if (kind === 'migration') {
      verifyMigration(
        flagValue(args, '--clean') ?? '',
        flagValue(args, '--upgrade') ?? '',
      )
    } else if (kind === 'release-bundle') {
      verifyReleaseBundle(args)
    } else {
      throw new Error(
        'Usage: --kind=<scale|faults|migration|release-bundle> with evidence paths',
      )
    }
    console.log(`beta-local-1 ${kind} evidence: valid`)
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runGateEvidenceVerifier(process.argv.slice(2))
}
