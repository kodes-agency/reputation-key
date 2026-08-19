#!/usr/bin/env node
// BQC-6.9 — changed-code budget gate. Wired as `pnpm check:changed-code` and
// as a CI step in the check job (ci.yml, after the coverage gate).
//
// Master-plan changed-code budget: every NEW production source module with
// runtime behavior under src/** must have executable contract evidence: a
// colocated/direct test, or fresh per-file coverage at the enforced threshold.
//
// Scope (deliberately narrow — the coverage ratchet in check-coverage.mjs
// owns the overall floor; this gate owns new decision code):
//   included : files ADDED by this branch vs the main merge-base
//              (`git diff --diff-filter=A <base>...HEAD -- 'src/**'`)
//   excluded : test files (*.test.ts(x)), stories (*.stories.*),
//              UI routes (src/routes/**), components (src/components/**),
//              test-only helpers/fixtures, barrels, generated sources, and
//              config modules. Type/interface-only modules are detected with
//              the TypeScript parser and excluded because they have no runtime
//              behavior to exercise.
//   modified files are NOT gated here (the ratchet owns their coverage).
//
// EXEMPT register — a new file may ship without executable contract evidence
// ONLY with owner + reason recorded here. Keep it narrow and stale-checked.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, basename, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {ReadonlyArray<{ file: string, owner: string, reason: string }>} */
const EXEMPT = [
  // BQC-7.4 alert family — covered by the family injection suites (unit +
  // integration) rather than per-file colocated tests:
  {
    file: 'src/shared/observability/alert-definitions.ts',
    owner: 'engineering',
    reason:
      'covered by src/shared/jobs/alert-injection.test.ts (51 tests: per-alert fire/no-fire table, boundaries, registry shape)',
  },
  {
    file: 'src/shared/observability/alert-dispatcher.ts',
    owner: 'engineering',
    reason:
      'covered by src/shared/jobs/alert-injection.test.ts (dispatch contract, payload fields, webhook failure semantics, banned-key walk)',
  },
  {
    file: 'src/shared/health/alert-state.ts',
    owner: 'engineering',
    reason:
      'covered by src/shared/jobs/alert-injection.test.ts (hysteresis: edge, no-refire, refire-after-expiry, recovery-clears) + the integration injection suite',
  },
  {
    file: 'src/shared/observability/alert-aux-reads.ts',
    owner: 'engineering',
    reason:
      'SQL needs real PG — covered by src/shared/jobs/infrastructure/repositories/alert-injection.test.ts (integration project, real-schema assertions)',
  },
]

const EXCLUDED = (file) =>
  !/\.(ts|tsx)$/.test(file) ||
  /\.(test|spec)\.(ts|tsx)$/.test(file) ||
  /\.stories\.(ts|tsx)$/.test(file) ||
  file.startsWith('src/routes/') ||
  file.startsWith('src/components/') ||
  file.startsWith('src/shared/testing/') ||
  file.startsWith('src/test-fixtures/') ||
  file.includes('/generated/') ||
  basename(file) === 'index.ts' ||
  /\.(gen|generated)\.ts$/.test(file) ||
  /\.config\.ts$/.test(file)

const hasRuntimeBehavior = (file) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    false,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  return source.statements.some((statement) => {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isImportEqualsDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    ) {
      return false
    }
    if (
      ts.isExportDeclaration(statement) &&
      (statement.isTypeOnly ||
        (statement.exportClause &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.every((element) => element.isTypeOnly)))
    ) {
      return false
    }
    return !statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DeclareKeyword,
    )
  })
}

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: (r.stdout ?? '').trim() }
}

const directTestOwners = () => {
  const tests = git([
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z',
    '--',
    'src/**/*.test.ts',
    'src/**/*.test.tsx',
  ])
  if (tests.status !== 0) return new Map()
  const owners = new Map()
  for (const testFile of tests.stdout.split('\0').filter(Boolean)) {
    const source = ts.createSourceFile(
      testFile,
      readFileSync(join(ROOT, testFile), 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      testFile.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        continue
      }
      const clause = statement.importClause
      const named = clause?.namedBindings
      if (
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          named &&
          ts.isNamedImports(named) &&
          named.elements.every((element) => element.isTypeOnly))
      ) {
        continue
      }
      const specifier = statement.moduleSpecifier.text
      const basePath = specifier.startsWith('#/')
        ? join(ROOT, 'src', specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(ROOT, dirname(testFile), specifier)
          : null
      if (!basePath) continue
      const candidates = /\.[cm]?[jt]sx?$/.test(basePath)
        ? [basePath]
        : [`${basePath}.ts`, `${basePath}.tsx`, join(basePath, 'index.ts')]
      const sourcePath = candidates.find(existsSync)
      if (!sourcePath) continue
      const sourceFile = relative(ROOT, sourcePath)
      const sourceOwners = owners.get(sourceFile) ?? []
      sourceOwners.push(testFile)
      owners.set(sourceFile, sourceOwners)
    }
  }
  return owners
}

