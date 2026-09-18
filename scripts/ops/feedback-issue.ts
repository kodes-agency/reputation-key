// OBS-01 — publish one accepted beta report to the public issue tracker.
//
// The report's own words never travel here. `buildBetaFeedbackIssue` renders
// controlled triage vocabulary plus monitoring links, and this command only
// hands that to `gh` and writes the resulting issue number back through the
// same CAS transition the triage command uses.
//
// The record must already be `accepted`: linking an engineering issue to
// anything else is refused by the domain, and accepting is a triage decision
// that belongs to `ops:triage-beta-feedback`.
//
//   pnpm ops feedback-issue <reference> --operator <id> --ticket <ref> --apply

import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { getDb } from '../../src/shared/db'
import { getEnv } from '../../src/shared/config/env'
import { BetaFeedbackTriageRepository } from '../../src/contexts/identity/infrastructure/beta-feedback-triage.repository'
import { betaFeedbackPseudonym } from '../../src/contexts/identity/application/beta-feedback-pseudonym'
import {
  buildBetaFeedbackIssue,
  issueNumberFromUrl,
} from '../../src/contexts/identity/application/beta-feedback-issue'
import { runOperatorCommand } from './operator-command'

const COMMAND = 'ops:feedback-issue'
const USAGE = `pnpm ops feedback-issue <reference> --operator <id> --ticket <ref> [--apply]`

/** Sentry search prefix; absent config renders bare ids rather than guessing. */
function monitoringSearchBase(): string | null {
  const organization = process.env.SENTRY_ORG_SLUG
  return organization
    ? `https://sentry.io/organizations/${organization}/issues/?query=`
    : null
}

function createGithubIssue(
  issue: Readonly<{ title: string; body: string; labels: ReadonlyArray<string> }>,
): string {
  const args = ['issue', 'create', '--title', issue.title, '--body', issue.body]
  for (const label of issue.labels) args.push('--label', label)
  // `gh` infers the repository from the worktree's origin remote.
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
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
    async (context, args, io) => {
      const reference = args.positionals[0]
      if (!reference) {
        io.err(`a feedback reference is required\nusage: ${USAGE}`)
        return 2
      }

      const repository = BetaFeedbackTriageRepository.create(getDb())
      const record = await repository.find(reference)
      if (!record) {
        io.err(`no beta feedback record for ${reference}`)
        return 2
      }
      if (record.triageState !== 'accepted') {
        io.err(
          `only an accepted report may be published; ${reference} is ${record.triageState}. ` +
            'Run ops:triage-beta-feedback first.',
        )
        return 2
      }
      if (record.engineeringIssueRef) {
        io.err(`${reference} is already tracked as #${record.engineeringIssueRef}`)
        return 2
      }

      const issue = buildBetaFeedbackIssue(
        record,
        record.providerReference,
        monitoringSearchBase(),
      )

      io.out(
        JSON.stringify({ command: COMMAND, mode: 'preview', reference, issue }, null, 2),
      )
      if (context.dryRun || !context.ticket) return

      const issueNumber = issueNumberFromUrl(createGithubIssue(issue))
      await repository.transition({
        transitionId: randomUUID(),
        reference,
        operatorPseudonym: betaFeedbackPseudonym(
          getEnv().BETTER_AUTH_SECRET,
          'triage-operator',
          context.operatorId,
        ),
        now: new Date(),
        transition: {
          // A self-transition: the decision does not change, only its linkage.
          expectedRevision: record.revision,
          toState: 'accepted',
          severity: record.severity,
          privacyClass: record.privacyClass,
          securityClass: record.securityClass,
          reproduction: record.reproduction,
          dedupeDisposition: record.dedupeDisposition,
          duplicateOfReference: record.duplicateOfReference,
          ownerQueue: record.ownerQueue,
          ownerPseudonym: record.ownerPseudonym,
          customerResponse: record.customerResponse,
          engineeringIssueRef: issueNumber,
          reasonCode: 'engineering_issue_linked',
          supportEvidenceRef: context.ticket,
        },
      })

      io.out(
        JSON.stringify(
          { command: COMMAND, mode: 'apply', reference, issueNumber },
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
