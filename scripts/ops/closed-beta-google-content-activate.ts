/**
 * Install signed Google Content approval bundles into the closed beta.
 *
 * WHY THIS EXISTS. `ops:google-content-approval-sign` produces valid signed
 * bundles, and until now nothing could consume them here: the governed
 * installer (`scripts/release/railway-google-content-approval-activation.ts`)
 * addresses exactly one target — project `reputation-key-us-beta`, environment
 * `cell-us` — validated against the canonical single-US foundation readback.
 * The closed beta is neither, so signing produced artifacts with nowhere to go,
 * and the Google capabilities stayed dark after
 * `GOOGLE_PROVIDER_ROUTE_CATALOGUE_VERSION` moved to 2026-08-27.
 *
 * This does the proportionate half: verify the bundles with the SAME parser,
 * signature verifier and validator the production installer uses, apply the
 * set-level rules, install the approval rows, and print (or set) the two
 * runtime variables. It does not do the cell-us foundation readback or the
 * reviewed-intent digest ceremony, neither of which is meaningful for an
 * environment with one operator and no promotion step — and it refuses
 * outright at any posture but `closed-beta`, so it can never stand in for the
 * real ceremony.
 *
 * THE DATABASE HALF IS NOT OPTIONAL. `authorizeRuntime` resolves a capability
 * by reading `capability_compliance_approvals` through `loadApprovalForRuntime`
 * (google-content-authority.ts), whose predicate pins ~20 binding columns
 * exactly — `routeCatalogueVersion` among them. The deployed image carries only
 * the runtime binding and the role public keys, never the bundle, so the app
 * can never install its own approval. Writing the two variables alone therefore
 * leaves the runtime pointing at a binding no stored row matches, and both
 * capabilities deny `approval_unavailable` — observed live on 2026-09-01, where
 * the binding advertised routeCatalogue 2026-08-27 while the newest row was
 * still 2026-08-16, and every import returned 403. The rows are written FIRST,
 * before the variables move, so the running deployment is never pointed at a
 * binding that has no approval behind it.
 *
 * Usage:
 *   pnpm ops:closed-beta-google-content \
 *     --public-keys .secrets/google-content-approval-bundles/role-public-keys.json \
 *     --bundle .secrets/google-content-approval-bundles/property-import_gbp_v2.json \
 *     --bundle .secrets/google-content-approval-bundles/property-read_gbp_performance.json \
 *     [--apply]
 *
 * Without `--apply` it verifies and reports only, touching neither the database
 * nor Railway. With `--apply` it installs each approval row through the
 * repository's `ensureApproval` (idempotent: an identical binding returns the
 * existing row, a conflicting one is refused), then writes
 * GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON and
 * GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON to `web` and `worker` via the
 * Railway CLI, then tells you to redeploy. Values are passed through a
 * 0600 env-file, never argv, so they are not visible in a process list.
 *
 * `--apply` requires DATABASE_URL to address the closed-beta database.
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createGoogleContentRoleSignatureVerifier,
  parseGoogleContentApprovalBundle,
  parseGoogleContentRolePublicKeys,
  validateGoogleContentApprovalBundle,
  type GoogleContentApprovalBundle,
} from '../../src/shared/auth/google-content-approval'
import {
  activateClosedBetaGoogleContent,
  type ClosedBetaBundleView,
} from '../../src/shared/release/closed-beta-google-content-activation'
import { CURRENT_RELEASE_POSTURE } from '../../src/shared/release/release-posture'
import { getDb, type Database } from '../../src/shared/db'
import { closePool } from '../../src/shared/db/pool'
import { createGoogleContentAuthorityRepository } from '../../src/contexts/identity/infrastructure/repositories/google-content-authority.repository'

const ENVIRONMENT = 'google-closed-beta'
const SERVICES = ['web', 'worker'] as const
const MAX_INPUT_BYTES = 5 * 1024 * 1024

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

function flagValues(name: string): string[] {
  const values: string[] = []
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== `--${name}`) continue
    const next = process.argv[index + 1]
    if (!next || next.startsWith('--')) fail(`--${name} requires a value`)
    values.push(next)
  }
  return values
}

function readJson(path: string, label: string): unknown {
  let bytes: Buffer
  try {
    bytes = readFileSync(resolve(path))
  } catch {
    // A missing role-public-keys.json is the ordinary first-run mistake: the
    // signer writes it beside the bundles, so say where rather than surfacing
    // a raw ENOENT stack.
    return fail(
      `cannot read ${label} at ${path}\n` +
        'Run pnpm ops:google-content-approval-sign first — it writes the bundles and role-public-keys.json into .secrets/google-content-approval-bundles/.',
    )
  }
  if (bytes.byteLength > MAX_INPUT_BYTES) fail(`${label} is too large`)
  try {
    return JSON.parse(bytes.toString('utf8'))
  } catch {
    return fail(`${label} is not valid JSON`)
  }
}

async function main(): Promise<number> {
  if (CURRENT_RELEASE_POSTURE !== 'closed-beta') {
    fail(
      `refusing: CURRENT_RELEASE_POSTURE is ${CURRENT_RELEASE_POSTURE}. Use the governed cell-us activation controller (pnpm infra:railway:google-content-approval).`,
    )
  }

  const publicKeysPath = flagValues('public-keys')[0]
  const bundlePaths = flagValues('bundle')
  const apply = process.argv.includes('--apply')
  if (!publicKeysPath || bundlePaths.length === 0) {
    fail(
      'Usage: pnpm ops:closed-beta-google-content --public-keys <role-public-keys.json> --bundle <bundle.json> [--bundle ...] [--apply]',
    )
  }

  const publicKeys = parseGoogleContentRolePublicKeys(
    readJson(publicKeysPath, 'role public keys'),
  )
  if (!publicKeys.ok) fail('role public keys are invalid')
  const verify = createGoogleContentRoleSignatureVerifier(publicKeys.publicKeys)

  const now = new Date()
  const views: ClosedBetaBundleView[] = []
  const candidates: GoogleContentApprovalBundle['candidate'][] = []
  for (const path of bundlePaths) {
    const parsed = parseGoogleContentApprovalBundle(readJson(path, `bundle ${path}`))
    if (!parsed.ok) fail(`bundle ${path} is not a valid approval bundle`)
    // The same validator the production installer runs: signatures, digests,
    // approval window. Nothing about it is re-implemented or relaxed here.
    const validation = validateGoogleContentApprovalBundle(parsed.bundle, now, verify)
    if (!validation.ok) {
      fail(`bundle ${path} refused: ${validation.code}`)
    }
    candidates.push(parsed.bundle.candidate)
    views.push({
      binding: parsed.bundle.candidate.binding as ClosedBetaBundleView['binding'],
      approverIdentities: parsed.bundle.candidate.roleDocuments.map(
        ({ document }) => document.approverIdentity,
      ),
    })
  }

  const outcome = activateClosedBetaGoogleContent(views)
  if (!outcome.ok) fail(`activation refused (${outcome.code}): ${outcome.detail}`)

  process.stderr.write(
    `verified ${String(outcome.capabilities.length)} capabilit${outcome.capabilities.length === 1 ? 'y' : 'ies'}: ${outcome.capabilities.join(', ')}\n` +
      `route catalogue ${outcome.routeCatalogueVersion}, expires ${outcome.expiresAt}\n`,
  )

  if (!apply) {
    process.stdout.write(
      `${JSON.stringify(
        {
          capabilities: outcome.capabilities,
          routeCatalogueVersion: outcome.routeCatalogueVersion,
          expiresAt: outcome.expiresAt,
          applied: false,
          services: SERVICES,
        },
        null,
        2,
      )}\n`,
    )
    process.stderr.write('report only; pass --apply to write the variables.\n')
    return 0
  }

  // The database half, first. `ensureApproval` is the same idempotent call the
  // production installer makes: an identical binding returns the row already
  // stored, and a binding that collides with a stored one under the same
  // identity is refused outright ('google_content_approval_runtime_binding_conflict'),
  // so a re-run converges instead of stacking rows.
  if (!process.env.DATABASE_URL) {
    fail(
      '--apply needs DATABASE_URL pointing at the closed-beta database.\n' +
        'Postgres16 has no public route by default; open a temporary TCP proxy and run under:\n' +
        '  railway run --service Postgres16 --environment google-closed-beta -- sh -c \'export DATABASE_URL="postgresql://$PGUSER:$(node -e "process.stdout.write(encodeURIComponent(process.env.PGPASSWORD))")@$RAILWAY_TCP_PROXY_DOMAIN:$RAILWAY_TCP_PROXY_PORT/$PGDATABASE"; pnpm ops:closed-beta-google-content ... --apply\'',
    )
  }
  const repository = createGoogleContentAuthorityRepository(getDb())
  const installed: { capability: string; inserted: boolean }[] = []
  try {
    for (const candidate of candidates) {
      const ensured = await repository.transaction(async (tx: Database) =>
        repository.ensureApproval(tx, candidate),
      )
      installed.push({
        capability: candidate.binding.capability,
        inserted: ensured.inserted,
      })
      process.stderr.write(
        `${ensured.inserted ? 'installed' : 'already present'} approval row for ${candidate.binding.capability} (${ensured.record.id})\n`,
      )
    }
  } finally {
    await closePool()
  }

  // Values go through a 0600 env-file rather than argv: a bindings map is not a
  // secret, but the role public keys and the habit both belong out of `ps`.
  const directory = mkdtempSync(join(tmpdir(), 'rk-gc-activate-'))
  try {
    for (const service of SERVICES) {
      for (const [name, value] of [
        ['GOOGLE_CONTENT_RUNTIME_BINDINGS_JSON', outcome.runtimeBindingsJson],
        [
          'GOOGLE_CONTENT_APPROVAL_ROLE_PUBLIC_KEYS_JSON',
          JSON.stringify(publicKeys.publicKeys),
        ],
      ] as const) {
        const file = join(directory, 'value')
        writeFileSync(file, value, { mode: 0o600 })
        chmodSync(file, 0o600)
        execFileSync(
          'railway',
          [
            'variable',
            'set',
            name,
            '--stdin',
            '--service',
            service,
            '--environment',
            ENVIRONMENT,
            '--skip-deploys',
          ],
          { input: readFileSync(file, 'utf8'), stdio: ['pipe', 'inherit', 'inherit'] },
        )
        process.stderr.write(`set ${name} on ${service}\n`)
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        capabilities: outcome.capabilities,
        routeCatalogueVersion: outcome.routeCatalogueVersion,
        expiresAt: outcome.expiresAt,
        applied: true,
        approvalsInstalled: installed,
        services: SERVICES,
      },
      null,
      2,
    )}\n`,
  )
  process.stderr.write(
    'variables written with --skip-deploys. Redeploy web and worker to pick them up:\n' +
      '  railway redeploy --service web --environment google-closed-beta --yes\n' +
      '  railway redeploy --service worker --environment google-closed-beta --yes\n',
  )
  return 0
}

const exitCode = await main()
process.exit(exitCode)
