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
  `confirm=ERASE <SCOPE> <id>` text. Refused in production. Outside production
  it validates, then runs the executors composed for the scope.

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

Closing an Organization erases every Property in it: export first.

The older `privacy-request` and `property-erase` commands stay until apply is
activated.