const twoHopTestOwners = (directOwners) => {
  const owners = new Map(directOwners)
  for (const [ownerSource, tests] of directOwners) {
    const source = ts.createSourceFile(
      ownerSource,
      readFileSync(join(ROOT, ownerSource), 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      ownerSource.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    for (const statement of source.statements) {
      const declaration =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
          ? statement
          : null
      const clause = ts.isImportDeclaration(statement)
        ? statement.importClause
        : undefined
      const named = clause?.namedBindings
      if (
        !declaration?.moduleSpecifier ||
        !ts.isStringLiteral(declaration.moduleSpecifier) ||
        declaration.isTypeOnly ||
        clause?.isTypeOnly ||
        (clause &&
          !clause.name &&
          named &&
          ts.isNamedImports(named) &&
          named.elements.every((element) => element.isTypeOnly))
      ) {
        continue
      }
      const specifier = declaration.moduleSpecifier.text
      const basePath = specifier.startsWith('#/')
        ? join(ROOT, 'src', specifier.slice(2))
        : specifier.startsWith('.')
          ? resolve(ROOT, dirname(ownerSource), specifier)
          : null
      if (!basePath) continue
      const candidates = /\.[cm]?[jt]sx?$/.test(basePath)
        ? [basePath]
        : [`${basePath}.ts`, `${basePath}.tsx`, join(basePath, 'index.ts')]
      const sourcePath = candidates.find(existsSync)
      if (!sourcePath) continue
      const sourceFile = relative(ROOT, sourcePath)
      const sourceOwners = owners.get(sourceFile) ?? []
      owners.set(sourceFile, [...new Set([...sourceOwners, ...tests])])
    }
  }
  return owners
}

const coveredRuntimeModules = (files) => {
  const report = join(ROOT, 'coverage/coverage-summary.json')
  if (!existsSync(report)) return new Set()
  const newestSource = Math.max(
    ...files.map((file) => statSync(join(ROOT, file)).mtimeMs),
  )
  if (statSync(report).mtimeMs < newestSource) return new Set()
  const summary = JSON.parse(readFileSync(report, 'utf8'))
  const covered = new Set()
  for (const [absolutePath, metrics] of Object.entries(summary)) {
    if (absolutePath === 'total') continue
    const file = relative(ROOT, absolutePath)
    const statements = metrics?.statements
    const functions = metrics?.functions
    if (
      statements?.total > 0 &&
      statements.pct >= 80 &&
      (functions?.total === 0 || functions?.pct >= 80)
    ) {
      covered.add(file)
    }
  }
  return covered
}

// Resolve the diff base: explicit env override (CI), then origin/main, then main.
function resolveBase() {
  const candidates = [process.env.CHANGED_CODE_BASE, 'origin/main', 'main'].filter(
    Boolean,
  )
  for (const ref of candidates) {
    if (git(['rev-parse', '--verify', '--quiet', ref]).status === 0) return ref
  }
  return null
}

const base = resolveBase()
if (!base) {
  const msg =
    '[changed-code] no base ref found (tried CHANGED_CODE_BASE, origin/main, main) — ' +
    'cannot evaluate added files. Fetch the main branch (CI: actions/checkout fetch-depth: 0).'
  if (process.env.CI === 'true') {
    console.error(msg)
    process.exit(1)
  }
  console.warn(`${msg}\n[changed-code] SKIP (local run without a main ref)`)
  process.exit(0)
}

const mergeBase = git(['merge-base', base, 'HEAD']).stdout
const diff = git([
  'diff',
  '--name-only',
  '-z',
  '--diff-filter=A',
  `${mergeBase}...HEAD`,
  '--',
  'src/**',
])
if (diff.status !== 0) {
  console.error(`[changed-code] git diff against ${base} failed`)
  process.exit(1)
}

const added = diff.stdout ? diff.stdout.split('\0').filter(Boolean) : []
const gated = added.filter((f) => !EXCLUDED(f))
const runtimeGated = gated.filter(hasRuntimeBehavior)
const testOwners = twoHopTestOwners(directTestOwners())
const coverageOwners = coveredRuntimeModules(runtimeGated)
const exemptFiles = new Map(EXEMPT.map((e) => [e.file, e]))

const failures = []
for (const file of runtimeGated) {
  if (testOwners.has(file)) continue
  if (coverageOwners.has(file)) continue
  if (exemptFiles.has(file)) continue
  failures.push(
    `${file} — added without runtime contract evidence; expected a runtime import from a test, ` +
      `fresh per-file coverage of at least 80% statements/functions, or a registered exemption ` +
      'with owner and reason in scripts/check-changed-code.mjs',
  )
}

// Stale exemptions fail too — the register must not rot.
for (const e of EXEMPT) {
  if (!existsSync(join(ROOT, e.file))) {
    failures.push(
      `stale exemption: ${e.file} (owner ${e.owner}) no longer exists — remove the entry`,
    )
  }
}

console.log(
  `[changed-code] base ${base} (merge-base ${mergeBase.slice(0, 12)}): ` +
    `${added.length} added src file(s), ${gated.length} source candidate(s), ` +
    `${runtimeGated.length} runtime-gated, ${testOwners.size} directly test-owned, ` +
    `${EXEMPT.length} exempt`,
)

if (failures.length > 0) {
  console.error(`[changed-code] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '[changed-code] OK — every added runtime production module carries a contract test',
)
