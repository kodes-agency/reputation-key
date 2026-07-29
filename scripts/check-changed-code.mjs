#!/usr/bin/env node
// BQC-6.9 — changed-code budget gate. Wired as `pnpm check:changed-code` and
// as a CI step in the check job (ci.yml, after the coverage gate).
//
// Master-plan changed-code budget: every NEW production source file under
// src/** must arrive with a colocated unit test — `foo.ts` next to
// `foo.test.ts` in the same directory (CONTEXT.md §Testing: "Tests colocated").
//
// Scope (deliberately narrow — the coverage ratchet in check-coverage.mjs
// owns the overall floor; this gate owns new decision code):
//   included : files ADDED by this branch vs the main merge-base
//              (`git diff --diff-filter=A <base>...HEAD -- 'src/**'`)
//   excluded : test files (*.test.ts(x)), stories (*.stories.*),
//              UI routes (src/routes/**), components (src/components/**),
//              test-only helpers (src/shared/testing/** — fixtures/builders,
//              mirroring the coverage-config exclusion), barrels (index.ts),
//              generated (*.gen.ts), config (*.config.ts)
//              — UI surfaces are covered by storybook/e2e gates, barrels and
//              generated code carry no logic.
//   modified files are NOT gated here (the ratchet owns their coverage).
//
// EXEMPT register — a new file may ship without a colocated test ONLY with
// owner + reason recorded here. Empty today; keep it narrow.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** @type {ReadonlyArray<{ file: string, owner: string, reason: string }>} */
const EXEMPT = [
  // { file: 'src/path/to/file.ts', owner: '@handle', reason: 'why no colocated test is correct' },
]

const EXCLUDED = (file) =>
  /\.(test|spec)\.(ts|tsx)$/.test(file) ||
  /\.stories\.(ts|tsx)$/.test(file) ||
  file.startsWith('src/routes/') ||
  file.startsWith('src/components/') ||
  file.startsWith('src/shared/testing/') ||
  basename(file) === 'index.ts' ||
  /\.gen\.ts$/.test(file) ||
  /\.config\.ts$/.test(file)

const git = (args) => {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' })
  return { status: r.status ?? 1, stdout: (r.stdout ?? '').trim() }
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
  '--diff-filter=A',
  `${mergeBase}...HEAD`,
  '--',
  'src/**',
])
if (diff.status !== 0) {
  console.error(`[changed-code] git diff against ${base} failed`)
  process.exit(1)
}

const added = diff.stdout ? diff.stdout.split('\n').filter(Boolean) : []
const gated = added.filter((f) => !EXCLUDED(f))
const exemptFiles = new Map(EXEMPT.map((e) => [e.file, e]))

const failures = []
for (const file of gated) {
  const testSibling = file.replace(/\.(ts|tsx)$/, '.test.$1')
  if (existsSync(join(ROOT, testSibling))) continue
  if (exemptFiles.has(file)) continue
  failures.push(
    `${file} — added without colocated ${basename(testSibling)}; ` +
      'add the test or register an exemption (owner+reason) in scripts/check-changed-code.mjs',
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
    `${added.length} added src file(s), ${gated.length} gated, ${EXEMPT.length} exempt`,
)

if (failures.length > 0) {
  console.error(`[changed-code] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}
console.log(
  '[changed-code] OK — every added production source file carries a colocated test',
)
