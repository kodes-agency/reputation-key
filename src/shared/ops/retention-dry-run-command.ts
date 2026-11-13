// The operator command contract for the retention dry run:
//
//   pnpm ops retention dry-run --operator <id>
//
// It reports, per retention rule, what the sweep would do right now and to how
// many rows. It writes nothing: the query runs in a READ ONLY transaction.

import type { OperatorArgs, OperatorCommandSpec } from './operator-command'

const ACTION = 'dry-run'

export const retentionDryRunCommandSpec: OperatorCommandSpec = Object.freeze({
  name: 'ops:retention',
  scope: 'global',
  mutation: false,
  usage: 'pnpm ops retention dry-run --operator <id>',
})

export function isRetentionDryRun(args: OperatorArgs): boolean {
  return args.positionals.length === 1 && args.positionals[0] === ACTION
}
