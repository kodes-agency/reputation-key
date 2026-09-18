// OBS-01 — close the loop from the issue tracker back to beta triage.
//
// Deliberately a pull, not a webhook: an inbound GitHub hook would mean new
// public ingress, a shared secret and a signature-verification surface, for a
// beta whose whole feedback volume one person reads. This command asks `gh`
// about the issues already linked to accepted reports and resolves the ones
// GitHub says are closed.
//
// Nothing here reads an issue's body or comments — only its state.
//
//   pnpm ops feedback-sync --operator <id> --ticket <ref> --apply

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getDb } from '../../src/shared/db'
import { getEnv } from '../../src/shared/config/env'
import { BetaFeedbackTriageRepository } from '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'
import { betaFeedbackPseudonym } from '../../src/contexts/identity/application/beta-feedback-pseudonym'
import { resolveBetaFeedbackReporter } from '../../src/contexts/identity/infrastructure/beta-feedback-reporter'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:feedback-sync'
const USAGE = `pnpm ops feedback-sync --operator <id> --ticket <ref> [--apply]`

function issueState(issueNumber: string): string {
  const raw = execFileSync('gh', ['issue', 'view', issueNumber, '--json', 'state'], {
    encoding: 'utf8',
  })
  const parsed: unknown = JSON.parse(raw)
  const state =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as { state?: unknown }).state
      : undefined
  if (typeof state !== 'string')
    throw new Error(`gh returned no state for #${issueNumber}`)
  return state.toUpperCase()
}

async function main(): Promise<void> {
  const result = await runOperatorCommand(
    {
      name: COMMAND,
      scope: 'global',
      mutation: true,
      requiresTicket: true,
      usage: USAGE,
    },
    async (context, _args, io) => {
      const repository = BetaFeedbackTriageRepository.create(getDb())
      const queue = await repository.listQueue(200)
      const tracked = queue.filter(
        (item) => item.triageState === 'accepted' && item.engineeringIssueRef,
      )

      const closed: Array<{ reference: string; issueNumber: string }> = []
      for (const item of tracked) {
        const issueNumber = item.engineeringIssueRef
        if (!issueNumber) continue
        if (issueState(issueNumber) !== 'CLOSED') continue
        closed.push({ reference: item.reference, issueNumber })
      }

      io.out(
        JSON.stringify(
          {
            command: COMMAND,
            mode: 'report',
            tracked: tracked.length,
            closed,
          },
          null,
          2,
        ),
      )
      if (context.dryRun || !context.ticket || closed.length === 0) return

      const secret = getEnv().BETTER_AUTH_SECRET
      const notified: Array<{ reference: string; reporterNotified: boolean }> = []
      for (const { reference } of closed) {
        // Re-read inside the loop: revisions move, and the transition is CAS.
        const record = await repository.find(reference)
        if (!record || record.triageState !== 'accepted') continue
        // ADR 0059: the reporter hears about it in the bell, unless they have
        // since left the Organization.
        const reporter = await resolveBetaFeedbackReporter(getDb(), secret, record)
        notified.push({ reference, reporterNotified: reporter !== null })
        await repository.transition({
          outcomeRecipient: reporter,
          transitionId: randomUUID(),
          reference,
          operatorPseudonym: betaFeedbackPseudonym(
            secret,
            'triage-operator',
            context.operatorId,
          ),
          now: new Date(),
          transition: {
            expectedRevision: record.revision,
            toState: 'resolved',
            severity: record.severity,
            privacyClass: record.privacyClass,
            securityClass: record.securityClass,
            reproduction: record.reproduction,
            dedupeDisposition: record.dedupeDisposition,
            duplicateOfReference: record.duplicateOfReference,
            ownerQueue: record.ownerQueue,
            ownerPseudonym: record.ownerPseudonym,
            // Resolving requires a disposition. The reporter learns the outcome
            // from their own report list, which is a response, not a silence.
            customerResponse:
              record.customerResponse === 'pending'
                ? 'not_required'
                : record.customerResponse,
            engineeringIssueRef: record.engineeringIssueRef,
            reasonCode: 'engineering_issue_closed',
            supportEvidenceRef: context.ticket,
          },
        })
      }

      io.out(
        JSON.stringify(
          { command: COMMAND, mode: 'apply', resolved: notified.length, notified },
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
