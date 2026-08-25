ALTER TABLE "feedback" ALTER COLUMN "ip_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "feedback" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "ip_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_events" ALTER COLUMN "ip_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_events" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "retention_runs" ADD COLUMN "rows_redacted" integer DEFAULT 0 NOT NULL;
