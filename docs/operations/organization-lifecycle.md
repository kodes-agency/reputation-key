# Organization and Property Lifecycle Control Plane (LIF-01)

## Operational status

The repository now contains a fail-closed local control plane for recoverable
Property lifecycle, staged Organization closure, and Organization Export. It is
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
- a deterministic context-owned Organization Export contract, request
  authority, encrypted-storage adapter, single-use retrieval, and expiry
  deletion control plane;
- one concrete Identity export contributor that reads tenant-visible profile,
  member, invitation, role, access-policy, and lifecycle status through a
  bounded read-only snapshot while excluding authentication/recovery secrets
  and restricted operational control state, preserving PostgreSQL timestamp
  microseconds in canonical UTC text; and
- a transaction-bound Identity lifecycle contribution wrapper whose reviewed
  phase mutation and append-only content-free receipt commit together after
  the exact live lifecycle state, lineage, revision, and deadline are locked
  and verified. No destructive phase implementation is bound to it yet.

Production-shaped but deliberately quarantined:

- Identity now exposes one named `identityLifecycleRuntime` rather than adding
  maintenance, support, or export methods to the flattened container use-case
  surface;
- independently authorized support transitions are present on that runtime
  only when the exact reviewed contributor set and support authorization are
  both bound; no server route or mutating operator command invokes them;
- bounded handlers exist for lifecycle advancement (50 Organizations), export
  generation (one lease), and expired-object deletion (one object);
- the operational catalogue owns their intended five-minute, one-minute, and
  hourly schedules, but all three job families are `quarantined`, so worker
  reconciliation removes those schedules while retaining no-mutation safety
  handlers for stale queued work; and
- `pnpm ops:report-organization-lifecycle --operator <id> --org <id>` reports
  exact content-free authority and composition readiness. It has no apply mode.

Not activated or complete:

- the 17 concrete lifecycle contributors and remaining 16 concrete export
  contributors;
- reviewed contributor/storage composition, durable post-upload generation
  recovery, active worker schedules,
  authenticated Closure Center, mutating independently authorized operator
  commands, final notice delivery, or explicit reactivation;
- context purge/scrub implementations, legal-hold handling, backup erasure
  ledger, support-mediated Property Erase, complete privacy workflows, and the
  counsel-approved retention matrix;
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
source epoch, creates a 30-day recovery deadline, invalidates the current Google
review destination, and records `property.archived`. Archived Properties are
excluded from normal external effects and public work by lifecycle admission.

Restore is permitted only before the recovery deadline. It rechecks current
Property access and an eligible Responsible Manager,
then advances the source epoch and records `property.restored`. The returned
Google-binding readiness is either `ready` or `reconnect_required`; Restore does
not silently recreate provider authority.

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
| `closure_requested` | AccountAdmin request and global suspension are committed.                          | Current AccountAdmin may cancel strictly before the deadline.                                            |
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
state to `active` but retains the closure lineage, Organization suspension, and
`reactivation_required=true`. It does not reactivate Google, Portals, AI,
imports, sync, replies, notifications, or schedules.

## Explicit reactivation (LIF-01-T18)

Clearing `reactivation_required` and lifting the Organization suspension is a
separate command with its own authority, readiness evidence and receipt. It
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
clears (the `organization_lifecycle_state_shape` check requires it), the
suspension is lifted with a new policy generation, and only THEN can a new
closure be requested.

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

| Action                   | Required typed confirmation                  | Result                                                          |
| ------------------------ | -------------------------------------------- | --------------------------------------------------------------- |
| Waive recovery           | `WAIVE RECOVERY <organization-id>`           | Closing → Purge Pending, after fresh readiness receipts         |
| Cancel pending purge     | `CANCEL PENDING PURGE <organization-id>`     | Purge Pending → active, retaining suspension/reactivation fence |
| Begin irreversible purge | `BEGIN IRREVERSIBLE PURGE <organization-id>` | Purge Pending → Purging and sets `irreversible_at`              |

These methods are local application seams, not an authorization UI or operator
tool. Do not invoke equivalent ad-hoc SQL.

### Worker quarantine and activation rule

The worker boot-registers three content-free safety handlers:

| Job                                  | Per-pass bound       | Intended cadence | Current posture |
| ------------------------------------ | -------------------- | ---------------- | --------------- |
| `advance-organization-lifecycle`     | 50 Organizations     | 5 minutes        | quarantined     |
| `generate-organization-export`       | one generation lease | 1 minute         | quarantined     |
| `purge-expired-organization-exports` | one expired object   | 1 hour           | quarantined     |

