// OBS-01 content-free internal triage. Report mode is the default. Apply
// changes one opaque feedback reference with CAS, ticket, operator identity,
// and append-only transition evidence. It never reads/copies report text,
// downloads attachments, or creates an engineering issue automatically.

import { getDb } from '../../src/shared/db'
import { getEnv } from '../../src/shared/config/env'
import { parseBetaFeedbackTriageInvocation } from '../../src/contexts/identity/application/beta-feedback-triage-invocation'
import { BetaFeedbackTriageRepository } from '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'
import { betaFeedbackPseudonym } from '../../src/contexts/identity/application/beta-feedback-pseudonym'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:triage-beta-feedback'
const USAGE =
  `pnpm ${COMMAND} [<reference> <expected-revision> <to-state> <severity> ` +
  `<privacy> <security> <reproduction> <dedupe> <duplicate-ref|none> ` +
  `<owner-queue> <owner-id> <customer-response> <issue-ref|none> ` +
  `<transition-id>] --operator <id> [--ticket <ref> --reason <text> --apply]`

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (context, args, io) => {
      let invocation: ReturnType<typeof parseBetaFeedbackTriageInvocation>
      try {
        invocation = parseBetaFeedbackTriageInvocation(args.positionals)
      } catch (error) {
        io.err(
          `${error instanceof Error ? error.message : String(error)}\nusage: ${USAGE}`,
        )
        return 2
      }

      const repository = BetaFeedbackTriageRepository.create(getDb())
      const before = await repository.listQueue()
      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            mode: 'report',
            generatedAt: new Date().toISOString(),
            items: before,
          },
          null,
          2,
        ),
      )
      if (context.dryRun) return
      if (invocation.mode !== 'apply' || !context.ticket) {
        io.err(`apply requires one exact reviewed transition\nusage: ${USAGE}`)
        return 2
      }

      const secret = getEnv().BETTER_AUTH_SECRET
      await repository.transition({
        transitionId: invocation.transitionId,
        reference: invocation.reference,
        operatorPseudonym: betaFeedbackPseudonym(
          secret,
          'triage-operator',
          context.operatorId,
        ),
        now: new Date(),
        transition: {
          expectedRevision: invocation.expectedRevision,
          toState: invocation.toState,
          severity: invocation.severity,
          privacyClass: invocation.privacyClass,
          securityClass: invocation.securityClass,
          reproduction: invocation.reproduction,
          dedupeDisposition: invocation.dedupeDisposition,
          duplicateOfReference: invocation.duplicateOfReference,
          ownerQueue: invocation.ownerQueue,
          ownerPseudonym: betaFeedbackPseudonym(
            secret,
            'triage-owner',
            invocation.ownerId,
          ),
          customerResponse: invocation.customerResponse,
          engineeringIssueRef: invocation.engineeringIssueRef,
          reasonCode: 'manual_triage_update',
          supportEvidenceRef: context.ticket,
        },
      })
      const after = (await repository.listQueue()).find(
        (item) => item.reference === invocation.reference,
      )
      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            mode: 'apply',
            reference: invocation.reference,
            outcome: after ?? { triageState: 'resolved_or_not_queued' },
          },
          null,
          2,
        ),
      )
    },
  )
  process.exit(result.exitCode)
}

main().catch((error) => {
  console.error(`${COMMAND} failed`, error)
  process.exit(1)
})
