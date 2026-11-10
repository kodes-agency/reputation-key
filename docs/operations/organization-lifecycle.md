# Organization and Property Lifecycle Control Plane (LIF-01)

## Operational status

The repository now contains a fail-closed local control plane for recoverable
Property lifecycle and staged Organization closure. It is
not yet an activated beta workflow.

Implemented and locally testable:

- ordinary Property deletion is refused before any destructive dependency;
- Property Archive, recovery-window Restore, and archived Google-binding
  Disconnect are composed through authenticated server functions;
- membership removal revokes sessions and releases the singular Organization
  binding in the same Identity transaction as membership deletion and its
  durable fact;
- Organization lifecycle authority, request/cancel, scheduled transitions,
  support-gated recovery/waiver/irreversible-boundary commands, and database
  fences;
- a transaction-bound Identity lifecycle contribution wrapper whose reviewed
  phase mutation and append-only content-free receipt commit together after
  the exact live lifecycle state, lineage, revision, and deadline are locked
  and verified. No destructive phase implementation is bound to it yet.

Production-shaped but deliberately quarantined:

- Identity now exposes one named `identityLifecycleRuntime` rather than adding
  maintenance or support methods to the flattened container use-case
  surface;
- independently authorized support transitions are present on that runtime
  only when the exact reviewed contributor set and support authorization are
  both bound; no server route or mutating operator command invokes them;
- a bounded handler exists for lifecycle advancement (50 Organizations);
- the operational catalogue owns its intended five-minute schedule, but the job
  family is `quarantined`, so worker reconciliation removes that schedule while
  retaining a no-mutation safety handler for stale queued work; and
- `pnpm ops report-organization-lifecycle --operator <id> --org <id>` reports
  exact content-free authority and composition readiness. It has no apply mode.

Not activated or complete:

- the 17 concrete lifecycle contributors;
- reviewed contributor composition, active worker schedules,
  authenticated Closure Center, mutating independently authorized operator
  commands, final notice delivery, or explicit reactivation;
- context purge/scrub implementations, legal-hold handling, backup erasure
  ledger, support-mediated Property Erase, complete privacy workflows, and the
  counsel-approved retention matrix. Known before arming: Review's purge keeps
  the Review, Reply and publication-authorization rows (scrubbed), and the
  Property phase's `DELETE FROM properties` cascades into `reviews`, which the
  retained `replies` and authorizations refuse with `ON DELETE RESTRICT`, so an
  Organization that ever saved a Reply would stay `purging` (S10-04). It needs a
  retention decision: delete the Replies and authorizations, or stop the Property
  phase from cascading into them;
- deployed Railway object-storage configuration or live database/provider
  drills.

No operator should infer deletion, provider disconnection, export availability,
or production readiness from the presence of these local modules.

## Property lifecycle

Normal product management uses Archive, Restore, and Disconnect. The legacy
`property.delete` server/use-case path always returns the lifecycle-unavailable
error before it can call a repository, provider, queue, or purge dependency.
The capability map sends that legacy permission to the blocked
`property.erase` capability.

Archive atomically changes the stable Property row to `archived`, advances its
source epoch, creates a 30-day recovery deadline, fences the current Google
review destination (`awaiting_refresh`; the URI and its pin are kept), and
records `property.archived`. Archived Properties are
excluded from normal external effects and public work by lifecycle admission.
Owners of scheduled work react to the fact themselves: Inbox cancels the
Property's unreleased Response Target reminder slots, and Notification treats a
reminder released for a non-active Property as obsolete. Restore re-arms none of
those slots; a cancelled slot is terminal
(`docs/operations/inbox-response-targets.md`). Review cancels the Property's
reply publications that were approved but not yet sent as policy
cancellations (the Reply returns to draft); a write already dispatched stays
with the publish worker and reconciliation. The publish worker itself refuses
to send, and cancels as policy, a cycle whose Property is not active at the
cycle's source epoch, so a Restore before either runs cannot turn the stale
cycle into a "Google rejected" notice. New approvals are refused until the
Property is active again and the Review has been observed at its current
source epoch.

Restore is permitted only before the recovery deadline. It rechecks current
Property access and an eligible Responsible Manager,
then advances the source epoch and records `property.restored`. Portal reacts
by raising `portal.responsibility_became_needed` for each live Portal of the
Property that still has no manager, because those gaps stayed silent while it
was archived and Restore checks only the Property's own manager. The returned
Google-binding readiness is either `ready` or `reconnect_required`; Restore does
not silently recreate provider authority. When the binding is still `active`,
Restore also returns the fenced Google review destination to `verified`, pin
unchanged, so the Property's live Portals offer the Google action again and can
be published; it calls Google for nothing. A binding disconnected while
archived leaves the destination `awaiting_refresh` until a relink, and a
Property Google gave no review link at import still has none.