Do not change a family to `enabled` merely because its handler exists. Lifecycle
advancement requires all 17 unique context contributors plus independently
reviewed support authorization. Export generation requires all 17 unique export
contributors, encrypted private storage, a dedicated retrieval-secret binding,
and durable recovery of a post-upload/pre-completion crash. Export
deletion additionally requires a live absence-verification drill. A partial set
is reported as missing contexts and remains non-executable; it is never
converted to `no_data` by composition.

### Post-upload crash recovery

Migration `0170_organization_export_pre_egress_evidence.sql` makes the ambiguous
window recoverable, so `generationRecoveryConfigured` is now derived from the
supplied storage rather than hard-coded false. A storage adapter that cannot
answer `verifyStored` still cannot recover, and composition still refuses.

The protocol is:

1. `generating` — the bundle is built.
2. `recordPreEgressEvidence` commits the coverage, manifest and archive digests
   plus the deterministic object key, and moves the row to `egress_pending`.
   `encryption_evidence_ref` is still null: the bytes have not left yet.
3. `storage.putEncrypted` uploads.
4. `completeGeneration` confirms the persisted digests and moves to `ready`.

A crash anywhere after step 2 is no longer ambiguous, because step 2 recorded
what the bytes must be before they existed. A reclaimed `egress_pending` lease
renews **in place** — never back to `generating` — calls `storage.verifyStored`,
and either completes with the **original** digests or fails closed with
`egress_evidence_mismatch`, retaining them for inspection. `buildBundle` is
never invoked on the recovery path, so a reclaimed lease can never produce a
second archive of a different as-of moment.

## Organization Export

Organization Export is not a cross-context database dump. Exactly one
contributor from each of the 17 contexts must return `complete`, `no_data`, or
`omitted` at a fixed `as_of`. `complete` requires a human-readable CSV and a
lossless JSON file; omission requires a content-free code. Paths, encodings,
classifications, duplicates, and forbidden path components are validated.

The deterministic `organization-export/v1` ZIP contains:

- `README.md`;
- `schema.json`;
- `coverage.json`, including every context and omission state;
- context-owned CSV/JSON files; and
- `manifest.json` with media type, classification, byte size, and SHA-256 for
  every preceding entry.

Canonical UTF-8 byte ordering and fixed ZIP metadata make retries reproducible.
The Review contributor may expose only manager-authored material; Integration
is content-free lifecycle status; AI is limited to retained permitted
derivatives. OAuth material, sessions, cookies, password/hash/key/credential
material, raw provider review content/identifiers, live Performance payloads,
queues/outbox/receipts, rate limits, fraud/security/operator internals,
prompts/transient inference, and restricted Operational Action History are
excluded by contract. Concrete contributors still require independent review;
the coordinator cannot prove a secret was mislabeled inside otherwise valid
CSV/JSON bytes. The Identity contributor is the first reviewed concrete owner:
it emits `identity/organization.csv` and `identity/organization.json`, names
excluded record classes, never queries Account credentials, Sessions, or
Verification challenges, and refuses a request whose extraction cannot begin
within the 15-minute bounded snapshot window. Its stable payload omits the
changing transaction timestamp, so an unchanged database produces identical
bytes on retry.

A request and every retrieval step recheck and lock a current AccountAdmin
membership plus active Organization Binding inside the database transaction.
PostgreSQL stores only state, revisions, checksums, a private deterministic
object key, encrypted-storage evidence, a token digest, clocks, and deletion
evidence. It stores neither ZIP bytes nor the raw token.

Generation uses a bounded renewable lease and deterministic private key. A
failure before storage starts can become a content-free terminal failure. Once
storage starts, the row remains retryable so an ambiguous object write cannot
be hidden behind a terminal database state. The remaining blocker is durable
recovery of the exact archive/checksum evidence after a process dies between
the object write and database completion; rebuilding a later live snapshot is
not accepted as proof. Production composition is hard-disabled until that
protocol and its post-upload crash test exist. The S3-compatible adapter
requires private keys, server-side AES-256 evidence, exact checksum replay, and
verified absence after deletion.

Retrieval authority is derived from a dedicated server secret, bound to the
request and operation UUID, stored only as a SHA-256 digest, valid for at most
24 hours and never beyond the object deadline, and atomically consumed before
object bytes are read. Every issued operation and digest is also retained in
append-only `organization_export_retrieval_issuances`, so expired rotation
cannot resurrect an earlier raw token. The archive checksum is reverified after read. A
consumed request no longer blocks a new export, which provides a safe recovery
path after a client/storage read failure without making the original token
reusable. An expired 24-hour authority can be transactionally replaced by a
fresh current-AccountAdmin request while the encrypted object remains inside
its seven-day deadline; the prior digest stops authorizing retrieval. Export
objects have a maximum seven-day deadline; deletion is only complete after
object deletion/absence is verified and content-free evidence is committed.

