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
   are not mandatory, and `notificationScopeForType` consults it. It has one
   member. The database CHECK names the same type rather than admitting "any
   Organization-scoped workflow notice", so every further widening needs a
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
