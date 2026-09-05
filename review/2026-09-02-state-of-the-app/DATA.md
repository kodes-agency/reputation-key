# Data, schema, migrations, projections, and retention — state of the app, 2026-09-02

## Verdict

The rewrite did not finish the planned Metric contraction: three rollup tables and their watermark still have enabled scheduled writers even though the Metric context admits they have no production reader. The physical model is now very large but knowable—242 tables, 39 enums, 491 explicit secondary indexes, 707 checks, 316 foreign keys, one ordinary compatibility view, and zero materialized views—and every table is classified below. The 178-entry migration journal is mechanically contiguous and the deploy runner is unusually strong, but current zero-to-head proof stops at migration 0129/0130, two consequential cutovers violated the mandated multi-deployment expand/backfill/cutover/contract sequence, and 71 journal timestamps are on calendar dates after this review date. Tenant predicates are strong in sampled repositories, yet five of 15 representative tables still allow cross-tenant relationship inconsistency at the database boundary. Retention is genuinely executing, including 7-day pseudonym cleanup, 30-day contact redaction, 90-day private-feedback deletion, and 24-hour AI derivative erasure; however, the “report-only” registry is not the source of the production executor, and its claimed 24-month coverage does not cover separately stored qualified-scan and click facts. Six tables have production INSERT writers and no production query reader; two are sound uniqueness receipts, while the other four need an explicit evidence consumer or deletion/convergence decision. This is materially better than the pre-rewrite false-confidence baseline, but declarations still overstate runtime truth in exactly the areas the rewrite promised to close.

## Scorecard

| Planned outcome (cite the package/§)                                                                                                          | Current reality                                                                                                                                                                                                       | Verdict     | Severity |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- |
| Remove rollup tables/jobs with no beta reader (§3.6.6; MET-01 work 8, `docs/comprehensive-beta-implementation-program-2026-08-25.md:105,917`) | Matviews are gone, but three replacement rollup tables plus `_rollup_watermarks` are still written by three enabled schedules; no product reader exists (`src/contexts/metric/CONTEXT.md:165-170`).                   | SUBSTANTIAL | medium   |
| One governed retention registry, report-only then bounded apply (LIF-01 work 10–11, `...implementation-program-2026-08-25.md:985-991`)        | A declarative counsel-pending registry and an independent 28-rule destructive executor coexist; production supplies no registry rules to the executor guard (`src/bootstrap.ts:446-457`).                             | SUBSTANTIAL | medium   |
| Guest defaults: 7d/30d/90d/24m (§3.3.10, `...implementation-program-2026-08-25.md:71-72`)                                                     | 7d network/abuse, 30d contact, 90d text and `guest_responses` 24m run; `guest_qualified_scans` and click facts have no corresponding 24m execution rule.                                                              | IMPROVE     | medium   |
| AI erasure within 24h (§3.5.2, `...implementation-program-2026-08-25.md:92-96`)                                                               | An unconditional five-minute job deletes exact retired analysis/aggregate/trend generations and fails on overdue backlog.                                                                                             | ACHIEVED    | —        |
| Expand → backfill/report → verify → cutover → later contract (§4.1/4.3, `...implementation-program-2026-08-25.md:128-138,156-158`)            | Journal/deploy mechanics are strong, but migrations 0054 and 0101 add/backfill/drop consequential representations in one deployment.                                                                                  | IMPROVE     | medium   |
| Complete physical inventory and contraction evidence (LIF-01/CNV-01, `...implementation-program-2026-08-25.md:985,1171-1182`)                 | All 242 tables are fate-declared and 33 contraction candidates have named inventory commands; runtime reachability still contradicts some declarations.                                                               | GOOD        | —        |
| Repository/schema tenant-negative constraints (§4.2, `...implementation-program-2026-08-25.md:142-151`; prior DATA-10)                        | All 15 sampled repositories scope reads; five sampled schemas lack a tenant-bound relationship FK.                                                                                                                    | IMPROVE     | high     |
| Semantic schema authority and clean install (FND/ARC; `src/shared/db/schema-drift.ts:1-18`)                                                   | Deep comparator and serialized deploy path exist; the generation barrel omits 12 app tables, CI checks a disposable DB rather than production, and latest clean-install evidence covers only 130/178 journal entries. | IMPROVE     | medium   |
| Fix old dead AI aggregate and rollup findings (pre-review `...consolidated-2026-08-24.md:651,764-779`)                                        | `ai_property_daily_aggregates` now has an authorized server/UI read; the three legacy Metric rollups remain dark.                                                                                                     | IMPROVE     | medium   |

## What was achieved

### DATA-A01 The physical model is exhaustively enumerable

**Evidence.** Reflection over `src/shared/db/schema/index.ts` plus `google-import-compatibility.schema.ts` returned:

```text
model={tables:242,enums:39,indexes:473,checks:704,foreignKeys:316}
dbOnly={other:1,function:114,trigger:142,check:3,expression-index:1,index:7}
```

The eight Better Auth tables are separately owned (`src/shared/db/CONTEXT.md:16-21`) and their compatibility bootstrap declares ten secondary indexes (`scripts/migrations/0000-auth-tables-bootstrap.sql:148-158`). Therefore the expected physical inventory is **242 tables, 39 enums, 491 explicit secondary indexes** (473 model + eight registered DB-only/exclusion indexes + ten auth), **707 check constraints** (704 model + three DB-only), and **316 foreign keys**; index count excludes PK/UNIQUE constraint-backing indexes. Migration 0008 drops all three former matviews (`drizzle/0008_incremental-rollup-tables.sql:67-73`), while migration 0160 creates the sole ordinary compatibility view, `activity_log` (`drizzle/0160_recent_activity_identifiers.sql:1-29`). A replay of `CREATE/DROP/RENAME TABLE` over all 178 SQL files produced 234 Drizzle-owned current tables; adding the eight auth tables independently corroborates 242.

