import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import {
  assertGoogleImportReleaseImageIdentity,
  assertGoogleImportRuntimePackagePurity,
  createGoogleImportReleaseSourcePlan,
  releaseSourcePlanSha256,
  type GoogleImportReleaseSourcePlan,
} from '../../src/shared/testing/google-import-release-source'

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const CONTRACT_MIGRATION = 'scripts/migrations/google-import-contract.sql'
const POSTGRES_IMAGE =
  'postgres:16@sha256:33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20'
const PROVIDER_REDIS_IMAGE =
  'redis:7@sha256:595cc6f2bb3af6e03347b90deb6123c6aa2c81dea05ce08128de8a174b6ac67b'

type CommandResult = Readonly<{
  command: string
  durationMs: number
  stdout: string
}>

type ImageProof = Readonly<{
  tag: string
  id: string
  repoDigests: readonly string[]
  sourceRevision: string | null
  contract: string | null
  rolloutScope: string | null
  user: string
  entrypoint: readonly string[] | null
  command: readonly string[] | null
}>

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function flag(name: string): string {
  const prefix = `${name}=`
  const value = process.argv
    .slice(2)
    .find((entry) => entry.startsWith(prefix))
    ?.slice(prefix.length)
  if (!value) throw new Error(`Missing required ${name}=<full-commit-sha> input`)
  return value
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ')
}

function run(
  command: string,
  args: readonly string[],
  options: Readonly<{
    cwd?: string
    env?: NodeJS.ProcessEnv
    input?: string
    quiet?: boolean
  }> = {},
): CommandResult {
  const startedAt = Date.now()
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.quiet ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  })
  const text = commandText(command, args)
  if (result.error) throw new Error(`${text}: ${result.error.message}`)
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    throw new Error(
      `${text} exited ${String(result.status)}${detail ? `\n${detail}` : ''}`,
    )
  }
  return {
    command: text,
    durationMs: Date.now() - startedAt,
    stdout: result.stdout?.trim() ?? '',
  }
}

function runExpectFailure(
  command: string,
  args: readonly string[],
  options: Readonly<{ cwd?: string; env?: NodeJS.ProcessEnv }> = {},
): Readonly<{ command: string; durationMs: number; exitCode: number }> {
  const startedAt = Date.now()
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'ignore', 'ignore'],
  })
  if (result.error) throw result.error
  if (result.status === 0) {
    throw new Error(`${commandText(command, args)} unexpectedly succeeded`)
  }
  return {
    command: commandText(command, args),
    durationMs: Date.now() - startedAt,
    exitCode: result.status ?? -1,
  }
}

function git(args: readonly string[], cwd = ROOT): string {
  return run('git', args, { cwd, quiet: true }).stdout
}

function assertReleaseRepository(plan: GoogleImportReleaseSourcePlan): void {
  if (git(['rev-parse', '--is-shallow-repository']) !== 'false') {
    throw new Error('Immutable drill requires a full, non-shallow Git history')
  }
  if (git(['status', '--porcelain=v1']) !== '') {
    throw new Error('Immutable drill requires a clean final source worktree')
  }
  if (git(['rev-parse', 'HEAD']) !== plan.finalCommit) {
    throw new Error('finalCommit must equal the clean checked-out HEAD')
  }

  for (const commit of [
    plan.baselineCommit,
    plan.compatibilityCommit,
    plan.finalCommit,
  ]) {
    run('git', ['cat-file', '-e', `${commit}^{commit}`], { quiet: true })
    const gitlinks = git(['ls-tree', '-r', commit])
      .split('\n')
      .filter((line) => line.startsWith('160000 '))
    if (gitlinks.length > 0) {
      throw new Error(
        `Commit ${commit} contains submodules; immutable materialization is ambiguous`,
      )
    }
  }

  run(
    'git',
    ['merge-base', '--is-ancestor', plan.baselineCommit, plan.compatibilityCommit],
    {
      quiet: true,
    },
  )
  run(
    'git',
    ['merge-base', '--is-ancestor', plan.compatibilityCommit, plan.finalCommit],
    {
      quiet: true,
    },
  )
}

