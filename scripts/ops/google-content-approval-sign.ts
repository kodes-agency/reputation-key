/**
 * Re-sign and install the Google Content capability approvals.
 *
 * Why this exists: `capability_compliance_approvals` rows are Ed25519
 * role-signed and byte-pinned to the compiled contract. When an approval-bound
 * value moves — most recently `GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION`, which
 * fixes the Performance route URL, its wire metric set, the dailyRange
 * encoding, page size and response cap — every persisted approval stops
 * resolving and both Google capabilities deny `approval_unavailable` until a
 * freshly signed bundle is installed. Only the approval owner can do that, so
 * this command asks for one password and does the rest.
 *
 * What it does:
 *   1. unlocks (or creates) an encrypted role keystore with your password;
 *   2. rebuilds each capability's binding from the CURRENT approved row, with
 *      the compiled catalogue/policy versions and a fresh approval window;
 *   3. signs the five role documents, assembles each bundle and validates it
 *      locally with the same parser/validator the installer uses;
 *   4. installs both bundles through `ops:google-content-approval`; and
 *   5. reports whether the deployed role public keys must be updated.
 *
 * Usage:
 *   pnpm ops:google-content-approval-sign --operator <id> \
 *     --reason <text> --ticket <ref> [--apply] \
 *     [--railway-environment google-closed-beta]
 *
 * Without `--apply` it validates and prints what would be installed, touching
 * nothing. `DATABASE_URL` must point at the target database. With
 * `--railway-environment` it also rotates
 * `GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON` on web and worker, which is
 * required whenever the keystore is created or rotated.
 */
import {
  createCipheriv,
  createDecipheriv,
  generateKeyPairSync,
  randomBytes,
  scryptSync,
  sign as signPayload,
} from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  GOOGLE_CONTENT_CAPABILITIES,
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
import { getEnv } from '../../src/shared/config/env'
import { canonicalizeRfc8785 } from '../../src/shared/merchant-ai-notice-contract'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
/** Override only for rehearsal; the real ceremony uses the default path. */
const KEYSTORE_PATH =
  process.env.GOOGLE_CONTENT_APPROVAL_KEYSTORE ??
  resolve(ROOT, '.secrets/google-content-approval-roles.enc.json')
