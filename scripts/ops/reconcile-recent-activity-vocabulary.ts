// Report-first, exact-fingerprint Recent Activity vocabulary reconciliation.
// The default invocation only reports grouped, content-free counts. Apply is
// one Organization and one source pair at a time, protected by the common
// operator policy, a support ticket, typed confirmation, an operation id, and
// the exact count/fingerprint returned by the reviewed report.

import { getDb } from '../../src/shared/db'
import { organizationId } from '../../src/shared/domain/ids'
import { parseRecentActivityVocabularyInvocation } from '../../src/contexts/activity/application/recent-activity-vocabulary-invocation'
import {
  applyRecentActivityVocabularyReconciliation,
  reportRecentActivityVocabulary,
} from '../../src/contexts/activity/application/use-cases/reconcile-recent-activity-vocabulary'
import { createRecentActivityVocabularyReconciliationStore } from '../../src/contexts/activity/infrastructure/recent-activity-vocabulary-reconciliation.store'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:reconcile-recent-activity-vocabulary'
const USAGE =
  `pnpm ${COMMAND} [<source-action> <source-resource> <target-action> ` +
  `<target-resource> <expected-count> <expected-fingerprint> <operation-id>] ` +
  `--operator <id> --org <id> [--ticket <ref> --reason <text> --apply --yes ${COMMAND}]`

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'org',
      capability: 'activity.use',
      mutation: true,
      destructive: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (context, args, io) => {
      let invocation: ReturnType<typeof parseRecentActivityVocabularyInvocation>
      try {
        invocation = parseRecentActivityVocabularyInvocation(args.positionals)
      } catch (error) {
        io.err(
          `${error instanceof Error ? error.message : String(error)}\nusage: ${USAGE}`,
        )
        return 2
      }

      const targetOrganizationId = organizationId(context.organizationId as string)
      const store = createRecentActivityVocabularyReconciliationStore(getDb())
      const report = await reportRecentActivityVocabulary({
        store,
        clock: () => new Date(),
      })(targetOrganizationId)
      io.out(JSON.stringify({ command: COMMAND, mode: 'report', report }, null, 2))

      if (context.dryRun) return
      if (invocation.mode !== 'apply' || !context.ticket) {
        io.err(`apply requires one exact reviewed target\nusage: ${USAGE}`)
        return 2
      }

      const outcome = await applyRecentActivityVocabularyReconciliation({
        store,
        authority: {
          authorize: async (command) =>
            command.organizationId === targetOrganizationId &&
            command.authorizedBy === context.operatorId &&
            command.authorizationEvidenceRef === context.ticket,
        },
        clock: () => new Date(),
      })({
        ...invocation,
        organizationId: targetOrganizationId,
        authorizedBy: context.operatorId,
        authorizationEvidenceRef: context.ticket,
      })

      const after = await reportRecentActivityVocabulary({
        store,
        clock: () => new Date(),
      })(targetOrganizationId)
      io.out(JSON.stringify({ command: COMMAND, mode: 'apply', outcome, after }, null, 2))
      return outcome.status === 'applied' || outcome.status === 'replayed' ? 0 : 1
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
