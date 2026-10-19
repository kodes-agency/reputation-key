---
status: accepted
date: 2026-09-18
---

# 0059 — Organization-scoped report outcome notice

## Context

A beta reporter should learn, in the notification bell, that the report they
filed was accepted, not taken forward, or resolved. Two rules stood in the way.

ADR 0046 fixes four notification categories and makes mandatory account,
security and legal notices Organization policy. The code went further than
the ADR: `notificationScopeForType` derived scope from category alone, so every
non-mandatory notice was Property-scoped, and the database enforced that in
`notifications_mandatory_scope_check`. A beta report belongs to no Property, so
it could not be Property-scoped. The only Organization-scoped category,
`mandatory`, forces an immediate email that cannot be turned off, which is
wrong for "your report was dealt with". Inventing a Property for it would be
worse: the same rule exists to stop callers doing exactly that.

The report is also identified only by pseudonyms. The triage row stores the
reporter as a keyed digest, deliberately without a user id, and that must stay
true.

## Decision

Admit exactly one new notice shape: `beta_feedback.outcome`, category
`workflow_collaboration`, no Property, and a `beta_feedback_report` resource
whose id is the report's opaque triage reference.

1. **Scope is per type, not only per category.**
   `ORGANIZATION_INFORMATIONAL_TYPES` names the Organization-scoped types that
   are not mandatory, and `notificationScopeForType` consults it. It had one
   member on the day of this decision; the note of 2026-10-13 below says what
   it holds now. The database CHECK names the same type rather than admitting
   "any Organization-scoped workflow notice", so every further widening needs a
   decision like this one. A test pins that the application list and the
   database agree.
2. **Channels resolve through ADR 0046 rule 1.** There is no Property, so there
   is no preference row. Missing rows resolve through the versioned defaults:
   in-app on. Email is off outright. No row could ever opt it in, and the email
   queue's scope CHECK is unchanged, so a mailed report outcome is refused
   twice.
3. **The reporter is found at the moment of the transition.** When an operator
   transition moves a report into `accepted`, `declined` or `resolved`, Identity
   recomputes the reporter's pseudonyms over its own Organization and member
   rows. Those tables are exempt from the tenant-predicate canary as
   Identity-owned. No user-to-report link is persisted to do this. Current
   membership bounds the scan, so a reporter who has left the Organization is
   not sent a notice about an Organization they can no longer open.
4. **The notice exists if and only if the state does.** The
   `identity.beta_feedback.outcome_reached` fact commits in the same
   transaction as the triage transition. It carries identifiers and a closed
   outcome only. It flows through the existing affected-account audience, whose
   authority re-reads the durable fact before inserting, so a queued job cannot
   redirect the notice.
5. **A self-transition is not news.** Linking an issue to an already-accepted
   report writes no fact. A report accepted and later resolved coalesces into
   one unread row that says where it ended up.
6. **The link opens the reporter's list, not a route.** Reports live in the
   Feedback dialog, which every authenticated page carries. The notice links to
   `/properties#beta-feedback-reports`. It uses an anchor rather than a search
   parameter because no route's search schema has to admit it, and the report
   reference never appears in the URL.

## Consequences

- Reporters hear about outcomes in the bell as well as from the marker on the
  Feedback entry point.
- A report-outcome notice cannot be switched off in notification settings.
  Settings are Property-scoped and this notice has no Property. It is in-app
  only, low volume and about the reader's own report; dismissing it is the
  control. Revisit this if Organization-level preferences are ever introduced.
- Future Organization-scoped informational notices follow this pattern. Each
  one is added to `ORGANIZATION_INFORMATIONAL_TYPES` and to the database CHECK
  by name, and gets its own ADR.
- The mandatory branch of ADR 0046 is unchanged.

## Note 2026-10-13 — two more shapes have joined this one

Decision 1 said the list of Organization-scoped notices that are not mandatory
has one member. That was true on 2026-09-18 and is not now. ADR 0046 has since
admitted two more shapes, each in an amendment to that ADR rather than in a new
ADR, and each by name in a branch of its own in
`notifications_mandatory_scope_check`:

