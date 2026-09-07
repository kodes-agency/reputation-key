# GOV-02 — executable context-standards matrix closure

Date: 2026-08-28  
Authority: `docs/standards.md`  
Scope: the 17 bounded contexts and 11 governed dimensions in
`src/shared/governance/context-standards-matrix.ts`

## Outcome

GOV-02 replaces generic matrix uncertainty with an executable current-tree
disposition for every cell. This is a standards-evidence closure, not a claim
that all retained legacy code already conforms.

| Disposition          | Cells | Meaning                                                                                             |
| -------------------- | ----: | --------------------------------------------------------------------------------------------------- |
| `evidenced`          |   122 | An exhaustive current-tree check proves the rule for the context.                                   |
| `not_applicable`     |    24 | The context has no governed surface for the rule, with a concrete inert or ownership boundary.      |
| `accepted_exception` |    41 | A current variance is pinned to an owned, expiring register entry and a measurable removal trigger. |
| `unresolved`         |     0 | No generic or unowned gap remains.                                                                  |
| Total                |   187 | 17 contexts × 11 rules.                                                                             |

An accepted exception is explicitly **not conformance**. Any new variance, any
change to a pinned variance inventory, an expired or unowned exception, or a
matrix/register mismatch fails the focused governance tests.

## Executable proof added

- Event tags, envelopes, constructor validation, context/master unions, and
  `CONTEXT.md` event tables are checked exhaustively for every event-producing
  context. Portal's persisted legacy tag vocabulary remains the sole tag
  exception; it cannot be renamed safely without versioned replay and consumer
  compatibility.
- Every production application use-case directory is inspected for the
  Input/Deps/ReturnType convention. Existing variances are pinned per context by
  exact issue count and SHA-256 digest, so the inventories can shrink but cannot
  drift silently.
- Application async-`Result` propagation and native/untagged domain throws are
  inventoried separately. The exact Goal, Review, Activity, Guest, Identity,
  Metric, and Notification variances are registered as invariant-tier
  exceptions rather than being misreported as conformant.
- Context-layer filenames and mirrored test names are checked across production
  and test sources. Badge and Leaderboard currently conform; each retained
  legacy context inventory is digest-pinned for owner-scoped contraction.
- Exported repository declarations are checked for the standard application-port
  location and tenant scope on `findById`. The three retained placement
  variances—Activity, Metric, and Review—are exact registered exceptions.
- Build boundaries, required context documentation, and infrastructure factory
  style remain tied to their existing exhaustive authorities and evidence
  pointers.

## Accepted-exception inventory

| Dimension                 | Count | Contexts / authority                                                                                                              |
| ------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------- |
| Event tags                |     1 | Portal (`STD-MAINT-001`)                                                                                                          |
| Use-case type triples     |    15 | Every applicable non-contracted context (`STD-MAINT-004`–`018`)                                                                   |
| Error flow                |     7 | Goal (`STD-INV-002`), Review (`STD-INV-003`), Activity/Guest/Identity/Metric/Notification (`STD-INV-037`–`041`)                   |
| Context filenames         |    15 | Every context except currently conformant Badge and Leaderboard (`STD-MAINT-019`–`033`)                                           |
| Repository-port placement |     3 | Activity, Metric, Review (`STD-MAINT-034`–`036`)                                                                                  |
| Total                     |    41 | Each entry has context, dimension, existing scope, rationale, owner, compensating check, review/expiry dates, and sunset trigger. |

The authoritative details live in
`docs/governance/standards-exceptions.json`. The register is exactly cross-bound
to accepted matrix cells; extra entries and unregistered accepted cells both
fail.

## Data-fate integration

The shared data-fate authority is exhaustive for all 227 exported Drizzle
tables. GOV-02 also records the new lifecycle and Recent Activity authorities:

- `organization-lifecycle.schema.ts#organizationLifecycleAuthority` — Identity
  active authority (`LIF-01`).
- `organization-lifecycle.schema.ts#organizationLifecycleCommandReceipts` —
  content-free Identity recovery archive (`LIF-01`).
- `activity.schema.ts#recentActivityEntries` — renamed canonical Activity
  authority (`ACT-01`).
- `outbox.schema.ts#idempotencyReceipts` with scope
  `activity_vocabulary_reconciliation` — content-minimal Activity
  reconciliation receipts retained through retry/recovery and the
  compatibility audit window (`ACT-01`).

No retention, erasure, export, or restore capability is inferred merely from a
catalogue row; the declared exit criteria remain mandatory.

## Verification authority

The focused gate consists of:

```text
src/shared/governance/context-standards-matrix.application.test.ts
src/shared/governance/context-standards-matrix.event-envelope.test.ts
src/shared/governance/context-standards-matrix.test.ts
src/shared/governance/context-standards-authority.test.ts
src/shared/governance/data-fate-authority.test.ts
```

These tests include independent negative fixtures for newly introduced source
checkers, exact current-tree inventories, evidence-path existence, exception
scope ownership/existence, and register-to-matrix exhaustiveness.

Handoff verification on 2026-08-28:

- Focused GOV-02 gate: 5 files / 33 tests passed.
- Full shared-governance unit directory: 16 files / 140 tests passed.
- Owned TypeScript lint, focused formatting check, and whitespace/diff checks
  passed.
- Whole-tree `tsc --noEmit` reached one unrelated SAFE-owned error at
  `src/shared/google-provider-control/egress-inventory.ts:187`; it reported no
  GOV-02 type error. This evidence does not relabel that external failure as
  passing.

## Residual work and release meaning

- The 41 accepted cells are deliberate migration work, not hidden closure.
  Their owners should shrink the exact inventories during bounded feature-owned
  changes and remove an exception only when its sunset trigger is proved.
- Portal event-tag migration remains replay- and consumer-compatibility work; a
  mass rename is explicitly unsafe.
- Goal and Review async error-contract migration and the six pinned native-domain
  error surfaces require caller-aware behavioral slices.
- Type-alias, filename, and repository placement cleanup is maintainability work
  and must not displace beta-critical behavioral recovery.
- GOV-02 does not activate a capability, provider, deployment, destructive data
  lifecycle, or production release. Wider program status remains governed by the
  central comprehensive status ledger.
