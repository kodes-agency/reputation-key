-- Compatible streaming refresh for dark reply drafting v2; no consent or serving changes.
-- The switch-on PR widens the consent-evidence and enablement deployment CHECKs.
INSERT INTO ai_execution_control_transitions (control_id, generation, scope_key, scope_kind, scope_value, execution_state, reason_code, actor_user_id, occurred_at, predecessor_generation, admission_state, ticket_reference, candidate_release_sha) VALUES ('00000000-0000-4000-8000-00000000a008', 1, 'provider:private-beta-global-v3', 'provider_deployment_profile', 'private-beta-global-v3', 'enabled', 'migration_seed', NULL, now(), NULL, 'accepting', 'migration-0086', NULL);
--> statement-breakpoint
INSERT INTO ai_execution_control_heads (scope_key, scope_kind, scope_value, control_id, generation, execution_state, updated_at, admission_state) VALUES ('provider:private-beta-global-v3', 'provider_deployment_profile', 'private-beta-global-v3', '00000000-0000-4000-8000-00000000a008', 1, 'enabled', now(), 'accepting');
