// LIF-01-T21 operator command for a partially applied offboarding.
//
// Removal and leave fence the provider-side authorities BEFORE the Identity
// transaction. A crash between the two leaves exactly one shape: every
// property access grant revoked with the offboarding reason, and a membership
// row that should no longer exist. This command finds that shape and, when
// explicitly applied, converges by COMPLETING the offboarding through the same
// atomic command a clean removal uses.
//
// It never re-grants access. The fence was an authorized decision; undoing it
// to repair a crash would hand back authority somebody already removed. If the
// member should keep working, re-invite them — that has its own audit trail.
//
// Report the whole candidate set:
//   pnpm ops:repair-partial-offboarding --operator <id>
//
// Report one user:
//   pnpm ops:repair-partial-offboarding <organization-id> <user-id> --operator <id>
//
// Converge one reviewed user:
//   pnpm ops:repair-partial-offboarding <organization-id> <user-id> \
//     --operator <id> --ticket <ref> --reason <text> \
//     --apply --yes ops:repair-partial-offboarding

import { getDb } from '../../src/shared/db'
import { createAtomicIdentityCommandStore } from '../../src/contexts/identity/infrastructure/identity-command-store'
import { createPartialOffboardingLookup } from '../../src/contexts/identity/infrastructure/partial-offboarding.lookup'
import { repairPartialOffboarding } from '../../src/contexts/identity/application/use-cases/repair-partial-offboarding'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:repair-partial-offboarding'
const USAGE =
  `pnpm ${COMMAND} [<organization-id> <user-id>] --operator <id> ` +
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
      const db = getDb()
      const command = repairPartialOffboarding({
        lookup: createPartialOffboardingLookup(db),
        commandStore: createAtomicIdentityCommandStore(db, () => crypto.randomUUID()),
        clock: () => new Date(),
        operatorUserId: context.operatorId,
      })

      const [organizationId, userId, ...unexpected] = args.positionals
      if (unexpected.length > 0) throw new Error(`usage: ${USAGE}`)

      // A sweep is deliberately report-only in EVERY mode. Converging an
      // unreviewed set of users in one pass is exactly the blast radius an
      // operator command must not have.
      if (!organizationId || !userId) {
        const reports = await command.sweep({ limit: 25 })
        io.out(JSON.stringify({ command: COMMAND, mode: 'sweep', reports }, null, 2))
        return
      }

      const report = await command.inspect({
        organizationId,
        userId,
        apply: !context.dryRun,
      })
      io.out(
        JSON.stringify(
          { command: COMMAND, mode: context.dryRun ? 'report' : 'apply', report },
          null,
          2,
        ),
      )
      if (
        !context.dryRun &&
        report.finding === 'partial_offboarding' &&
        !report.repaired
      ) {
        return 1
      }
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