The executable fate catalogue says it scans every `pgTable` in both directions (`src/shared/governance/data-fate-authority.ts:1-18`). For this review, category precedence is: legacy/quarantine, then production-write-without-query-reader, then evidence/audit-only, then active serving/control authority. The complete mutually exclusive classification is **189 active + 6 written-only + 8 evidence/audit-only + 39 legacy/quarantined = 242**.

**Actively read by product or live control-plane code (189):**

- `account`, `ai_admission_cost_reservations`, `ai_admission_product_consumptions`, `ai_admission_rate_windows`, `ai_authorization_lifecycle_records`, `ai_canary_authorization_heads`, `ai_canary_authorizations`, `ai_execution_control_heads`, `ai_execution_control_transitions`, `ai_execution_permit_settlements`, `ai_execution_permits`, `ai_operation_attempts`, `ai_operation_profiles`, `ai_operations`, `ai_organization_cost_windows`, `ai_property_aggregate_contributions`, `ai_property_aggregate_heads`, `ai_property_calendar_authorities`, `ai_property_daily_aggregates`, `ai_property_processing_profiles`.
- `ai_property_quota_windows`, `ai_property_trend_outcomes`, `ai_property_trend_scheduler_heads`, `ai_property_trend_schedules`, `ai_provider_circuit_states`, `ai_provider_deployment_capabilities`, `ai_provider_deployment_profiles`, `ai_read_barrier_heads`, `ai_review_analyses`, `ai_review_analysis_backfill_run_memberships`, `ai_review_analysis_backfill_runs`, `ai_review_analysis_enrollment_memberships`, `ai_review_analysis_enrollment_replays`, `ai_review_analysis_enrollments`, `ai_review_analysis_outcomes`, `ai_review_event_cursors`, `ai_routing_policies`, `ai_runtime_capability_profiles`, `authorization_execution_permits`, `beta_feedback_triage`.
- `beta_feedback_triage_transitions`, `capability_compliance_approvals`, `capability_execution_control`, `context_organization_lifecycle_receipts`, `credential_revoke_permits`, `data_cell_topology_cutovers`, `event_consumer_receipts`, `gbp_import_item_retry_receipts`, `gbp_import_request_items`, `gbp_import_requests`, `gbp_import_sagas`, `goal_definition_versions`, `goal_definitions`, `goal_evaluations`, `goal_monthly_results`, `goal_periods`, `goal_program_versions`, `goal_programs`, `goal_refresh_receipts`, `goal_result_revisions`.
- `goal_subject_assignments`, `goal_timezone_event_receipts`, `google_connections`, `google_credential_broker_replay`, `google_credential_routing_directory_snapshots`, `google_credential_routing_directory_state`, `google_credential_source_operations`, `google_disconnect_revoke_attempts`, `google_import_discovery_invalidations`, `google_import_discovery_records`, `google_oauth_exchange_attempts`, `google_organization_credential_homes`, `google_reply_observation_heads`, `google_reply_observations`, `google_subject_authority_guards`, `guest_contact_request_purge_checkpoints`, `guest_contact_requests`, `guest_network_pressure_records`, `guest_qualified_scan_receipts`, `guest_qualified_scans`.
- `guest_response_experience_snapshots`, `guest_response_integrity_decisions`, `guest_response_private_feedback`, `guest_response_session_bindings`, `guest_responses`, `identity_invitation_fact_contract`, `identity_organization_lifecycle_receipts`, `inbox_assignment_history`, `inbox_escalation_history`, `inbox_feedback_handling_outcomes`, `inbox_handling_cycle_heads`, `inbox_handling_cycle_response_targets`, `inbox_handling_cycle_transitions`, `inbox_handling_cycles`, `inbox_items`, `inbox_notes`, `inbox_private_feedback_target_property_overrides`, `inbox_response_target_organization_policies`, `inbox_response_target_reminders`, `inbox_user_views`.
- `invitation`, `invited_registration_attempts`, `material_review_revisions`, `member`, `merchant_ai_consent_evidence`, `merchant_ai_enablement`, `metric_corrections`, `metric_current_google_reputation_snapshots`, `metric_definition_versions`, `metric_definitions`, `metric_readings`, `metric_source_watermarks`, `notification_digest_batch_members`, `notification_digest_batches`, `notification_email_queue`, `notification_preferences`, `notification_user_settings`, `notifications`, `operational_action_history_heads`, `operational_action_history_legal_holds`.
- `operational_action_history_records`, `organization`, `organizationRole`, `organization_capability`, `organization_export_retrieval_issuances`, `organization_exports`, `organization_lifecycle_authority`, `organization_lifecycle_command_receipts`, `organization_policy`, `organization_role_policy`, `outbox_events`, `permission_version`, `policy_consent`, `policy_version`, `portal_access_artifacts`, `portal_approved_destinations`, `portal_group_memberships`, `portal_groups`, `portal_health_intervals`, `portal_link_categories`.
- `portal_links`, `portal_localized_overrides`, `portal_metric_lifetime_aggregates`, `portal_pending_content_changes`, `portal_publication_activations`, `portal_publication_snapshots`, `portal_responsibilities`, `portal_responsible_managers`, `portal_tokens`, `portal_upload_issuances`, `portals`, `properties`, `property_access_grant`, `property_capability`, `property_erase_authorities`, `property_erase_context_receipts`, `property_operation_receipts`, `property_policy`, `property_portal_brand_contents`, `property_portal_brand_profiles`.
- `property_responsible_managers`, `recent_activity_actor_label_redactions`, `recent_activity_entries`, `recent_activity_replay_facts`, `recovery_runs`, `region_moves`, `replies`, `reply_publication_attempts`, `reply_publication_authorizations`, `review_ai_analysis_heads`, `review_lifecycle_recovery_executions`, `review_provider_deletion_candidates`, `review_provider_snapshot_members`, `review_provider_snapshot_runs`, `review_provider_subject_hmac_key_versions`, `review_provider_subjects`, `review_refresh_runs`, `review_source_contents`, `review_source_observations`, `review_sync_state`.
- `reviews`, `session`, `setup_checklist_milestones`, `staff_participants`, `staff_participations`, `staff_user_links`, `user`, `user_organization_bindings`, `verification`.

