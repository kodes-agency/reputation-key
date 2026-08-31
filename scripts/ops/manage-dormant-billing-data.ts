// EXP-01 report-first lifecycle for the five Better Auth Billing compatibility
// columns. Default mode emits content-free counts and fingerprints only.
// Apply re-locks the complete target set, refuses fingerprint drift, atomically
// nulls all five fields, and verifies the empty result. It never drops columns.
//
// Report:
//   pnpm ops:manage-dormant-billing-data --operator <id>
//
// Apply one reviewed exact report:
//   pnpm ops:manage-dormant-billing-data <target-fingerprint> \
//     --operator <id> --ticket <ref> --reason <text> \
//     --apply --yes ops:manage-dormant-billing-data

import { getDb } from '../../src/shared/db'
import { canonicalDormantBillingDataReport } from '../../src/contexts/identity/application/dormant-billing-data-lifecycle'
import { createDormantBillingDataLifecycleAdapter } from '../../src/contexts/identity/infrastructure/dormant-billing-data-lifecycle.adapter'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:manage-dormant-billing-data'
const USAGE =
  `pnpm ${COMMAND} [<expected-target-fingerprint>] --operator <id> ` +
  `[--ticket <ref> --reason <text> --apply --yes ${COMMAND}]`

const main = async (): Promise<void> => {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (context, args, io) => {
      const lifecycle = createDormantBillingDataLifecycleAdapter(getDb())
      const report = await lifecycle.report(new Date())
      io.out(canonicalDormantBillingDataReport(report))
      if (context.dryRun) {
        io.out(
          `report only — retain and review targetFingerprint before any ${COMMAND} apply`,
        )
        return
      }

      const [expectedTargetFingerprint, ...unexpected] = args.positionals
      if (!expectedTargetFingerprint || unexpected.length > 0) {
        throw new Error(`usage: ${USAGE}`)
      }
      const outcome = await lifecycle.erase({
        expectedTargetFingerprint,
        evaluatedAt: new Date(),
      })
      io.out(JSON.stringify({ command: COMMAND, mode: 'apply', outcome }, null, 2))
      if (outcome.status === 'refused_fingerprint') return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
