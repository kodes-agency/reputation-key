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

export type GoogleProviderOperatorCommand = Readonly<{
  /** Worker job that does this work on its own schedule, when one exists. */
  automatedJob: string | null
  /** What happens, or what to do, instead of `--apply`. */
  instead: string
}>

export const GOOGLE_PROVIDER_OPERATOR_COMMANDS: Readonly<
  Record<string, GoogleProviderOperatorCommand>
> = Object.freeze({
  'ops:disconnect-connection': {
    automatedJob: null,
    instead:
      'To disconnect, an AccountAdmin of the Organization uses Settings, Integrations in the app. ' +
      "To stop the Organization's Google work without them, add its ID to BETA_SUSPENDED_ORGS on web and worker; " +
      'to stop Google for everyone, set BETA_CAPABILITIES_OFF (docs/operations/runbooks.md §2, §10 and §11).',
  },
  'ops:gbp-subscribe': {
    automatedJob: 'reconcile-gbp-notification-subscriptions',
    instead:
      'The worker subscribes accounts by itself: an import subscribes its own, and the daily ' +
      "reconcile-gbp-notification-subscriptions job re-asserts every Organization's " +
      '(docs/operations/google-pubsub-setup.md §6).',
  },
  'ops:reconcile-publication': {
    automatedJob: 'reconcile-ambiguous-publications',
    instead:
      "The worker's reconcile-ambiguous-publications job re-reads Google for every due reply every five minutes, " +
      'and a manager can use Check Google again on the reply in the Inbox (docs/operations/runbooks.md §6).',
  },
})

const lookup = (commandName: string): GoogleProviderOperatorCommand | null =>
  Object.hasOwn(GOOGLE_PROVIDER_OPERATOR_COMMANDS, commandName)
    ? (GOOGLE_PROVIDER_OPERATOR_COMMANDS[commandName] ?? null)
    : null

/** The usage error for `--apply` on a command that only reports; null otherwise. */
export function googleProviderApplyRefusal(commandName: string): string | null {
  const command = lookup(commandName)
  if (!command) return null
  return (
    '--apply is refused: this command needs a call to Google, and operator commands ' +
    `run without the Google provider runtime, so it only reports. ${command.instead}`
  )
}

/** The line printed after a report of a command that only reports; null otherwise. */
export function googleProviderReportNotice(commandName: string): string | null {
  const command = lookup(commandName)
  if (!command) return null
  return `${commandName} only reports: --apply is refused. ${command.instead}`
}
