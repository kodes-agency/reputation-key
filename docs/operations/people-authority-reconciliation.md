# People authority reconciliation

This read-only report compares retained People data with the canonical beta
model before any legacy contraction or corrective migration. It does not create,
update, or remove rows.

Run it with an explicit observation time so an unchanged database produces the
same ordered rows and SHA-256 fingerprint:

```sh
pnpm exec tsx scripts/ops/report-people-authority.ts \
  --operator <registered-operator> \
  --as-of 2026-08-26T08:00:00.000Z \
  --org <organization-id>
```

Omit `--org` only for an intentional global report. The output contains
identifiers and relationship state, not names, email addresses, feedback, or
review content.

## Outcome meanings

| Outcome    | Meaning                                                                 |
| ---------- | ----------------------------------------------------------------------- |
| `exact`    | The canonical relationship matches, or inactive history is retained.    |
| `mappable` | The source has one deterministic canonical destination, pending review. |
| `conflict` | Existing rows disagree or more than one destination is possible.        |
| `orphan`   | A required parent record is missing or inactive.                        |
| `unsafe`   | Applying the old meaning would violate an accepted beta boundary.       |

Each source is evaluated by dimension. A legacy Staff assignment may therefore
have an exact Participant mapping and, separately, a quarantined Team relation.
This is intentional: `PropertyAccessGrant`, `StaffParticipation`, Staff
`PortalResponsibility`, and Portal/Property Responsible Manager assignment never
stand in for one another.

Current `StaffUserLink` intervals are checked on both sides. Overlapping current
links for either a Participant or a login are reported as conflicts, and the
interactive participation lookup treats that association as unresolved. Future
links are not exposed early; a link with a scheduled end remains current until
the half-open interval ends.

Review every non-`exact` row. `mappable` is not permission to apply a change;
the corrective migration must be separately reviewed, use compare-and-set or
effective-dated writes, and be followed by a report with no unexplained rows.
Team rows remain retained reconciliation data and are never converted into
Portal Groups. A `StaffUserLink` remains an optional association and never
activates Staff User login in beta.