**Written by production code but with no production query reader (6):** `ai_product_volume_consumptions`, `audit_logs`, `guest_contact_request_reveal_audits`, `guest_destination_action_receipts`, `inbound_webhook_receipts`, `review_google_reputation_snapshot_facts`.

**Evidence/audit-only (8):** `ai_governance_policies`, `backup_erasure_hold_releases`, `backup_erasure_ledger`, `policy_decision_audit`, `privacy_request_transitions`, `privacy_requests`, `recent_activity_vocabulary_reconciliations`, `retention_runs`. Some are read by operational fences/alerts; none is a tenant product projection. The two privacy-request tables are currently schema/trigger evidence with no production producer or reader.

**Legacy/quarantined (39):**

- `_rollup_watermarks`, `badge_awards`, `badge_definition_versions`, `badge_definitions`, `feedback`, `gbp_cache`, `gbp_import_jobs`, `gbp_import_legacy_history`, `goal_progress`, `goals`, `guest_response_media`, `leaderboard_entries`, `leaderboard_snapshots`, `legacy_import_control`, `legacy_import_effect_leases`, `metric_quarantine`, `notification_governance_quarantine`, `notification_preference_governance_quarantine`.
- `organization_badge_enablements`, `portal_group_members`, `property_access_grants`, `ratings`, `recognition_activation_groups`, `recognition_activations`, `recognition_award_status_facts`, `recognition_awards`, `recognition_board_entries`, `recognition_board_snapshots`, `recognition_reconciliation_events`, `review_source_provenance_quarantine`, `review_sync_runs`, `rollup_daily_inbox_metrics`, `rollup_daily_metrics`, `rollup_weekly_metrics`, `scan_events`, `staff_assignments`, `team_memberships`, `team_portal_group_scopes`, `teams`.

Thirty-eight are directly classified by the fate/contraction/quarantine authorities; `review_sync_runs` is added by runtime inspection because production has neither an INSERT producer nor a SELECT reader—only retention/lifecycle DELETEs—despite being declared `active_authority` beside live sync state (`src/shared/governance/data-fate-authority.ts:765-776`).

**Why it matters.** This is the first defensible denominator for “what remains”: declarations alone had hidden compatibility schemas, auth ownership, DB-only constructs, and runtime-dark rows.

**Recommendation.** Generate this inventory from schema reflection plus runtime query reachability in one gate; fail when a declared active table has no producer or reader, and require an explicit `uniqueness_receipt`/`audit_evidence` exception rather than calling every row an active authority.

**Cost/risk of the fix.** Low implementation cost; moderate ownership work to approve exceptions. The risk is false positives around PL/pgSQL-only readers, so the gate must include registered function bodies and Better Auth ownership.

### DATA-A02 The migration journal and deploy entry point are mechanically coherent

**Evidence.** A journal/file audit returned:

```text
entries=178, sql_files=178, idx_contiguous=true, unique_tags=true,
journal_equals_sql=true, prefix_matches_idx=true, when_strictly_increasing=true,
first=0000_init, last=0177_google_permit_release_decoupling
```

The deploy runner applies Better Auth, a staged Drizzle journal, the concurrent Google-binding index, registered SQL sidecars, privilege isolation, provider-key initialization, and state readback under a session advisory lock (`scripts/migrate-deploy.ts:1-38,120-179,200-220`). Production authorization happens before opening `DATABASE_URL` and is limited to the US cell and two named services (`src/shared/db/deploy-migration-runtime.ts:31-90`). The staged runner owns the historical enum commit boundary and journal writes (`src/shared/db/staged-drizzle-migrator.ts:132-158,240-273`).

