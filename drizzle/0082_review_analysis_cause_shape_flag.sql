-- Review Analysis v3: a cause with an invalid shape no longer drops its mention.
--
-- The normalizer used to drop a whole mention when its `thing` or `issue` was not one to
-- three lowercase words of letters and hyphens (or a thing came with no issue), and
-- counted it in `dropped_mention_count` under `mention_dropped_cause`. The guest's topic
-- was evidence either way, so the normalizer now empties the cause and keeps the mention
-- as a topic-level mention, the way it already treats a cause that holds a name or
-- repeats the review (`cause_refused_name`, `cause_refused_quotation`), and records
-- `cause_refused_shape`.
--
-- The only database fact that names the flags is the check on a settled operation's
-- `normalization_flags`. This file restates it with the new flag in the closed list.
-- `mention_dropped_cause` stays in the list: no row can carry it while v3 is dark, but
-- a row recorded under it, if one ever exists, must stay valid.
--
-- Nothing reads or writes a v3 operation yet (no operation profile, runtime catalogue
-- row, merchant notice or deployment profile selects v3), so every row of ai_operations
-- satisfies the first arm of the check and the scan below changes nothing.
--
-- Locks. The ADD CONSTRAINT CHECK scans ai_operations under an ACCESS EXCLUSIVE lock, plain
-- rather than NOT VALID because drizzle applies every pending file in one transaction
-- (0078 explains the same choice). It is one row per operation, a short scan at beta
-- size. migrate-deploy bounds the lock WAIT (src/shared/db/migration-lock-timeout.ts).
--
-- Roll forward, never back. The down step is: restate ai_operations_normalization_lineage_valid
-- as 0078 states it; then delete the 0082 row of drizzle.__drizzle_migrations.
ALTER TABLE "ai_operations" DROP CONSTRAINT "ai_operations_normalization_lineage_valid";--> statement-breakpoint
ALTER TABLE "ai_operations" ADD CONSTRAINT "ai_operations_normalization_lineage_valid" CHECK (("ai_operations"."normalization_profile_version" IS NULL AND "ai_operations"."normalization_profile_digest" IS NULL
          AND "ai_operations"."normalization_flags" = '{}' AND "ai_operations"."dropped_mention_count" = 0)
        OR ("ai_operations"."normalization_profile_version" IS NOT NULL AND "ai_operations"."normalization_profile_digest" IS NOT NULL
          AND char_length("ai_operations"."normalization_profile_version") BETWEEN 1 AND 100
          AND "ai_operations"."normalization_profile_digest" ~ '^[0-9a-f]{64}$'
          AND "ai_operations"."normalization_flags" <@ ARRAY['mentions_capped', 'sentence_refs_capped', 'enum_case_repaired', 'mention_dropped_malformed', 'mention_dropped_enum', 'mention_dropped_cause', 'mention_dropped_sentences', 'sentence_refs_repaired', 'cause_refused_name', 'cause_refused_quotation', 'cause_refused_shape', 'names_person_invalid', 'names_person_raised', 'mentions_merged', 'urgent_reason_unknown']
          AND "ai_operations"."dropped_mention_count" BETWEEN 0 AND 48));
