# Audit events

Feed owns `audit_events`: Organization, optional Property and actor identifiers,
action/outcome, resource identifiers, occurrence time and stable source provenance.
There is no content or generic payload column. Writes reject unknown fields and
malformed identifiers. An Organization/source-kind/source-id key fences replays;
reusing it for a different fact fails.

A named, registered operator can read one Organization:

```bash
pnpm ops audit-events --operator <id> --org <id> [--property <id>] [--batch-size <1..100>]
```

The command is read-only and returns at most 100 events, newest first. Reads hide
future events and events older than 365 elapsed days. The daily retention sweep
removes rows older than that same occurrence cutoff in bounded batches. Its
`audit_events` retention-run evidence uses the existing retention failure alert;
that alert does not detect an overdue or missing sweep.

The table is an additive expansion. Production consumers still write Operational
Action History, and the new operator read will be empty until copying and writer
cutover are completed. Existing source tables, restricted history RPCs, legal holds,
redaction and Organization export/lifecycle contributors remain authoritative.
No source row is deleted by this expansion.

Before writer cutover, verify stable identities and eligible source counts for
the last 365 days, cover export/redaction and legal-hold transitions, coordinate
policy-audit writers and publish the approved notice wording. Verify PostgreSQL
constraints, populated upgrade and the canonical schema dump through the normal
database checks. Add overdue-retention monitoring before treating the new table
as the sole authority. Inbox item timelines and Portal history keep their own
stores and lifetimes.
