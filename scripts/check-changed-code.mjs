#!/usr/bin/env node
// BQC-6.9 — changed-code budget gate. Wired as `pnpm check:changed-code` and
// as the first CI step of the artifacts job (ci.yml, before the web build).
//
// Master-plan changed-code budget: every NEW production source module with
// runtime behavior under src/** must be within one import of a test: a test
// imports it, or a test imports a module that imports or re-exports it.
//
// An import here is a top-level `import` declaration that is not type-only.
// `await import()` is not read, so a module a test loads only that way is
// refused.
//
// The second hop is a relaxation (2026-08-19) and it is wide. It lets a test
// reach a module through a barrel, and it equally passes anything a context's
// `build.ts` wires once a test imports that build, with no assertion about the
// new module. So this gate proves a test can load the module. It does not
// prove a test exercises it, and nothing else in CI does.
//
// Scope (deliberately narrow: this gate owns new decision code and nothing
// else. No coverage is measured anywhere: the coverage ratchet,
// scripts/check-coverage.mjs, was deleted on 2026-09-05, and with it the
// per-file coverage this gate once accepted in place of a test):
//   included : files ADDED by this branch vs the main merge-base
//              (`git diff --diff-filter=A <base>...HEAD -- 'src/**'`),
//              API routes (src/routes/api/**) among them, an `index.ts`
//              route too: they are server handlers, not pages
//   excluded : test files (*.test.ts(x)), stories (*.stories.*),
//              UI routes (the rest of src/routes/**), components
//              (src/components/**),
//              test-only helpers/fixtures, barrels (an `index.ts` outside
//              src/routes/api/**), generated sources, and
//              config modules. Type/interface-only modules are detected with
//              the TypeScript parser and excluded because they have no runtime
//              behavior to exercise.
//   modified files are NOT gated, here or anywhere else.
//
// EXEMPT register — a new file may ship without executable contract evidence
// ONLY with owner + reason recorded here. The register is rot-checked in two
// directions, because a dead entry is not harmless: it silently pre-authorises
// the file to LOSE its evidence again without the gate noticing.
//   stale     — the file no longer exists            → remove the entry
//   redundant — the file is now within one import of a test, so the gate
//               would pass it anyway → remove the entry

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, basename, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @type {ReadonlyArray<{ file: string, owner: string, reason: string }>}
 *
 * EXEMPTIONS (owner + reason) — one hydration entry registered below.
 *
 * Emptied 2026-08-21: the four BQC-7.4 alert-family entries
 * (observability/alert-definitions.ts, observability/alert-dispatcher.ts,
 * health/alert-state.ts, observability/alert-aux-reads.ts) were all dead —
 * every one is a DIRECT test owner via runtime imports in
 * src/shared/jobs/alert-injection.test.ts, so the gate passed them on
 * evidence, never on the exemption. The alert-aux-reads reason ("SQL needs
 * real PG") was also factually wrong: its countRegionAttempts export is a pure
 * reducer over quarantine entries and is unit-tested with plain in-memory
 * fixtures at alert-injection.test.ts:636. The redundancy check below now
 * catches this rot class instead of relying on review discipline.
 */
const EXEMPT = [
  {
    file: 'src/client.tsx',
    owner: 'platform',
    reason:
      "TanStack Start's hydration entry contains no decision logic; a unit import would hydrate the test document as a side effect. Every Playwright browser project exercises this registered client entry because the app cannot render interactive routes without hydration.",
  },
]

// Pages are excluded with the components they render. `src/routes/api/**` holds
// server handlers (webhooks, the auth provider's routes, health), so it is not.
const isApiRoute = (file) => file.startsWith('src/routes/api/')
const isUiRoute = (file) => file.startsWith('src/routes/') && !isApiRoute(file)

// An `index.ts` is a barrel everywhere but under `src/routes/api/**`, where it
// is the route of its own directory (src/routes/api/health/index.ts).
const isBarrel = (file) => basename(file) === 'index.ts' && !isApiRoute(file)

const EXCLUDED = (file) =>
  !/\.(ts|tsx)$/.test(file) ||
  /\.(test|spec)\.(ts|tsx)$/.test(file) ||
  /\.stories\.(ts|tsx)$/.test(file) ||
  isUiRoute(file) ||
  file.startsWith('src/components/') ||
  file.startsWith('src/shared/testing/') ||
  file.startsWith('src/test-fixtures/') ||
  file.includes('/generated/') ||
  isBarrel(file) ||
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
    // `git ls-files -c` includes tracked paths deleted or moved in the worktree.
    // They cannot own current code and attempting to read them makes the gate
    // crash before it can evaluate the actual change.
    if (!existsSync(join(ROOT, testFile))) continue
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
const exemptFiles = new Map(EXEMPT.map((e) => [e.file, e]))

const failures = []
for (const file of runtimeGated) {
  if (testOwners.has(file)) continue
  if (exemptFiles.has(file)) continue
  failures.push(
    `${file} — added without contract evidence; expected a static, non-type import of it in a test ` +
      '(`await import()` is not read), or in a module a test imports, or a registered exemption ' +
      'with owner and reason in scripts/check-changed-code.mjs',
  )
}

// Register rot fails the gate in BOTH directions (see the header): an entry for
// a file that is gone, and an entry for a file the gate would now pass on its
// own evidence. The redundancy arm uses exactly the same owner set as the pass
// loop above, so it can only fire on exemptions that are provably doing no
// work.
for (const e of EXEMPT) {
  if (!existsSync(join(ROOT, e.file))) {
    failures.push(
      `stale exemption: ${e.file} (owner ${e.owner}) no longer exists — remove the entry`,
    )
    continue
  }
  const owners = testOwners.get(e.file)
  if (owners?.length) {
    failures.push(
      `exemption no longer needed — remove: ${e.file} (owner ${e.owner}) is within one import of ` +
        `${owners.join(', ')}, so the gate already passes it on evidence. A dead exemption ` +
        'is not harmless: it pre-authorises the file to lose that evidence unnoticed.',
    )
  }
}

console.log(
  `[changed-code] base ${base} (merge-base ${mergeBase.slice(0, 12)}): ` +
    `${added.length} added src file(s), ${gated.length} source candidate(s), ` +
    `${runtimeGated.length} runtime-gated, ${testOwners.size} module(s) within one import of a test, ` +
    `${EXEMPT.length} exempt`,
)

if (failures.length > 0) {
  console.error(`[changed-code] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '[changed-code] OK — every added runtime production module is imported by a test, or by a module a test imports',
)
