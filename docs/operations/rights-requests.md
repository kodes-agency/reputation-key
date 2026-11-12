# Manual rights requests

Requests to access or erase personal data are handled by the owner through
`denev@kodes.agency`, with `pnpm ops rights-request`.

## Rules

- Answer within 30 days of receipt.
- Verify the requester's identity first. The seven-day export deadline starts
  at verification.
- Deliver an export as a download link valid for 24 hours, pointing at a file
  in the private bucket. Delete the file after download and after seven days at
  the latest. Never email an export as an attachment.
- Name a person by the SHA-256 of the verified identifier, never the
  identifier itself.

## Scopes and modes

Scopes: `access`, `guest-response`, `participant`, `property`, `organization`.

- **report** (default): prints the plan, the deadlines and the delivery rule.
- **replay**: `replay journal=<file> restore-point=<iso>` lists the entries of a
  journal export (see `erasure-journal.md`) that a restore undid, limited to
  the given Organization and, when set, Property. Another Property in the same
  Organization is never listed.
- **apply**: `--apply` with `verified=<iso>`, `verification=<ref>`, `--reason`,
  `--ticket`, `--yes ops:rights-request` and the exact
  `confirm=ERASE <SCOPE> <id>` text. Every erasure is journaled before it runs:
  the command writes one IDs-only journal object per context to the private
  bucket first, and when that write fails nothing is deleted and an alert
  fires. Only the final warning, which deletes nothing, needs no journal.
  Guest self-service withdrawals use the same journal, so a response a guest
  withdrew after the restore point is replayed too.
  Work runs in bounded batches and a stopped run resumes by running the same
  command again. Each run, whatever its outcome, records one audit event
  naming the operator, the scope, the Organization and Property and the
  verification reference. The command refuses a request whose Organization does
  not exist or whose Property belongs to another Organization, and `--property`
  is not accepted for `access` or `organization`. Each one-off erasure needs the
  owner's approval at the time.

`access` and `organization` reports accept `out=<dir>`, which writes each
executor's export files under that directory (mode 0600). Upload them to the
private bucket by hand and delete the local copy.

## Executors

- **google-integration** (`access`, `organization`): exports the lifecycle
  status of the Organization's Google connections and imports (no credentials,
  Google subject, email, scopes, provider identifiers or replay digests). On
  closure it deletes import work and discovery records and scrubs the retained
  connection rows. The script cannot reach Google, so apply refuses while a
  connection still holds a credential, an import item is in flight, or a
  revoke or exchange is unfinished: an Organization admin first uses
  Disconnect in Settings, Integrations, which revokes the grant.
- **reporting** (`access`, `organization`): covers goal, metric and dashboard records (goal programs, versions,
  assignments, monthly results and revisions, rating goals, metric readings and
  corrections, Google snapshots).

  - **Access**: `access` or `organization` with `out=<dir>` writes one JSON file
    per table under `<dir>/reporting/`, plus a manifest of row
    counts. Only allowlisted columns leave; a row from another Organization
    aborts the export. Upload the files to the private bucket by hand.
  - **Organization purge**: `organization --apply` refuses an Organization that is
    not suspended (add its ID to `BETA_SUSPENDED_ORGS` in the environment the command runs with), pauses its active goals, refuses while a
    goal is being evaluated or Portal source facts have not settled, then deletes
    its rows in one transaction and prints an erasure record (context, evidence
    line, rows per table, no content). The monthly-result delete guard is off
    only inside that transaction, under a five-second lock timeout, and a
    rollback restores it. Property, guest-response and participant scopes have no
    Reporting executor.

- **ai** (`property`, `organization`): on closure it retires and deletes the
  retained AI derivatives (analyses, mentions, aggregates, issue groups,
  operations, draft measurements, cost windows); the merchant consent evidence
  stays. Apply refuses while an AI authorization is enabled, an enrollment is
  active or an AI operation is in flight. `organization` with `out=<dir>` writes
  two files under `<dir>/ai/`: `review-analysis-mentions.json` (topic, polarity,
  strength, cause phrases and the sentence numbers that state each) and
  `review-analysis-mention-corrections.json` (the manager corrections). Only
  allowlisted columns leave, never review text. Only the analysis the product
  still serves is exported: retired, revoked or expired generations are left
  out. `access` does not run this executor: an access request covers the
  requester's own records, and this analysis is the Organization's derived
  data.
