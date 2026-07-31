#!/usr/bin/env node
// BQC-7.7 — license policy gate.
//
// Inventories dependency licenses via `pnpm licenses list --json` (prod and
// dev trees separately) and fails on any package whose license is neither in
// the committed allow-list nor covered by a live exception
// (docs/operations/security-ci-policy.md):
//
//   policy file   security/license-policy.json
//   allowed       permissive set (MIT, ISC, BSD-*, Apache-2.0, 0BSD, CC0-1.0,
//                 BlueOak-1.0.0, MIT-0, Python-2.0, Unlicense, WTFPL)
//   expressions   "(MIT OR CC0-1.0)" passes when ANY operand is allowed;
//                 "MIT AND ISC" passes only when EVERY operand is allowed
//   exceptions    { package, license, scope, owner, reason, expiresAt }
//                   package   exact name, or trailing "*" = prefix match
//                             (covers os/cpu-suffixed binary packages)
//                   scope     "prod" | "dev" | "both"
//                   expiresAt ISO date — an EXPIRED exception FAILS the gate
//
// Stale exceptions (matching nothing in the scanned trees) are WARNED, not
// failed: os/cpu-restricted optional packages legitimately appear only on the
// platforms they target (e.g. @img/*-linux-x64 exists on CI, not on macOS
// dev machines). Expiry is platform-independent, so it always fails.
// There is no continue-on-error anywhere: a red gate blocks the PR.

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const POLICY_FILE = join(ROOT, 'security/license-policy.json')

const TREES = [
  { scope: 'prod', args: ['licenses', 'list', '--json', '--prod'] },
  { scope: 'dev', args: ['licenses', 'list', '--json', '--dev'] },
]

function runLicenses(args) {
  const res = spawnSync('pnpm', args, { cwd: ROOT, encoding: 'utf8', shell: false })
  if (res.error) {
    console.error(`[licenses] failed to spawn pnpm: ${res.error.message}`)
    process.exit(2)
  }
  try {
    return JSON.parse(res.stdout)
  } catch {
    console.error(
      `[licenses] could not parse \`pnpm ${args.join(' ')}\` output ` +
        `(exit ${res.status}) — output shape changed?:\n${res.stderr?.slice(0, 500)}`,
    )
    process.exit(2)
  }
}

function loadPolicy() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(POLICY_FILE, 'utf8'))
  } catch (err) {
    console.error(`[licenses] cannot read ${POLICY_FILE}: ${err.message}`)
    process.exit(2)
  }
  if (!Array.isArray(parsed?.allowed) || !Array.isArray(parsed?.exceptions)) {
    console.error(
      `[licenses] ${POLICY_FILE} must be { "allowed": [...], "exceptions": [...] }`,
    )
    process.exit(2)
  }
  const today = new Date().toISOString().slice(0, 10)
  for (const [i, e] of parsed.exceptions.entries()) {
    const missing = [
      'package',
      'license',
      'scope',
      'owner',
      'reason',
      'expiresAt',
    ].filter((k) => !e[k])
    if (missing.length > 0 || !['prod', 'dev', 'both'].includes(e.scope)) {
      console.error(
        `[licenses] exception #${i} is malformed (need package/license/scope/owner/reason/expiresAt; scope ∈ prod|dev|both): ${JSON.stringify(e)}`,
      )
      process.exit(2)
    }
    if (e.expiresAt < today) {
      console.error(
        `[licenses] FAILED — exception for ${e.package} (${e.license}, owner: ${e.owner}) EXPIRED on ${e.expiresAt}. ` +
          'Renew it with a fresh reason+date or remove the dependency — expired exceptions do not suppress findings.',
      )
      process.exit(1)
    }
  }
  return parsed
}

// Expression rule: an OR expression passes when any operand is allowed (the
// recipient elects that license); anything else (AND / plain) requires every
// license identifier to be allowed.
function isAllowedExpression(expression, allowed) {
  const identifiers = expression.match(/[A-Za-z0-9.-]+/g) ?? []
  const operands = identifiers.filter((id) => !['AND', 'OR', 'WITH'].includes(id))
  if (operands.length === 0) return false
  if (/\bOR\b/.test(expression)) return operands.some((id) => allowed.has(id))
  return operands.every((id) => allowed.has(id))
}

const packageMatches = (pattern, name) =>
  pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern

const policy = loadPolicy()
const allowed = new Set(policy.allowed)
const matchedExceptions = new Set()
const failures = []
const reports = []

for (const tree of TREES) {
  const inventory = runLicenses(tree.args)
  const summary = []
  for (const [license, packages] of Object.entries(inventory).sort()) {
    summary.push(`${license}×${packages.length}`)
    for (const pkg of packages) {
      if (isAllowedExpression(license, allowed)) continue
      const exception = policy.exceptions.find(
        (e) =>
          packageMatches(e.package, pkg.name) &&
          e.license === license &&
          (e.scope === 'both' || e.scope === tree.scope),
      )
      if (exception) {
        matchedExceptions.add(exception)
        reports.push(
          `  ⊘ excepted (${tree.scope}, expires ${exception.expiresAt}, owner ${exception.owner}): ${pkg.name} ${license} — ${exception.reason}`,
        )
        continue
      }
      failures.push(
        `  ✗ [${tree.scope}] ${pkg.name}@${pkg.version ?? '?'} — license "${license}" is not in the allow-list and has no live exception`,
      )
    }
  }
  reports.unshift(`[licenses] ${tree.scope} tree: ${summary.join(' ') || '(empty)'}`)
}

for (const e of policy.exceptions) {
  if (!matchedExceptions.has(e)) {
    reports.push(
      `  ⚠ stale exception (warning only — os/cpu-conditional packages appear per-platform): ${e.package} ${e.license} matched nothing in the scanned trees`,
    )
  }
}

for (const line of reports) console.log(line)

if (failures.length > 0) {
  console.error(`[licenses] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(f)
  console.error(
    '[licenses] fix by replacing the dependency, or add a dated, owned exception to ' +
      'security/license-policy.json after review — see docs/operations/security-ci-policy.md',
  )
  process.exit(1)
}

console.log(
  `[licenses] OK — every dependency license is allowed or excepted (${matchedExceptions.size} active exception(s))`,
)