**Why it matters.** This directly improves the old positive baseline of only 0–77 contiguous migrations (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:356-380`) and gives deployment one real migration authority.

**Recommendation.** Keep this path; add a current empty-database evidence artifact at head and production-catalog drift readback before claiming zero-to-head or no hand DDL.

**Cost/risk of the fix.** Low code risk; requires a disposable PostgreSQL run and a read-only production credential in release automation.

### DATA-A03 `ai_property_daily_aggregates` is no longer write-only

**Evidence.** A real GET server function resolves tenant context and authorization before invoking the AI read API (`src/contexts/ai/server/property-aggregates.ts:31-50`). The use case fixes organization, property, source epoch, analysis epoch, profile and local-date window (`src/contexts/ai/application/use-cases/read-property-aggregates.ts:66-108`); the adapter applies all those predicates to `ai_property_daily_aggregates` (`src/contexts/ai/infrastructure/adapters/ai-property-aggregate-store.adapter.ts:837-857`); and the Property dashboard component executes the query (`src/components/features/property/property-ai-aggregate-section.tsx:24-43`).

**Why it matters.** This closes the pre-rewrite “written but never read” concern for that named AI table through a route → use case → adapter → UI chain, not a catalogue assertion.

**Recommendation.** Protect the chain and its epoch-completeness fence; do not fold this table into the unrelated legacy Metric rollups.

**Cost/risk of the fix.** None; regression risk is a future UI/capability cutover leaving the table dark again.

### DATA-A04 AI derivative erasure is reachable and correctly scoped

**Evidence.** The fixed contract requires local derivative erasure within 24 hours (`docs/comprehensive-beta-implementation-program-2026-08-25.md:92-96`), and the deadline constant is exactly 24 hours (`src/contexts/ai/application/ports/ai-review-analysis-enrollment.port.ts:8-10`). The enabled schedule runs every five minutes (`src/shared/governance/event-job-catalogue.ts:2847-2862`). Its handler records deleted counts and fails when overdue or recovery is exhausted (`src/shared/jobs/ai-authorization-erasure.job.ts:19-43,53-125`); the adapter deletes exact organization/property/retired-epoch trend, aggregate, and analysis rows (`src/contexts/ai/infrastructure/adapters/ai-authorization-erasure.adapter.ts:128-221`).

**Why it matters.** This is an executable lifecycle, not just a retention declaration, and it preserves content-free evidence while refusing an overdue backlog.

**Recommendation.** Keep it load-bearing; release evidence should read back `retention_runs` and overdue backlog.

**Cost/risk of the fix.** Only operational proof is missing; code changes are not indicated.

## What is genuinely good

### DATA-G01 Application tenant predicates are consistent across the 15-table sample

**Evidence.** Every sampled repository applies organization scope, and property scope where the operation requires it: Property (`src/contexts/property/infrastructure/repositories/property.repository.ts:68-99`), Review (`src/contexts/review/infrastructure/review-command-store.ts:193-223`), Reply (`src/contexts/review/infrastructure/review-command-store.ts:54-90`), Inbox (`src/contexts/inbox/infrastructure/repositories/inbox.repository.ts:130-153`), Guest Response (`src/contexts/guest/infrastructure/repositories/guest-response.repository.ts:61-110`), Contact (`src/contexts/guest/infrastructure/repositories/contact-request.repository.ts:262-305`), Portal/Group (`src/contexts/portal/infrastructure/repositories/portal.repository.ts:116-133`; `portal-group.repository.ts:16-38`), Metric (`src/contexts/metric/infrastructure/metric-command-store.ts:121-150`), Goal (`src/contexts/goal/infrastructure/repositories/goal-program.repository.ts:363-389`), Notification (`src/contexts/notification/infrastructure/repositories/notification.repository.ts:38-75`), Google (`src/contexts/integration/infrastructure/repositories/google-connection.repository.ts:31-68`), AI adoption validation (`src/contexts/review/infrastructure/ai-suggested-draft-store.ts:224-277`), Staff (`src/contexts/staff/infrastructure/repositories/staff-participation.repository.ts:202-220`), and Operational Action History (`src/contexts/activity/infrastructure/operational-action-history-store.ts:222-234`).

**Why it matters.** The pre-review found no concrete query leak but warned that this was not database proof (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:348-354`). The application layer remains a strong defense even where physical constraints lag.

**Recommendation.** Preserve predicate tests while adding the five missing physical relationships in DATA-I01.

**Cost/risk of the fix.** Low for retaining current behavior.

### DATA-G02 Two “write-only” tables are deliberately useful uniqueness receipts

**Evidence.** `guest_destination_action_receipts` returns whether a composite dedupe insert won before emitting a click fact (`src/contexts/guest/infrastructure/guest-observation-store.ts:208-248`). `inbound_webhook_receipts` returns whether the Pub/Sub message insert won and co-commits its outbox handoff (`src/contexts/integration/infrastructure/gbp-review-push-receipt.store.ts:6-33`). Neither needs a later SELECT: the unique constraint and INSERT result are the read.

**Why it matters.** “Zero reader” is not automatically dead; deleting these would reintroduce duplicate click/webhook effects.

**Recommendation.** Keep them, classify them explicitly as bounded uniqueness receipts, and retain their 24-hour/30-day cleanup rules.

**Cost/risk of the fix.** Documentation/catalogue-only; deletion would be high risk.

### DATA-G03 Contraction inventory is honest about destructive preconditions

**Evidence.** The registry derives candidates from the fate authority and fails uncovered or multiply claimed tables (`src/shared/governance/contraction-inventory-registry.ts:1-26`). It names commands for 26 bounded-contraction and seven compatibility-read tables, including four rollup objects (`src/shared/governance/contraction-inventory-registry.ts:78-163`). The rollup report itself reads exact counts and FK metadata in one repeatable-read, read-only snapshot (`src/contexts/metric/infrastructure/legacy-rollup-inventory.repository.ts:174-194`) and refuses contraction while rows/dependencies remain (`src/contexts/metric/application/legacy-rollup-inventory.ts:231-275`).

**Why it matters.** With one tenant, preserving recoverability is more important than performing cosmetic drops. The completion plan correctly keeps physical contraction open until a verified release/restore proof (`docs/program-completion-plan-2026-08-29.md:165-171,197-203`).

**Recommendation.** Keep the preconditions, but stop active rollup writers now; “do not drop yet” does not require “continue recomputing unused data.”

**Cost/risk of the fix.** Low to disable writers; contraction remains gated.

### DATA-G04 The schema comparator is materially deeper than a name check

**Evidence.** It compares columns, types, defaults, PK/unique/check/FK actions, ordered/expression/partial indexes, enums, journal count and file hashes, and registered/unregistered database objects (`src/shared/db/schema-drift.ts:1-18,1046-1155,1176-1231`). The standalone command exits nonzero on drift (`scripts/check-schema-drift.ts:17-39`), and CI runs it after migrating a fresh PostgreSQL database (`.github/workflows/ci.yml:194-215`).

**Why it matters.** This is load-bearing protection against model/journal divergence and is much stronger than the governance catalogues criticized by the pre-review.

**Recommendation.** Preserve the comparator; close its view and production-target gaps in DATA-I03.

**Cost/risk of the fix.** Low.

