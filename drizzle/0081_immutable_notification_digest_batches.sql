CREATE TABLE "notification_digest_batch_members" (
	"batch_id" uuid NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"notification_email_id" uuid NOT NULL,
	"sort_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_batch_members_pk" PRIMARY KEY("batch_id","notification_email_id"),
	CONSTRAINT "notification_digest_batch_members_sort_index_nonnegative" CHECK ("notification_digest_batch_members"."sort_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_digest_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"local_date" date NOT NULL,
	"sequence" integer NOT NULL,
	"member_digest" varchar(64) NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"provider_idempotency_key" varchar(96) NOT NULL,
	"state" varchar(16) DEFAULT 'prepared' NOT NULL,
	"provider_message_id" varchar(255),
	"outcome_class" varchar(24),
	"terminal_reason" varchar(64),
	"retry_count" integer DEFAULT 0 NOT NULL,
	"attempted_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_digest_batches_state_valid" CHECK ("notification_digest_batches"."state" IN ('prepared', 'retryable', 'accepted', 'terminal')),
	CONSTRAINT "notification_digest_batches_sequence_positive" CHECK ("notification_digest_batches"."sequence" > 0),
	CONSTRAINT "notification_digest_batches_member_digest_valid" CHECK ("notification_digest_batches"."member_digest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "notification_digest_batches_content_digest_valid" CHECK ("notification_digest_batches"."content_digest" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_id_tenant_recipient_unique" ON "notification_digest_batches" USING btree ("id","organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_queue_id_tenant_recipient_unique" ON "notification_email_queue" USING btree ("id","organization_id","user_id");--> statement-breakpoint
ALTER TABLE "notification_digest_batch_members" ADD CONSTRAINT "notification_digest_batch_members_batch_tenant_fk" FOREIGN KEY ("batch_id","organization_id","user_id") REFERENCES "public"."notification_digest_batches"("id","organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_digest_batch_members" ADD CONSTRAINT "notification_digest_batch_members_email_tenant_fk" FOREIGN KEY ("notification_email_id","organization_id","user_id") REFERENCES "public"."notification_email_queue"("id","organization_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batch_members_email_unique" ON "notification_digest_batch_members" USING btree ("notification_email_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batch_members_order_unique" ON "notification_digest_batch_members" USING btree ("batch_id","sort_index");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_sequence_unique" ON "notification_digest_batches" USING btree ("organization_id","user_id","local_date","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_provider_key_unique" ON "notification_digest_batches" USING btree ("provider_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_digest_batches_open_unique" ON "notification_digest_batches" USING btree ("organization_id","user_id") WHERE state IN ('prepared', 'retryable');--> statement-breakpoint
CREATE INDEX "notification_digest_batches_retention_idx" ON "notification_digest_batches" USING btree ("state","updated_at");
