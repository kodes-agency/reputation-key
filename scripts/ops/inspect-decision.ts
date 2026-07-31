// Operator CLI (BQC-7.5): inspect a routing/policy decision (read-only).
//
// Usage:
//   pnpm ops:inspect region --operator <id> --org <id> --property <id>
//     — the BQC-4.4 region diagnostic (region facts + router decision + cell;
//       audited per read by the policy-admin op itself, plus the harness row)
//   pnpm ops:inspect policy <permission> <userId> --operator <id> --org <id> [--property <id>]
//     — explain the ExecutionPolicy decision for a user action (capability /
//       permission / scope breakdown)
//
// Requires DATABASE_URL. Reads are policy-evaluated + audited like every
// other invocation (harness decision row, reason 'read'). Output is
// identifiers and decision states only — content-free.

import { getContainer } from '../../src/composition'
import { hasPermissionCapability } from '../../src/shared/auth/capability-for-permission'
import type { Permission } from '../../src/shared/domain/permissions'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:inspect <region --org <id> --property <id> | policy <permission> <userId> --org <id> [--property <id>]> --operator <id>'

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [sub, permission, targetUserId] = positionalArgs(process.argv.slice(2))
  if (sub !== 'region' && sub !== 'policy') usage()
  if (sub === 'policy') {
    if (!permission || !targetUserId) usage()
    if (!hasPermissionCapability(permission)) {
      console.error(`unknown permission '${permission}'`)
      usage()
    }
  }

  const result = await runOperatorCommand(
    {
      name: 'ops:inspect',
      scope: sub === 'region' ? 'property' : 'org',
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      const container = getContainer()
      if (sub === 'region') {
        const diagnostic = await container.policyAdmin.getRegionDiagnostic({
          organizationId: ctx.organizationId as string,
          propertyId: ctx.propertyId as string,
          actorUserId: ctx.operatorId,
        })
        io.out(JSON.stringify(diagnostic, null, 2))
        return
      }
      const explanation = await container.policyAdmin.explainPolicyDecision({
        organizationId: ctx.organizationId as string,
        action: permission as Permission,
        propertyId: ctx.propertyId,
        userId: targetUserId as string,
        now: new Date(),
      })
      io.out(JSON.stringify(explanation, null, 2))
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:inspect failed', err)
  process.exit(1)
})
