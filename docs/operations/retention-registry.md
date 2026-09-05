# Retention registry — report-only

**Status: REPORT-ONLY. Apply mode is refused by code, not by convention.**

Authority: LIF-01 program bullets 10, 11 and 12.
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

Counsel has approved nothing. `docs/legal/legal-document-registry.json` holds
five documents, all `draft`, zero `approved`, and
`docs/legal/counsel-decision-checklist.json` holds forty-one items, all `open`.
Every registry rule therefore sits at `pending_counsel`, and:

- `assertRetentionRegistryApplyAllowed(rule)` **throws** for every rule.
- `retentionRegistryReportOnlyPlan(RETENTION_REGISTRY).mode` is `report_only`.
- `createRetentionSweepHandler` refuses any registry rule handed to it through
  `registryApplyRules`, **before** it opens a single evidence row — so a refused
  sweep cannot leave a half-finished `retention_runs` record behind.

The unit tests assert all three, and the integration test proves the report path
against real seeded, definitely-eligible rows opens no `retention_runs` row and
deletes nothing.

### Unblocking a rule (for the future)

1. Counsel resolves the `blockingCounselDecisions` items on the rule.
2. The approval lands in `docs/legal/legal-document-registry.json` with status
   `approved`, a named external approver and an approval evidence reference.
3. The rule gains an `approvalArtifact` naming that document.
4. Only then does `assertRetentionRegistryApplyAllowed` stop throwing.

Skipping step 2 is the failure mode this design exists to prevent.

---

## 3. Compatibility mirrors may never be a retention source

**No registry rule may name a `compatibility_read` or `bounded_contraction`
table.** This is asserted against the live authority
(`contractionCandidateTableNames()`), not against a hand-written list.

The reason is not tidiness. Those tables are contraction candidates blocked
until **one verified release plus a restore proof**. The evidence a future
contraction decision rests on is the row and foreign-key inventory produced by
`ops:report-compatibility-read-surfaces`. A retention rule that deleted their
rows would drain that inventory, the report would read "already empty", and the
contraction would have happened quietly and early — with neither the release nor
the restore proof it is gated on. `retention_classes.
unresolved_legacy_compatibility_rows` is still an open counsel question.

### What was removed

The scheduled sweep previously carried `gbp_cache.expired`, deleting expired
rows from `gbp_cache` — the `legacyGbpCache` compatibility mirror, superseded by
`google-import-v2` and written by nothing in production. That rule has been
removed. The class is carried report-only in the registry instead, blocked on
`retention_classes.expiring_google_cache`.

### The one declared exception

Six sweep rules still touch a contraction candidate: the `ip_hash` and
`session_id` pseudonym redactions on `scan_events`, `ratings` and `feedback`.
They are `redact`, never `delete`. Every row survives, so the inventory count is
unchanged, and the §3.3.10 seven-day pseudonym default still reaches the
mirrors. The exception is locked to exactly those six subjects by
`LEGACY_MIRROR_PSEUDONYM_REDACTIONS`; a seventh, or a change from `redact` to
`delete`, fails the test.

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

The `updated_at` anchors that do exist in the sweep
(`invited_registration_attempts.settled`, `notification_digest_batches`) are
operational saga state clocks on content-free rows, not content deadlines. Only
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
integer count and the approval blockers — and is safe to attach to a counsel
review or an operational ticket.

Rules with a `counsel_undecided` horizon, an object-store source or an external
processor source report `eligibleRows: null` with a stated
`notCountableReason`. They are never silently omitted: a class that cannot be
counted is itself a finding.

> **Not yet wired as an operator command.** `buildRetentionRegistryReport` is
> callable and tested, but the `ops:report-retention` command it belongs behind
> requires entries in `src/shared/governance/entry-point-catalogue.ts` and
> `src/shared/governance/operator-command-mutation-classifier.ts`, which are
> outside this change's ownership. See §8.

---