Google-binding Disconnect requires the Property to be archived. It uses the
Property-owned exact epoch/profile-version store and is idempotent for already
disconnected/unbound bindings. It does not erase retained managerial history.

Permanent Property Erase remains deliberately absent. Beta activation still
requires AccountAdmin request, support identity verification, dependency and
retention preview, typed confirmation, asynchronous per-owner purge evidence,
and an irreversible boundary drill.

## Organization lifecycle authority

Migration `0159_organization_lifecycle_authority` creates an Identity-owned row
separate from Better Auth's Organization entity. An `AFTER INSERT` trigger
provisions every new Organization in the same transaction, and the migration
backfills existing Organizations as `active` without interpreting provider or
tenant content.

| State               | Meaning                                                                            | Recovery posture                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `active`            | No closure is running. A prior recovery may still require deliberate reactivation. | A new request is denied while `reactivation_required=true`.                                              |
| `closure_requested` | AccountAdmin request is committed. No Organization-wide suspension is set.         | Current AccountAdmin may cancel strictly before the deadline.                                            |
| `closing`           | Every context has acknowledged its Closing preparation.                            | Current AccountAdmin may cancel before the deadline; support may waive the remaining window.             |
| `purge_pending`     | Grace elapsed/was waived and every context supplied readiness evidence.            | Support may cancel only before `irreversible_at`, with independent authorization and typed confirmation. |
| `purging`           | The irreversible boundary has been crossed.                                        | No recovery edge exists. Every context must return purge evidence.                                       |
| `closed`            | All context purge results were accepted.                                           | Terminal; retained evidence is content-free and policy-governed.                                         |

Database triggers enforce:

- tenant identity never changes;
- every update advances the revision by exactly one;
- only declared state edges are accepted;
- the machine reason must match the exact edge;
- closure lineage/request evidence and the irreversible timestamp are
  immutable;
- transition time cannot move backwards;
- a recovered Organization cannot begin another closure until explicit
  reactivation clears its fence.

## Request and ordinary cancellation

A closure request no longer commits an Organization suspension: the call that
set one was removed in #460, and the capability gate's `org_suspended` now
comes only from `BETA_SUSPENDED_ORGS`. A context that must stop an external
effect from the request onward reads this authority itself. Notification
email does: from `closure_requested`, and while a cancelled closure awaits
reactivation, it queues and sends no optional mail (mandatory account notices
continue until `purging`), and it suppresses what was already queued with
reason `organization_closing`.

A closure request locks and rechecks the concrete Better Auth `owner`
membership in the same transaction as the command. It requires a
caller-provided UUID operation ID, closed request reason, bounded content-free
support reference, and exact 30-day deadline.

The transaction co-commits:

1. lifecycle revision and closure lineage (the live closure fence);
2. `identity.organization_lifecycle.changed` in the outbox; and
3. an exact request/cancel retry receipt.

An interruption before commit rolls back the entire result. Replaying the same
operation ID with the same binding returns the recorded result; changing its
tenant, actor, operation, reason, or evidence is rejected.

Ordinary cancellation is allowed from Closure Requested or Closing strictly
before `recoverable_until`, by a still-current AccountAdmin. It returns the
state to `active` but retains the closure lineage and
`reactivation_required=true`. It does not reactivate Google, Portals, AI,
imports, sync, replies, notifications, or schedules.

## Explicit reactivation (LIF-01-T18)

Clearing `reactivation_required` is a separate command with its own authority, readiness evidence and receipt. It
answers four closed checks, all of which must pass:

| Check                         | Question                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| `responsible_manager`         | does every Property have an eligible CURRENT Responsible Manager?         |
| `google_authorization`        | is there a FRESH authorization — not merely a stored credential?          |
| `portal_reactivation`         | was at least one Portal deliberately re-pointed at its retained snapshot? |
| `schedule_quarantine_cleared` | are the lifecycle/import/sync/notification schedules out of quarantine?   |

A probe that cannot answer is an UNSATISFIED check (`probe_unavailable`), never
an implicit pass.

Three DELIBERATE ACTIONS must additionally be recorded, each with a human actor
and a content-free reason: `portal_republished`, `ai_capability_reviewed`,
`google_reauthorized`. The command asserts them; it never performs them. It
never republishes a Portal, never re-enables an AI capability and never
restores a Google credential. A `system:` actor is refused — a machine cannot
author a deliberate human decision.

Reactivation is compare-and-set on the revision its readiness evidence
describes, so a concurrent closure request or operator transition invalidates
it. On success `reactivation_required` becomes false, the whole closure lineage
clears (the `organization_lifecycle_state_shape` check requires it), and only
THEN can a new closure be requested.

