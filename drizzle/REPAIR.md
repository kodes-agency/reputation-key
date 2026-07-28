# Snapshot chain repair (BQC-5.4, 2026-07-28)

## What was broken

- `0004_snapshot.json` … `0010_snapshot.json` were byte-copies of
  `0003_snapshot.json` (all shared id `1a7f0373-822d-4035-a02f-bb5b5601cd97`
  and prevId `24576151-ae6b-4fbd-b2f9-c89a3ac06262`), produced when the
  hand-written migrations 0004–0010 were journaled without real snapshots.
- Snapshots for journal entries 0011–0016 never existed (those migrations
  were hand-written with journal entries only).
- `drizzle-kit check` failed with a snapshot collision; `drizzle-kit generate`
  was unusable. `drizzle-kit migrate` still worked because the journal + SQL
  files were intact.

## What was done

Point-in-time fidelity for 0004–0016 was already lost and cannot be
reconstructed from git. Instead, every snapshot from `0004_snapshot.json` to
`0016_snapshot.json` now carries the FINAL consolidated schema state (all 60
app-owned tables, matching the live migrated catalog as verified by
`src/shared/db/migration-verification.test.ts`):

- The content was produced by running `drizzle-kit generate` on an empty out
  directory against the full model (`src/shared/db/schema/migratable.ts`) and
  copying the emitted snapshot.
- Each snapshot 0004–0016 received a fresh unique `id`; `prevId` chains
  correctly from 0003's real id (`1a7f0373-822d-4035-a02f-bb5b5601cd97`).
- Snapshots 0000–0003 are original and untouched, as is `_journal.json`
  (17 entries, idx 0–16).

Consequence: snapshot-to-snapshot diffs for 0004–0016 are empty; the real DDL
history lives in the SQL files (the schema authority), not in snapshot diffs.
`drizzle-kit migrate` is unaffected (it replays SQL by journal order).
`drizzle-kit check` passes and `drizzle-kit generate` diffs against the 0016
snapshot (the true current state), so newly generated migrations are correct.

Verified 2026-07-28: `pnpm drizzle-kit check` → "Everything's fine";
`pnpm drizzle-kit generate` → "No schema changes, nothing to migrate".
