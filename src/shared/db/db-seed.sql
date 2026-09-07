-- Seed rows the schema cannot derive.
--
-- The 182 historical migrations carried 145 INSERT statements. Most were
-- one-off backfills over rows that a fresh database does not have, but some
-- seeded catalogues and control singletons the runtime requires at boot: the
-- Data Cell topology cutover row, the AI operation/provider/routing
-- catalogues, the metric registry, and the identity invitation fact contract.
-- A DDL-only baseline silently drops them, and the first thing that notices is
-- a permit authority refusing with "topology cutover authority is unavailable".
--
-- Captured as the RESULT of a full migration rather than by replaying the
-- inserts: whatever a freshly-migrated database holds with no application
-- traffic is exactly the seed set. Regenerate the same way (pg_dump
-- --data-only --column-inserts over the non-empty tables) if a seed changes.
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a001', 1, 'global', 'global', NULL, 'enabled', 'migration_seed', NULL, '2026-08-16 03:00:00+03', NULL, 'accepting', 'migration-0048', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a002', 1, 'provider:private-beta-global-v1', 'provider_deployment_profile', 'private-beta-global-v1', 'enabled', 'migration_seed', NULL, '2026-08-16 03:00:00+03', NULL, 'accepting', 'migration-0048', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a003', 1, 'capability:property_trends', 'capability', 'property_trends', 'killed', 'migration_seed', NULL, '2026-08-16 03:00:00+03', NULL, 'draining', 'migration-0048', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a004', 1, 'capability:reply_drafting', 'capability', 'reply_drafting', 'killed', 'migration_seed', NULL, '2026-08-16 03:00:00+03', NULL, 'draining', 'migration-0048', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a005', 1, 'capability:review_analysis', 'capability', 'review_analysis', 'killed', 'migration_seed', NULL, '2026-08-16 03:00:00+03', NULL, 'draining', 'migration-0048', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('global', 'global', NULL, '00000000-0000-4000-8000-00000000a001', 1, 'enabled', '2026-08-16 03:00:00+03', 'accepting');
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('provider:private-beta-global-v1', 'provider_deployment_profile', 'private-beta-global-v1', '00000000-0000-4000-8000-00000000a002', 1, 'enabled', '2026-08-16 03:00:00+03', 'accepting');
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('capability:property_trends', 'capability', 'property_trends', '00000000-0000-4000-8000-00000000a003', 1, 'killed', '2026-08-16 03:00:00+03', 'draining');
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('capability:reply_drafting', 'capability', 'reply_drafting', '00000000-0000-4000-8000-00000000a004', 1, 'killed', '2026-08-16 03:00:00+03', 'draining');
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('capability:review_analysis', 'capability', 'review_analysis', '00000000-0000-4000-8000-00000000a005', 1, 'killed', '2026-08-16 03:00:00+03', 'draining');
--> statement-breakpoint
INSERT INTO ai_property_trend_scheduler_heads (scheduler_key, generation, cursor_organization_id, cursor_property_id, lease_owner, claimed_at, lease_expires_at, updated_at) VALUES ('property-trend-v1', 0, NULL, NULL, NULL, NULL, NULL, '2026-09-05 23:07:05.351486+03');
--> statement-breakpoint

--> statement-breakpoint
INSERT INTO capability_execution_control (capability, denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at, operator_id, reason, updated_at) VALUES ('property.import_gbp_v2', true, 1, '2026-09-05 23:07:05.116845+03', NULL, NULL, NULL, 'migration_default_deny', '2026-09-05 23:07:05.116845+03');
--> statement-breakpoint
INSERT INTO capability_execution_control (capability, denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at, operator_id, reason, updated_at) VALUES ('property.read_gbp_performance', true, 1, '2026-09-05 23:07:05.116845+03', NULL, NULL, NULL, 'migration_default_deny', '2026-09-05 23:07:05.116845+03');
--> statement-breakpoint
INSERT INTO capability_execution_control (capability, denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at, operator_id, reason, updated_at) VALUES ('property.connect_gbp', true, 1, '2026-09-05 23:07:05.351486+03', NULL, NULL, 'migration:0124', 'organization_ownership_expand_default_deny', '2026-09-05 23:07:05.351486+03');
--> statement-breakpoint
INSERT INTO capability_execution_control (capability, denied, emergency_kill_version, denied_at, drained_at, cleanup_drained_at, operator_id, reason, updated_at) VALUES ('property.publish_reply', true, 1, '2026-09-05 23:07:05.351486+03', NULL, NULL, 'migration:0124', 'reply_publication_provider_authority_default_deny', '2026-09-05 23:07:05.351486+03');
--> statement-breakpoint
