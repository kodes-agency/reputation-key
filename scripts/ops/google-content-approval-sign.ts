/**
 * Prepare freshly signed Google Content capability approval bundles.
 *
 * Why this exists: `capability_compliance_approvals` rows are Ed25519
 * role-signed and byte-pinned to the compiled contract. When an approval-bound
 * value moves — most recently `GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION`, which
 * fixes the Performance route URL, its wire metric set, the dailyRange
 * encoding, page size and response cap — every persisted approval stops
 * resolving and both Google capabilities deny `approval_unavailable` until a
 * freshly signed bundle is installed. Only the approval owner can prepare the
 * role decisions, so this command asks for one password and creates the
 * private inputs for the separate reviewed activation controller.
 *
 * What it does:
 *   1. unlocks (or creates) an encrypted role keystore with your password;
 *   2. rebuilds each capability's binding from the CURRENT approved row, with
 *      the compiled catalogue/policy versions and a fresh approval window;
 *   3. signs the five role documents, assembles each bundle and validates it
 *      locally with the same parser/validator the installer uses;
 *   4. writes all four private bundles plus the public-role-key map for review;
 *      and
 *   5. reports the inputs for the exact-target approval/configuration
 *      activation ceremony.
 *
 * Usage:
 *   pnpm ops:google-content-approval-sign --operator <id> \
 *     --reason <text> --ticket <ref> [--release-sha <40-hex>]
 *
 * `--release-sha` re-attests the approval against a different deployed release.
 * Without it the binding keeps the release the CURRENT row names, which is the
 * historical behaviour and pins the approval to whichever release was approved
 * first. The start authority requires `approval.release_sha = p_release_sha`
 * (drizzle/0175_google_core_capability_start_authority.sql:80) against the
 * admission service's RELEASE_SHA, so an approval that cannot follow the
 * deployed release makes "approved" and "runnable" mutually exclusive as soon
 * as the release moves. There is no default and no inference from git: this is
 * the value the five role signatures attest, so the operator states it.
 *

 * It reads the current approval rows and writes only private local artifacts;
 * it does not change the database or Railway. `--apply` is deliberately
 * refused before any database write. The exact-target release controller owns
 * the coordinated database installation and two-variable Railway activation.
 */
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign as signPayload,
} from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from 'pg'
import {
  canonicalGoogleContentSha256,
  createGoogleContentRoleSignatureVerifier,
  googleContentRoleSignaturePayload,
  parseGoogleContentApprovalBundle,
  validateGoogleContentApprovalBundle,
} from '../../src/shared/auth/google-content-approval'
import {
  GOOGLE_CONTENT_APPROVAL_ROLES,
  GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
  GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
  GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
  GOOGLE_CONTENT_POLICY_VERSION,
  type GoogleContentApprovalBinding,
  type GoogleContentApprovalRole,
  type GoogleContentApprovalRoleDocument,
  type GoogleContentCapability,
} from '../../src/shared/auth/google-content-contract'
import { GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION } from '../../src/shared/google-provider-control/contracts'
import { googleContentSigningScope } from '../../src/shared/release/google-content-signing-scope'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** Override only for rehearsal; the real ceremony uses the default path. */
const KEYSTORE_PATH =
  process.env.GOOGLE_CONTENT_APPROVAL_KEYSTORE ??
  resolve(ROOT, '.secrets/google-content-approval-roles.enc.json')
const BUNDLE_DIR = resolve(ROOT, '.secrets/google-content-approval-bundles')
/** Approval window for the closed beta; the validator caps it at 30 days. */
const APPROVAL_WINDOW_MS = 29 * 24 * 60 * 60 * 1000
// 128 * N * r bytes of scratch space, so N=2^17/r=8 needs ~134 MiB: Node's
// default 32 MiB maxmem rejects it outright.
const SCRYPT = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 192 * 1024 * 1024,
})

