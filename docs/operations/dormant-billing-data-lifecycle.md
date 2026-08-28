# Dormant Billing data lifecycle

Billing is not a beta capability. The active settings DTOs, Better Auth input
and response schemas, and Organization update path do not accept or return the
five historical Billing fields. The physical Better Auth columns remain only
for compatibility while their existing data is deliberately erased:

- `billingCompanyName`
- `billingAddress`
- `billingCity`
- `billingPostalCode`
- `billingCountry`

## Report first

Run the governed command without `--apply`:

```sh
pnpm ops:manage-dormant-billing-data --operator <approved-operator-id>
```

The report reads one repeatable-read, read-only snapshot. It never selects or
emits Billing content. It contains only total and affected Organization counts,
per-field presence counts, the total number of stored field values, fixed
dispositions, and two SHA-256 fingerprints. `targetFingerprint` binds the exact
Organization/field-presence target set without exposing identifiers;
`reportFingerprint` additionally binds the aggregate counts and observation
time.

Retain the canonical report, independently review the scope, and confirm that
no approved export or legal hold requires keeping the dormant values. A report
does not authorize erasure or schema contraction.

## Exact erasure

Apply only the reviewed target fingerprint:

```sh
pnpm ops:manage-dormant-billing-data <targetFingerprint> \
  --operator <approved-operator-id> \
  --ticket <change-reference> \
  --reason <reviewed-reason> \
  --apply \
  --yes ops:manage-dormant-billing-data
```

Apply is destructive and has no content restore path. The command therefore
requires the standard named-operator policy, a ticket, a reason, `--apply`, and
the exact typed confirmation. Inside one serializable transaction it locks the
complete Organization snapshot, rebuilds the target fingerprint, and refuses
any target-set drift. Only an exact match may null all five columns. It then
re-reads the snapshot and rolls back unless no dormant Billing value remains.
An already-empty exact target is an idempotent no-op.

The operator policy decision is the content-free invocation audit. Preserve
the before/after command output with the change record. Never run the apply
command merely because a local or staging report is empty; evidence must come
from the exact candidate database under the approved operational procedure.

## Schema remains compatibility-only

Erasure does not drop or rename columns. Better Auth continues to declare them
with `input: false` and `returned: false`, preventing schema tooling from
silently recreating an externally writable/readable Billing surface.

Any future Billing product must be introduced as a new reviewed capability,
not by re-enabling these fields. Its contract must define ownership,
authorization, payment-provider boundaries, tax/address minimization,
regional processing, encryption, retention/erasure, exports, legal notices,
failure recovery, observability, and migration from an explicitly empty
compatibility state. Only after that contract and a reversible Better Auth
schema migration are approved may these compatibility columns be contracted or
replaced.
