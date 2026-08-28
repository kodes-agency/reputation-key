import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyArtifact,
  discoverEntryPoints,
  extractFunctionLikeSymbols,
  extractImports,
  parseFindingRegister,
  parseTraceabilityMap,
} from './baseline-inventory'

type Options = Readonly<{
  evidenceRoot: string
  expectedSha?: string
  plan: string
  report: string
  runGates: boolean
  sourceRoot: string
}>

type CommandResult = Readonly<{
  exitCode: number
  stderr: string
  stdout: string
}>

const CODE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
const THIS_FILE = fileURLToPath(import.meta.url)

function parseArgs(argv: ReadonlyArray<string>): Options {
  const values = new Map<string, string>()
  let runGates = false
  for (const argument of argv) {
    if (argument === '--run-gates') {
      runGates = true
      continue
    }
    const match = /^--([^=]+)=(.+)$/.exec(argument)
    if (!match) throw new Error(`Unknown argument: ${argument}`)
    values.set(match[1], match[2])
  }

  const sourceRoot = resolve(values.get('source-root') ?? process.cwd())
  const plan = resolve(
    values.get('plan') ??
      join(sourceRoot, 'docs/comprehensive-beta-implementation-program-2026-08-25.md'),
  )
  const reportValue = values.get('report')
  if (!reportValue)
    throw new Error('--report=<absolute consolidated report path> is required')
  const report = resolve(reportValue)
  const evidenceRoot = resolve(
    values.get('evidence-root') ?? join(process.cwd(), 'docs/release-evidence/review'),
  )

  return {
    evidenceRoot,
    expectedSha: values.get('expected-sha'),
    plan,
    report,
    runGates,
    sourceRoot,
  }
}

function run(file: string, args: ReadonlyArray<string>, cwd: string): string {
  return execFileSync(file, args, { cwd, encoding: 'utf8' }).trim()
}

function runCaptured(
  file: string,
  args: ReadonlyArray<string>,
  cwd: string,
): CommandResult {
  const result = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function extension(path: string): string {
  const match = /(?:\.[^./]+)$/.exec(path)
  return match?.[0].toLowerCase() ?? ''
}

function trackedFiles(sourceRoot: string): ReadonlyArray<string> {
  return run('git', ['ls-files', '-z'], sourceRoot).split('\0').filter(Boolean).sort()
}

function repositoryName(remote: string): string | undefined {
  const normalized = remote.replace(/\.git$/, '')
  const https = /^https:\/\/github\.com\/([^/]+\/[^/]+)$/.exec(normalized)?.[1]
  if (https) return https
  return /^git@github\.com:([^/]+\/[^/]+)$/.exec(normalized)?.[1]
}

function githubGovernance(sourceRoot: string, remote: string): unknown {
  const repository = repositoryName(remote)
  if (!repository)
    return { status: 'unavailable', reason: 'origin is not a GitHub repository' }
  const auth = runCaptured('gh', ['auth', 'status'], sourceRoot)
  if (auth.exitCode !== 0) {
    return { status: 'unavailable', reason: 'gh is not authenticated' }
  }

  const protection = runCaptured(
    'gh',
    ['api', `repos/${repository}/branches/main/protection`],
    sourceRoot,
  )
  const rulesets = runCaptured(
    'gh',
    ['api', `repos/${repository}/rulesets`, '--paginate'],
    sourceRoot,
  )
  return {
    branch: 'main',
    capturedAt: new Date().toISOString(),
    protection:
      protection.exitCode === 0
        ? JSON.parse(protection.stdout)
        : { status: 'unavailable', error: protection.stderr.trim() },
    repository,
    rulesets:
      rulesets.exitCode === 0
        ? JSON.parse(rulesets.stdout)
        : { status: 'unavailable', error: rulesets.stderr.trim() },
    status: 'captured',
  }
}

function assertEmptyDirectory(path: string): void {
  if (existsSync(path) && readdirSync(path).length > 0) {
    throw new Error(`Evidence directory already exists and is not empty: ${path}`)
  }
  mkdirSync(path, { recursive: true })
}

function environmentId(nodeVersion: string): string {
  return `local-${process.platform}-${process.arch}-node${nodeVersion.replace(/^v/, '')}`
}

function runCleanInstall(sourceRoot: string, evidenceDir: string): void {
  const result = runCaptured('pnpm', ['install', '--frozen-lockfile'], sourceRoot)
  writeFileSync(
    join(evidenceDir, 'clean-install.log'),
    [`$ pnpm install --frozen-lockfile`, '', result.stdout, result.stderr].join('\n'),
  )
  if (result.exitCode !== 0) throw new Error('Clean frozen-lockfile install failed')
}

function runBaselineGates(
  sourceRoot: string,
  evidenceDir: string,
  expectedSha: string,
): CommandResult {
  const script = resolve(dirname(THIS_FILE), '../bqc/run-baseline.ts')
  const result = spawnSync('pnpm', ['exec', 'tsx', script], {
    cwd: sourceRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      BQC_EVIDENCE_ROOT: join(evidenceDir, 'gates'),
      BQC_EXPECTED_SHA: expectedSha,
    },
    maxBuffer: 64 * 1024 * 1024,
  })
  const captured = {
    exitCode: result.status ?? 1,
    stderr: result.stderr ?? '',
    stdout: result.stdout ?? '',
  }
  writeFileSync(
    join(evidenceDir, 'baseline-gates.log'),
    [captured.stdout, captured.stderr].join('\n'),
  )
  return captured
}

