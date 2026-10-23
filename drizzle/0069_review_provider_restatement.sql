-- `provider_restatement`: Google rewording a review it did not update is no guest edit.
--
-- A guest edit moves Google's `updateTime`. On 2026-10-23 Google changed how it
-- wraps translated review text and did not move it; the material comparison
-- still saw different text and created Material Review Revision 2 on 62
-- closed-beta reviews, reopening handled Inbox items and giving open ones a
-- Response Target that was overdue from birth. PR #945 fixed that one wrapper.
-- This is the general net: when the rating or normalized text differs but
-- Google's `updateTime` is the same instant as the stored head's, the
-- observation keeps the current revision, adopts the incoming digests (as
-- `normalization_shadow_match` does) and records the comparison below, so the
-- next change of Google's format is countable instead of invisible.
--
-- `review_source_observations.comparison_result` is the only column that
-- holds a comparison, and only this CHECK constrains it. The CHECK is restated
-- with the seven values it had, in their order, and the new one appended. No
-- row changes and no digest moves.
--
-- Restated, not added `NOT VALID` and validated later: drizzle applies every
-- pending file in one transaction, so a NOT VALID/VALIDATE pair would hold the
-- same lock across the same scan (see 0065). The table holds one row per
-- applied provider fetch, and migrate-deploy bounds the lock WAIT
-- (src/shared/db/migration-lock-timeout.ts).
--
-- This runs before any new process (web's preDeploy); deploy web, then the
-- worker. An older process never writes the new value. One that reads it
-- (the Inbox's source-epoch carry attestation) treats an unknown comparison as
-- a guest edit for the few minutes the two overlap.
--
-- Down, never before relabelling: restoring the old CHECK is refused while any
-- row holds the new value. First
--   UPDATE review_source_observations
--      SET comparison_result = 'normalization_shadow_match'
--    WHERE comparison_result = 'provider_restatement';
-- (the same outcome: revision kept, digests adopted, no guest edit), then
-- restore the seven-value CHECK below, then delete the 0069 row of
-- drizzle.__drizzle_migrations.
ALTER TABLE "review_source_observations" DROP CONSTRAINT "review_source_observations_comparison_valid";
--> statement-breakpoint
ALTER TABLE "review_source_observations" ADD CONSTRAINT "review_source_observations_comparison_valid" CHECK ("review_source_observations"."comparison_result" IN (
        'backfilled_unverified',
        'initial_material_revision',
        'unchanged',
        'material_change',
        'normalization_shadow_match',
        'baseline_unavailable',
        'out_of_order_ignored',
        'provider_restatement'
      ));
