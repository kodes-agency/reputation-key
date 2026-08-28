# Development database drift diagnosis — 2026-08-28

**Subject:** the configured default development database `repkey_dev`
**Method:** read-only comparison of the repository migration journal against the
recorded Drizzle migration ledger. No schema was altered, no migration was run,
no repair was attempted, and no destructive command was issued.
**Status:** diagnosed, **not repaired**. Repair is an explicit, separate operator
decision — see “Disposition”.

## Why this exists

Two mistakenly broad test invocations reached migration setup against
`repkey_dev`. Better Auth reported no change and Drizzle then stopped
immediately on an “already exists” error, so no tests ran. The comprehensive
progress report recorded this as an open item requiring a separate diagnosis
rather than an implicit fix during feature work. This document is that
diagnosis.

## Evidence

Comparison inputs:

- repository journal `drizzle/meta/_journal.json` — **169 entries**, `0000_init`
  through `0168_identity_organization_lifecycle_receipts`;
- migration content hashes recomputed from `drizzle/<tag>.sql` at frozen
  integration SHA `d16284d7`;
- the database ledger `drizzle.__drizzle_migrations`.

Observed ledger state:

| Measure                                                | Value   |
| ------------------------------------------------------ | ------- |
| Repository journal entries                             | 169     |
| Rows in `drizzle.__drizzle_migrations`                 | 117     |
| `id` range in the ledger                               | 1 – 154 |
| First ordinal where the ledger hash ≠ the journal hash | **25**  |
| Repository migrations with no matching applied hash    | **57**  |
| Applied hashes that match no repository migration      | **5**   |

The five applied hashes that no current repository migration produces sit at
ledger ordinals **25, 26, 110, 111 and 116**. The corresponding repository
positions are:

| Ordinal | Current repository migration at that position            |
| ------: | -------------------------------------------------------- |
|      25 | `0025_recognition-governance`                            |
|      26 | `0026_notification-delivery-policy`                      |
|     110 | `0110_portal_upload_issuances`                           |
|     111 | `0111_google_import_parent_saga`                         |
|     116 | `0116_stable_review_observations_and_material_revisions` |

## Conclusion

`repkey_dev` is **not** simply “behind”. It is **forked**.

1. It carries five migrations whose SQL text has since been **rewritten in the
   repository**. Their applied hashes no longer correspond to any file on the
   branch, so Drizzle can never reconcile them by re-running or skipping.
2. Because ordinal 25 already diverges, every ordinal-based comparison after it
   is meaningless. The `id` range 1–154 against a row count of 117 confirms the
   ledger has been edited or partially reset at least once.
3. The 57 unapplied repository migrations include the `0110`–`0126` band. Those
   rewritten predecessors created some of the same objects under different
   text, which is exactly why a forward run halts on an “already exists” error
   at the first colliding `ADD COLUMN`, instead of at a missing object.

So the reported symptom is a **consequence**, not the fault. Patching the one
colliding column would move the failure to the next collision and would leave
the ledger permanently unreconcilable.

## Impact

- **No impact on program verification.** All program verification runs on
  disposable databases created from scratch and migrated through the full
  journal. The 2026-08-28 integration run used `fresh_b`, confirmed absent,
  created, migrated through journal 169, and then removed.
- **No impact on the release candidate.** Candidate evidence must come from a
  brand-new database, never from a long-lived developer database.
- **Impact on local development only.** Any developer using `repkey_dev` is
  running against a schema that no commit on this branch describes.

## Disposition

`repkey_dev` should be **recreated, not repaired**.

Reconciling a forked ledger means hand-editing `drizzle.__drizzle_migrations`
to assert that rewritten migrations were applied. That produces a database that
claims a lineage it does not have, and it is precisely the failure mode the
program forbids for evidence. A developer database holds no evidence and no
production data, so recreation costs nothing that matters.

Recommended operator sequence, to be run deliberately by a human who has
confirmed the database holds nothing they need:

```bash
psql "$ADMIN_DATABASE_URL" -c 'DROP DATABASE repkey_dev'
```

```bash
psql "$ADMIN_DATABASE_URL" -c 'CREATE DATABASE repkey_dev'
```

```bash
pnpm db:bootstrap-auth && pnpm auth:migrate && pnpm db:migrate && pnpm db:matviews
```

Then confirm the ledger matches the journal:

```bash
pnpm check:schema-drift
```

### Before dropping

These read-only checks are left for the operator rather than performed here,
because the answer changes whether anything must be preserved first:

1. Confirm no unexported local fixture data is wanted from `repkey_dev`.
2. Confirm no other developer or long-running local process is bound to it.

### Guardrail follow-up

The root cause of the incident was a test invocation broad enough to reach
migration setup against the configured default database. The durable fix is a
fence in the integration-test harness that refuses to run migration setup
against any database that is not explicitly marked disposable, rather than
relying on invocation discipline. Tracked as part of the verification harness
work, not as a schema repair.

## What was deliberately not done

- No `ALTER`, `DROP`, `CREATE`, `INSERT`, `UPDATE` or `DELETE` on `repkey_dev`.
- No migration run against `repkey_dev`.
- No edit to `drizzle.__drizzle_migrations`.
- No change to the configured `DATABASE_URL`.