function main(): void {
  const options = parseArgs(process.argv.slice(2))
  if (!existsSync(options.plan)) throw new Error(`Plan not found: ${options.plan}`)
  if (!existsSync(options.report)) throw new Error(`Report not found: ${options.report}`)

  const sha = run('git', ['rev-parse', 'HEAD'], options.sourceRoot)
  if (options.expectedSha && sha !== options.expectedSha) {
    throw new Error(
      `Frozen SHA mismatch: expected ${options.expectedSha}, received ${sha}`,
    )
  }
  const dirty = run('git', ['status', '--porcelain'], options.sourceRoot)
  if (dirty) throw new Error(`Frozen source checkout is not clean:\n${dirty}`)

  const packageJson = JSON.parse(
    readFileSync(join(options.sourceRoot, 'package.json'), 'utf8'),
  ) as {
    engines?: { node?: string }
    packageManager?: string
  }
  const expectedNode = packageJson.engines?.node
  const expectedPnpm = packageJson.packageManager?.split('@').at(-1)
  const actualNode = process.version.replace(/^v/, '')
  const actualPnpm = run('pnpm', ['--version'], options.sourceRoot)
  if (expectedNode && expectedNode !== actualNode) {
    throw new Error(`Node mismatch: expected ${expectedNode}, received ${actualNode}`)
  }
  if (expectedPnpm && expectedPnpm !== actualPnpm) {
    throw new Error(`pnpm mismatch: expected ${expectedPnpm}, received ${actualPnpm}`)
  }

  const evidenceDir = join(options.evidenceRoot, sha, environmentId(process.version))
  assertEmptyDirectory(evidenceDir)

  const files = trackedFiles(options.sourceRoot)
  const artifacts = files.map((file) => {
    const absolute = join(options.sourceRoot, file)
    const stats = lstatSync(absolute)
    const symlinkTarget = stats.isSymbolicLink() ? readlinkSync(absolute) : undefined
    const contents = symlinkTarget ? Buffer.from(symlinkTarget) : readFileSync(absolute)
    return {
      bytes: stats.size,
      class: classifyArtifact(file),
      kind: stats.isSymbolicLink() ? 'symlink' : 'file',
      path: file,
      sha256: sha256(contents),
      ...(symlinkTarget ? { symlinkTarget } : {}),
    }
  })
  const codeFiles = files.filter((file) => {
    return (
      CODE_EXTENSIONS.has(extension(file)) &&
      lstatSync(join(options.sourceRoot, file)).isFile()
    )
  })
  const imports = codeFiles.map((file) => ({
    imports: extractImports(file, readFileSync(join(options.sourceRoot, file), 'utf8')),
    path: file,
  }))
  const symbols = codeFiles.flatMap((file) => {
    return extractFunctionLikeSymbols(
      file,
      readFileSync(join(options.sourceRoot, file), 'utf8'),
    )
  })
  const entryPoints = codeFiles.flatMap((file) => {
    return discoverEntryPoints(file, readFileSync(join(options.sourceRoot, file), 'utf8'))
  })

  const plan = readFileSync(options.plan, 'utf8')
  const report = readFileSync(options.report, 'utf8')
  const findingRegister = parseFindingRegister(report, parseTraceabilityMap(plan))
  const remote = run('git', ['remote', 'get-url', 'origin'], options.sourceRoot)
  const journal = JSON.parse(
    readFileSync(join(options.sourceRoot, 'drizzle/meta/_journal.json'), 'utf8'),
  ) as { entries: ReadonlyArray<{ tag: string }> }
  const betterAuthMigrations = files.filter((file) =>
    file.startsWith('better-auth_migrations/'),
  )
  const routeTree = readFileSync(join(options.sourceRoot, 'src/routeTree.gen.ts'))
  const relativePlan = relative(options.sourceRoot, options.plan)
  const planReference =
    relativePlan.startsWith('..') || isAbsolute(relativePlan)
      ? options.plan
      : relativePlan

  writeJson(join(evidenceDir, 'artifact-ledger.json'), artifacts)
  writeJson(join(evidenceDir, 'entry-point-catalogue.json'), entryPoints)
  writeJson(join(evidenceDir, 'import-graph.json'), imports)
  writeJson(join(evidenceDir, 'symbol-inventory.json'), symbols)
  writeJson(join(evidenceDir, 'finding-register.json'), findingRegister)
  writeJson(
    join(evidenceDir, 'github-governance.json'),
    githubGovernance(options.sourceRoot, remote),
  )

  const manifest = {
    schemaVersion: 1,
    kind: 'comprehensive-review-frozen-baseline',
    frozen: {
      branchCandidates: run(
        'git',
        ['branch', '--format=%(refname:short)', '--contains', sha],
        options.sourceRoot,
      )
        .split('\n')
        .filter(Boolean),
      clean: true,
      origin: remote,
      sha,
    },
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      pnpm: actualPnpm,
    },
    digests: {
      lockfileSha256: sha256(readFileSync(join(options.sourceRoot, 'pnpm-lock.yaml'))),
      routeTreeSha256: sha256(routeTree),
    },
    migrations: {
      betterAuth: betterAuthMigrations,
      drizzleHead: journal.entries.at(-1)?.tag ?? 'unknown',
      drizzleJournalEntries: journal.entries.length,
    },
    inventory: {
      artifacts: artifacts.length,
      entryPoints: entryPoints.length,
      files: files.length,
      findings: findingRegister.length,
      imports: imports.reduce((total, row) => total + row.imports.length, 0),
      sourceFiles: codeFiles.length,
      symbols: symbols.length,
      unmappedFindings: findingRegister
        .filter((finding) => finding.targetPackages.length === 0)
        .map((finding) => finding.id),
    },
    provenance: {
      inventoryLibrarySha256: sha256(
        readFileSync(join(dirname(THIS_FILE), 'baseline-inventory.ts')),
      ),
      inventoryToolSha256: sha256(readFileSync(THIS_FILE)),
      plan: planReference,
      planSha256: sha256(plan),
      report: options.report,
      reportSha256: sha256(report),
    },
    capturedAt: new Date().toISOString(),
  }
  writeJson(join(evidenceDir, 'manifest.json'), manifest)

  if (options.runGates) {
    runCleanInstall(options.sourceRoot, evidenceDir)
    const result = runBaselineGates(options.sourceRoot, evidenceDir, sha)
    writeJson(join(evidenceDir, 'gate-run-result.json'), {
      exitCode: result.exitCode,
      result: result.exitCode === 0 ? 'pass' : 'fail',
    })
  }

  process.stdout.write(`${evidenceDir}\n`)
}

main()
