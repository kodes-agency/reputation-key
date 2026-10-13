import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

// The dependency audit gate is a script that runs from top to bottom against
// the project it sits in, so these tests run the real file as a process inside
// a throwaway project with a manifest, a lockfile and an exception register of
// its own. `pnpm` is whatever the PATH names: a stand-in that replays a
// recorded answer for each of the gate's two audit runs, or, for the one case
// that asks what pnpm itself does when the registry is gone, the real one.
//
// The stand-in is written once for the file and told where its answers are by
// a variable: macOS takes some 150 ms to start an executable it has not seen
// before, which a stand-in per case would pay twice in every case.

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = 'scripts/check-dependency-audit.mjs'
const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'] as const
const ADVISORY_ID = 'GHSA-aaaa-bbbb-cccc'
const HIDDEN_ADVISORY_ID = 'GHSA-dddd-eeee-ffff'
const HIDDEN_ADVISORY_CVE = 'CVE-2026-00002'
const REAL_PNPM_TIMEOUT_MS = 60_000
const STAND_IN_PNPM = `#!/bin/sh
case "$*" in
  'audit --prod --json') run=prod ;;
  'audit --json') run=full ;;
  *) echo "stand-in pnpm: unexpected arguments: $*" >&2; exit 64 ;;
esac
cat "$STAND_IN_ANSWERS/$run.stdout"
exit "$(cat "$STAND_IN_ANSWERS/$run.status")"
`

type Severity = (typeof SEVERITIES)[number]
/** What one `pnpm audit --json` run exits with and prints on stdout. */
type Answer = Readonly<{ status: number; stdout: string }>
type Answers = Readonly<{ prod: Answer; full: Answer }>
type Exception = Readonly<{
  id: string
  scope: 'prod' | 'full'
  owner: string
  reason: string
  expiresAt: string
}>
type GateRun = Readonly<{ status: number | null; output: string }>
/** The `pnpm` field of the fixture's manifest, when a case gives it one. */
type PnpmSettings = Readonly<Record<string, unknown>>

const projects: string[] = []
let standInBin = ''

// Any invocation but the gate's two audit runs fails, so the gate cannot pass
// by asking pnpm for something else.
beforeAll(() => {
  standInBin = realpathSync(mkdtempSync(join(tmpdir(), 'dependency-audit-pnpm-')))
  writeFileSync(join(standInBin, 'pnpm'), STAND_IN_PNPM)
  chmodSync(join(standInBin, 'pnpm'), 0o755)
})

afterAll(() => {
  rmSync(standInBin, { recursive: true, force: true })
})

afterEach(() => {
  for (const project of projects.splice(0)) {
    rmSync(project, { recursive: true, force: true })
  }
})

/** The pnpm this repository pins, so a run of the real one resolves no other version. */
function pinnedPackageManager(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    packageManager: string
  }
  return manifest.packageManager
}

const LOCKFILE = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .:
    dependencies:
      fixture-dependency:
        specifier: 1.0.0
        version: 1.0.0

packages:

  fixture-dependency@1.0.0:
    resolution: {integrity: sha512-${'A'.repeat(86)}==}

snapshots:

  fixture-dependency@1.0.0: {}