type RoleKeyPair = Readonly<{ publicKeyPem: string; privateKeyPem: string }>
type RoleKeys = Readonly<Record<GoogleContentApprovalRole, RoleKeyPair>>

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function readPassword(prompt: string): Promise<string> {
  return new Promise((resolvePassword, rejectPassword) => {
    const stdin = process.stdin
    if (!stdin.isTTY) {
      rejectPassword(
        new Error('a TTY is required so the password is never echoed or logged'),
      )
      return
    }
    process.stderr.write(prompt)
    stdin.setEncoding('utf8')
    stdin.setRawMode(true)
    let value = ''
    const cleanup = (): void => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stderr.write('\n')
    }
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          cleanup()
          if (value.length < 12) {
            rejectPassword(new Error('password must be at least 12 characters'))
            return
          }
          resolvePassword(value)
          return
        }
        if (character === '\u0003') {
          cleanup()
          rejectPassword(new Error('cancelled'))
          return
        }
        if (character === '\u007f') {
          value = value.slice(0, -1)
          continue
        }
        value += character
      }
    }
    stdin.on('data', onData)
    stdin.resume()
  })
}

function encryptKeystore(password: string, keys: RoleKeys): void {
  const salt = randomBytes(32)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, SCRYPT.keyLength, SCRYPT)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const payload = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(keys), 'utf8')),
    cipher.final(),
  ])
  mkdirSync(dirname(KEYSTORE_PATH), { recursive: true, mode: 0o700 })
  writeFileSync(
    KEYSTORE_PATH,
    `${JSON.stringify(
      {
        version: 'google-content-approval-roles-v1',
        kdf: { name: 'scrypt', ...SCRYPT, salt: salt.toString('base64') },
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        payload: payload.toString('base64'),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  )
}

function decryptKeystore(password: string): RoleKeys {
  const file = JSON.parse(readFileSync(KEYSTORE_PATH, 'utf8')) as {
    kdf: {
      salt: string
      N: number
      r: number
      p: number
      keyLength: number
      maxmem?: number
    }
    iv: string
    authTag: string
    payload: string
  }
  const key = scryptSync(
    password,
    Buffer.from(file.kdf.salt, 'base64'),
    file.kdf.keyLength,
    {
      N: file.kdf.N,
      r: file.kdf.r,
      p: file.kdf.p,
      maxmem: file.kdf.maxmem ?? SCRYPT.maxmem,
    },
  )
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(file.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(file.authTag, 'base64'))
  try {
    const plain = Buffer.concat([
      decipher.update(Buffer.from(file.payload, 'base64')),
      decipher.final(),
    ])
    return JSON.parse(plain.toString('utf8')) as RoleKeys
  } catch {
    return fail('wrong password (or the keystore is corrupt)')
  }
}

function generateRoleKeys(): RoleKeys {
  return Object.freeze(
    Object.fromEntries(
      GOOGLE_CONTENT_APPROVAL_ROLES.map((role: GoogleContentApprovalRole) => {
        const pair = generateKeyPairSync('ed25519')
        return [
          role,
          {
            publicKeyPem: pair.publicKey
              .export({ type: 'spki', format: 'pem' })
              .toString(),
            privateKeyPem: pair.privateKey
              .export({ type: 'pkcs8', format: 'pem' })
              .toString(),
          },
        ]
      }),
    ),
  ) as RoleKeys
}

/** The already-approved facts we re-use verbatim: only versions and the window move. */
type ApprovalRow = Readonly<{
  capability: string
  target_phase: string
  environment_profile: string
  release_sha: string
  evidence_manifest_sha256: string
  evidence_index_sha256: string
  deployment_attestation_sha256: string
  adr_0050_sha256: string
  google_oauth_contract_version: string
  google_project_attestation_sha256: string
  google_oauth_client_id_sha256: string
  google_redirect_uri_sha256: string
  provider_origin_profile_sha256: string
  runtime_isolation_profile_version: string | null
  runtime_isolation_profile_sha256: string | null
  railway_closed_beta_cohort: readonly string[] | null
  railway_closed_beta_cohort_sha256: string | null
  railway_closed_beta_residual_risk_sha256: string | null
  migration_head: string
  image_digests: Record<string, string>
  evidence_index: {
    sha256: string
    manifestSha256: string
    artifactSha256: Record<string, string>
    roleDocumentSha256: Record<string, string>
  }
  role_approvals: ReadonlyArray<{ approverIdentity?: string }> | null
}>

function buildBinding(
  row: ApprovalRow,
  manifestSha256: string,
  approvedAt: string,
  expiresAt: string,
  releaseSha: string,
): GoogleContentApprovalBinding {
  return {
    capability: row.capability,
    targetPhase: row.target_phase,
    environmentProfile: row.environment_profile,
    releaseSha,
    evidenceManifestSha256: manifestSha256,
    evidenceIndexSha256: row.evidence_index_sha256,
    deploymentAttestationSha256: row.deployment_attestation_sha256,
    adr0050Sha256: row.adr_0050_sha256,
    googleContentPolicyVersion: GOOGLE_CONTENT_POLICY_VERSION,
    googleOAuthContractVersion: row.google_oauth_contract_version,
    googleProjectAttestationSha256: row.google_project_attestation_sha256,
    googleOAuthClientIdSha256: row.google_oauth_client_id_sha256,
    googleRedirectUriSha256: row.google_redirect_uri_sha256,
    providerOriginProfileSha256: row.provider_origin_profile_sha256,
    runtimeIsolationProfileVersion: row.runtime_isolation_profile_version,
    runtimeIsolationProfileSha256: row.runtime_isolation_profile_sha256,
    railwayClosedBetaCohort: row.railway_closed_beta_cohort,
    railwayClosedBetaCohortSha256: row.railway_closed_beta_cohort_sha256,
    railwayClosedBetaResidualRiskSha256: row.railway_closed_beta_residual_risk_sha256,
    performanceCatalogVersion: GOOGLE_CONTENT_PERFORMANCE_CATALOG_VERSION,
    routeCatalogueVersion: GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION,
    capabilityPolicyVersion: GOOGLE_CONTENT_CAPABILITY_POLICY_VERSION,
    executionPolicyVersion: GOOGLE_CONTENT_EXECUTION_POLICY_VERSION,
    migrationHead: row.migration_head,
    imageDigests: row.image_digests,
    approvedAt,
    expiresAt,
    status: 'approved',
  } as GoogleContentApprovalBinding
}

function signRoleDocument(
  keys: RoleKeys,
  role: GoogleContentApprovalRole,
  binding: GoogleContentApprovalBinding,
  manifestSha256: string,
  approverIdentity: string,
): Readonly<{ sha256: string; document: GoogleContentApprovalRoleDocument }> {
  const unsigned = {
    role,
    capability: binding.capability,
    manifestSha256,
    releaseSha: binding.releaseSha,
    targetPhase: binding.targetPhase,
    environmentProfile: binding.environmentProfile,
    transientPerformanceReportingDecision: 'approved',
    confirmedImportProfileTreatmentDecision: 'approved',
    unmanagedUserAgentMemoryResidualDecision: 'approved',
    railwayClosedBetaResidualDecision:
      binding.targetPhase === 'railway_closed_beta' ? 'approved' : null,
    railwayClosedBetaCohortSha256: binding.railwayClosedBetaCohortSha256,
    railwayClosedBetaResidualRiskSha256: binding.railwayClosedBetaResidualRiskSha256,
    approverIdentity,
    // Every role decision shares the binding's window: the validator requires
    // the LATEST role approval to equal binding.approvedAt exactly.
    approvedAt: binding.approvedAt,
    expiresAt: binding.expiresAt,
  } as Omit<GoogleContentApprovalRoleDocument, 'signature'>
  const signature = signPayload(
    null,
    googleContentRoleSignaturePayload({
      ...unsigned,
      signature: '',
    } as GoogleContentApprovalRoleDocument),
    keys[role].privateKeyPem,
  ).toString('base64')
  const document = { ...unsigned, signature } as GoogleContentApprovalRoleDocument
  return { sha256: canonicalGoogleContentSha256(document), document }
}

async function main(): Promise<void> {
  const operator = flag('operator')
  const reason = flag('reason')
  const ticket = flag('ticket')
  const apply = process.argv.includes('--apply')
  if (flag('railway-environment')) {
    fail(
      '--railway-environment is retired; this command never mutates Railway. Use the governed exact-target cell-us configuration and signed-release procedure.',
    )
  }
  if (apply) {
    fail(
      '--apply is blocked before any database write: this signer prepares private review artifacts only. Use pnpm infra:railway:google-content-approval plan, then apply or recover the unchanged reviewed intent; do not install bundles manually.',
    )
  }
  if (!operator || !reason || !ticket) {
    fail(
      'Usage: pnpm ops:google-content-approval-sign --operator <id> --reason <text> --ticket <ref> [--release-sha <40-hex>]',
    )
  }
  // Re-signing the release the approval covers.
  //
  // `release_sha` is an approval-bound value like any other, and refreshing a
  // signature when such a value moves is exactly what this command is for. It
  // was the one that could not move: the binding copied `row.release_sha`, so
  // every re-sign re-attested the release the FIRST approval named.
  //
  // That pinned this deployment to e7ab6376 (2026-08-15) permanently. The
  // start authority requires `approval.release_sha = p_release_sha`
  // (drizzle/0175_google_core_capability_start_authority.sql:80), where the
  // right-hand side is the admission service's RELEASE_SHA — so every Google
  // call fails once the deployed release moves, and the only way to satisfy it
  // was to run a build from 2026-08-15. That build predates
  // services/google-peer-identities.ts, so it can no longer complete an mTLS
  // call to the current egress gateway. Approved and runnable had become
  // mutually exclusive.
  //
  // The operator must state the release explicitly: there is no default and no
  // inference from git, because this value is what the five role signatures
  // attest. Everything else — the evidence index, the deployment attestation,
  // the cohort and residual-risk digests — is environment-scoped and still
  // copied verbatim from the approved row, so this widens WHICH release the
  // existing evidence covers and mints nothing.
  const releaseShaFlag = flag('release-sha')
  if (releaseShaFlag !== undefined && !/^[0-9a-f]{40}$/.test(releaseShaFlag)) {
    fail('--release-sha must be a lowercase 40-character git object id')
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) fail('DATABASE_URL is required')
  const created = !existsSync(KEYSTORE_PATH)
  const password = await readPassword(
    created
      ? 'Create a password for the approval role keystore: '
      : 'Approval role keystore password: ',
  )
  let keys: RoleKeys
  if (created) {
    const confirm = await readPassword('Repeat the password: ')
    if (confirm !== password) fail('passwords do not match')
    keys = generateRoleKeys()
    encryptKeystore(password, keys)
    process.stderr.write(`created ${KEYSTORE_PATH}\n`)
  } else {
    keys = decryptKeystore(password)
  }

  const publicKeys = Object.fromEntries(
    GOOGLE_CONTENT_APPROVAL_ROLES.map((role: GoogleContentApprovalRole) => [
      role,
      keys[role].publicKeyPem,
    ]),
  ) as Readonly<Record<GoogleContentApprovalRole, string>>
  const verify = createGoogleContentRoleSignatureVerifier(publicKeys)

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  let rows: ApprovalRow[]
  try {
    const result = await client.query<ApprovalRow>(
      `SELECT DISTINCT ON (capability) * FROM capability_compliance_approvals
        ORDER BY capability, created_at DESC`,
    )
    rows = result.rows
  } finally {
    await client.end()
  }
  // Which capabilities this run refreshes. Keyed on posture: the closed beta
  // has approval rows for two of the four, so demanding all four made this
  // command impossible to run exactly when a moved route catalogue had taken
  // the Google capabilities down. It can never invent an approval — the scope
  // is drawn from the rows that already exist, and an empty set is refused at
  // every posture.
  const scope = googleContentSigningScope(rows.map((row) => row.capability))
  if (!scope.ok) fail(scope.reason)
  rows = rows.filter((row) =>
    scope.capabilities.includes(row.capability as GoogleContentCapability),
  )
  process.stderr.write(
    `re-signing ${scope.capabilities.join(', ')}${releaseShaFlag ? ` for release ${releaseShaFlag}` : ''}\n`,
  )

  const now = new Date()
  const approvedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + APPROVAL_WINDOW_MS).toISOString()
  mkdirSync(BUNDLE_DIR, { recursive: true, mode: 0o700 })
  const rolePublicKeysPath = resolve(BUNDLE_DIR, 'role-public-keys.json')
  writeFileSync(rolePublicKeysPath, `${JSON.stringify(publicKeys, null, 2)}\n`, {
    mode: 0o600,
  })
  chmodSync(rolePublicKeysPath, 0o600)
  const bundlePaths: string[] = []

  for (const row of rows) {
    // The Railway closed beta requires ONE approver identity across all five
    // role documents; reuse the identity already recorded on the approval.
    const approverIdentity = row.role_approvals?.[0]?.approverIdentity ?? operator
    // The manifest is the previously approved evidence document: this command
    // re-signs existing evidence, it never mints new evidence. Only the role
    // signatures (and therefore the role/index digests) change.
    const manifest = { evidenceIndexSha256: row.evidence_index_sha256 }
    const manifestSha256 = canonicalGoogleContentSha256(manifest)
    const releaseSha = releaseShaFlag ?? row.release_sha
    const binding = buildBinding(row, manifestSha256, approvedAt, expiresAt, releaseSha)
    const roleDocuments = GOOGLE_CONTENT_APPROVAL_ROLES.map(
      (role: GoogleContentApprovalRole) =>
        signRoleDocument(keys, role, binding, manifestSha256, approverIdentity),
    )
    const indexDocument = {
      manifestSha256,
      artifactSha256: row.evidence_index.artifactSha256,
      roleDocumentSha256: Object.fromEntries(
        roleDocuments.map(
          (entry: { sha256: string; document: GoogleContentApprovalRoleDocument }) => [
            entry.document.role,
            entry.sha256,
          ],
        ),
      ),
    }
    const index = {
      sha256: canonicalGoogleContentSha256(indexDocument),
      ...indexDocument,
    }
    const bundle = {
      manifest,
      candidate: {
        binding: { ...binding, evidenceIndexSha256: index.sha256 },
        index,
        roleDocuments,
      },
    }

    const parsed = parseGoogleContentApprovalBundle(bundle)
    if (!parsed.ok) fail(`bundle for ${row.capability} does not parse`)
    const validation = validateGoogleContentApprovalBundle(parsed.bundle, now, verify)
    if (!validation.ok) fail(`bundle for ${row.capability} refused: ${validation.code}`)

    const path = resolve(BUNDLE_DIR, `${row.capability.replaceAll('.', '-')}.json`)
    writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 })
    chmodSync(path, 0o600)
    bundlePaths.push(path)
    process.stderr.write(
      `validated ${row.capability} routeCatalogue=${GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION} expires=${expiresAt}\n`,
    )
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        rolePublicKeysPath,
        bundles: bundlePaths,
        approvedAt,
        expiresAt,
        databaseApplied: false,
        railwayConfigurationApplied: false,
      },
      null,
      2,
    )}\n`,
  )
  process.stderr.write(
    'prepared only; nothing was installed. Create one private canonical intent with pnpm infra:railway:google-content-approval plan, review its SHA-256 and exact cell-us IDs, then use apply or recover and finish with verify.\n',
  )
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `google-content-approval-sign failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  )
  process.exitCode = 1
})