function materializeWorktree(root: string, name: string, commit: string): string {
  const path = join(root, name)
  run('git', ['worktree', 'add', '--detach', path, commit], { quiet: true })
  if (git(['status', '--porcelain=v1'], path) !== '') {
    throw new Error(`${name} materialized worktree is not clean`)
  }
  if (git(['rev-parse', 'HEAD'], path) !== commit) {
    throw new Error(`${name} materialized the wrong commit`)
  }
  return path
}

function removeWorktree(path: string): void {
  if (!existsSync(path)) return
  const result = spawnSync('git', ['worktree', 'remove', '--force', path], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'ignore',
  })
  if (result.status !== 0) rmSync(path, { recursive: true, force: true })
}

function assertPinnedDockerfile(path: string): void {
  const aliases = new Set<string>()
  for (const rawLine of readFileSync(path, 'utf8').split('\n')) {
    const match = /^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/i.exec(rawLine.trim())
    if (!match) continue
    const source = match[1] as string
    if (!aliases.has(source) && !source.includes('@sha256:')) {
      throw new Error(`${basename(path)} has an unpinned external FROM ${source}`)
    }
    if (match[2]) aliases.add(match[2])
  }
}

function sourceProof(path: string, commit: string): Record<string, unknown> {
  const packageJson = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')) as {
    packageManager?: string
  }
  if (packageJson.packageManager !== 'pnpm@10.6.5') {
    throw new Error(`${commit} does not pin pnpm@10.6.5`)
  }
  for (const dockerfile of [
    'Dockerfile',
    'Dockerfile.worker',
    ...(existsSync(join(path, 'Dockerfile.google-import-compatibility'))
      ? ['Dockerfile.google-import-compatibility']
      : []),
    ...(existsSync(join(path, 'Dockerfile.google-execution-admission'))
      ? ['Dockerfile.google-execution-admission']
      : []),
    ...(existsSync(join(path, 'Dockerfile.google-egress-gateway'))
      ? ['Dockerfile.google-egress-gateway']
      : []),
  ]) {
    assertPinnedDockerfile(join(path, dockerfile))
  }
  return {
    commit,
    tree: git(['rev-parse', 'HEAD^{tree}'], path),
    lockfileSha256: sha256(readFileSync(join(path, 'pnpm-lock.yaml'))),
    packageManager: packageJson.packageManager,
  }
}

function buildImage(
  input: Readonly<{
    context: string
    dockerfile: string
    tag: string
    sourceRevision: string
  }>,
): CommandResult {
  return run('docker', [
    'build',
    '--provenance=false',
    '--build-arg',
    `SOURCE_REVISION=${input.sourceRevision}`,
    '-f',
    input.dockerfile,
    '-t',
    input.tag,
    input.context,
  ])
}

function inspectImage(tag: string): ImageProof {
  const raw = run('docker', ['image', 'inspect', tag], { quiet: true }).stdout
  const [value] = JSON.parse(raw) as Array<{
    Id: string
    RepoDigests?: string[]
    Config: {
      Labels?: Record<string, string>
      User?: string
      Entrypoint?: string[] | null
      Cmd?: string[] | null
    }
  }>
  if (!value?.Id.startsWith('sha256:'))
    throw new Error(`${tag} has no immutable image ID`)
  const labels = value.Config.Labels ?? {}
  return {
    tag,
    id: value.Id,
    repoDigests: value.RepoDigests ?? [],
    sourceRevision: labels['org.opencontainers.image.revision'] ?? null,
    contract: labels['com.repkey.google-import-contract'] ?? null,
    rolloutScope: labels['com.repkey.rollout-scope'] ?? null,
    user: value.Config.User ?? '',
    entrypoint: value.Config.Entrypoint ?? null,
    command: value.Config.Cmd ?? null,
  }
}