`

function write(project: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(project, path)), { recursive: true })
    writeFileSync(join(project, path), content)
  }
}

/** A project that holds the gate, one dependency and the exception register given. */
function projectWith(
  exceptions: readonly Exception[] = [],
  pnpmSettings?: PnpmSettings,
): string {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'dependency-audit-gate-')))
  projects.push(project)
  mkdirSync(join(project, 'scripts'))
  copyFileSync(join(ROOT, GATE), join(project, GATE))
  write(project, {
    'package.json': JSON.stringify({
      name: 'dependency-audit-gate-fixture',
      version: '1.0.0',
      private: true,
      packageManager: pinnedPackageManager(),
      dependencies: { 'fixture-dependency': '1.0.0' },
      ...(pnpmSettings === undefined ? {} : { pnpm: pnpmSettings }),
    }),
    'pnpm-lock.yaml': LOCKFILE,
    'security/audit-exceptions.json': JSON.stringify({ exceptions }),
  })
  return project
}

/** Records what the stand-in answers each audit run with; returns where it reads them. */
function recordAnswers(project: string, answers: Answers): string {
  write(project, {
    'answers/prod.stdout': answers.prod.stdout,
    'answers/prod.status': String(answers.prod.status),
    'answers/full.stdout': answers.full.stdout,
    'answers/full.status': String(answers.full.status),
  })
  return join(project, 'answers')
}

function runGate(project: string, env: NodeJS.ProcessEnv, timeout?: number): GateRun {
  const result = spawnSync(process.execPath, [join(project, GATE)], {
    cwd: project,
    encoding: 'utf8',
    env,
    timeout,
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

/** The gate, with the stand-in answering its two audit runs. */
function gateAnswered(
  answers: Answers,
  exceptions: readonly Exception[] = [],
  pnpmSettings?: PnpmSettings,
): GateRun {
  const project = projectWith(exceptions, pnpmSettings)
  return runGate(project, {
    ...process.env,
    PATH: `${standInBin}${delimiter}${process.env.PATH ?? ''}`,
    STAND_IN_ANSWERS: recordAnswers(project, answers),
  })
}

function advisory(severity: Severity): Record<string, unknown> {
  return {
    id: 1100001,
    github_advisory_id: ADVISORY_ID,
    cves: ['CVE-2026-00001'],
    url: `https://github.com/advisories/${ADVISORY_ID}`,
    severity,
    module_name: 'fixture-dependency',
    title: 'Fixture advisory',
    patched_versions: '>=1.0.1',
    findings: [{ version: '1.0.0', paths: ['.>fixture-dependency'] }],
  }
}

/**
 * An audit that ran, as pnpm 10.6.5 prints it: the advisories by id, a count
 * for each severity, and exit 1 when it counts anything at all, else 0.
 */
function auditFinding(...severities: readonly Severity[]): Answer {
  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [
      severity,
      severities.filter((found) => found === severity).length,
    ]),
  )
  const advisories = Object.fromEntries(
    severities.map((severity, index) => [String(1100001 + index), advisory(severity)]),
  )
  const report = {
    actions: [],
    advisories,
    muted: [],
    metadata: { vulnerabilities: counts, dependencies: 1, totalDependencies: 1 },
  }
  return {
    status: severities.length > 0 ? 1 : 0,
    stdout: JSON.stringify(report, null, 2),
  }
}

const CLEAN = auditFinding()

/**
 * A request that failed, as pnpm 10.6.5 answers it under `--json`: exit 1, an
 * error object on stdout and nothing on stderr. Each pair below was recorded
 * on 2026-10-13 by pointing `pnpm audit --json` at a closed port or at a local
 * server that gave the answer named.
 */
function failedRequest(code: string, message: string): Answer {
  return { status: 1, stdout: JSON.stringify({ error: { code, message } }, null, 2) }
}

const AUDIT_URL = 'https://registry.npmjs.org/-/npm/v1/security/audits'

const FAILED_REQUESTS: readonly (readonly [string, string, string])[] = [
  [
    'the registry cannot be reached',
    'ECONNREFUSED',
    `request to ${AUDIT_URL} failed, reason: connect ECONNREFUSED 127.0.0.1:9`,
  ],
  [
    'the registry answers 500',
    'ERR_PNPM_AUDIT_BAD_RESPONSE',
    `The audit endpoint (at ${AUDIT_URL}) responded with 500: {"error":"Internal Server Error"}`,
  ],
  [
    'the registry answers 429',
    'ERR_PNPM_AUDIT_BAD_RESPONSE',
    `The audit endpoint (at ${AUDIT_URL}) responded with 429: Too Many Requests`,
  ],
  [
    'the audit endpoint is gone (404)',
    'ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS',
    `The audit endpoint (at ${AUDIT_URL}) is doesn't exist.`,
  ],
  [
    'the registry answers 200 with an empty object',
    'pnpm',
    "Cannot read properties of undefined (reading 'vulnerabilities')",
  ],
  [
    'the registry answers 200 with a page that is not JSON',
    'pnpm',
    'Unexpected token \'<\', "<html>main"... is not valid JSON',
  ],
]

