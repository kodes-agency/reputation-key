# Operational Action History

**Owner:** Activity  
**Authority:** ACT-01, ADR 0056, migration 0149  
**Status:** Repository authority plus durable Property archive/restore/delete,
Portal publish/archive, approved-destination policy and hero validation,
member-role and Merchant AI capability change, Google connection/disconnection,
and provider-confirmed Google reply publication paths are implemented. Broader
action-family coverage and a counsel-approved destructive lifecycle are not
complete.

## Trigger and impact

Use this runbook when a restricted action-history read is unavailable, sequence
coverage reports a gap, a legal hold or redaction needs review, or the proposed
365-day retention horizon needs assessment. Operational Action History is
separate from the user-facing Recent Activity feed. Recent Activity must never
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
hold. Tenant heads reject deletion/truncation and accept only a one-step,
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
  content-free outcome and return no history rows.
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
Google-connect v2 fact reads `connectedBy`; current v3 reads `userId`. Source
facts that carry no actor, including Property delete, Google disconnect,
Merchant AI, approved-destination, and hero-completion facts, are recorded as
system actions rather than receiving invented attribution. This list is not
complete action coverage: authentication/authorization and Property-access
decisions, other policy/capability changes, sensitive-data access/export,
privacy requests, feedback moderation, and general operator commands still
need their own atomic source seams before they may be claimed.

Readiness is `ready/sequence_current` only when the tenant head equals the
covered distinct sequence count and there are no duplicate sequences. A gap is
`unavailable/unaccounted_sequence_gap`; a failed database read is
`unavailable/authority_store_unavailable` with unknown counts, never zeros.

For an interrupted append, retry the exact source fact or canonical command
with the same provenance identity. The store serializes allocation on the
tenant head, commits record plus head atomically, and treats matching provenance
as a duplicate success. A conflicting use of the same provenance fails closed.
Never synthesize provenance or reconstruct a missing record from
`recent_activity_entries`, `recent_activity_replay_facts`, or legacy `audit_logs`.

## Legal holds and redaction

Legal holds are Organization-scoped occurrence-time intervals with a reason
code and named operator identifier. Placement and its history action commit
together. Release is a one-time transition with a named operator and reason
code; direct rewrite, deletion, and truncation are rejected.

Actor/resource redaction handles at most 100 matching records per call. Rows
covered by an active hold remain unchanged and are reported as held. The only
allowed record mutation sets the selected identifier to null and its redaction
timestamp once; action, outcome, provenance, sequence, and all other fields stay
unchanged. Retrying a completed correlation is a reported duplicate and cannot
consume another batch; continuing an incomplete redaction requires a new
correlation identity.

## Retention

The proposed horizon is 365 days, but repository behavior is
`report_only_pending_counsel`. Assessment appends a lifecycle action and returns
only cutoff, eligible count, held count, and oldest eligible time. There is no
delete/apply method and no shared retention-sweep rule.

Do not add destructive behavior until counsel approves the policy and the
change has separately reviewed authority for legal-hold precedence, redaction,
export, restore/fork behavior, and deletion evidence.

## Verification and escalation

Repository verification consists of the domain/access/lifecycle unit suites,
the migration guard suite, an empty-to-current PostgreSQL migration, schema
drift, and the real-database append/fault/pagination/hold/redaction/assessment
suite. Capture only content-free totals, journal head, test result, and failure
codes in incident evidence.

Escalate any sequence gap, provenance conflict, direct-mutation rejection, or
active-hold conflict to the Activity owner. Escalate policy interpretation or a
request to delete history to counsel; it is not an operational override.

The following remain deployed-evidence requirements and cannot be proven by
repository tests alone:

- the production database role has only the intended table/function grants;
- PITR/backup access is restricted and a current isolated restore is readable;
- the production authenticated entry point uses the current Identity authority;
- exports are access-controlled and handled under the approved privacy policy;
- counsel has approved any eventual destructive lifecycle.