function imageSmoke(
  tag: string,
  options: Readonly<{ scriptPolicy?: 'forbid' | 'allow' }> = {},
): CommandResult {
  const result = run(
    'docker',
    [
      'run',
      '--rm',
      '--entrypoint',
      'node',
      tag,
      '-e',
      "const p=require('/app/package.json');process.stdout.write(String('scripts' in p))",
    ],
    { quiet: true },
  )
  if (result.stdout !== 'true' && result.stdout !== 'false') {
    throw new Error(`${tag} returned an invalid runtime package inspection`)
  }
  assertGoogleImportRuntimePackagePurity(
    { tag, hasScripts: result.stdout === 'true' },
    options,
  )
  return result
}

function migrationEnvironment(databaseUrl: string): readonly string[] {
  return [
    '-e',
    'NODE_ENV=production',
    '-e',
    'DEPLOY_MIGRATE=1',
    '-e',
    `DATABASE_URL=${databaseUrl}`,
    '-e',
    'BETTER_AUTH_SECRET=local-release-drill-secret-at-least-32-characters',
    '-e',
    'BETTER_AUTH_URL=http://127.0.0.1:3000',
    '-e',
    'GOOGLE_CLIENT_ID=local-release-drill-client',
    '-e',
    'GOOGLE_CLIENT_SECRET=local-release-drill-client-secret',
    '-e',
    `ENCRYPTION_KEY=${'ab'.repeat(32)}`,
    '-e',
    `OAUTH_STATE_SECRET=${'cd'.repeat(16)}`,
  ]
}

function runMigrator(tag: string, network: string, databaseUrl: string): CommandResult {
  return run('docker', [
    'run',
    '--rm',
    '--network',
    network,
    ...migrationEnvironment(databaseUrl),
    tag,
    'node',
    'dist-worker/migrate-deploy.js',
  ])
}

function runMigratorExpectFailure(
  tag: string,
  network: string,
  databaseUrl: string,
): Readonly<{ command: string; durationMs: number; exitCode: number }> {
  return runExpectFailure('docker', [
    'run',
    '--rm',
    '--network',
    network,
    ...migrationEnvironment(databaseUrl),
    tag,
    'node',
    'dist-worker/migrate-deploy.js',
  ])
}

function psql(container: string, sql: string): string {
  return run(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
      '--tuples-only',
      '--no-align',
      '-U',
      'repkey',
      '-d',
      'repkey',
    ],
    { input: sql, quiet: true },
  ).stdout
}

async function waitForPostgres(container: string): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = spawnSync('docker', [
      'exec',
      container,
      'pg_isready',
      '-U',
      'repkey',
      '-d',
      'repkey',
    ])
    if (result.status === 0) return
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }
  throw new Error('Disposable PostgreSQL did not become ready')
}

function prepareContractState(container: string): void {
  psql(
    container,
    `UPDATE legacy_import_control
       SET state='closed', connected_event_issuance='v2', oauth_state_issuance='opaque-v2',
           connected_event_converged_at=now(), oauth_state_converged_at=now(),
           v1_state_drain_not_before=now() - interval '1 minute',
           v1_events_drained_at=now(), quiescing_at=now(), closed_at=now(),
           operator_id='local-r2', reason='immutable disposable contract rehearsal';
     DO $seed_gate$
     BEGIN
       IF EXISTS (SELECT 1 FROM gbp_import_requests WHERE status IN ('queued','processing')) OR
          EXISTS (SELECT 1 FROM authorization_execution_permits
                  WHERE capability IN ('property.import_gbp_v2','property.read_gbp_performance')
                    AND state IN ('admitted','started')) OR
          EXISTS (SELECT 1 FROM outbox_events WHERE published_at IS NULL
                    AND event_type IN ('integration.property_import.requested',
                                       'integration.property_import.retention_released',
                                       'property.google_binding.changed',
                                       'integration.google_account.connected',
                                       'integration.google_account.disconnected')) THEN
         RAISE EXCEPTION 'disposable drill unexpectedly contains active Google work';
       END IF;
     END
     $seed_gate$;`,
  )
}

