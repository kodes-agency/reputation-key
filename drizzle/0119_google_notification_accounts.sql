CREATE TABLE "google_notification_accounts" (
  "account_key" varchar(64) PRIMARY KEY NOT NULL,
  "attempted_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "configuration" text
);
