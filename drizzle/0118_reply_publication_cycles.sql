ALTER TABLE "replies" ADD COLUMN "publication_cycle" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_publication_cycle_safe" CHECK ("replies"."publication_cycle" BETWEEN 0 AND '9007199254740991'::bigint);