## What should be improved

### DATA-I01 Five of 15 representative tenant tables still lack physical tenant-bound relationships

**Severity: high.**

**Evidence.** Schema reflection of the sample found this boundary matrix:

| Table                                | Physical organization/property boundary                                                                                                             | Repository scope                                          | Result                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------ |
| `properties`                         | `(organization_id,id)` unique tenant anchor (`src/shared/db/schema/property.schema.ts:22-112`)                                                      | org + id + cell                                           | strong anchor                  |
| `reviews`                            | `organization_id` exists, but `property_id → properties.id` is single-column (`src/shared/db/schema/review.schema.ts:54-70`)                        | org + property + id (`review-command-store.ts:210-221`)   | **app-only relationship**      |
| `replies`                            | `organization_id` exists, but `review_id → reviews.id` is single-column (`review.schema.ts:883-890`)                                                | org + review (`review-command-store.ts:73-88`)            | **app-only relationship**      |
| `inbox_items`                        | org/property indexes and scoped source unique; no FK (`src/shared/db/schema/inbox.schema.ts:38-108`)                                                | org and optional property (`inbox.repository.ts:150-154`) | **app-only relationship**      |
| `guest_responses`                    | composite portal/property/organization FK (`src/shared/db/schema/guest.schema.ts:405-409`)                                                          | org + property + portal                                   | strong                         |
| `guest_contact_requests`             | composite portal scope FK (`guest.schema.ts:856-860`)                                                                                               | org + property + portal                                   | strong                         |
| `portals`                            | composite property tenant FK (`portal.schema.ts:68-72`)                                                                                             | `baseWhere(org)` + id                                     | strong                         |
| `portal_groups`                      | composite property tenant FK (`portal-group.schema.ts:33-37`)                                                                                       | org + property                                            | strong                         |
| `metric_readings`                    | base property/portal/group FKs are single-column; composite FKs apply only when Staff attribution is populated (`metric.schema.ts:128-137,222-253`) | org + property in governed writes                         | **app-only base relationship** |
| `goal_programs`                      | composite property FK (`goal.schema.ts:486-490`)                                                                                                    | org + property + id                                       | strong                         |
| `notifications`                      | composite property tenant FK (`notification.schema.ts:80-82`)                                                                                       | user + org + optional property                            | strong                         |
| `google_connections`                 | Organization-owned `(organization_id,id)` unique anchor (`google-connection.schema.ts:83-84,126-130`)                                               | org + id                                                  | strong anchor                  |
| `ai_operations`                      | composite property tenant FK (`ai.schema.ts:786-788`)                                                                                               | exact tenant fields validated before adoption             | strong                         |
| `staff_participations`               | composite property and participant tenant FKs (`people-access.schema.ts:195-199`)                                                                   | org + participation                                       | strong                         |
| `operational_action_history_records` | org/property columns and org indexes, no property FK (`activity.schema.ts:239-289`)                                                                 | org + optional property                                   | **app-only relationship**      |

A direct constraint-name search found no `reviews_*tenant_fk`, `replies_*tenant_fk`, `inbox_items_*tenant_fk`, `metric_readings_property_tenant_fk`, or `operational_action_history_*tenant_fk`. Thus application bugs/direct SQL can persist a row whose organization and related Property/Review disagree. This is the same class as prior DATA-10 (`...consolidated-2026-08-24.md:367-373`), not fully fixed.

**Why it matters.** Cross-tenant inconsistent rows break the physical isolation invariant and can later be exposed by a correctly organization-scoped query because the row's duplicated organization key is itself wrong.

**Recommendation.** In expand migrations, add supporting composite uniques where absent, report mismatches, repair to zero, then add `NOT VALID` composite FKs and validate: `(organization_id,property_id)` for reviews/inbox/metric/activity and `(organization_id,review_id)` for replies. Keep existing repository predicates as defense in depth.

**Cost/risk of the fix.** Medium: five reports/backfills and online constraint validation. Risk is discovering real mismatches; that is evidence to reconcile, not a reason to retain the gap.

### DATA-I02 The Drizzle generation boundary omits 12 application-owned tables

**Severity: medium.**

**Evidence.** `migratable.ts` claims every app-owned table and lockstep with the full barrel (`src/shared/db/schema/migratable.ts:1-12`), and `drizzle.config.ts` derives both schema and `tablesFilter` from it (`drizzle.config.ts:11-30`). Reflection returned `full=237`, `managed=217`; after excluding eight auth mirrors, these 12 unexpected omissions remain:

```text
backup_erasure_hold_releases, backup_erasure_ledger,
context_organization_lifecycle_receipts, identity_organization_lifecycle_receipts,
organization_export_retrieval_issuances, organization_exports,
organization_lifecycle_authority, organization_lifecycle_command_receipts,
privacy_request_transitions, privacy_requests,
property_erase_authorities, property_erase_context_receipts
```

The full drift comparator imports `./schema` (`src/shared/db/schema-drift.ts:24-29`), so existing SQL can still compare correctly, but future `db:generate` changes to these tables are invisible to the declared generation authority.

**Why it matters.** These are precisely high-consequence lifecycle, privacy, export, and erase tables. A developer can edit their Drizzle schema and receive no migration, contradicting the source comment and clean workflow.

**Recommendation.** Export the six missing schema modules from `migratable.ts`; add a bidirectional gate that compares full app table names (full barrel minus auth) to the migratable set.

**Cost/risk of the fix.** Low code cost. Run `db:generate` only in a controlled scratch branch because correcting ownership may expose pre-existing drift; do not accept generated destructive SQL blindly.

### DATA-I03 Drift CI cannot detect hand-applied production DDL, and the sole view is only documented

**Severity: medium.**