## 7. Bullet 12 — legacy reconciliation reports

Bullet 12 requires the existing billing, custom-role, multi-Organization, Team
and legacy-Guest data to be reconciled or archived before migration **without
erasing the evidence needed to fix the conflicts**. That second clause is why
every command in this family is read-only: the rows that make a conflict fixable
are exactly the rows an eager cleanup would delete.

| Data               | Command                                 | Status                                                           |
| ------------------ | --------------------------------------- | ---------------------------------------------------------------- |
| Billing            | `ops:manage-dormant-billing-data`       | Pre-existing (report-first, apply behind a reviewed fingerprint) |
| Team               | `ops:report-legacy-people-team`         | Pre-existing                                                     |
| Custom roles       | `ops:report-legacy-custom-roles`        | **New**                                                          |
| Multi-Organization | `ops:report-legacy-multi-org`           | **New**                                                          |
| Legacy Guest       | `ops:report-legacy-guest-compatibility` | **New**                                                          |

All three new commands are read-only, have no apply flag and no write path, and
emit counts, severities and a state fingerprint only.

```bash
pnpm ops:report-legacy-custom-roles         --operator <id> --as-of <ISO-8601>
pnpm ops:report-legacy-multi-org            --operator <id> --as-of <ISO-8601>
pnpm ops:report-legacy-guest-compatibility  --operator <id> --as-of <ISO-8601>
```

The fingerprint covers observed state — subject, version and every finding
id/severity/count — but deliberately **not** `asOf`. Two runs an hour apart over
unchanged data fingerprint identically, so the fingerprint can be used to prove
nothing moved. A reclassified severity changes it, so downgrading a blocker
cannot hide behind an unchanged hash.

### Severity

- `blocks_migration` — migration cannot proceed correctly while the count is
  non-zero.
- `needs_review` — someone must look; the migration is not wrong without it.
- `informational` — context that makes the other numbers interpretable.

Dormant custom role **definitions** are `informational`: §3.1.3 explicitly
allows the dormant schema to remain. A member or a pending invitation actually
**holding** a custom role is `blocks_migration`, because its effective
permissions come from a definition beta does not evaluate at runtime.

Nothing in the legacy-Guest report is `blocks_migration`. The mirrors cannot be
contracted before one verified release plus a restore proof, so no finding there
can legitimately block a migration — it can only require a recorded decision.

### The legacy-Guest deadline

`ops:report-legacy-guest-compatibility` is **not** a contraction inventory;
`ops:report-compatibility-read-surfaces` owns that and this command does not
restate it. It asks a different question: how much of the legacy population can
still be reconciled to the canonical Guest Response model.

`session_id` + `portal_id` is the only handle that can tie a legacy row to a
canonical Guest Response. The session binding expires 24 hours after submission
and the sweep redacts the mirror `session_id` on the same clock. So
`ratings_without_canonical_response` can only ever shrink, and every row it
loses moves into `ratings_without_correlatable_session` — countable and
archivable, permanently unreconcilable.

Do not attempt to re-derive a redacted pseudonym. That is re-identification, not
reconciliation.

---

## 8. Known gaps in this change

1. **`ops:report-retention` is not registered.** The report builder exists and
   is tested; the operator command needs an `entry-point-catalogue.ts` row and
   an `operator-command-mutation-classifier.ts` `read_only` entry.
2. **The three new bullet-12 scripts are not registered either**, for the same
   reason — each needs an `entry-point-catalogue.ts` row and a classifier entry.
3. **`data-fate-authority.ts` does not yet cross-reference the registry.** The
   registry reads the authority; the authority does not know a retention class
   exists for a table.
4. **The lifetime-aggregate ordering constraint is documented, not enforced**
   (§5).
5. **`docs/operations/runbooks.md` and
   `docs/operations/backup-and-lifecycle.md` still list `gbp_cache.expired`** as
   a live retention subject. That table row is now stale.
