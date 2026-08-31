CREATE TABLE "invited_registration_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invitation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"expected_user_id" text NOT NULL,
	"expected_credential_account_id" text NOT NULL,
	"expected_initial_session_id" text NOT NULL,
	"attempt_ordinal" integer NOT NULL,
	"state" text DEFAULT 'prepared' NOT NULL,
	"request_count" integer DEFAULT 1 NOT NULL,
	"provider_observed_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"compensated_at" timestamp with time zone,
	"manual_review_at" timestamp with time zone,
	"next_recovery_at" timestamp with time zone,
	"lease_owner" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"last_failure_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invited_registration_state_valid" CHECK ("invited_registration_attempts"."state" IN ('prepared', 'accepted', 'compensated', 'manual_review')),
	CONSTRAINT "invited_registration_attempt_ordinal_positive" CHECK ("invited_registration_attempts"."attempt_ordinal" > 0),
	CONSTRAINT "invited_registration_request_count_positive" CHECK ("invited_registration_attempts"."request_count" > 0),
	CONSTRAINT "invited_registration_lease_pair" CHECK (("invited_registration_attempts"."lease_owner" IS NULL) = ("invited_registration_attempts"."lease_expires_at" IS NULL)),
	CONSTRAINT "invited_registration_terminal_shape" CHECK ((
        "invited_registration_attempts"."state" = 'prepared'
        AND "invited_registration_attempts"."accepted_at" IS NULL
        AND "invited_registration_attempts"."compensated_at" IS NULL
        AND "invited_registration_attempts"."manual_review_at" IS NULL
        AND "invited_registration_attempts"."next_recovery_at" IS NOT NULL
      ) OR (
        "invited_registration_attempts"."state" = 'accepted'
        AND "invited_registration_attempts"."accepted_at" IS NOT NULL
        AND "invited_registration_attempts"."compensated_at" IS NULL
        AND "invited_registration_attempts"."manual_review_at" IS NULL
        AND "invited_registration_attempts"."next_recovery_at" IS NULL
        AND "invited_registration_attempts"."lease_owner" IS NULL
      ) OR (
        "invited_registration_attempts"."state" = 'compensated'
        AND "invited_registration_attempts"."accepted_at" IS NULL
        AND "invited_registration_attempts"."compensated_at" IS NOT NULL
        AND "invited_registration_attempts"."manual_review_at" IS NULL
        AND "invited_registration_attempts"."next_recovery_at" IS NULL
        AND "invited_registration_attempts"."lease_owner" IS NULL
      ) OR (
        "invited_registration_attempts"."state" = 'manual_review'
        AND "invited_registration_attempts"."accepted_at" IS NULL
        AND "invited_registration_attempts"."compensated_at" IS NULL
        AND "invited_registration_attempts"."manual_review_at" IS NOT NULL
        AND "invited_registration_attempts"."next_recovery_at" IS NULL
        AND "invited_registration_attempts"."lease_owner" IS NULL
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "invited_registration_expected_user_unique" ON "invited_registration_attempts" USING btree ("expected_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invited_registration_expected_account_unique" ON "invited_registration_attempts" USING btree ("expected_credential_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invited_registration_expected_session_unique" ON "invited_registration_attempts" USING btree ("expected_initial_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invited_registration_invitation_ordinal_unique" ON "invited_registration_attempts" USING btree ("invitation_id","attempt_ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "invited_registration_one_unresolved_per_invitation" ON "invited_registration_attempts" USING btree ("invitation_id") WHERE "invited_registration_attempts"."state" IN ('prepared', 'manual_review');--> statement-breakpoint
CREATE INDEX "invited_registration_recovery_due_idx" ON "invited_registration_attempts" USING btree ("next_recovery_at","created_at") WHERE "invited_registration_attempts"."state" = 'prepared';