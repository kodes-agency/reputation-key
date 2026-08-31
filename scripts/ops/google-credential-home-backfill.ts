// Controlled Organization Google credential-home backfill.
//
// Report (read-only; default):
//   pnpm ops:google-credential-home-backfill --operator <id> --org <org>
//
// Apply one reviewed exact report (never infers a cell):
//   pnpm ops:google-credential-home-backfill us <report-sha256> \
//     --operator <id> --org <org> --ticket <ref> --reason <text> \
//     --apply --yes ops:google-credential-home-backfill
//
// The store re-locks every Organization connection, recomputes the digest,
// and refuses drift. Country, request origin, and sibling-majority inputs do
// not exist in this command.

import { getDb } from '../../src/shared/db'
import { organizationId, userId } from '../../src/shared/domain/ids'
import { dataCellById } from '../../src/shared/domain/data-cell-catalogue'
import {
  createOrganizationGoogleCredentialHomeBackfill,
  googleCredentialHomeBackfillConfirmation,
  googleCredentialHomeBackfillTarget,
} from '../../src/contexts/integration/application/organization-google-credential-home-backfill'
import { createOrganizationGoogleCredentialHomeBackfillStore } from '../../src/contexts/integration/infrastructure/organization-google-credential-home-backfill.store'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:google-credential-home-backfill'
const USAGE =
  `pnpm ${COMMAND} [<explicit-home-cell> <expected-report-sha256>] ` +
  `--operator <id> --org <org> [--ticket <ref> --reason <text> --apply --yes ${COMMAND}]`

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'org',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (ctx, args, io) => {
      const orgId = organizationId(ctx.organizationId!)
      const backfill = createOrganizationGoogleCredentialHomeBackfill({
        store: createOrganizationGoogleCredentialHomeBackfillStore(
          getDb(),
          () => new Date(),
        ),
      })
      const report = await backfill.report(orgId)
      io.out(JSON.stringify({ command: COMMAND, mode: 'report', ...report }, null, 2))
      if (ctx.dryRun) {
        io.out(
          'review local legacy placement evidence; no home is inferred or selected by this report',
        )
        return
      }
      const [rawCell, expectedDigest] = args.positionals
      const cell = rawCell ? dataCellById(rawCell)?.id : undefined
      if (!cell || !expectedDigest) throw new Error(`usage: ${USAGE}`)
      const selectedHome = googleCredentialHomeBackfillTarget(cell)
      const command = {
        organizationId: orgId,
        selectedHome,
        expectedReportDigestSha256: expectedDigest,
        operatorId: userId(ctx.operatorId),
        ticket: ctx.ticket!,
      }
      const outcome = await backfill.apply({
        ...command,
        confirmation: googleCredentialHomeBackfillConfirmation(command),
      })
      io.out(JSON.stringify({ command: COMMAND, mode: 'apply', outcome }, null, 2))
      if (outcome.kind !== 'applied') return 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
