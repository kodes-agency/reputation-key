# Operator reports

These five commands are read-only inventories. They run through the standard
operator policy/audit harness, emit content-free deterministic evidence, and
have no `--apply` mode. A green report is evidence for a separately reviewed
cutover; it is never permission to migrate, repair, publish, or drop data.

## Inbox Handling Cycle cutover

```sh
pnpm ops report-inbox-handling-cutover \
  --operator <registered-operator> \
  --org <organization-id> \
  --observed-at <ISO-8601>
```

**Reports:** one `REPEATABLE READ`, `READ ONLY` snapshot of pre-cutover Inbox
items against Handling Cycle heads and logs. It classifies each row as `exact`,
`mappable`, `ambiguous`, or `orphan`; reports head coverage, legacy-status mirror
drift, Response Target lineage, and outcome/performance eligibility; and emits
only controlled reason codes, identifiers, counts, transaction posture, and a
SHA-256 fingerprint. Guest, manager, Review, and note text is never selected.

**Run when:** preparing or reviewing the Inbox Handling Cycle cutover, comparing
a rerun at the same observation time, or measuring the unresolved backfill
list. `mappable` is review evidence, not write authority. A current-open private
feedback start instant requires its own signed operator decision. Bulk Close
stays disabled, and this report authorizes no column or mirror removal.

## Compatibility-read mirrors

```sh
pnpm ops report-compatibility-read-surfaces \
  --operator <registered-operator> \
  --as-of <ISO-8601>
```

**Reports:** for each retained compatibility mirror, its physical and Drizzle
names, data-fate authority, exact row count, registered production reader count,
foreign-key dependencies, and the Integration-owned Google mirror mapping. The
transaction is read-only and the output never selects Rating, Feedback, scan,
provider, or import content.

**Run when:** checking replacement parity, reader removal, foreign-key repair,
or preparing a reversible schema-contraction review. Removal remains blocked
until the exact candidate has a retained inventory, replacement parity, zero
readers, one verified release without touches, an isolated restore proof, and a
disposition for every non-foreign-key reference. Empty tables alone do not lift
the block.

## Non-foreign-key references

```sh
pnpm ops report-non-fk-references \
  --operator <registered-operator> \
  --as-of <ISO-8601> \
  [--table <contraction-candidate> ...]
```

**Reports:** identifier-free counts for declared UUID, polymorphic
`resource_type`/`resource_id`, aggregate-ID, and JSON surfaces that PostgreSQL
foreign keys cannot protect. One read-only snapshot emits the candidate,
surface, columns, probe kind, count, and deterministic SHA-256 fingerprint.
JSON probes deliberately over-match rather than risk a false negative.

**Run when:** any contraction slice proposes deleting rows or dropping a legacy
or compatibility table. Run without `--table` for every candidate; repeat the
flag for a bounded review. A non-zero count must be rewritten, expired,
explicitly accepted with a written reason, or treated as a stop condition.
Re-running does not disposition it.

## Guest Response readiness

```sh
pnpm ops report-guest-response-readiness \
  --operator <registered-operator> \
  --observed-at <ISO-8601> \
  [--org <organization-id> ...]
```

**Reports:** a read-only snapshot of legacy Rating/Feedback rows and canonical
Guest Response evidence. Every retained fact is classified as `exact`,
`mappable`, `conflict`, `orphan`, or `unsafe`; four separate 1–5 distributions
preserve legacy, retained, effective, and durable-fact heads. The report also
checks lineage, withdrawal, media/contact, Inbox, retention, and durable-fact
integrity. Output contains controlled outcomes, IDs, counts, and a fingerprint,
never feedback text, contact values, session/network identifiers, object URLs,
or provider destinations.

**Run when:** preparing GST-01 reconciliation, comparing unchanged data at a
fixed observation time, or proving canonical fact parity and zero unexplained
rows. Omit `--org` only for a reviewed global inventory. A unique legacy
candidate remains `mappable`; the report never manufactures provenance or
activates Guest capability.

## Portal beta readiness

```sh
pnpm ops report-portal-beta-readiness \
  --operator <registered-operator> \
  --as-of <ISO-8601> \
  [--org <organization-id> ...]
```

**Reports:** retained Portal ownership/provenance, effective group membership,
Access Artifact/address status, Brand/locale completeness, and raw-link gaps at
the chosen cutoff. Canonical output is limited to scope/source IDs, controlled
reason codes, counts, readiness, and a fingerprint; it excludes Portal and
Property names, localized content, themes, destinations, and token material.

**Run when:** preparing POR-01 beta inventory, reviewing unresolved legacy
ownership or group intervals, or comparing an unchanged-data rerun. Keep every
ambiguous Portal Disabled or Archived and every raw destination quarantined.
A zero-gap report is necessary evidence, not publication approval.