## Member offboarding

The app-owned member-removal flow refuses removal of the final AccountAdmin.
Before the Identity command, composition fences Google connector/import work
and releases current Property/Portal/Inbox manager authorities and Property
access grants. The Identity transaction then locks the exact membership,
verifies the durable fact names that same user, deletes all Better Auth sessions
for the departing user, deletes membership, and appends
`identity.member.removed`.

### Transfer-first leave (LIF-01-T21)

Self-service leave is a SEPARATE command from removal, because the two need
opposite behaviour. Removal RELEASES what the member held — an AccountAdmin is
present to reassign afterwards. A voluntary leave has no such supervisor, so
`leaveOrganization` REFUSES until every Portal responsibility, Property
responsibility and open Inbox assignment the leaver holds has been explicitly
transferred to a named, currently eligible manager. There is no auto-assign and
no "release to nobody": choosing a successor is an accountability decision.

- The sole AccountAdmin cannot leave. Checked in the use case for a usable
  message and re-checked under the Organization advisory lock in the command
  store, which is what closes the race between two admins leaving at once.
- The worklist is re-read AFTER the transfers are applied, so a responsibility
  created during the hand-over blocks the leave instead of being abandoned.
- The responsibility facts are composed (`memberOffboarding`). ABSENT IS
  FAIL-CLOSED: with no adapter bound, leave refuses. A leave that cannot see
  the worklist would silently strand everything on it.
- `identity.leave_org` is capability-gated as usual, so a suspended
  Organization does not lose members while its closure is pending.

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
pnpm ops:repair-partial-offboarding --operator <id>

# Report one user
pnpm ops:repair-partial-offboarding <organization-id> <user-id> --operator <id>

# Converge one reviewed user
pnpm ops:repair-partial-offboarding <organization-id> <user-id> \
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
  than proceeding silently.
- The job id is `<eventId>-<recipient>`, so bus/outbox dual delivery and any
  retry converge on one notice per admin.

## Read-only diagnostics

Preferred content-free operator report:

```sh
pnpm ops:report-organization-lifecycle \
  --operator <registered-operator> \
  --org <organization-id>
```

The command is read-only. It reports state/revision/lineage/deadlines,
reactivation fence, and missing lifecycle/export bindings. It cannot request
or cancel closure,
waive recovery, cross the irreversible boundary, reactivate, generate an
export, issue a retrieval token, or delete storage.

Use exact tenant/request identifiers and read only:

- `organization_lifecycle_authority` for state, revision, deadline, lineage,
  irreversible time, and reactivation marker;
- `organization_lifecycle_events` for append-only request/cancel retry results,
  transaction-bound context phase results, Property erase receipts, privacy
  transitions, and backup legal-hold releases;
- `organization_export_retrieval_issuances` for append-only, digest-only
  evidence that every old retrieval authority remains dead;
- `organization_exports` for content-free generation/retrieval/deletion state;
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

1. concrete, idempotent lifecycle contributors for all 17 contexts and export
   contributors for the remaining 16 contexts;
2. immutable pre-egress archive evidence plus post-upload/pre-completion crash
   recovery that never rebuilds a later live snapshot as historical proof;
3. production composition, bounded schedules, manager Closure Center, and
   ticketed independent operator authorization;
4. the migration that adds the `active -> active` reactivation edge and the
   `reactivate` receipt operation, without which explicit reactivation (whose
   command, readiness port and checks now exist) cannot commit;
5. support-mediated Property Erase and Organization Purge interruption/retry
   drills with independently retained managerial-work decisions;
6. backup erasure/restore fences proving closed or expired data cannot
   resurrect;
7. Guest-contact/feedback and Participant access/correction/withdrawal/erasure;
8. a counsel-approved retention registry with owner, eligibility query,
   evidence, restore implications, report-only run, bounded cell-local apply,
   and tenant-isolation/time-travel tests;
9. a fresh-database migration proof for migrations `0159` and `0168` and the
   final journal, plus live Railway storage configuration and deletion
   verification; and
10. product, security, legal, support, and operational acceptance evidence.

Migration `0159` is append-only candidate DDL. Do not rewrite it after release
or successful application to a non-disposable environment; any later correction
must use a new journaled migration.
Migration `0168` is governed by the same rule once it leaves disposable local
test databases.