const answer = (status: number, body: unknown): Answer => ({
  status,
  stdout: typeof body === 'string' ? body : JSON.stringify(body),
})

const ZERO_COUNTS = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 }

/** Output that is not an audit report, whatever pnpm exits with. */
const UNREADABLE: readonly (readonly [string, Answer, string])[] = [
  ['nothing at all', answer(1, ''), 'printed no JSON'],
  ['text instead of JSON', answer(1, 'ERR_PNPM_FETCH_503'), 'printed no JSON'],
  ['a JSON value that is not an object', answer(0, []), 'not a JSON object'],
  ['an empty object', answer(0, {}), 'no `advisories` map'],
  [
    'no advisories map',
    answer(0, { metadata: { vulnerabilities: ZERO_COUNTS } }),
    'no `advisories` map',
  ],
  [
    'no vulnerability counts',
    answer(0, { advisories: {}, metadata: {} }),
    'no `metadata.vulnerabilities` counts',
  ],
  [
    'no count for a severity the run fails on',
    answer(0, { advisories: {}, metadata: { vulnerabilities: { low: 0 } } }),
    'does not count `high` vulnerabilities',
  ],
  [
    'an advisory with a severity the gate cannot rank',
    answer(1, {
      advisories: { 1100001: { ...advisory('high'), severity: 'severe' } },
      metadata: { vulnerabilities: { ...ZERO_COUNTS, high: 1 } },
    }),
    'severity "severe"',
  ],
  // The counts are what pnpm's exit status follows and the advisories are what
  // the gate judges: a counted severity with nothing listed is an advisory the
  // gate was never shown. The real pnpm 10.6.5 passes the first of these
  // through from a registry that answers it (seen 2026-10-13).
  [
    'a count for a severity the run fails on and no advisory at all',
    answer(1, {
      advisories: {},
      metadata: { vulnerabilities: { ...ZERO_COUNTS, high: 2 } },
    }),
    "the report's `high` count is 2 and it lists no advisory of that severity. An advisory left out of the list is not excepted: pnpm's `auditConfig` ignore lists are not an exception route",
  ],
  [
    'a count for a severity the run fails on and only advisories of another',
    answer(1, {
      advisories: { 1100001: advisory('moderate') },
      metadata: { vulnerabilities: { ...ZERO_COUNTS, moderate: 1, critical: 1 } },
    }),
    "the report's `critical` count is 1 and it lists no advisory of that severity",
  ],
  [
    'a non-zero exit with a report that counts nothing',
    { ...CLEAN, status: 1 },
    'the exit status disagrees with the report, whose counts add up to 0',
  ],
  [
    'a zero exit with a report that counts a vulnerability',
    { ...auditFinding('critical'), status: 0 },
    'the exit status disagrees with the report, whose counts add up to 1',
  ],
]

