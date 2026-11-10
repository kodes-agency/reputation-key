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
  corrections, Google snapshots, Portal lifetime totals, setup milestones).

  - **Access**: `access` or `organization` with `out=<dir>` writes one JSON file
    per table under `<dir>/reporting/`, plus a manifest of row
    counts. Only allowlisted columns leave; a row from another Organization
    aborts the export. Upload the files to the private bucket by hand.
  - **Organization purge**: `organization --apply` refuses an Organization that is
    still active (suspend it first), pauses its active goals, refuses while a
    goal is being evaluated or Portal source facts have not settled, then deletes
    its rows in one transaction and prints an erasure record (context, evidence
    line, rows per table, no content). The monthly-result delete guard is off
    only inside that transaction, under a five-second lock timeout, and a
    rollback restores it. Property, guest-response and participant scopes have no
    Reporting executor.

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

### Notifications

- **report** counts notification history, preferences and settings, says
  whether suspension is holding optional mail (mandatory mail is never held),
  and, for an Organization, how many account admins and former members a final
  warning would reach. For `access` and `organization`, `out=<dir>` writes
  `notification/notification-rights.json`; the export is never printed.
- Reads are named and use explicit field allowlists. Delivery queues, digest
  batches and source event ids are not exported. A row of another Organization
  or Property stops the run.
- **apply** on `property` deletes that Property's notifications, queued mail,
  preferences, delivery windows and unsubscribe scopes. On `organization` it
  deletes the Organization's rows in every notification table. Work runs in
  bounded batches and a stopped run resumes by running again.
- **apply** on `organization final-warning` runs only this executor and queues the final warning instead
  of deleting: one per current account admin and one per former member, with no
  Property. Like the automatic warning, it names the Organization. Send it
  before the purge; the job ids repeat safely for one
  `verification` reference.

Closing an Organization erases every Property in it: export first.