function finalSchemaProof(container: string): Record<string, unknown> {
  const raw = psql(
    container,
    `SELECT json_build_object(
       'legacyTables', (SELECT count(*) FROM pg_tables WHERE schemaname='public'
         AND tablename IN ('gbp_cache','gbp_import_jobs','gbp_import_legacy_history',
                           'legacy_import_control','legacy_import_effect_leases')),
       'legacyColumns', (SELECT count(*) FROM information_schema.columns
         WHERE table_schema='public' AND
           ((table_name='google_connections' AND column_name IN ('google_account_id','google_email'))
             OR (table_name='properties' AND column_name='gbp_place_id'))),
       'legacyTypes', (SELECT count(*) FROM pg_type WHERE typname IN
         ('legacy_import_effect_lease_state','legacy_import_history_status',
          'legacy_import_control_state','google_oauth_state_issuance_version',
          'google_connected_event_issuance_version','import_job_status','gbp_cache_data_type')),
       'identityConstraint', (SELECT pg_get_constraintdef(oid) FROM pg_constraint
         WHERE conname='google_connections_identity_check'),
       'killedCapabilities', (SELECT count(*) FROM capability_execution_control
         WHERE capability IN ('property.import_gbp_v2','property.read_gbp_performance')
           AND denied AND denied_at IS NOT NULL),
       'providerContentRows', 0
     )::text;`,
  )
  const proof = JSON.parse(raw) as Record<string, unknown>
  if (
    proof.legacyTables !== 0 ||
    proof.legacyColumns !== 0 ||
    proof.legacyTypes !== 0 ||
    proof.killedCapabilities !== 2 ||
    proof.providerContentRows !== 0
  ) {
    throw new Error(`Final schema proof failed: ${raw}`)
  }
  return proof
}

