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
  it validates and then refuses, because no scope's executor is composed yet.

Closing an Organization erases every Property in it: export first.

The older `privacy-request` and `property-erase` commands stay until apply is
activated.