- `integration.google_disconnected` (ADR 0046, amended 2026-09-24): always
  Organization-scoped, `workflow_collaboration`, pointing at the connection. It
  is the second member of `ORGANIZATION_INFORMATIONAL_TYPES`.
- `integration.reauthorization_required` (ADR 0046, amended 2026-09-28): still
  Property-scoped `urgent_operational` whenever an active Property can anchor
  it, and Organization-scoped only when none can. It is not in
  `ORGANIZATION_INFORMATIONAL_TYPES`; it is the one member of
  `ORGANIZATION_FALLBACK_TYPES`.

So three named types can be Organization-scoped without being mandatory, and
at that scope each is in-app only and never mailed, as decision 2 says of this
one. The rule of the third consequence above stands in its substance: a further
shape is a recorded decision and a CHECK branch that names it. It has been met
by an ADR 0046 amendment both times, not by an ADR of its own.

## Note 2026-10-19 — the 72-hour triage backlog alert is off for the closed beta

The triage ledger this ADR's transitions write to had a paging alert on its
age, `beta-feedback.triage-backlog` (P2, runbooks §16). It is off for the closed
beta and returns for general availability by the steps below. It fired when the
oldest delivered report not yet `resolved` in the ledger was older than 72
hours, or when the aggregate read failed. On 2026-10-19 it fired on the closed
beta (Sentry JAVASCRIPT-TANSTACKSTART-REACT-15) because six reports delivered
on 2026-10-16 and 2026-10-17 had been triaged and fixed in Sentry and never
recorded in the ledger.

The owner decided that the 72-hour ledger deadline is ceremony for a closed
beta whose only operator is the owner, as the SAFE-01 signer and drill ceremony
was (ADR 0032, ADR 0063). Beta feedback keeps flowing to Sentry, where the owner
triages it and has an alert rule for new feedback. So the alert is off for the
closed beta. There is no environment variable or posture flag for it: a flag
would be one more setting to keep in step with a decision that holds for the
whole closed beta, and the environment contract pins every variable. The
definition and the `beta_feedback_triage` journey row in
`beta-support-operations.ts` are removed, and a test pins that no alert of that
name is defined or dispatched, whatever the ledger holds.

Kept: the ledger, its state machine and transition evidence, `pnpm ops
triage-beta-feedback`, and the `betaFeedbackTriage` aux read, which the health
check still logs on every run (count and age, content-free). One consequence is
worth knowing: decision 3 and 4 above send the reporter's bell notice from the
ledger transition, so a report that is never recorded in the ledger gets no
outcome notice. Record the transition when the reporter should hear back.

**To restore it for general availability**, by a recorded decision:

1. Record every delivered report still unresolved in the ledger first, or the
   first health check after the deploy pages for each old receipt.
2. Define `beta-feedback.triage-backlog` again in
   `src/shared/observability/alert-definitions.ts`: P2, `runbooks.md §16`,
   window and threshold 72 hours, not sustained, no `blindedBy`. It reads
   `aux.betaFeedbackTriage`: value -1 when `monitorAvailable` is false, or when
   the count is above 0 and the age is missing; nothing when the count is 0 or
   the age is at most 72 hours; otherwise the age, with the count in the detail.
3. Put the `beta_feedback_triage` journey back in
   `src/shared/observability/beta-support-operations.ts` (status
   `implemented_application_signal`, P2, evidence `content_free_queue_age_signal`,
   `named_owner_coverage`, `local_alert_injection_test`).
4. Put the row back in `docs/operations/alerts-and-security-posture.md` and
   replace the off-notes there and in `docs/operations/runbooks.md` §16 with the
   alert's description.
5. Restore the tests that named it: the registry list and the
   `READS_NO_HEALTH_SIGNAL` entry in `alert-definitions.test.ts`, the breach
   case and registry list in `src/shared/jobs/alert-injection.test.ts`, and
   injection (d) in `src/shared/jobs/infrastructure/repositories/alert-injection.test.ts`.
   The git history of those files holds the previous versions.
