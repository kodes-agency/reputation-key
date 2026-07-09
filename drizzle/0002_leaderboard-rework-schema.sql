DROP INDEX "leaderboard_entries_org_idx";--> statement-breakpoint
DROP INDEX "leaderboard_snapshots_org_idx";--> statement-breakpoint
DROP INDEX "leaderboard_snapshots_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_snapshots_key_unique" ON "leaderboard_snapshots" USING btree ("property_id","period","scope","metric_key","score_key");--> statement-breakpoint
ALTER TABLE "leaderboard_snapshots" DROP COLUMN "organization_id";