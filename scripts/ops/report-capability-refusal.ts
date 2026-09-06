// Read-only capability refusal diagnostic (issues #403/#408). The report reads
// live capability, execution-control, and empirical permit state; it never
// predicts or invokes the mutating Postgres start authority.
//
// WHERE THIS CAN RUN, and why that is not an oversight.
//
// This command cannot reach the deployed closed beta. The runtime image ships
// neither `scripts/` nor tsx, and `scripts/check-production-artifacts.mjs`
// deny-lists `scripts/ops/` as "operator-only command source" — so bundling it
// into `dist-worker` to run it over `railway ssh` fails the image build, on
// purpose. Operator command source is deliberately absent from production
// artifacts. I tried exactly that and CI refused it; the gate was right.
//
// So this is the local-stack and dev-database surface. The live answer comes
// from the other caller of the same core: `explainPolicyDecisionFn`, which runs
// inside the web process and is reachable by an authenticated operator holding
// `policy.admin`. Both call `createCapabilityRefusalExplainer`, so there is one
// truth with two entry points — see #408 for why a third, internet-reachable
// surface was rejected while SAFE-01 remains open.

import { pathToFileURL } from 'node:url'
import { CAPABILITIES } from '../../src/shared/auth/beta-capabilities'
import { createCapabilityRefusalReaders } from '../../src/contexts/identity/infrastructure/repositories/capability-refusal.repository'
import { getDb } from '../../src/shared/db'
import {
  createCapabilityRefusalExplainer,
  type CapabilityRefusalReport,
  type ObservedFact,
} from '../../src/shared/governance/capability-refusal'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:report-capability-refusal'
const USAGE =
  'pnpm ops:report-capability-refusal --operator <id> [--capability <id>] [--org <id>] [--property <id>] [--json]'
const HELP = [
  'Explain the first authority refusing one capability or the complete capability catalogue.',
  'This command is read-only; it never calls the mutating Postgres start authority.',
  '',
  `usage: ${USAGE}`,
  '',
  'options:',
  '  --operator <id>    Required registered operator identity',
  '  --capability <id>  Explain one capability (default: the complete catalogue)',
  '  --org <id>         Supply Organization scope when available',
  '  --property <id>    Supply Property scope when available',
  '  --json             Emit machine-readable JSON',
  '  --help             Show this usage without connecting to the database',
].join('\n')

type ReportArgv = Readonly<{
  capability?: string
  harnessArgv: ReadonlyArray<string>
}>

type ReportArgvResult =
  Readonly<{ ok: true; value: ReportArgv }> | Readonly<{ ok: false; error: string }>

function extractReportArgv(argv: ReadonlyArray<string>): ReportArgvResult {
  let capability: string | undefined
  const harnessArgv: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string
    if (token === '--capability') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        return { ok: false, error: '--capability requires a value' }
      }
      capability = value
      index += 1
      continue
    }
    if (token.startsWith('--capability=')) {
      const value = token.slice('--capability='.length)
      if (!value) return { ok: false, error: '--capability requires a value' }
      capability = value
      continue
    }
    harnessArgv.push(token)
  }

  return { ok: true, value: { capability, harnessArgv } }
}

function renderFact(fact: ObservedFact): string {
  return fact.expected === undefined
    ? `${fact.name}: observed ${fact.observed}`
    : `${fact.name}: expected ${fact.expected}, observed ${fact.observed}`
}

export function renderCapabilityRefusalReport(report: CapabilityRefusalReport): string {
  const factlessRefusal = report.chain.find(
    (entry) => entry.outcome === 'refused' && entry.facts.length === 0,
  )
  if (factlessRefusal) {
    throw new Error(
      `Capability refusal report is missing facts for ${factlessRefusal.authority}`,
    )
  }

  const lines = [
    `${report.allowed ? 'ALLOWED' : 'REFUSED'} ${report.capability}`,
    `  deciding authority: ${report.decidedBy ?? '<none>'}`,
    `  code: ${report.code ?? '<none>'}`,
    `  fate: ${report.fate?.fate ?? '<none>'}`,
    `  fate authority: ${report.fate?.authority ?? '<none>'}`,
    `  activation: ${report.fate?.activation ?? '<none>'}`,
    '  chain:',
  ]

  for (const entry of report.chain) {
    lines.push(
      `    - ${entry.authority}: ${entry.outcome}${entry.code ? ` (code=${entry.code})` : ''}`,
    )
    for (const fact of entry.facts) lines.push(`      ${renderFact(fact)}`)
  }

  lines.push('  permit outcomes:')
  if (report.permitOutcomes.length === 0) {
    lines.push('    - none observed')
  } else {
    for (const outcome of report.permitOutcomes) {
      lines.push(
        `    - state=${outcome.state}; correlationId=${outcome.correlationId ?? '<none>'}; count=${outcome.count}; lastAt=${outcome.lastAt ?? '<none>'}`,
      )
    }
  }

  return lines.join('\n')
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(HELP)
    return
  }

  const parsed = extractReportArgv(argv)
  if (!parsed.ok) {
    console.error(`${COMMAND_NAME}: ${parsed.error}`)
    console.error(`usage: ${USAGE}`)
    process.exit(1)
  }

  const json = parsed.value.harnessArgv.includes('--json')
  let actionRunning = false
  const machineIO = json
    ? {
        out: (line: string) => {
          if (actionRunning) console.log(line)
          else console.error(line)
        },
        err: (line: string) => console.error(line),
      }
    : undefined

  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'global',
      mutation: false,
      extraFlags: ['json'],
      usage: USAGE,
    },
    async (context, _args, io) => {
      actionRunning = true
      const explain = createCapabilityRefusalExplainer(
        createCapabilityRefusalReaders(getDb()),
      )
      const capabilities: ReadonlyArray<string> = parsed.value.capability
        ? [parsed.value.capability]
        : CAPABILITIES
      const reports: CapabilityRefusalReport[] = []
      for (const capability of capabilities) {
        reports.push(
          await explain({
            capability,
            organizationId: context.organizationId,
            propertyId: context.propertyId,
          }),
        )
      }

      io.out(
        json
          ? JSON.stringify({ reports }, null, 2)
          : reports.map(renderCapabilityRefusalReport).join('\n\n'),
      )
    },
    parsed.value.harnessArgv,
    machineIO,
  )
  process.exit(result.exitCode)
}

const invokedPath = process.argv[1]
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  main().catch((error) => {
    console.error(
      `${COMMAND_NAME} failed:`,
      error instanceof Error ? error.name : 'UnknownError',
    )
    process.exit(1)
  })
}