async function main(): Promise<void> {
  const plan = createGoogleImportReleaseSourcePlan({
    baselineCommit: flag('--baseline'),
    compatibilityCommit: flag('--compatibility'),
    finalCommit: flag('--final'),
  })
  assertReleaseRepository(plan)
  run('docker', ['version'], { quiet: true })

  const scratch = mkdtempSync(join(tmpdir(), 'repkey-google-release-'))
  const worktrees: string[] = []
  const network = `repkey-google-release-${plan.finalCommit.slice(0, 12)}`
  const postgres = `${network}-postgres`
  const builtTags: string[] = []
  const startedAt = new Date()

  try {
    const baseline = materializeWorktree(scratch, 'baseline', plan.baselineCommit)
    const compatibility = materializeWorktree(
      scratch,
      'compatibility',
      plan.compatibilityCommit,
    )
    const final = materializeWorktree(scratch, 'final', plan.finalCommit)
    worktrees.push(baseline, compatibility, final)

    const sources = {
      baseline: sourceProof(baseline, plan.baselineCommit),
      compatibility: sourceProof(compatibility, plan.compatibilityCommit),
      final: sourceProof(final, plan.finalCommit),
    }
    const short = {
      baseline: plan.baselineCommit.slice(0, 12),
      compatibility: plan.compatibilityCommit.slice(0, 12),
      final: plan.finalCommit.slice(0, 12),
    }
    const tags = {
      baselineWeb: `repkey-release-baseline-web:${short.baseline}`,
      baselineWorker: `repkey-release-baseline-worker:${short.baseline}`,
      compatibility: `repkey-release-google-compatibility:${short.compatibility}`,
      finalWeb: `repkey-release-final-web:${short.final}`,
      finalWorker: `repkey-release-final-worker:${short.final}`,
      admission: `repkey-release-google-admission:${short.final}`,
      gateway: `repkey-release-google-gateway:${short.final}`,
    }
    builtTags.push(...Object.values(tags))

    const builds = [
      buildImage({
        context: baseline,
        dockerfile: join(baseline, 'Dockerfile'),
        tag: tags.baselineWeb,
        sourceRevision: plan.baselineCommit,
      }),
      buildImage({
        context: baseline,
        dockerfile: join(baseline, 'Dockerfile.worker'),
        tag: tags.baselineWorker,
        sourceRevision: plan.baselineCommit,
      }),
      buildImage({
        context: compatibility,
        dockerfile: join(compatibility, 'Dockerfile.google-import-compatibility'),
        tag: tags.compatibility,
        sourceRevision: plan.compatibilityCommit,
      }),
      buildImage({
        context: final,
        dockerfile: join(final, 'Dockerfile'),
        tag: tags.finalWeb,
        sourceRevision: plan.finalCommit,
      }),
      buildImage({
        context: final,
        dockerfile: join(final, 'Dockerfile.worker'),
        tag: tags.finalWorker,
        sourceRevision: plan.finalCommit,
      }),
      buildImage({
        context: final,
        dockerfile: join(final, 'Dockerfile.google-execution-admission'),
        tag: tags.admission,
        sourceRevision: plan.finalCommit,
      }),
      buildImage({
        context: final,
        dockerfile: join(final, 'Dockerfile.google-egress-gateway'),
        tag: tags.gateway,
        sourceRevision: plan.finalCommit,
      }),
      run('docker', ['pull', PROVIDER_REDIS_IMAGE]),
    ]

    const images = {
      baselineWeb: inspectImage(tags.baselineWeb),
      baselineWorker: inspectImage(tags.baselineWorker),
      compatibility: inspectImage(tags.compatibility),
      finalWeb: inspectImage(tags.finalWeb),
      finalWorker: inspectImage(tags.finalWorker),
      admission: inspectImage(tags.admission),
      gateway: inspectImage(tags.gateway),
      providerRedis: inspectImage(PROVIDER_REDIS_IMAGE),
    }
    assertGoogleImportReleaseImageIdentity(images.baselineWeb, plan.baselineCommit, {
      allowUnlabeledMaterializedSource: true,
    })
    assertGoogleImportReleaseImageIdentity(images.baselineWorker, plan.baselineCommit, {
      allowUnlabeledMaterializedSource: true,
    })
    assertGoogleImportReleaseImageIdentity(images.compatibility, plan.compatibilityCommit)
    assertGoogleImportReleaseImageIdentity(images.finalWeb, plan.finalCommit)
    assertGoogleImportReleaseImageIdentity(images.finalWorker, plan.finalCommit)
    assertGoogleImportReleaseImageIdentity(images.admission, plan.finalCommit)
    assertGoogleImportReleaseImageIdentity(images.gateway, plan.finalCommit)
    if (images.compatibility.contract !== 'compatibility') {
      throw new Error('Compatibility image has the wrong contract label')
    }
    for (const proof of [images.finalWeb, images.finalWorker]) {
      if (proof.contract !== 'final' || proof.rolloutScope !== 'serving-final') {
        throw new Error(`${proof.tag} is not a serving-final contract image`)
      }
    }
    const smokes = [
      imageSmoke(tags.baselineWeb, { scriptPolicy: 'allow' }),
      imageSmoke(tags.baselineWorker, { scriptPolicy: 'allow' }),
      imageSmoke(tags.compatibility),
      imageSmoke(tags.finalWeb),
      imageSmoke(tags.finalWorker),
      imageSmoke(tags.admission, { scriptPolicy: 'allow' }),
      imageSmoke(tags.gateway, { scriptPolicy: 'allow' }),
    ]

    run('docker', ['network', 'create', '--internal', network], { quiet: true })
    run(
      'docker',
      [
        'run',
        '-d',
        '--name',
        postgres,
        '--network',
        network,
        '-e',
        'POSTGRES_USER=repkey',
        '-e',
        'POSTGRES_PASSWORD=release-drill-password',
        '-e',
        'POSTGRES_DB=repkey',
        POSTGRES_IMAGE,
        '-c',
        'fsync=off',
        '-c',
        'full_page_writes=off',
      ],
      { quiet: true },
    )
    await waitForPostgres(postgres)
    const databaseUrl =
      'postgresql://repkey:release-drill-password@' + postgres + ':5432/repkey'

    const baselineMigration = runMigrator(tags.baselineWeb, network, databaseUrl)
    const baselineHead = psql(
      postgres,
      "SELECT count(*)::text || ':' || max(created_at)::text FROM drizzle.__drizzle_migrations;",
    )
    const expandMigration = runMigrator(tags.finalWeb, network, databaseUrl)
    const expandHead = psql(
      postgres,
      "SELECT count(*)::text || ':' || max(created_at)::text FROM drizzle.__drizzle_migrations;",
    )
    prepareContractState(postgres)
    const contractSql = readFileSync(join(final, CONTRACT_MIGRATION), 'utf8')
    psql(postgres, `BEGIN;\n${contractSql}\nCOMMIT;`)
    const contractMigrationSha256 = sha256(contractSql)
    const finalMigration = runMigrator(tags.finalWeb, network, databaseUrl)
    const finalSchema = finalSchemaProof(postgres)
    const oldBinaryRejected = runMigratorExpectFailure(
      tags.baselineWeb,
      network,
      databaseUrl,
    )

    const finalImagesAfter = {
      web: inspectImage(tags.finalWeb).id,
      worker: inspectImage(tags.finalWorker).id,
      admission: inspectImage(tags.admission).id,
      gateway: inspectImage(tags.gateway).id,
      providerRedis: inspectImage(PROVIDER_REDIS_IMAGE).id,
    }
    const finalImagesBefore = {
      web: images.finalWeb.id,
      worker: images.finalWorker.id,
      admission: images.admission.id,
      gateway: images.gateway.id,
      providerRedis: images.providerRedis.id,
    }
    if (JSON.stringify(finalImagesAfter) !== JSON.stringify(finalImagesBefore)) {
      throw new Error('Final image identity changed during the contract drill')
    }

    const evidence = {
      schemaVersion: 'google-import-immutable-drill-v1',
      evidenceKind: 'google-import-immutable-local-migration-drill',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      sourcePlan: plan,
      sourcePlanSha256: releaseSourcePlanSha256(plan),
      sources,
      contractMigration: {
        path: CONTRACT_MIGRATION,
        sha256: contractMigrationSha256,
      },
      builds: builds.map(({ command, durationMs }) => ({ command, durationMs })),
      imageSmokes: smokes.map(({ command, durationMs }) => ({ command, durationMs })),
      images,
      finalImagesBefore,
      finalImagesAfter,
      migration: {
        baseline: { ...baselineMigration, stdout: undefined, head: baselineHead },
        expand: { ...expandMigration, stdout: undefined, head: expandHead },
        final: { ...finalMigration, stdout: undefined },
        oldBinaryRejected,
      },
      finalSchema,
      assertions: {
        cleanFullHistory: true,
        orderedDistinctCommits: true,
        isolatedCommitWorktrees: true,
        historicalBaselineBoundByMaterializedWorktree: true,
        lockfilesAndBaseImagesPinned: true,
        immutableImageIds: true,
        baselineToExpandToContract: true,
        finalImageRunsOnExpandAndFinal: true,
        oldBinaryRejectedAfterContract: true,
        bothCapabilitiesPersistedKilled: true,
        zeroProviderContent: true,
      },
      exclusions: [
        'production-egress-attestation',
        'live-provider-canary',
        'hosted-capacity',
        'managed-pitr',
      ],
    }
    const artifactDirectory = resolve(ROOT, 'test-results/google-import-release-drill')
    mkdirSync(artifactDirectory, { recursive: true })
    const artifactPath = join(artifactDirectory, 'release-evidence.json')
    const encoded = `${JSON.stringify(evidence, null, 2)}\n`
    const digest = sha256(encoded)
    writeFileSync(artifactPath, encoded, 'utf8')
    writeFileSync(
      `${artifactPath}.sha256`,
      `${digest}  ${basename(artifactPath)}\n`,
      'utf8',
    )
    console.log(JSON.stringify({ evidence: artifactPath, sha256: digest }))
  } finally {
    spawnSync('docker', ['rm', '-f', postgres], { stdio: 'ignore' })
    spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' })
    for (const path of worktrees.reverse()) removeWorktree(path)
    rmSync(scratch, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
