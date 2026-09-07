# Legacy Metric rollup contraction

## COMPLETED — 2026-09-04

The CNV-01 contraction gate is complete for `rollup_daily_metrics`,
`rollup_weekly_metrics`, `rollup_daily_inbox_metrics`, and
`_rollup_watermarks`. The owner approved the reconstruction route on
2026-09-04 after the governed source was proved to reproduce every retained
aggregate exactly. Physical removal is implemented by the journaled migration
`drizzle/0181_big_killmonger.sql`.

All retained gate evidence is under
[`docs/release-evidence/cnv-01/2026-09-04/`](../release-evidence/cnv-01/2026-09-04/).
The adjacent `.sha256` files authenticate the three JSON artifacts.

| Step | Status       | Retained evidence                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---: | :----------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|    1 | **COMPLETE** | [`rollup-inventory.json`](../release-evidence/cnv-01/2026-09-04/rollup-inventory.json) and [`rollup-inventory.json.sha256`](../release-evidence/cnv-01/2026-09-04/rollup-inventory.json.sha256) inventory the exact live `google-closed-beta` database: 6 daily Metric rows, 6 weekly Metric rows, 9 daily Inbox rows, and 3 watermark rows, together with every column, constraint, index, inbound/outbound foreign key, and trigger. |
|    2 | **COMPLETE** | [`rollup-export.json`](../release-evidence/cnv-01/2026-09-04/rollup-export.json) and [`rollup-export.json.sha256`](../release-evidence/cnv-01/2026-09-04/rollup-export.json.sha256) retain all 21 projection rows and all 3 watermark rows in deterministic order as the rollback data source.                                                                                                                                         |
|    3 | **COMPLETE** | The same checksummed retained copy, together with [`reconstruction-proof.json`](../release-evidence/cnv-01/2026-09-04/reconstruction-proof.json) and [`reconstruction-proof.json.sha256`](../release-evidence/cnv-01/2026-09-04/reconstruction-proof.json.sha256), establishes a reversible recovery path without inventing a second serving authority.                                                                                |
|    4 | **COMPLETE** | `reconstruction-proof.json` records the deleted writer's own aggregate SQL, recovered from `4085491e^`, run unbounded against `metric_readings` and `inbox_items`: 6/6 daily, 6/6 weekly, and 9/9 Inbox rows rebuilt, with 0 only-stored rows, 0 only-rebuilt rows, and 0 value mismatches.                                                                                                                                            |
|    5 | **COMPLETE** | `rollup-inventory.json` records exactly one primary-key constraint and one primary-key index per table, with 0 inbound foreign keys, 0 outbound foreign keys, and 0 triggers. `reconstruction-proof.json` records 0 residual catalog dependencies during the drop rehearsal. The contraction removes the four registered non-FK exemptions with the tables.                                                                            |
|    6 | **COMPLETE** | `rollup-export.json` retains the three watermark rows. Their `updated_at` values were frozen at `14:00:00Z`, `14:05:00Z`, and `00:31:58Z`, all before the `14:41:53Z` quarantine deployment, and remained unchanged across the 15:00, 16:00, and 17:00 cron windows.                                                                                                                                                                   |
|    7 | **COMPLETE** | `reconstruction-proof.json` records the live reversible rehearsal: `BEGIN; DROP TABLE` for all four tables with `CASCADE`; catalog inspection; then `ROLLBACK`. The rehearsal changed 4 tables to 0, left all 239 other public tables unaffected, found 0 residual catalog dependencies, and restored all four tables plus all 21 projection and 3 watermark rows after rollback.                                                      |

Steps 2 and 3 were **not** satisfied by an encrypted, access-controlled
export-and-restore ceremony. The owner deliberately chose a retained,
checksummed copy plus a proven reconstruction path because these rows are
derived aggregates and their governed sources reproduce them key-for-key and
value-for-value. The checksummed copy remains the rollback data source; the
reconstruction proof establishes that no unique product truth is lost.

The former inventory command, schema models, quarantine handlers, schedules,
governance exemptions, lifecycle/export special cases, fixtures, and tests are
removed in the same contraction change. No compatibility shim or retained
application model remains.
