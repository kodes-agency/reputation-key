// Operator CLI (LIF-01-T19): support-mediated permanent Property Erase.
//
// POSTURE. `property.erase` is DISABLED in capability-fate.ts and is a member
// of BLOCKED_CAPABILITIES. It stays blocked as a tenant capability. THIS FILE
// IS THE ONLY ENTRY POINT. There is no route, no server function and no tenant
// capability check that reaches the erase use case — proved by the negative
// test in src/contexts/property/application/use-cases/erase-property.test.ts.
//
// An AccountAdmin may REQUEST; only a registered operator carrying an
// INDEPENDENT support authorization reference may authorize.
//
// Usage (report-only by default — mutations need --apply):
//   pnpm ops:property-erase report  --operator <id> --org <id> --property <id>
//   pnpm ops:property-erase request --operator <id> --org <id> --property <id> \
//     requested-by=<user-id> identity-verification=<ref> support-authorization=<ref> \
//     --reason <text> --ticket <ref> --apply --yes ops:property-erase
//   pnpm ops:property-erase preview authority=<id> ... --apply --yes ops:property-erase
//   pnpm ops:property-erase confirm authority=<id> inventory-revision=<n> \
//     'typed-confirmation=ERASE PROPERTY <property-id>' ... --apply --yes ops:property-erase
//   pnpm ops:property-erase cancel  authority=<id> reason-code=<code> ... --apply
//   pnpm ops:property-erase advance --operator <id> --org <id> --property <id> --apply
//
// Requires DATABASE_URL. The command contract and its tests live in
// src/shared/ops/property-erase-command.ts — scripts/ sits outside the unit
// test project, so this file is wiring only.

import {
  planPropertyEraseCommand,
  propertyEraseCommandSpec,
} from '../../src/shared/ops/property-erase-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    propertyEraseCommandSpec,
    async (ctx, args, io) => {
      const planned = planPropertyEraseCommand(ctx, args)
      if (!planned.ok) {
        io.err(`${propertyEraseCommandSpec.name}: ${planned.error}`)
        return 1
      }
      const { plan } = planned

      if (plan.reportOnly) {
        io.out(
          `would ${plan.mode} permanent erase for property=${plan.propertyId} ` +
            `org=${plan.organizationId} — re-run with --apply --yes ${propertyEraseCommandSpec.name} ` +
            '(reason + ticket + independent support authorization required)',
        )
        return 0
      }

      // Wiring for the erase use cases and the advance job is not yet composed:
      // the container deliberately supplies no destructive lifecycle set, and
      // arming this path is held behind crash recovery, backup fencing and
      // counsel-approved retention. Refusing loudly is the honest behaviour —
      // silently succeeding would be a lie about an irreversible operation.
      io.err(
        `${propertyEraseCommandSpec.name}: erase execution is not armed in this build. ` +
          'The authority, receipts, job and ledger exist; composition is pending ' +
          '(see docs/operations/backup-and-lifecycle.md).',
      )
      return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops property erase failed', err)
  process.exit(1)
})