**Currently fenced by the database.** Migration `0159` predates this command:
`guard_organization_lifecycle_revision_v1` allows no `active -> active` edge,
and `organization_lifecycle_receipt_operation_valid` allows only the `request`
and `cancel` operations. Both belong to the migration integrator. Until that
migration lands, `reactivate` fails closed at the database rather than
half-lifting the fence — the safe direction. An Organization that cannot prove
reactivation stays fenced.

## Scheduled and support transitions

One bounded scheduled pass examines at most 50 candidates. It can perform:

- `closure_requested → closing` after the Closing phase;
- due `closing → purge_pending` after Purge Readiness; and
- `purging → closed` after the Purge phase.

For each phase, the coordinator requires exactly one result from every named
context: Activity, AI, Badge, Dashboard, Goal, Guest, Identity, Inbox,
Integration, Leaderboard, Metric, Notification, Portal, Property, Review,
Staff, and Team. Empty/dark contexts return `no_data`; omission is not success.
Each contributor must durably replay its own content-free result for the same
closure lineage/revision. Any missing, duplicate, wrong-phase, unsafe, or
failed result leaves the Organization state unchanged.

Support-only transitions bind the exact Organization, closure lineage,
expected revision, operator, external support reference, independent
authorization reference, and any phase digest into one content-free evidence
digest:

| Action                   | Required typed confirmation                  | Result                                                   |
| ------------------------ | -------------------------------------------- | -------------------------------------------------------- |
| Waive recovery           | `WAIVE RECOVERY <organization-id>`           | Closing → Purge Pending, after fresh readiness receipts  |
| Cancel pending purge     | `CANCEL PENDING PURGE <organization-id>`     | Purge Pending → active, retaining the reactivation fence |
| Begin irreversible purge | `BEGIN IRREVERSIBLE PURGE <organization-id>` | Purge Pending → Purging and sets `irreversible_at`       |

These methods are local application seams, not an authorization UI or operator
tool. Do not invoke equivalent ad-hoc SQL.

### Worker quarantine and activation rule

The worker boot-registers one content-free safety handler:

| Job                              | Per-pass bound   | Intended cadence | Current posture |
| -------------------------------- | ---------------- | ---------------- | --------------- |
| `advance-organization-lifecycle` | 50 Organizations | 5 minutes        | quarantined     |

Do not change a family to `enabled` merely because its handler exists. Lifecycle
advancement requires all 17 unique context contributors plus independently
reviewed support authorization. A partial set is reported as missing contexts
and remains non-executable; it is never converted to `no_data` by composition.

## Organization Export

There is no in-app export runtime and no export worker family. An Organization's
data is exported on request through the manual procedure in
[rights-requests.md](rights-requests.md).

## Member offboarding

There is no self-service leave: an AccountAdmin removes a member, and nobody
removes themselves. The app-owned member-removal flow refuses removal of the
final AccountAdmin.
Before the Identity command, composition fences Google connector/import work
and releases current Property/Portal/Inbox manager authorities and Property
access grants. The Identity transaction then locks the exact membership,
verifies the durable fact names that same user, deletes all Better Auth sessions
for the departing user, deletes membership, and appends
`identity.member.removed`.

The release before the Identity command is not the last one. Until the
membership is deleted the member is still an eligible manager, so an assignment
another admin saves in between is accepted. Property and Portal therefore
release again from `identity.member.removed` (worker consumers
`property.on-member-removed` and `portal.on-member-removed`): whatever the
member still holds and may no longer hold. A "Responsible Manager needed" notice
can follow a removal by a few seconds for that reason, and it is correct. A
save of a Property's or Portal's managers also reads eligibility again after it
commits and releases, and refuses, a manager who was removed while it ran.

When these two consumers are first deployed, the five-minute redelivery sweep
hands them every published `identity.member.removed` fact older than two hours
that is still in the outbox: such a fact has no receipt for them yet. That
releases a Responsible Manager who was removed earlier and is still assigned; a
member who is back keeps what they may hold; a fact with nothing left to
release only records its receipt.

`property_access_grant` revocation now commits INSIDE the Identity transaction
alongside session deletion, binding release, membership deletion and the
`identity.member.removed` fact. Google connector and import fencing cannot join
that transaction, so they still run before it — deliberately, because a fenced
connector with a surviving membership is repairable while a deleted membership
with a live provider grant is not.

### Repairing a partial offboarding

A crash between the provider fence and the Identity transaction leaves exactly
one shape: every grant revoked with reason `member_offboarded`, no live grant
left, and a membership row that should not exist.

