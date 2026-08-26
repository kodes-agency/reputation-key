// Operator CLI (BQC-7.5): report and repair a property's capability allowlist
// against its organization's.
//
// A property's allowlist is INDEPENDENT of its organization's: an org can hold
// the full beta capability set while one of its properties holds none, and an
// empty property_capability set denies every non-core capability
// (`property_not_allowlisted`). The Google import now provisions every
// property it creates; this command reports and repairs the properties that
// predate that wiring (or whose provisioning failed).
//
// Usage:
//   pnpm ops:property-capabilities list <propertyId> --operator <id> --org <id>
//   pnpm ops:property-capabilities list --all --operator <id> --org <id>
//   pnpm ops:property-capabilities sync <propertyId> --operator <id> --org <id>
//     [--reason <text> --apply]
//   pnpm ops:property-capabilities sync --all --operator <id> --org <id>
//     [--reason <text> --apply]
//
// `sync` is DRY-RUN by default: without --apply it prints the same report and
// writes nothing. Requires DATABASE_URL. Deliberately NOT capability-gated —
// it repairs the very allowlist a capability gate would consult.

import { getDb } from '../../src/shared/db'
import { bindPropertyCapabilityProvisioning } from '../../src/composition'
import {
  createPropertyCapabilityOperatorAction,
  parsePropertyCapabilityCommand,
} from '../../src/contexts/identity/application/use-cases/policy-admin'
import { positionalArgs } from '../../src/shared/ops/operator-command'
import { runOperatorCommand } from './operator-command'

const COMMAND_NAME = 'ops:property-capabilities'
const USAGE =
  'pnpm ops:property-capabilities <list|sync> (<propertyId>|--all) --operator <id> --org <id> [--reason <text> --apply]'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = parsePropertyCapabilityCommand(
    positionalArgs(argv),
    argv.includes('--all'),
  )
  if (!command) {
    process.stderr.write(`Usage: ${USAGE}\n`)
    process.exit(1)
  }

  const result = await runOperatorCommand(
    {
      name: COMMAND_NAME,
      scope: 'org',
      mutation: command.action === 'sync',
      extraFlags: ['all'],
      usage: USAGE,
    },
    async (ctx, args, io) => {
      // `getDb()`, not `getContainer()`: the composition root demands a job
      // queue (QUEUE_REDIS_URL), and Redis is only reachable inside the deployment,
      // so booting it here makes the command unrunnable from an operator
      // workstation. Nothing in this command needs the queue.
      //
      // The no-op refresh is deliberate: every write goes through
      // `provisionPropertyCapabilitiesFromOrganization`, which bumps
      // `policy_version` in the SAME statement, and that bump is the
      // cross-process invalidation contract every running service polls.
      // Refreshing this short-lived process's own snapshot cache would change
      // nothing.
      const ops = bindPropertyCapabilityProvisioning(getDb(), async () => {})
      await createPropertyCapabilityOperatorAction(ops, command, COMMAND_NAME)(
        ctx,
        args,
        io,
      )
    },
    argv,
  )
  process.exit(result.exitCode)
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`${COMMAND_NAME} failed: ${message}\n`)
  process.exit(1)
})
