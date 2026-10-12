// Operator CLI (BQC-7.5): echo the Google connection a disconnect would act
// on, without reading it. REPORT ONLY: `--apply` is refused by the operator
// harness.
//
// A disconnect revokes the Google grant, and operator commands run without the
// Google provider runtime, so this command cannot do it
// (src/shared/ops/google-provider-commands.ts). What works instead:
//
//   - An AccountAdmin of the Organization disconnects Google in the app
//     (Settings, Integrations). That runs the disconnectGoogleAccount use case
//     where the provider is available: imports cancelled, the governed revoke,
//     one atomic disconnect + identifier/secret redaction, and a bounded
//     source-content purge. It is an `integration.manage` action, so the app
//     refuses it while the Organization is suspended, and while
//     BETA_CAPABILITIES_OFF is all or names integration.use: disconnect
//     first, suspend afterwards (runbook §2).
//   - To stop the Organization's Google work without them, add its ID to
//     BETA_SUSPENDED_ORGS on web and worker (runbook §1).
//   - To stop Google for everyone, set BETA_CAPABILITIES_OFF to the Google
//     capabilities (runbook §11).
//
// Usage:
//   pnpm ops disconnect-connection <connectionId> --operator <id> --org <id>
//
// Requires DATABASE_URL. The apply branch below is kept for a
// provider-enabled operator path; none exists today, and the harness never
// reaches it.
//
// NOT in this slice: ENCRYPTION_KEY/token-key rotation (re-encrypt-at-rest)
// stays runbook-manual (runbook §2) — registered for the platform owner.

import { organizationId, userId } from '../../src/shared/domain/ids'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const USAGE = 'pnpm ops disconnect-connection <connectionId> --operator <id> --org <id>'

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
          `a disconnect of connection=${connectionId} org=${ctx.organizationId} would revoke the token, redact the stored secrets and purge caches and content`,
        )
        return
      }
      const { container } = ctx
      const connection = await container.integrationPublicApi.connections.disconnect(
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
