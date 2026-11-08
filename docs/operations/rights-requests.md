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
  it runs the executors composed so far and refuses a scope with none.

## Notifications

The Feed executor runs for `access`, `property` and `organization`.

- **report** counts notification history, preferences and settings, says
  whether suspension is holding optional mail (mandatory mail is never held),
  and, for an Organization, how many account admins and former members a final
  warning would reach. Add `export-file=<path>` to write the export (mode 0600)
  to deliver by download link; it is never printed.
- Reads are named and use explicit field allowlists. Delivery queues, digest
  batches and source event ids are not exported. A row of another Organization
  or Property stops the run.
- **apply** on `property` deletes that Property's notifications, queued mail,
  preferences, delivery windows and unsubscribe scopes. On `organization` it
  deletes the Organization's rows in every notification table. Work runs in
  bounded batches and a stopped run resumes by running again.
- **apply** on `organization final-warning` queues the final warning instead
  of deleting: one per current account admin and one per former member, with no
  Property. Like the automatic warning, it names the Organization. Send it
  before the purge; the job ids repeat safely for one
  `verification` reference.

Closing an Organization erases every Property in it: export first.

The older `privacy-request` and `property-erase` commands stay until apply is
activated.
