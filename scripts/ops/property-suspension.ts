// Operator CLI (BQC-7.5): suspend/restore property processing via the
// BQC-2.7 policy-admin op (setPropertySuspension — reason + ticket required).
// Production policyAdmin routes the suspension and version change through one
// Identity transaction. Suspension blocks the property in the capability
// store (processing denies property_suspended within the refresh bound);
// restore clears it.
//
// Usage:
//   pnpm ops:suspend-property --operator <id> --org <id> --property <id>            — dry-run report
//   pnpm ops:suspend-property --operator <id> --org <id> --property <id> \
//     --reason <text> --ticket <ref> --apply
//   pnpm ops:restore-property  — same shape (restores processing)
//
// Requires DATABASE_URL. Containment command: deliberately NOT
// capability-gated — it must work while the org/property is suspended.

import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:(suspend-property|restore-property) --operator <id> --org <id> --property <id> [--reason <text> --ticket <ref> --apply]'

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [mode] = positionalArgs(process.argv.slice(2))
  if (mode !== 'suspend' && mode !== 'restore') usage()
  const command = mode === 'suspend' ? 'ops:suspend-property' : 'ops:restore-property'

  const result = await runOperatorCommand(
    {
      name: command,
      scope: 'property',
      mutation: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      if (ctx.dryRun) {
        io.out(
          `would ${mode} property=${ctx.propertyId} org=${ctx.organizationId} — re-run with --apply (reason + ticket required)`,
        )
        return
      }
      const { container } = ctx
      await container.policyAdmin.setPropertySuspension({
        organizationId: ctx.organizationId as string,
        propertyId: ctx.propertyId as string,
        suspend: mode === 'suspend',
        reason: ctx.reason as string,
        ticketRef: ctx.ticket as string,
        actorUserId: ctx.operatorId,
        now: new Date(),
      })
      io.out(
        `${mode === 'suspend' ? 'suspended' : 'restored'}: property=${ctx.propertyId} org=${ctx.organizationId} (effective within the policy refresh bound)`,
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops property suspension failed', err)
  process.exit(1)
})
