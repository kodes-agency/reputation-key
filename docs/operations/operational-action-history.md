# Operational Action History

**Owner:** Activity  
**Authority:** ACT-01, ADR 0056, migration 0149  
**Status:** Repository authority plus durable Property archive/restore/delete,
Portal publish/archive, approved-destination policy and hero validation,
member-role and Merchant AI capability change, Google connection/disconnection,
and provider-confirmed Google reply publication paths are implemented. Broader
action-family coverage and a counsel-approved destructive lifecycle are not
complete. The readiness, retention-assessment, legal-hold and redaction
operations were removed as unused (see "Removed lifecycle operations").

## Trigger and impact

Use this runbook when a restricted action-history read is unavailable, sequence
coverage shows a gap, or a legal hold or retention question reaches the
Activity owner. Operational Action History is separate from the user-facing Recent Activity feed. Recent Activity must never
be used to fill a gap or presented as security/action evidence.

An unavailable history read does not block the source business action. It does
mean operators cannot claim complete restricted-history coverage for that
tenant until the source fact/command and append result are reconciled.

## Data and claim boundary

The canonical record stores tenant, optional Property, actor/resource
identifiers, one explicit action/resource pair, outcome, reason code, exact
provenance, source occurrence time, record time, and tenant-local sequence. It
has no generic payload/details field and must never contain review text,
private feedback/contact, Inbox notes, reply bodies, names, email addresses,
tokens, credentials, URLs, or raw/pseudonymous network values.

Database mutation guards reject core updates, deletes, and truncation. They
permit only one-way actor/resource identifier redaction outside an active legal
hold; no application code performs that redaction. Tenant heads reject deletion/truncation and accept only a one-step,
monotonic record-time advance. This is ordinary defense in depth. Do not call
it immutable, tamper-evident, cryptographically verifiable, or compliance-grade. Sequence
coverage detects ordinary gaps; the export fingerprint proves only that two
canonical export bodies are byte-equivalent.

## Access and export

- Only a current AccountAdmin verdict from Identity may authorize list/export.
  A role embedded in an old session is insufficient; authority failure denies.
- Tenant scope always comes from the authenticated context. Clients cannot
  select another Organization.
- List pages use a stable `(occurredAt, sequence)` keyset and contain at most
  100 rows. Exports contain at most 500 identifier-only rows and bind their
  tenant/filter scope and observation time into the canonical fingerprint.
- A successful read/export appends its access record in the same database
  transaction before any result is returned. Denied/failed attempts append a
  content-free outcome and return no history rows: a caller who is not a
  current AccountAdmin is answered 403, an unreadable authority or store 503.
- Both restricted GET boundaries emit private/no-store response policy, Cookie
  variance, and no-referrer policy; intermediaries must not cache exports.
- Authenticated list/export server boundaries are catalogued, and production
  composition supplies Identity's current AccountAdmin authority. Isolated
  context construction still defaults to deny; do not work around that default.

## Readiness and recovery

The registered durable source-fact coverage is intentionally explicit:

- Property archive, restore, and legacy delete;
- Portal publication and archive;
- Organization member role change;
- Merchant AI capability state change;
- approved Portal destination policy change;
- completed Portal hero validation/publication;
- Google account connection and disconnection;
- provider-confirmed Google reply publication.

Each accepted fact keeps its exact event id/version/source aggregate and copies
only allowlisted actor, tenant, Property, and resource identifiers. A historical
Google-connect v2 fact reads `connectedBy`; current v3 reads `userId`. A Google
disconnect names the AccountAdmin who made it in `userId` and is recorded as
that user's action; the recovery reconciler's disconnect of an attempt it cannot
attribute, and a fact recorded before 2026-09-24, carry none and are recorded as
system actions. Source facts that carry no actor, including Property delete,
Merchant AI, approved-destination, and hero-completion facts, are recorded as
system actions rather than receiving invented attribution. This list is not
complete action coverage: authentication/authorization and Property-access
decisions, other policy/capability changes, sensitive-data access/export,
privacy requests, feedback moderation, and general operator commands still
need their own atomic source seams before they may be claimed.

No code reports readiness any more. Sequence coverage is complete only when the
tenant head equals the count of distinct sequences in
`operational_action_history_records` and there are no duplicates; an operator
who needs that answer reads it from the two tables directly.

For an interrupted append, retry the exact source fact or canonical command
with the same provenance identity. The store serializes allocation on the
tenant head, commits record plus head atomically, and treats matching provenance
as a duplicate success. A conflicting use of the same provenance fails closed.
Never synthesize provenance or reconstruct a missing record from
`recent_activity_entries`, `recent_activity_replay_facts`, or legacy `audit_logs`.

## Removed lifecycle operations

The readiness report, retention assessment, legal-hold placement and release,
and subject redaction operations (and their store methods) were removed as
unused: no screen, ops command or job called them and nobody asked for them.
The `operational_action_history_legal_holds` table and its database guards stay,
and so does the rights/erasure check that refuses while a legal hold is active.
Holds can therefore only be placed or released by a reviewed database change.
Nothing assesses the proposed 365-day retention horizon; it is not enforced and
there is no delete/apply method or shared retention-sweep rule.

Do not add destructive behavior, or bring any of these operations back, until
counsel approves the policy and the change has separately reviewed authority for
legal-hold precedence, redaction, export, restore/fork behavior, and deletion
evidence.

## Verification and escalation

Repository verification consists of the domain/access unit suites,
the migration guard suite, an empty-to-current PostgreSQL migration, schema
drift, and the real-database append/fault/pagination/race suites. Capture only content-free totals, journal head, test result, and failure
codes in incident evidence.

Escalate any analysis coverage discontinuity, provenance conflict, direct-mutation rejection, or
active-hold conflict to the Activity owner. Escalate policy interpretation or a
request to delete history to counsel; it is not an operational override.

The following remain deployed-evidence requirements and cannot be proven by
repository tests alone:

- the production database role has only the intended table/function grants;
- PITR/backup access is restricted and a current isolated restore is readable;
- the production authenticated entry point uses the current Identity authority;
- exports are access-controlled and handled under the approved privacy policy;
- counsel has approved any eventual destructive lifecycle.
