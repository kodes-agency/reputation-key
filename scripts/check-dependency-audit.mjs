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
//
// The gate passes only on an audit it could read. A run whose request failed,
// or whose output is not an audit report, fails with exit 2 and says the audit
// could not be read; exit 1 is kept for an advisory or an exception that
// breaks the policy. See "A run counts only when" below.

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXCEPTIONS_FILE = join(ROOT, 'security/audit-exceptions.json')
const STDERR_EXCERPT_CHARS = 500

const SEVERITY_ORDER = ['info', 'low', 'moderate', 'high', 'critical']
const severityAtLeast = (severity, threshold) =>
  SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(threshold)

const RUNS = [
  { scope: 'prod', args: ['audit', '--prod', '--json'], failAt: 'high' },
  { scope: 'full', args: ['audit', '--json'], failAt: 'critical' },
]

// A run counts only when pnpm printed an audit report this gate can read.
//
// pnpm 10.6.5 answers a request that failed (the registry unreachable, a 4xx
// or 5xx, a 200 whose body is no audit report) with exit 1 and
// `{ "error": { "code", "message" } }` on stdout, and nothing on stderr. It
// exits 1 for an audit that found something too, so the status alone settles
// nothing, and the error object parses as JSON. Until 2026-10-13 this gate
// read that object as a report with no advisories and printed OK for as long
// as the registry stayed down.
//
// Each rule below names one way the output is not a report this run can
// judge, and returns why. They run in order and the first that answers fails
// the gate, so a later rule may rely on what an earlier one established.

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCount = (value) => Number.isInteger(value) && value >= 0

function notAnObject({ report }) {
  return isRecord(report) ? undefined : 'the output is not a JSON object'
}

function reportedError({ report }) {
  if (!('error' in report)) return undefined
  const { code, message } = isRecord(report.error) ? report.error : {}
  return `pnpm reported ${code ?? 'an error'}: ${message ?? JSON.stringify(report.error)}`
}

function noAdvisories({ report }) {
  return isRecord(report.advisories) ? undefined : 'the output has no `advisories` map'
}

// An advisory is judged by its severity; one this gate cannot rank would be
// reported as below every threshold.
function unrankedAdvisory({ report }) {
  const advisories = Object.values(report.advisories)
  const unranked = advisories.find((a) => !SEVERITY_ORDER.includes(a?.severity))
  if (unranked === undefined) return undefined
  return `an advisory has severity ${JSON.stringify(unranked?.severity)}, which this gate cannot rank`
}

function noCounts({ report }) {
  const counts = report.metadata?.vulnerabilities
  return isRecord(counts) && Object.values(counts).every(isCount)
    ? undefined
    : 'the output has no `metadata.vulnerabilities` counts'
}

function uncountedSeverity({ report, failAt }) {
  const counts = report.metadata.vulnerabilities
  const uncounted = SEVERITY_ORDER.find(
    (severity) => severityAtLeast(severity, failAt) && !(severity in counts),
  )
  if (uncounted === undefined) return undefined
  return `the output does not count \`${uncounted}\` vulnerabilities, which this run fails on`
}

// pnpm's own rule for `audit --json`: exit 1 when the counts add up to
// anything, at any severity, and 0 when they add up to nothing. A report that
// looks complete beside a status that contradicts it is not believed.
function statusDisagrees({ report, status }) {
  const counted = Object.values(report.metadata.vulnerabilities).reduce(
    (sum, count) => sum + count,
    0,
  )
  if (status === (counted > 0 ? 1 : 0)) return undefined
  return (
    `the exit status disagrees with the report, whose counts add up to ${counted}: ` +
    'pnpm exits 1 when it counts any vulnerability and 0 when it counts none'
  )
}

const UNREADABLE_RULES = [
  notAnObject,
  reportedError,
  noAdvisories,
  unrankedAdvisory,
  noCounts,
  uncountedSeverity,
  statusDisagrees,
]

function failUnreadable(run, res, reason) {
  const ended = res.status === null ? `killed by ${res.signal}` : `exit ${res.status}`
  console.error(
    `[dependency-audit] FAILED — the ${run.scope} audit could not be read: ` +
      `\`pnpm ${run.args.join(' ')}\` (${ended}): ${reason}`,
  )
  if (res.stderr) console.error(res.stderr.slice(0, STDERR_EXCERPT_CHARS))
  console.error(
    '[dependency-audit] the audit was not completed, so this run is a failure and not a pass. ' +
      'Rerun the job when the registry answers — see docs/operations/security-ci-policy.md',
  )
  process.exit(2)
}

function readReport(run, res) {
  let report
  try {
    report = JSON.parse(res.stdout)
  } catch {
    return failUnreadable(run, res, 'pnpm printed no JSON')
  }
  const context = { report, status: res.status, failAt: run.failAt }
  for (const rule of UNREADABLE_RULES) {
    const reason = rule(context)
    if (reason) return failUnreadable(run, res, reason)
  }
  return report
}

function runAudit(run) {
  // pnpm prefers the installed virtual lockfile when node_modules exists.
  // Run from an isolated manifest directory so local agent/tooling packages
  // cannot contaminate the committed dependency graph that CI evaluates.
  const auditRoot = mkdtempSync(join(tmpdir(), 'repkey-dependency-audit-'))
  let res
  try {
    copyFileSync(join(ROOT, 'package.json'), join(auditRoot, 'package.json'))
    copyFileSync(join(ROOT, 'pnpm-lock.yaml'), join(auditRoot, 'pnpm-lock.yaml'))
    res = spawnSync('pnpm', run.args, {
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
  return readReport(run, res)
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
  const report = runAudit(run)
  const advisories = Object.values(report.advisories)
  const counts = report.metadata.vulnerabilities
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