**Evidence.** CI migrates a disposable localhost database then runs the comparator against it (`.github/workflows/ci.yml:194-215`). A repository-wide invocation search found `check:schema-drift` only in that CI job and the standalone operator script; no release/predeploy production invocation exists. Therefore hand-applied production DDL can leave CI green. Separately, `activity_log` is registered as kind `other` (`src/shared/db/schema/db-only-constructs.ts:47-55`); the comparator explicitly returns no catalog for `other` (`src/shared/db/schema-drift.ts:1066-1085`) while any registered name exempts a view from the unregistered check (`schema-drift.ts:1144-1153`). A missing compatibility view would therefore pass.

**Why it matters.** CI proves repository self-consistency, not production parity. The view is described as a rolling-deploy compatibility path, so its absence could break an old binary exactly when needed.

**Recommendation.** Add a read-only production schema-drift release check (or catalog digest/readback) after migration and before traffic; add a verifiable `view` construct kind with normalized definition, or drop the view and registry row once the rolling window is proved closed.

**Cost/risk of the fix.** Medium operational risk: production credentials must be read-only and comparator queries bounded. View normalization needs a small comparator extension.

### DATA-I04 Migration hygiene is coherent at head but does not consistently obey the program’s deployment shape

**Severity: medium.**

**Evidence.** The plan forbids adding and dropping a consequential representation in one deployment and requires one verified deployment plus restore proof before contraction (`docs/comprehensive-beta-implementation-program-2026-08-25.md:128-138,156-158`). Migration 0101 creates session/private-feedback tables, backfills them, then drops `guest_responses.session_id` and `response_text` in the same file (`drizzle/0101_guest_response_retention_classes.sql:5-33,35-88,90-109`). Migration 0054 creates the new AI trend outcome/schedule model and drops `ai_property_trend_reports CASCADE` in the same migration, with no old-row parity/backfill in that file (`drizzle/0054_rare_hercules.sql:1-94`). Static journal scanning found three `DROP TABLE` statements (one is a temporary 0092 map), nine `DROP COLUMN`, and 21 `SET NOT NULL`; the problem is not the count but these consequential single-deploy contractions.

The latest migration is not a data migration: `wc -lc` reports **924 lines / 46,821 bytes**. It replaces three PL/pgSQL permit functions (`drizzle/0177_google_permit_release_decoupling.sql:61-66,529-543,769-783`) solely to remove four release-SHA predicates while preserving an old sidecar ABI (`:1-59`). This is a reasonable hotfix, but it makes a small policy change review as three copied function bodies.

A migration identifier scan found five retired table identities (`activity_log` as table, `ai_control_heads`, `ai_control_history`, `ai_property_calendar_catalogues`, `ai_property_trend_reports`) referenced across eight migrations, and the six write-only tables referenced across seven; their union is **14 of 178 migrations**. Four retired names are legitimate rename history and one is a drop; this prices journal history rather than proving a defect.

**Why it matters.** Same-deployment contraction removed the observation/rollback interval the rewrite explicitly required. Large copied functions increase review surface for tiny control changes.

**Recommendation.** Enforce a migration-shape gate for new consequential drops: require an earlier-journal cutover evidence reference and restore proof. Store canonical PL/pgSQL function sources in reviewable generated inputs and verify generated migration bytes, while keeping applied SQL immutable.

**Cost/risk of the fix.** Medium process/tooling cost; do not rewrite the applied journal. Future cutovers become slower by one deployment, intentionally.

### DATA-I05 Journal timestamps are synthetic future ordering keys, not trustworthy chronology

**Severity: low.**

**Evidence.** `_journal.json` entry 0106 uses `when=1788364800000` (`drizzle/meta/_journal.json:750-752`), and 0177 uses `1790524800046` (`:1247-1249`). Conversion gives 2026-09-02T16:00Z and 2026-09-27T16:00:00.046Z. **71 entries (0107–0177) are on calendar dates after 2026-09-02; 72 entries (0106–0177) are at or after Sep 2 16:00.** The sequence is strictly increasing and operationally valid, but cannot be read as author/deploy time.

**Why it matters.** Runbooks and incident review can misread a synthetic `created_at` as historical deployment chronology; the staged migrator also uses it as the skip key (`src/shared/db/staged-drizzle-migrator.ts:246-271`).

**Recommendation.** Explicitly document `when` as an immutable ordering ID, and use git/deploy evidence for chronology. Do not renumber applied entries.

**Cost/risk of the fix.** Trivial documentation/gate wording.

### DATA-I06 Current schema authority documentation is 37 migrations and 47 managed tables behind

**Severity: low.**

**Evidence.** The nearest DB context still says journal 0000–0140, 141 entries, 195 app tables, 203 total (`src/shared/db/CONTEXT.md:10-15,103-113`); `docs/auth-migrations.md` repeats 195 (`docs/auth-migrations.md:15-25`). Current facts are 0000–0177, 178 journal entries, 234 app-owned physical tables plus eight auth tables, while the actual generation barrel exposes only 217.

**Why it matters.** The rewrite’s governance goal requires current counts, and these specific wrong numbers obscure DATA-I02.

**Recommendation.** Generate counts from the same reflection used by the coverage gate; avoid hand-maintained totals.

**Cost/risk of the fix.** Low.

## What needs substantial change

### DATA-S01 The dead Metric rollup subsystem is still actively scheduled

**Severity: medium.**