const RUNTIME_BINDINGS_VAR = 'GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON'
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
): GoogleContentApprovalBinding {
  return {
    capability: row.capability,
    targetPhase: row.target_phase,
    environmentProfile: row.environment_profile,
    releaseSha: row.release_sha,
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
  if (!operator || !reason || !ticket) {
    fail(
      'Usage: pnpm ops:google-content-approval-sign --operator <id> --reason <text> --ticket <ref> [--apply]',
    )
  }
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) fail('DATABASE_URL is required')
  // `ops:google-content-approval` boots the operator runtime, which validates
  // the whole env schema. Validate it here too: without this the command
  // prompts for a password, creates the keystore and signs both bundles, and
  // only then dies on the child's `[CONFIG] Invalid environment variables`.
  if (apply) getEnv()

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
  const missing = GOOGLE_CONTENT_CAPABILITIES.filter(
    (capability: GoogleContentCapability) =>
      !rows.some((row) => row.capability === capability),
  )
  if (missing.length > 0) fail(`no approval row to re-sign for: ${missing.join(', ')}`)

  const now = new Date()
  const approvedAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + APPROVAL_WINDOW_MS).toISOString()
  mkdirSync(BUNDLE_DIR, { recursive: true, mode: 0o700 })
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
    const binding = buildBinding(row, manifestSha256, approvedAt, expiresAt)
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
    bundlePaths.push(path)
    process.stderr.write(
      `validated ${row.capability} routeCatalogue=${GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION} expires=${expiresAt}\n`,
    )
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        rolePublicKeys: publicKeys,
        bundles: bundlePaths,
        approvedAt,
        expiresAt,
        apply,
      },
      null,
      2,
    )}\n`,
  )
  if (!apply) {
    process.stderr.write('re-run with --apply to install these bundles\n')
    return
  }
  const { spawnSync } = await import('node:child_process')
  for (const path of bundlePaths) {
    const child = spawnSync(
      'pnpm',
      [
        'ops:google-content-approval',
        path,
        '--operator',
        operator,
        '--reason',
        reason,
        '--ticket',
        ticket,
        '--apply',
      ],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON: JSON.stringify(publicKeys),
        },
      },
    )
    if (child.status !== 0) fail(`installing ${path} failed`)
  }
  // Two deployment variables have to move with a re-sign, not one:
  //   * GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON — the runtime verifies
  //     each stored approval's role signatures against it;
  //   * GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON — every re-sign recomputes the
  //     evidence manifest digest (it hashes the prior index digest) and the
  //     evidence index digest (it hashes the fresh role-document digests), and
  //     the runtime compares the stored approval's binding to this variable
  //     field for field.
  // Rotating only the keys leaves a successfully installed approval denying
  // `runtime_binding_mismatch` at `google-content-preauthorize`.
  const railwayEnvironment = flag('railway-environment')
  if (!railwayEnvironment) {
    process.stderr.write(
      'installed. On web and worker set GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON to the rolePublicKeys above, ' +
        'and patch evidenceManifestSha256 + evidenceIndexSha256 in GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON to the ' +
        "installed bundles' values, then redeploy both.\n",
    )
    return
  }
  const listed = spawnSync(
    'railway',
    ['variable', 'list', '--service', 'web', '--environment', railwayEnvironment, '--kv'],
    { cwd: ROOT, encoding: 'utf8' },
  )
  if (listed.status !== 0) fail(`reading ${RUNTIME_BINDINGS_VAR} from web failed`)
  const bindingsLine = listed.stdout
    .split('\n')
    .find((line) => line.startsWith(`${RUNTIME_BINDINGS_VAR}=`))
  if (!bindingsLine)
    fail(`${RUNTIME_BINDINGS_VAR} is not set on web in ${railwayEnvironment}`)
  const runtimeBindings = JSON.parse(
    bindingsLine.slice(RUNTIME_BINDINGS_VAR.length + 1),
  ) as Record<string, Record<string, unknown>>
  for (const path of bundlePaths) {
    const { candidate } = JSON.parse(readFileSync(path, 'utf8')) as {
      candidate: { binding: Record<string, unknown> }
    }
    const capability = String(candidate.binding.capability)
    const current = runtimeBindings[capability]
    if (!current) fail(`${RUNTIME_BINDINGS_VAR} has no entry for ${capability}`)
    // RFC 8785, not JSON.stringify: `imageDigests` carries the same digests in
    // a different key order on either side, and a textual compare would report
    // a pure evidence rotation as a deployment change.
    const drifted = Object.keys(current).filter(
      (key) =>
        key !== 'evidenceManifestSha256' &&
        key !== 'evidenceIndexSha256' &&
        canonicalizeRfc8785(current[key]) !== canonicalizeRfc8785(candidate.binding[key]),
    )
    if (drifted.length > 0) {
      fail(
        `${capability}: the deployment's runtime binding differs from the approved binding in ` +
          `${drifted.join(', ')}. That is a deployment change, not an evidence rotation — ` +
          'mint fresh evidence instead of re-signing.',
      )
    }
    current.evidenceManifestSha256 = candidate.binding.evidenceManifestSha256
    current.evidenceIndexSha256 = candidate.binding.evidenceIndexSha256
  }
  for (const service of ['web', 'worker']) {
    for (const assignment of [
      `GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON=${JSON.stringify(publicKeys)}`,
      `${RUNTIME_BINDINGS_VAR}=${JSON.stringify(runtimeBindings)}`,
    ]) {
      const child = spawnSync(
        'railway',
        [
          'variable',
          'set',
          assignment,
          '--service',
          service,
          '--environment',
          railwayEnvironment,
          '--skip-deploys',
        ],
        { cwd: ROOT, stdio: 'inherit' },
      )
      if (child.status !== 0) {
        fail(
          `setting ${assignment.slice(0, assignment.indexOf('='))} on ${service} failed`,
        )
      }
    }
  }
  process.stderr.write(
    `installed and rotated role public keys + runtime bindings on web + worker in ${railwayEnvironment}. Redeploy both to pick them up:\n  railway up --service web --environment ${railwayEnvironment} --detach\n  railway up --service worker --environment ${railwayEnvironment} --detach\n`,
  )
}

await main().catch((error: unknown) => {
  process.stderr.write(
    `google-content-approval-sign failed: ${error instanceof Error ? error.message : 'unknown'}\n`,
  )
  process.exitCode = 1
})
