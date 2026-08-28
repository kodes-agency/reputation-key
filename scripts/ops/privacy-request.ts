// Operator CLI (LIF-01-T20): privacy access / correction / withdrawal /
// erasure for Guest contact and feedback and for Participant data.
//
// Tenant AND property scoped, access-controlled through the operator policy,
// content-classified, expiry-bound and audited. The subject is named by the
// SHA-256 of a VERIFIED identifier — never the email address, phone number or
// session id itself, which is why `subject-ref` is checked as a digest before
// anything happens.
//
// Usage (report-only by default — mutations need --apply):
//   pnpm ops:privacy-request report --operator <id> --org <id> --property <id>
//   pnpm ops:privacy-request receive --operator <id> --org <id> --property <id> \
//     kind=access subject-type=guest subject-ref=<sha256> \
//     --reason <text> --ticket <ref> --apply --yes ops:privacy-request
//   pnpm ops:privacy-request verify request=<id> verification=<ref> ... --apply
//   pnpm ops:privacy-request fulfil request=<id> ... --apply
//   pnpm ops:privacy-request refuse request=<id> reason-code=<code> ... --apply
//
// Requires DATABASE_URL. The command contract and its tests live in
// src/shared/ops/privacy/privacy-request-command.ts — scripts/ sits outside the
// unit test project, so this file is wiring only.

import {
  planPrivacyRequestCommand,
  privacyRequestCommandSpec,
} from '../../src/shared/ops/privacy/privacy-request-command'
import { runOperatorCommand } from './operator-command'

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    privacyRequestCommandSpec,
    async (ctx, args, io) => {
      const planned = planPrivacyRequestCommand(ctx, args)
      if (!planned.ok) {
        io.err(`${privacyRequestCommandSpec.name}: ${planned.error}`)
        return 1
      }
      const { plan } = planned

      if (plan.reportOnly) {
        io.out(
          `would ${plan.mode} privacy request for org=${plan.organizationId} ` +
            `property=${plan.propertyId} — re-run with --apply ` +
            `--yes ${privacyRequestCommandSpec.name} (reason + ticket required)`,
        )
        return 0
      }

      // The lifecycle, the subject contributor port and the Guest contributor
      // exist and are tested; the persistent store and the Staff/Inbox
      // contributors are not composed yet. Refusing loudly is the honest
      // behaviour — telling a subject their data was erased when no contributor
      // ran would be worse than telling them to wait.
      io.err(
        `${privacyRequestCommandSpec.name}: privacy fulfilment is not armed in this build. ` +
          'The request record, state machine, lifecycle and Guest contributor exist; ' +
          'the store and the Staff/Inbox contributors are pending ' +
          '(see docs/operations/backup-and-lifecycle.md).',
      )
      return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops privacy request failed', err)
  process.exit(1)
})
