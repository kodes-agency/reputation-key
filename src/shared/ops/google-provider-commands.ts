// Operator commands whose work is a call to Google.
//
// Operator commands run in a container built without the Google provider
// runtime (provider Redis, keyrings, the governed executor), so a provider
// call from one is refused by a recorded decision: a provider-dependent
// command "either runs through an enabled application path or refuses"
// (src/composition/operator-container.ts). No enabled path exists for these
// three, so each only reports.
//
// This table is what the harness, the three scripts and the operator
// documents share: which commands report only, and what does the work
// instead. The harness refuses `--apply` on them before anything runs and
// prints the same pointer after every report, so an operator in an incident
// is sent to what works rather than left with a composition error.

/**
 * Command name → what happens, or what to do, instead of `--apply`.
 *
 * What a sentence points to is gated like any other work: the in-app
 * disconnect is an `integration.manage` action, both reconciliation reads are
 * review-sync provider calls under `property.connect_gbp`, and Check Google
 * again is a reply command first. So each sentence also says which stop
 * refuses the thing it points to. An operator who suspends the Organization
 * and then asks for the disconnect is otherwise sent into a second refusal.
 */
export const GOOGLE_PROVIDER_OPERATOR_COMMANDS: Readonly<Record<string, string>> =
  Object.freeze({
    'ops:disconnect-connection':
      'To disconnect, an AccountAdmin of the Organization uses Settings, Integrations in the app. ' +
      'The app refuses that while the Organization is in BETA_SUSPENDED_ORGS, and while ' +
      'BETA_CAPABILITIES_OFF is all or names integration.use: ' +
      'have them disconnect before you suspend the Organization, or lift the suspension for the disconnect. ' +
      "To stop the Organization's Google work without them, add its ID to BETA_SUSPENDED_ORGS on web and worker; " +
      'to stop Google for everyone, set BETA_CAPABILITIES_OFF to the Google capabilities ' +
      '(docs/operations/runbooks.md §2, §10 and §11).',
    'ops:gbp-subscribe':
      'The worker subscribes accounts by itself: an import subscribes its own, and the daily ' +
      "reconcile-gbp-notification-subscriptions job re-asserts every Organization's " +
      '(docs/operations/google-pubsub-setup.md §6).',
    'ops:reconcile-publication':
      "The worker's reconcile-ambiguous-publications job re-reads Google for every due reply every five minutes, " +
      'and a manager can use Check Google again on the reply in the Inbox. ' +
      'Both reads need property.connect_gbp for the Organization, and Check Google again needs ' +
      'property.publish_reply as well: while BETA_CAPABILITIES_OFF or ' +
      'BETA_SUSPENDED_ORGS stops one, that read is refused and the reply stays ambiguous ' +
      '(docs/operations/runbooks.md §6).',
  })

const lookup = (commandName: string): string | null =>
  Object.hasOwn(GOOGLE_PROVIDER_OPERATOR_COMMANDS, commandName)
    ? (GOOGLE_PROVIDER_OPERATOR_COMMANDS[commandName] ?? null)
    : null

/** The usage error for `--apply` on a command that only reports; null otherwise. */
export function googleProviderApplyRefusal(commandName: string): string | null {
  const instead = lookup(commandName)
  if (!instead) return null
  return (
    '--apply is refused: this command needs a call to Google, and operator commands ' +
    `run without the Google provider runtime, so it only reports. ${instead}`
  )
}

/** The line printed after a report of a command that only reports; null otherwise. */
export function googleProviderReportNotice(commandName: string): string | null {
  const instead = lookup(commandName)
  if (!instead) return null
  return `${commandName} only reports: --apply is refused. ${instead}`
}