**Evidence.** The original three matviews were created in 0004 (`drizzle/0004_materialized-views-and-gbp-index.sql:11-63`) and removed in 0008, but were replaced by `rollup_daily_metrics`, `rollup_weekly_metrics`, `rollup_daily_inbox_metrics`, and `_rollup_watermarks` (`src/shared/db/schema/rollup.schema.ts:10-68`). The writer reads/advances watermarks and DELETE+INSERT rebuilds all three (`src/contexts/metric/infrastructure/incremental-rollup.ts:42-89,97-139,147-189,197-239`). Bootstrap registers all handlers (`src/bootstrap.ts:408-417`), and schedules are enabled hourly/daily/hourly (`src/shared/governance/event-job-catalogue.ts:2763-2797`). Yet the owning context explicitly states there is no production reader and removal remains MET-01 work (`src/contexts/metric/CONTEXT.md:165-170`).

The `ops:report-legacy-rollups` artifact measures exactly four table counts, FKs, blockers and a fingerprint; it intentionally reads no keys/values (`src/contexts/metric/application/legacy-rollup-inventory.ts:4-16,41-58,231-275`). It does **not** establish freshness, job execution, serving-reader absence at the current SHA, source parity, or repair/replay behavior. The old review named this subsystem as a deletion candidate (`/Users/bozhidardenev/tmp/rep-key-comprehensive-review-consolidated-2026-08-24.md:764-779`), and the plan explicitly required deletion after proof (`docs/comprehensive-beta-implementation-program-2026-08-25.md:105,917`).

**Why it matters.** Three recurring jobs continually write data no beta path consumes, adding operational failure/retention surface and preserving a second analytics model beside governed Metric. This is the pre-review “architecture exists, runtime truth differs” failure, not a harmless dormant table.

**Recommendation.** Immediately remove the three schedules and bootstrap handlers (no schema contraction required). At the current SHA, run the inventory plus a full route/server/job/bundle reader search and a governed Metric parity report; export/restore if rows exist; then drop the four tables in a later migration after the required verified deployment. Do not replace them with another projection unless it has a named consumer, freshness SLO, replay and repair.

**Cost/risk of the fix.** Disabling writers is low risk because the owner says no reader exists; physical deletion is medium risk and remains gated by row counts/export/restore.

### DATA-S02 The retention “registry” and executing policy are two different authorities

**Severity: medium.**

**Evidence.** The registry documents all rules as counsel-pending and apply-refused/report-only (`docs/operations/retention-registry.md:19-22,41-57`). The actual daily handler instead defaults to the independent `RETENTION_RULES` array (`src/shared/jobs/retention-sweep.job.ts:75-145,146-273,457-481`): 28 static destructive/redaction subjects, plus embedded Guest Contact and Google import sweeps. Its refusal loop only examines `deps.registryApplyRules`; production does not pass that field (`src/bootstrap.ts:446-457`), so the registry guard checks zero rules while the static array executes. The job is enabled daily (`src/shared/governance/event-job-catalogue.ts:2815-2829`).

Executing coverage is real and partly excellent: private feedback and session bindings delete on row deadlines, `guest_responses` deletes at 24 months, network pseudonyms at seven days, and legacy IP/session mirrors redact at seven/one day (`src/shared/jobs/retention-sweep.job.ts:75-145`). Contact is separately swept (`:337-373`). But the registry claims its single `guest_responses` rule covers rating, qualified scan, destination click, correction and withdrawal (`src/shared/db/retention/retention-registry.ts:326-355`). Physically, `guest_qualified_scans` is a separate table with `occurred_at` but no retention deadline (`src/shared/db/schema/guest.schema.ts:48-87`), and click facts live as `metric_readings.portal_destination_kind` (`src/shared/db/schema/metric.schema.ts:145-170`); neither table appears in the executor’s 24-month rules. Thus “coveredFacts” overstates execution.

**Why it matters.** Operators cannot answer “what will be deleted tonight?” from the supposed authority, and a policy can be pending/refused on paper while code deletes. Separately stored deidentified facts can outlive the fixed 24-month contract indefinitely.

**Recommendation.** Replace the bifurcation with one typed executable registry from which report and apply projections are generated. Each rule must map to exact table/columns/operation and approval state; production startup must refuse unknown or pending destructive rules. Add row deadlines/sweeps for `guest_qualified_scans` and retained click/correction/withdrawal source facts, or explicitly change the approved matrix. Preserve anonymous lifetime aggregates by applying corrections before purge.

**Cost/risk of the fix.** Medium-high: policy/data mapping across Guest and Metric plus backfilled deadlines. Roll out report-only, compare eligible row counts, canary the single tenant, then apply; premature deletion is irreversible.

### DATA-S03 The fate catalogue calls several write-only/dormant models active

**Severity: medium.**

**Evidence.** A static query-shape audit scanned 2,361 non-test TS/TSX production files under `src`, `scripts`, and `services`, plus raw SQL query forms, and returned:

```text
ai_product_volume_consumptions       read_sites=0 write_sites=3
 audit_logs                          read_sites=0 write_sites=13
guest_contact_request_reveal_audits  read_sites=0 write_sites=3
 guest_destination_action_receipts   read_sites=0 write_sites=2
inbound_webhook_receipts             read_sites=0 write_sites=2
review_google_reputation_snapshot_facts read_sites=0 write_sites=2
```

Lifecycle DELETEs are included in write-site counts; each table also has a real INSERT producer: AI output (`src/contexts/ai/infrastructure/adapters/ai-output-store.adapter.ts:697-740`), Goal/Identity audit (`src/contexts/goal/infrastructure/repositories/goal-program.repository.ts:319-344`), audited contact reveal (`src/contexts/guest/infrastructure/repositories/contact-request.repository.ts:349-376`), click/webhook receipts (`guest-observation-store.ts:226-248`; `gbp-review-push-receipt.store.ts:14-32`), and reputation snapshot fact (`src/contexts/review/infrastructure/repositories/review-provider-snapshot.repository.ts:257-297`). `review_sync_runs` is worse: no production INSERT or SELECT, only deletion, despite `active_authority` classification (`src/shared/governance/data-fate-authority.ts:765-776`). The catalogue also classifies `ai_product_volume_consumptions` as active (`data-fate-authority.ts:159-198`) and `audit_logs` as recoverable archive even while new Goal writes continue (`:215-221`).