/** A port on this machine that nothing listens on. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((listening) => {
    server.listen(0, '127.0.0.1', listening)
  })
  const address = server.address()
  await new Promise<void>((closed) => {
    server.close(() => closed())
  })
  if (address === null || typeof address === 'string') {
    throw new Error('the probe server reported no port')
  }
  return address.port
}

const EXCEPTION: Exception = {
  id: ADVISORY_ID,
  scope: 'prod',
  owner: 'platform',
  reason: 'no patched release yet',
  expiresAt: '2999-12-31',
}

describe('dependency audit gate', () => {
  describe('when the audit request failed', () => {
    // R5E-09: each of these printed "OK — no advisories at/above threshold"
    // and exited 0, because the error object parses as JSON and has no
    // `advisories` key to read.
    it.each(FAILED_REQUESTS)('fails when %s', (_name, code, message) => {
      const gate = gateAnswered({ prod: failedRequest(code, message), full: CLEAN })

      expect(gate.output).not.toContain('[dependency-audit] OK')
      expect(gate.output).toContain(
        '[dependency-audit] FAILED — the prod audit could not be read: `pnpm audit --prod --json` (exit 1)',
      )
      expect(gate.output).toContain(`pnpm reported ${code}: ${message}`)
      expect(gate.status).toBe(2)
    })

    it('fails when only the second run, of the full tree, failed', () => {
      const gate = gateAnswered({
        prod: CLEAN,
        full: failedRequest('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9'),
      })

      expect(gate.output).not.toContain('[dependency-audit] OK')
      expect(gate.output).toContain(
        '[dependency-audit] FAILED — the full audit could not be read: `pnpm audit --json` (exit 1)',
      )
      expect(gate.status).toBe(2)
    })

    // Not held back until the registry answers: what the run before found is
    // printed, and the gate still ends as an audit it could not read.
    it('prints what the first run found when the second could not be read', () => {
      const gate = gateAnswered({
        prod: auditFinding('high'),
        full: failedRequest('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9'),
      })

      expect(gate.output).toContain(
        '[dependency-audit] prod tree: {"info":0,"low":0,"moderate":0,"high":1,"critical":0} (fail threshold: high)',
      )
      expect(gate.output).toContain(`✗ [prod] high fixture-dependency (${ADVISORY_ID})`)
      expect(gate.output).toContain('the full audit could not be read')
      expect(gate.output).not.toContain('[dependency-audit] OK')
      expect(gate.status).toBe(2)
    })

    it.each(UNREADABLE)('fails when pnpm prints %s', (_name, printed, reason) => {
      const gate = gateAnswered({ prod: printed, full: CLEAN })

      expect(gate.output).not.toContain('[dependency-audit] OK')
      expect(gate.output).toContain('the prod audit could not be read')
      expect(gate.output).toContain(reason)
      expect(gate.status).toBe(2)
    })

    // The experiment that settled R5E-09, kept: the real pnpm, a registry
    // address nothing answers on, retries off so the run takes a second
    // rather than pnpm's seventy. It also watches a pnpm upgrade: a version
    // that answered a failed request with something report-shaped would turn
    // this red.
    it(
      'fails with the real pnpm when the registry cannot be reached',
      async () => {
        const registry = `http://127.0.0.1:${await closedPort()}`

        const gate = runGate(
          projectWith(),
          {
            ...process.env,
            npm_config_registry: registry,
            npm_config_fetch_retries: '0',
            pnpm_config_registry: registry,
            pnpm_config_fetch_retries: '0',
          },
          REAL_PNPM_TIMEOUT_MS,
        )

        expect(gate.output).not.toContain('[dependency-audit] OK')
        expect(gate.output).toContain('the prod audit could not be read')
        expect(gate.output).toContain(`${registry}/-/npm/v1/security/audits`)
        expect(gate.status).toBe(2)
      },
      REAL_PNPM_TIMEOUT_MS,
    )
  })

  describe('when the audit ran', () => {
    it('passes an audit that found nothing', () => {
      const gate = gateAnswered({ prod: CLEAN, full: CLEAN })

      expect(gate.output).toContain(
        '[dependency-audit] prod tree: {"info":0,"low":0,"moderate":0,"high":0,"critical":0} (fail threshold: high)',
      )
      expect(gate.output).toContain(
        '[dependency-audit] OK — no advisories at/above threshold (0 active exception(s))',
      )
      expect(gate.status).toBe(0)
    })

    it('fails a high advisory in the production tree', () => {
      const gate = gateAnswered({
        prod: auditFinding('high'),
        full: auditFinding('high'),
      })

      expect(gate.output).toContain(`✗ [prod] high fixture-dependency (${ADVISORY_ID})`)
      expect(gate.output).toContain('via .>fixture-dependency')
      expect(gate.status).toBe(1)
    })

    it('reports a high advisory that only the full tree has, and passes', () => {
      const gate = gateAnswered({ prod: CLEAN, full: auditFinding('high', 'moderate') })

      expect(gate.output).toContain(
        `• reported (below critical threshold): high fixture-dependency (${ADVISORY_ID})`,
      )
      expect(gate.output).toContain('[dependency-audit] OK')
      expect(gate.status).toBe(0)
    })

    it('fails a critical advisory that only the full tree has', () => {
      const gate = gateAnswered({ prod: CLEAN, full: auditFinding('critical') })

      expect(gate.output).toContain(
        `✗ [full] critical fixture-dependency (${ADVISORY_ID})`,
      )
      expect(gate.status).toBe(1)
    })
  })

  describe('the exception register', () => {
    it('lets a dated, owned exception cover the advisory it names', () => {
      const gate = gateAnswered({ prod: auditFinding('high'), full: CLEAN }, [EXCEPTION])

      expect(gate.output).toContain(
        `⊘ excepted (prod, expires 2999-12-31, owner platform): fixture-dependency ${ADVISORY_ID}`,
      )
      expect(gate.output).toContain('(1 active exception(s))')
      expect(gate.status).toBe(0)
    })

    it('fails an exception whose date has passed, before any audit runs', () => {
      const gate = gateAnswered({ prod: auditFinding('high'), full: CLEAN }, [
        { ...EXCEPTION, expiresAt: '2020-01-01' },
      ])

      expect(gate.output).toContain(
        `exception for ${ADVISORY_ID} (owner: platform) EXPIRED on 2020-01-01`,
      )
      expect(gate.status).toBe(1)
    })

    it('fails an exception that no advisory matches any more', () => {
      const gate = gateAnswered({ prod: CLEAN, full: CLEAN }, [EXCEPTION])

      expect(gate.output).toContain(
        `✗ STALE exception: ${ADVISORY_ID} (scope prod, owner platform)`,
      )
      expect(gate.status).toBe(1)
    })

    // pnpm has an exception route of its own, and the register never sees it:
    // an advisory named in the manifest's `pnpm.auditConfig` is dropped from
    // the advisories pnpm prints while its count stays. The answer below is
    // what the real pnpm 10.6.5 printed on 2026-10-13 for two production Highs
    // with one of them named in either list: one advisory, a count of two.
    // With the other excepted in the register, the gate printed OK and exited 0.
    it.each([
      ['ignoreGhsas', HIDDEN_ADVISORY_ID],
      ['ignoreCves', HIDDEN_ADVISORY_CVE],
    ])('fails a manifest that carries pnpm.auditConfig.%s', (list, hidden) => {
      const oneOfTwoHighsListed: Answer = {
        status: 1,
        stdout: JSON.stringify({
          advisories: { 1100001: advisory('high') },
          metadata: { vulnerabilities: { ...ZERO_COUNTS, high: 2 } },
        }),
      }

      const gate = gateAnswered({ prod: oneOfTwoHighsListed, full: CLEAN }, [EXCEPTION], {
        auditConfig: { [list]: [hidden] },
      })

      expect(gate.output).not.toContain('[dependency-audit] OK')
      expect(gate.output).toContain(
        `[dependency-audit] FAILED — package.json sets pnpm.auditConfig.${list}`,
      )
      expect(gate.output).toContain('security/audit-exceptions.json')
      expect(gate.status).toBe(1)
    })

    it('reads a manifest with other pnpm settings as before', () => {
      const gate = gateAnswered({ prod: CLEAN, full: CLEAN }, [], {
        overrides: { 'fixture-dependency': '1.0.0' },
        auditConfig: {},
      })

      expect(gate.output).toContain(
        '[dependency-audit] OK — no advisories at/above threshold (0 active exception(s))',
      )
      expect(gate.status).toBe(0)
    })

    // An exception is no reading of the audit: with the request failed there
    // is no advisory for it to cover, and the gate must not call it stale.
    it('does not judge exceptions when the audit could not be read', () => {
      const gate = gateAnswered(
        { prod: failedRequest('ECONNREFUSED', 'connect ECONNREFUSED'), full: CLEAN },
        [EXCEPTION],
      )

      expect(gate.output).toContain('the prod audit could not be read')
      expect(gate.output).not.toContain('STALE exception')
      expect(gate.status).toBe(2)
    })
  })
})
