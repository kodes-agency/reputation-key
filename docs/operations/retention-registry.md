# Retention registry — report-only

**Status: REPORT-ONLY. Apply mode is refused by code, not by convention.**

Authority: `docs/BETA.md` (LIF-01 program bullets 10, 11 and 12).
Registry: `src/shared/db/retention/retention-registry.ts`
Report builder: `src/shared/db/retention/report-retention-registry.ts`
Guards: `src/shared/db/retention/retention-registry.test.ts`,
`src/shared/db/retention/retention-registry.integration.test.ts`

---

## 1. What this registry is, and what it is not

The registry is the counsel-facing retention matrix. One row per data class, each
carrying an owner, a source table or object class, an eligibility query, an
evidence subject and a restore implication.

It is **declarative**. It does not execute. The scheduled sweep
(`src/shared/jobs/retention-sweep.job.ts`) executes a separate, separately
authorized rule set; the registry sits above it as the governance layer and the
place where counsel's decisions will land.

Do not read a registry row as a description of live behaviour. Each row carries
two distinct fields for exactly that reason:

| Field                             | Meaning                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `eligibility.horizon`             | The counsel-facing default from the program contract. What counsel approves.               |
| `eligibility.implementedBoundary` | What the shipped code enforces today, which is often stricter. What operators are held to. |

Conflating the two is how a privacy notice ends up describing behaviour the
system does not have. The Guest session pseudonym is the clearest example: the
§3.3.10 default is seven days, the code expires the binding at twenty-four
hours.

---

## 2. Apply mode is blocked

`approvalState` is **computed** from `approvalArtifact`, never written. A rule
reaches `approved` only by carrying a named counsel approval artifact.

No registry rule currently carries a named counsel approval artifact. Every
registry rule therefore sits at `pending_counsel`, and:

- `assertRetentionRegistryApplyAllowed(rule)` **throws** for every rule.
- `retentionRegistryReportOnlyPlan(RETENTION_REGISTRY).mode` is `report_only`.
- `createRetentionSweepHandler` refuses any registry rule handed to it through
  `registryApplyRules`, **before** it opens a single evidence row — so a refused
  sweep cannot leave a half-finished `retention_runs` record behind.

The unit tests assert all three, and the integration test proves the report path
against real seeded, definitely-eligible rows opens no `retention_runs` row and
deletes nothing.

### Unblocking a rule (for the future)

1. Counsel approves the proposed rule against the governing obligations in
   `docs/BETA.md`.
2. The rule gains an `approvalArtifact` naming the external approval evidence.
3. Only then does `assertRetentionRegistryApplyAllowed` stop throwing.

Skipping the external approval evidence is the failure mode this design exists
to prevent.

---

## 3. Compatibility mirrors remain row-preserving

The live `scan_events`, `ratings` and `feedback` compatibility tables are not
deleted by the retention sweep. The migration that called for one-off
contraction inventories was struck, so retention governance no longer depends
on a dedicated inventory command. The tables and their retention rules remain.

### The declared redactions

Six sweep rules touch those three mirrors: the `ip_hash` and `session_id`
pseudonym redactions on each table. They are `redact`, never `delete`. Every row
survives, while the §3.3.10 seven-day pseudonym default still reaches the
mirrors. `LEGACY_MIRROR_PSEUDONYM_REDACTIONS` aligns those executable sweep
subjects with the counsel-facing registry horizons.

---

## 4. Reading never extends a content deadline

Every content-bearing rule is anchored on the original submission or creation
column, or on an absolute deadline stamped at submission. Anchoring on a column
that records an act of handling would restart the clock every time somebody
opened the record.

`DEADLINE_NEUTRAL_COLUMNS` is the refused set: `last_read_at`, `read_at`,
`seen_at`, `viewed_at`, `last_accessed_at`, `accessed_at`, `revealed_at`,
`moderated_at`, `reviewed_at`, `handled_at`, `archived_at`, `updated_at`.

Worked examples:

- Private feedback expires on `guest_response_private_feedback.expires_at`,
  derived from `submitted_at`. Manager reading, Inbox handling, escalation and
  Portal archive leave it untouched.
- The de-identified Guest fact expires on `guest_responses.retention_deadline`,
  24 calendar months from the **initial** submission. `moderated_at` exists on
  the same row and is deliberately not the anchor.
- Contact material expires on `guest_contact_requests.expires_at`, stamped at
  consent. An audited reveal reads the material and is recorded separately in
  `guest_contact_request_reveal_audits`; it does not move `expires_at`.
- Provider source content expires on `content_expires_at`, not `last_fetched_at`
  — keying on the fetch would let RepKey hold provider text for as long as it
  keeps looking at it.

The `updated_at` anchor on `notification_digest_batches` is an operational saga
state clock on content-free rows, not a content deadline. Only
`CONTENT_DEADLINE_CLASSES` is subject to this rule.

---

## 5. The ordering constraint that has no code guard yet

Corrections and withdrawals **must** reach `portal_metric_lifetime_aggregates`
BEFORE the 24-month source-fact purge removes the rows they apply to. Once the
source fact is gone the aggregate keeps a contribution that can never be
reconciled again, and a restore does not fix it — it desynchronises the two
sides further.

This is currently a documented ordering constraint recorded in the registry
(`metric.lifetime_aggregates` restore implication), not an enforced one. It must
be enforced before the fact purge is ever armed in apply mode.

---

## 6. Running the report

The registry report is content-free — rule id, class, owner, source, cutoff, an
integer count and apply status — and is safe to attach to a counsel review or an
operational ticket.

Rules with a `counsel_undecided` horizon, an object-store source or an external
processor source report `eligibleRows: null` with a stated
`notCountableReason`. They are never silently omitted: a class that cannot be
counted is itself a finding.

`ops:report-retention` is registered as a read-only operator command. Its
builder is callable and covered by the report-only integration path.

---

## 7. Bullet 12 — no operator report

The custom-role, multi-Organization and legacy Guest rows still exist. The
program struck the migration that called for one-off reconciliation
inventories, so no dedicated operator report or apply path remains. Removing
those reports does not migrate, archive or delete their source rows.

---

## 8. Known gaps in this change

1. **The lifetime-aggregate ordering constraint is documented, not enforced**
   (§5).
2. **`docs/operations/runbooks.md` and
   `docs/operations/backup-and-lifecycle.md` still list `gbp_cache.expired`** as
   a live retention subject. That table row is now stale.
