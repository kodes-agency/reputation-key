// Operator CLI (BQC-7.5): rotate/revoke a Google connection's credentials —
// the runbook §2/§10 "revoke-then-reconnect" path. Runs the
// disconnectGoogleAccount use case: best-effort Google token revoke, then one
// atomic disconnect + identifier/secret redaction, GBP cache purge, and a
// bounded source-content purge. The user reconnects via Google OAuth to
// complete the rotation.
//
// DESTRUCTIVE (token revocation + content purge are irreversible): --apply
// requires the typed confirmation --yes ops:disconnect-connection.
//
// Usage:
//   pnpm ops:disconnect-connection <connectionId> --operator <id> --org <id>             — dry-run report
//   pnpm ops:disconnect-connection <connectionId> --operator <id> --org <id> \
//     --reason <text> --apply --yes ops:disconnect-connection
//
// Requires DATABASE_URL (+ provider env for the revoke call). The use case
// authorizes against a synthetic AccountAdmin context for the command's org
// (the operator principal itself is authorized by the harness policy
// evaluation, audited content-free).
//
// NOT in this slice: ENCRYPTION_KEY/token-key rotation (re-encrypt-at-rest)
// stays runbook-manual (runbook §2) — registered for the platform owner.

import { getContainer } from '../../src/composition'
import { organizationId, userId } from '../../src/shared/domain/ids'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE =
  'pnpm ops:disconnect-connection <connectionId> --operator <id> --org <id> [--reason <text> --apply --yes ops:disconnect-connection]'

function usage(): never {
  console.error(`Usage: ${USAGE}`)
  process.exit(1)
}

async function main(): Promise<void> {
  const [connectionId] = positionalArgs(process.argv.slice(2))
  if (!connectionId) usage()

  const result = await runOperatorCommand(
    {
      name: 'ops:disconnect-connection',
      scope: 'org',
      mutation: true,
      destructive: true,
      usage: USAGE,
    },
    async (ctx, _args, io) => {
      if (ctx.dryRun) {
        io.out(
          `would disconnect connection=${connectionId} org=${ctx.organizationId} (revoke token + redact secrets + purge caches/content) — re-run with --apply --yes ops:disconnect-connection`,
        )
        return
      }
      const container = getContainer()
      const connection = await container.useCases.disconnectGoogleAccount(
        { connectionId },
        {
          userId: userId(ctx.operatorId),
          organizationId: organizationId(ctx.organizationId as string),
          role: 'AccountAdmin',
        },
      )
      io.out(
        JSON.stringify(
          { connectionId, status: connection.status, org: ctx.organizationId },
          null,
          2,
        ),
      )
      io.out(
        'rotation: the property reconnects via Google OAuth to complete credential rotation',
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((err) => {
  console.error('ops:disconnect-connection failed', err)
  process.exit(1)
})
