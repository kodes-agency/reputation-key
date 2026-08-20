#!/usr/bin/env node
// BQC-7.7 — dependency vulnerability gate.
//
// Runs `pnpm audit` twice against the committed lockfile and fails hard on
// advisories at/above the policy threshold (docs/operations/security-ci-policy.md):
//
//   run    command                 fail threshold        rationale
//   prod   pnpm audit --prod       high + critical       prod deps ship in the images
//   full   pnpm audit (all deps)   critical              dev-deps are tooling-only —
//                                                        high/moderate/low are REPORTED
//                                                        (visible every run) but do not
//                                                        fail; a critical anywhere does
//
// Exceptions live in security/audit-exceptions.json (keep it EMPTY — fix the
// dependency instead). Entry schema:
//
//   {
//     "id": "GHSA-xxxx-xxxx-xxxx",  // GHSA id, CVE id, advisory URL, or npm id
//     "scope": "prod" | "full",     // which audit run this exception covers
//     "owner": "Name or team",
//     "reason": "why this cannot be fixed by an upgrade/override right now",
//     "expiresAt": "2026-09-30"     // ISO date — an EXPIRED exception FAILS
//   }                               // the gate until renewed or removed
//
// An exception that no longer matches a firing advisory is STALE and also
// fails the gate — remove it in the same change that fixed the advisory.
// There is no continue-on-error anywhere: a red gate blocks the PR.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXCEPTIONS_FILE = join(ROOT, 'security/audit-exceptions.json')

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const severityAtLeast = (severity, threshold) =>
  SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold)

const RUNS = [
  { scope: 'prod', args: ['audit', '--prod', '--json'], failAt: 'high' },
  { scope: 'full', args: ['audit', '--json'], failAt: 'critical' },
]

function runAudit(args) {
  // pnpm prefers the installed virtual lockfile when node_modules exists.
  // Run from an isolated manifest directory so local agent/tooling packages
  // cannot contaminate the committed dependency graph that CI evaluates.
  const auditRoot = mkdtempSync(join(tmpdir(), 'repkey-dependency-audit-'))
  let res
  try {
    copyFileSync(join(ROOT, 'package.json'), join(auditRoot, 'package.json'))
    copyFileSync(join(ROOT, 'pnpm-lock.yaml'), join(auditRoot, 'pnpm-lock.yaml'))
    res = spawnSync('pnpm', args, {
      cwd: auditRoot,
      encoding: 'utf8',
      shell: false,
    })
  } finally {
    rmSync(auditRoot, { recursive: true, force: true })
  }
  if (res.error) {
    console.error(`[dependency-audit] failed to spawn pnpm: ${res.error.message}`)
    process.exit(2)
  }
  try {
    return JSON.parse(res.stdout)
  } catch {
    console.error(
      `[dependency-audit] could not parse \`pnpm ${args.join(' ')}\` output ` +
        `(exit ${res.status}) — audit backend unreachable or output shape changed:\n${res.stderr?.slice(0, 500)}`,
    )
    process.exit(2)
  }
}

function loadExceptions() {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(EXCEPTIONS_FILE, 'utf8'))
  } catch (err) {
    console.error(`[dependency-audit] cannot read ${EXCEPTIONS_FILE}: ${err.message}`)
    process.exit(2)
  }
  const entries = parsed?.exceptions
  if (!Array.isArray(entries)) {
    console.error(`[dependency-audit] ${EXCEPTIONS_FILE} must be { "exceptions": [...] }`)
    process.exit(2)
  }
  const today = new Date().toISOString().slice(0, 10)
  for (const [i, e] of entries.entries()) {
    const missing = ['id', 'scope', 'owner', 'reason', 'expiresAt'].filter((k) => !e[k])
    if (missing.length > 0 || !['prod', 'full'].includes(e.scope)) {
      console.error(
        `[dependency-audit] exception #${i} is malformed (need id/scope/owner/reason/expiresAt; scope ∈ prod|full): ${JSON.stringify(e)}`,
      )
      process.exit(2)
    }
    if (e.expiresAt < today) {
      console.error(
        `[dependency-audit] FAILED — exception for ${e.id} (owner: ${e.owner}) EXPIRED on ${e.expiresAt}. ` +
          'Renew it with a fresh reason+date or fix the advisory — expired exceptions do not suppress findings.',
      )
      process.exit(1)
    }
  }
  return entries
}

const advisoryIds = (a) =>
  new Set([a.github_advisory_id, ...(a.cves ?? []), a.url, String(a.id)].filter(Boolean))

const firstPath = (a) => a.findings?.[0]?.paths?.[0] ?? '(no dependency path reported)'

const exceptions = loadExceptions()
const matchedExceptions = new Set()
const failures = []
const reports = []

for (const run of RUNS) {
  const report = runAudit(run.args)
  const advisories = Object.values(report.advisories ?? {})
  const counts = report.metadata?.vulnerabilities ?? {}
  reports.push(
    `[dependency-audit] ${run.scope} tree: ${JSON.stringify(counts)} (fail threshold: ${run.failAt})`,
  )

  for (const advisory of advisories) {
    const ids = advisoryIds(advisory)
    const exception = exceptions.find(
      (e) => e.scope === run.scope && [...ids].some((id) => id === e.id),
    )
    const line =
      `${advisory.severity} ${advisory.module_name} (${advisory.github_advisory_id ?? advisory.id}) ` +
      `patched: ${advisory.patched_versions || 'none'} — ${advisory.title}\n    via ${firstPath(advisory)}`

    if (exception) {
      matchedExceptions.add(exception)
      reports.push(
        `  ⊘ excepted (${run.scope}, expires ${exception.expiresAt}, owner ${exception.owner}): ${advisory.module_name} ${exception.id} — ${exception.reason}`,
      )
      continue
    }

    if (severityAtLeast(advisory.severity, run.failAt)) {
      failures.push(`  ✗ [${run.scope}] ${line}`)
    } else {
      reports.push(`  • reported (below ${run.failAt} threshold): ${line}`)
    }
  }
}

for (const e of exceptions) {
  if (!matchedExceptions.has(e)) {
    failures.push(
      `  ✗ STALE exception: ${e.id} (scope ${e.scope}, owner ${e.owner}) no longer matches a firing advisory — remove it from security/audit-exceptions.json`,
    )
  }
}

for (const line of reports) console.log(line)

if (failures.length > 0) {
  console.error(`[dependency-audit] FAILED — ${failures.length} violation(s):`)
  for (const f of failures) console.error(f)
  console.error(
    '[dependency-audit] fix by upgrading/overriding the dependency (preferred) or add a ' +
      'dated, owned exception to security/audit-exceptions.json — see docs/operations/security-ci-policy.md',
  )
  process.exit(1)
}

console.log(
  `[dependency-audit] OK — no advisories at/above threshold (${matchedExceptions.size} active exception(s))`,
)