**Why it matters.** The six rows are not equivalent. Two are load-bearing insert-result uniqueness receipts (DATA-G02); two are intentional evidence but lack any application/operator read; two duplicate data without a named consumer. `review_google_reputation_snapshot_facts` duplicates the outbox fact in the same transaction (`review-provider-snapshot.repository.ts:276-297`), and AI token counts also exist on operation attempts (`src/shared/db/schema/ai.schema.ts:944-963`). Treating all as “active authority” prevents the convergence decision.

**Recommendation.** Keep and explicitly classify the two uniqueness receipts. Keep reveal/audit evidence only with an approved horizon and named operator/export retrieval path; otherwise stop writing it. Delete `ai_product_volume_consumptions` and use attempt settlement facts, or wire a real quota/billing reader. Delete the reputation snapshot table and replay the durable event, or make it the documented replay/repair source—not both. Stop producing new `audit_logs` once Operational Action History parity covers Goal/Identity; retain the old archive until its horizon. Move `review_sync_runs` to bounded contraction.

**Cost/risk of the fix.** Medium: receipt exceptions are cheap; audit/action-history parity and snapshot replay proof require data comparison. Do not drop rows before inventory/export/restore.

## Proportionality ledger

- **Tenant reality:** one organization, six properties. **Physical machinery:** 242 tables, 39 enums, 491 explicit secondary indexes, 707 checks, 316 FKs, 114 registered functions, 142 registered triggers, eight DB-only/exclusion indexes, three DB-only checks, and one compatibility view. That is 40.3 tables per live Property, 2.0 explicit secondary indexes/table, 2.9 checks/table, and 1.1 registered DB-only constructs/table; the ratios price complexity, not usefulness.
- **Serving shape:** 189 active/control tables (78.1%), six write-only (2.5%), eight evidence/audit-only (3.3%), and 39 legacy/quarantined (16.1%). The executable contraction registry covers 33 of those 39; the rest are explicit quarantines plus the misclassified dormant `review_sync_runs`.
- **Migration weight:** 178 SQL migrations contain **34,270 lines / 2.03 MiB**. Over the 2026-08-19→09-02 rewrite window this is roughly 11.9 journal entries/day. Migration 0177 alone is 924 lines/45.7 KiB for four predicate removals across three functions, though it is not among the five largest SQL files.
- **Chronology debt:** 71 journal entries are dated on later calendar days than the review date. They work as ordering keys but not historical timestamps.
- **Dark recurring cost:** three enabled rollup schedules maintain four non-serving tables. Even with zero new facts they read/update watermarks; with facts they DELETE+recompute partitions. Tenant scale does not justify this when the named consumer count is zero.
- **Retention surface:** one daily job executes 28 static table rules plus two embedded owner sweeps; five additional lifecycle/retention job states exist (AI erasure active, queue quarantine TTL active, Review expiry/tombstone jobs unscheduled or quarantined, export purge quarantined). At one tenant this is manageable only if one registry—not two—answers what deletes.
- **Schema-generation gap:** 12 high-consequence app tables are outside the claimed generation barrel (5.0% of all physical tables). This is disproportionate risk because they concentrate lifecycle/privacy/export obligations.
- **Historical/dark journal references:** 14/178 migrations (7.9%) mention a retired table identity or one of the six write-only tables. Most are legitimate immutable history; the number shows why present reachability must not be inferred from journal mentions.

## Unverified / needs a runtime check

- **Current zero-to-head provisioning.** The latest recorded empty-Postgres proof reached 189 tables and 130 journal rows on 2026-08-27 (`docs/ba-fresh-db-provisioning.md:7-19`). It does not prove migrations 0130–0177. Verify with an empty PostgreSQL instance using the production `pnpm db:migrate-deploy` path, then `check:schema-drift`; no server/test suite is needed.
- **Production physical parity and exact implicit-index total.** Static sources establish the expected model counts above, not live `pg_catalog`. Run the read-only comparator against production and record tables/enums/indexes/checks/FKs/views plus journal hashes. This also answers whether hand DDL exists.
- **Rollup row counts/parity.** Run `ops:report-legacy-rollups` on production, then separately record last job executions, watermark age, and governed-source parity; the inventory command alone deliberately does not read values or serving reachability.
- **Write-only row volume.** Query row counts/oldest/newest timestamp for the six tables and `review_sync_runs`; static reachability proves query shape, not whether production accumulated rows.
- **Retention execution evidence.** Read recent `retention_runs` for all 28 subjects, Guest Contact, Google import and AI erasure; verify no overdue AI lifecycle record and inspect eligible-but-unprocessed counts. Registration is not proof that Redis dispatched successfully.
- **24-month correction/withdrawal ordering.** A production-shaped time-travel exercise must show corrections/withdrawals reach `portal_metric_lifetime_aggregates` before all corresponding Guest/Metric source facts purge.
- **Migration 0054/0101 upgrade outcome.** No retained upgrade report proves old trend/private-feedback rows were complete and restorable at contraction. Verify archived deployment evidence/backups; do not infer safety from the final schema.
- **Constraint backfill cleanliness.** Before adding five composite tenant FKs, run mismatch reports on production. This review did not access live tenant rows.

## Opinion (clearly separated, short)

The database is over-modeled for a one-tenant closed beta, but the right simplification is not indiscriminate table deletion. Keep composite integrity, idempotency receipts, lifecycle fences, and the semantic drift comparator; delete duplicate/dark projections and collapse the two retention authorities. A smaller model with 200 trustworthy tables is more valuable than a 242-table catalogue that calls every declaration active.