```sh
# Report the whole candidate set (always report-only)
pnpm ops repair-partial-offboarding --operator <id>

# Report one user
pnpm ops repair-partial-offboarding <organization-id> <user-id> --operator <id>

# Converge one reviewed user
pnpm ops repair-partial-offboarding <organization-id> <user-id> \
  --operator <id> --ticket <ref> --reason <text> \
  --apply --yes ops:repair-partial-offboarding
```

The repair converges by COMPLETING the offboarding through the same atomic
command a clean removal uses. It never re-grants access: the fence was an
authorized decision, and resurrecting access to undo a crash would hand back
authority somebody already removed. To let the person keep working, re-invite
them — that has its own audit trail. Retries are idempotent: after convergence
the same user classifies as `already_offboarded`.

## Purge Pending final notice (program bullet 5)

Closing cancels every still-sendable NON-mandatory queued email, so ordinary
product mail stops the moment a closure is requested. The final notice is the
explicit carve-out: `account.organization_purge_pending` is a MANDATORY
category, and the Closing fence skips that category, so this notice survives
the fence that silenced everything else.

- It is emitted at `purge_pending` and nowhere else. Earlier states are
  recoverable and already visible in the Closure Center; `purging` is past the
  irreversible boundary, where a "last chance" message would be a lie.
- It rides on the existing `identity.organization_lifecycle.changed` fact, so
  no new event family exists. The consumer
  (`notification.on-identity-organization-purge-pending`) records an
  `obsolete` receipt for every other state.
- Recipients are the CURRENT AccountAdmins, not the original requester, who may
  have left. If none remains the consumer logs a content-free warning rather
  than proceeding silently. The audience is re-read at the Organization when
  the notice is inserted, without a Property: the role is held at the
  Organization, and by Purge Pending the Properties may already be gone.
- The job id is `<eventId>-<recipient>`, so bus/outbox dual delivery and any
  retry converge on one notice per admin.
- Its email is not held by the beta email allowlist. It travels under
  `system:notification.email_mandatory` / `notification.send_mandatory_email`
  (core), so it leaves for an Organization that was never allowlisted for
  product mail (ADR 0046, amended 2026-09-24). `BETA_CAPABILITIES_OFF` and
  tenant suspension still stop it, as do suppression, the stale-row bound and
  the irreversible boundary.

## Read-only diagnostics

Preferred content-free operator report:

```sh
pnpm ops report-organization-lifecycle \
  --operator <registered-operator> \
  --org <organization-id>
```

The command is read-only. It reports state/revision/lineage/deadlines,
reactivation fence, and missing lifecycle bindings. It cannot request
or cancel closure,
waive recovery, cross the irreversible boundary, reactivate, or delete
storage.

Use exact tenant/request identifiers and read only:

- `organization_lifecycle_authority` for state, revision, deadline, lineage,
  irreversible time, and reactivation marker;
- `organization_lifecycle_events` for append-only request/cancel retry results,
  transaction-bound context phase results, Property erase receipts, privacy
  transitions, and backup legal-hold releases;
- `audit_logs` actions `privacy_request.received`,
  `sensitive_data.exported`, and `sensitive_data.accessed`; and
- `outbox_events` filtered to
  `identity.organization_lifecycle.changed` or `identity.member.removed`.

Never infer context cleanup from a lifecycle state alone. Never infer object
deletion from expiry alone. Never expose retrieval token digests, object keys,
or support evidence in routine product telemetry.

## Remaining release evidence

LIF-01 cannot be marked complete until all of the following exist and pass on
the final candidate:

1. concrete, idempotent lifecycle contributors for all 17 contexts;
2. production composition, bounded schedules, manager Closure Center, and
   ticketed independent operator authorization;
3. the migration that adds the `active -> active` reactivation edge and the
   `reactivate` receipt operation, without which explicit reactivation (whose
   command, readiness port and checks now exist) cannot commit;
4. support-mediated Property Erase and Organization Purge interruption/retry
   drills with independently retained managerial-work decisions;
5. backup erasure/restore fences proving closed or expired data cannot
   resurrect;
6. Guest-contact/feedback and Participant access/correction/withdrawal/erasure;
7. a counsel-approved retention registry with owner, eligibility query,
   evidence, restore implications, report-only run, bounded cell-local apply,
   and tenant-isolation/time-travel tests;
8. a fresh-database migration proof for migrations `0159` and `0168` and the
   final journal, plus live Railway storage configuration and deletion
   verification; and
9. product, security, legal, support, and operational acceptance evidence.

Migration `0159` is append-only candidate DDL. Do not rewrite it after release
or successful application to a non-disposable environment; any later correction
must use a new journaled migration.
Migration `0168` is governed by the same rule once it leaves disposable local
test databases.