- **review** (`access`, `organization`): exports manager-authored replies with
  their template and AI provenance, publication authorizations and attempts,
  and the layered reply library (voices, templates, revisions, wordings,
  visibility). Provider-mirrored replies, review source content, reply
  observations, provider identifiers and operation keys are never exported. On
  closure it stops sync schedules, cancels replies authorized but not yet sent,
  deletes provider observations, source content and the reply library, and
  scrubs reply and review text. Authorizations stay as content-free proof.
  Apply refuses while a reply is out at the provider or a snapshot run is open,
  and then changes nothing.
- **inbox** (`access`, `organization`): exports items (without the copied
  review or feedback text), handling cycles, transitions, response targets,
  assignment, escalation and priority history, handling outcomes, notes and the
  response-target policy fields. Personal last-view state and reminder schedule
  rows are not exported. On closure it cancels open reminders and deletes the
  items with their history, the policy and the per-Property overrides.

- **notification** (`access`, `property`, `organization`): see below.
- **google-integration** on `property` also deletes the Property's finished
  Google execution permits, and refuses while a Google call is admitted or
  under way for it before its deadline. A permit left admitted or started past
  its deadline is dead and goes with the Property.
- **staff** (`property`, `organization`): a Property erasure deletes that
  Property's Staff participations, Portal responsibilities, Portal Group
  memberships, onboardings and Staff settings; a closure deletes the whole
  Staff directory. The people themselves go only with the `participant` scope.
  It runs before Portal, whose Portals these rows reference.
- **identity** (`property`, `organization`): a Property erasure deletes its
  access grants and AI decide-later records; a closure deletes them for every
  Property, plus every member's AI notice receipts and product update receipts
  and settings, and the Organization's memberships, its owners' included, and
  invitations. Login identities stay: a person may belong to another
  Organization.
- **property** (`property`, `organization`): each Property becomes a
  content-free tombstone (`purged`, no name, address or Google binding) and
  its Responsible Managers are deleted. A closure tombstones every Property of
  the Organization rather than deleting the rows, because deleting them would
  cascade the retained AI consent evidence away.
- **activity** (`property`, `organization`) also pseudonymises the audit
  records: every event stays, and each user id, email address, name, IP
  address and free-text note in it is replaced by `pseudonym:` and a keyed
  hash, including email addresses inside longer text and detail keys that name
  a person. One person gets the same pseudonym throughout one erasure, and a
  restore replay with the same server secret writes the same values again; a
  rotated secret gives the replayed copy other, still consistent, pseudonyms. A
  Property erasure changes that Property's audit events and the audit log rows
  whose details name the Property. Operators name no customer and stay: an
  operator handle (`ops:<name>`) wherever it appears, including the record of
  the rights request itself, and the platform operator's user id on the
  operator console's own records (`platform.*` actions).
- **work-items** (`organization`, last): deletes the Organization's settled
  work items and the outbox events a restore fenced, which are never delivered
  and never age out. It refuses while any item is pending, running, uncertain or
  quarantined, or while an outbox event of the Organization is unsettled,
  since delivery would pick that event up again. Settle or cancel the work,
  then run the same command again.

Other outbox events are not erased early: settled events age out with the
30-day outbox retention. A Property erasure leaves the Property's fenced events
until the Organization's closure deletes them. The other tables an erasure
keeps on purpose (lifecycle and erasure evidence, AI consent evidence,
operational history under legal hold, reply authorization proof) are listed
with their reason in `src/composition/rights-coverage.test.ts`.

### Notifications

- **report** counts notification history, preferences and settings and, for an
  Organization, how many account admins and former members a final warning
  would reach. For `access` and `organization`, `out=<dir>` writes
  `notification/notification-rights.json`; the export is never printed.
- Reads are named and use explicit field allowlists. Delivery queues, digest
  batches and source event ids are not exported. A row of another Organization
  or Property stops the run.
- **apply** on `property` deletes that Property's notifications, queued mail,
  preferences, delivery windows and unsubscribe scopes. On `organization` it
  deletes the Organization's rows in every notification table. Work runs in
  bounded batches and a stopped run resumes by running again.
- **apply** on `organization final-warning` runs only this executor and writes the final warning instead
  of deleting: one notice per current account admin and one per former member,
  with no Property, all on one transaction. Like the automatic warning, it names the Organization. Send it
  before the purge; a repeat for one `verification` reference folds into the
  waiting notice without a second email.

Closing an Organization erases every Property in it: export first.
