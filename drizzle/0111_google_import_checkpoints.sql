CREATE TABLE "google_imports" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "request_id" uuid NOT NULL,
  "initiated_by" varchar(255) NOT NULL,
  "total_count" integer NOT NULL,
  "wire_replay_key_version" varchar(32) NOT NULL,
  "wire_replay_digest" varchar(43) NOT NULL,
  "semantic_replay_key_version" varchar(32) NOT NULL,
  "semantic_replay_digest" varchar(43) NOT NULL,
  "deletion_fence" integer DEFAULT 0 NOT NULL,
  "first_terminal_at" timestamp with time zone,
  "purge_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_imports_counts_valid" CHECK ("google_imports"."total_count" >= 1 AND "google_imports"."deletion_fence" >= 0),
  CONSTRAINT "google_imports_replay_encoding_valid" CHECK ("google_imports"."wire_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "google_imports"."semantic_replay_key_version" ~ '^[a-z][a-z0-9_-]{0,31}$'
        AND "google_imports"."wire_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'
        AND "google_imports"."semantic_replay_digest" ~ '^[A-Za-z0-9_-]{43}$'),
  CONSTRAINT "google_imports_terminal_times_valid" CHECK (("google_imports"."first_terminal_at" IS NULL) = ("google_imports"."purge_at" IS NULL)
        AND ("google_imports"."first_terminal_at" IS NULL OR "google_imports"."purge_at" = "google_imports"."first_terminal_at" + interval '30 days')),
  CONSTRAINT "google_imports_org_request_unique" UNIQUE ("organization_id", "request_id"),
  CONSTRAINT "google_imports_org_id_key" UNIQUE ("organization_id", "id")
);
--> statement-breakpoint
CREATE TABLE "google_import_items" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "import_id" uuid NOT NULL,
  "connection_id" uuid,
  "existing_property_id" uuid,
  "destination_property_id" uuid,
  "provider_account_suffix" varchar(255),
  "provider_location_suffix" varchar(255),
  "google_review_uri" varchar(2048),
  "google_primary_category" varchar(512),
  "expected_connection_lifecycle_version" integer,
  "expected_connection_access_version" integer,
  "expected_credential_generation" integer,
  "expected_execution_policy_version" varchar(32),
  "expected_actor_role" varchar(50),
  "expected_permission_digest" varchar(64),
  "expected_principal_kind" varchar(32),
  "expected_permission_version" integer,
  "expected_source_epoch" integer,
  "expected_profile_version" integer,
  "action" "google_import_v2_action" NOT NULL,
  "update_existing_profile" boolean NOT NULL,
  "property_name" varchar(100) NOT NULL,
  "property_address" text,
  "country_code" varchar(2),
  "timezone" varchar(64) NOT NULL,
  "status" "google_import_v2_item_status" DEFAULT 'pending' NOT NULL,
  "outcome_code" "google_import_v2_outcome",
  "invalid_profile_field" varchar(16),
  "effect_deadline_at" timestamp with time zone NOT NULL,
  "retry_revision" integer DEFAULT 0 NOT NULL,
  "dispatch_epoch" integer DEFAULT 0 NOT NULL,
  "next_dispatch_at" timestamp with time zone,
  "highest_attempt_for_revision" integer DEFAULT 0 NOT NULL,
  "claim_fence" uuid,
  "claim_lease_expires_at" timestamp with time zone,
  "first_terminal_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "google_import_items_dispatch_epoch_valid" CHECK ("google_import_items"."dispatch_epoch" >= 0),
  CONSTRAINT "google_import_items_checkpoint_state_valid" CHECK ((
        (
          ("google_import_items"."status" IN ('pending', 'processing') OR "google_import_items"."outcome_code" = 'temporarily_unavailable')
          AND "google_import_items"."connection_id" IS NOT NULL
          AND "google_import_items"."provider_account_suffix" IS NOT NULL
          AND "google_import_items"."provider_location_suffix" IS NOT NULL
          AND "google_import_items"."expected_connection_lifecycle_version" IS NOT NULL
          AND "google_import_items"."expected_connection_access_version" IS NOT NULL
          AND "google_import_items"."expected_credential_generation" IS NOT NULL
          AND "google_import_items"."expected_execution_policy_version" IS NOT NULL
          AND "google_import_items"."expected_actor_role" IS NOT NULL
          AND "google_import_items"."expected_permission_digest" IS NOT NULL
          AND "google_import_items"."expected_principal_kind" IS NOT NULL
          AND "google_import_items"."expected_permission_version" IS NOT NULL
        ) OR (
          "google_import_items"."status" NOT IN ('pending', 'processing')
          AND "google_import_items"."outcome_code" <> 'temporarily_unavailable'
          AND "google_import_items"."connection_id" IS NULL
          AND "google_import_items"."provider_account_suffix" IS NULL
          AND "google_import_items"."provider_location_suffix" IS NULL
          AND "google_import_items"."google_review_uri" IS NULL
          AND "google_import_items"."google_primary_category" IS NULL
          AND "google_import_items"."expected_connection_lifecycle_version" IS NULL
          AND "google_import_items"."expected_connection_access_version" IS NULL
          AND "google_import_items"."expected_credential_generation" IS NULL
          AND "google_import_items"."expected_execution_policy_version" IS NULL
          AND "google_import_items"."expected_actor_role" IS NULL
          AND "google_import_items"."expected_permission_digest" IS NULL
          AND "google_import_items"."expected_principal_kind" IS NULL
          AND "google_import_items"."expected_permission_version" IS NULL
        )
      ) IS TRUE),
  CONSTRAINT "google_import_items_appointment_valid" CHECK (("google_import_items"."status" IN ('pending', 'processing')) = ("google_import_items"."next_dispatch_at" IS NOT NULL)),
  CONSTRAINT "google_import_items_profile_valid" CHECK ((
        char_length(btrim("google_import_items"."property_name")) BETWEEN 1 AND 100
        AND char_length("google_import_items"."timezone") BETWEEN 1 AND 64
        AND ("google_import_items"."country_code" IS NULL OR "google_import_items"."country_code" ~ '^[A-Z]{2}$')
        AND (
          (
          ("google_import_items"."action" = 'create' AND "google_import_items"."existing_property_id" IS NULL AND "google_import_items"."destination_property_id" IS NOT NULL AND "google_import_items"."country_code" IS NOT NULL AND "google_import_items"."update_existing_profile" = true AND "google_import_items"."expected_source_epoch" IS NULL AND "google_import_items"."expected_profile_version" IS NULL)
          OR ("google_import_items"."action" = 'relink' AND "google_import_items"."existing_property_id" IS NOT NULL AND "google_import_items"."destination_property_id" = "google_import_items"."existing_property_id" AND "google_import_items"."expected_source_epoch" >= 0 AND "google_import_items"."expected_profile_version" >= 1)
        )
        OR (
          "google_import_items"."status" NOT IN ('pending', 'processing')
          AND "google_import_items"."outcome_code" <> 'temporarily_unavailable'
          AND "google_import_items"."existing_property_id" IS NULL
          AND ("google_import_items"."status" IN ('imported', 'relinked', 'already_exists') OR "google_import_items"."destination_property_id" IS NULL)
          AND "google_import_items"."expected_source_epoch" IS NULL
          AND "google_import_items"."expected_profile_version" IS NULL
        )
          )
      ) IS TRUE),
  CONSTRAINT "google_import_items_generations_valid" CHECK ((
        (
          (
          "google_import_items"."expected_connection_lifecycle_version" >= 1
          AND "google_import_items"."expected_connection_access_version" >= 1
          AND "google_import_items"."expected_credential_generation" >= 1
          )
          OR (
          "google_import_items"."status" NOT IN ('pending', 'processing')
          AND "google_import_items"."outcome_code" <> 'temporarily_unavailable'
          AND "google_import_items"."expected_connection_lifecycle_version" IS NULL
          AND "google_import_items"."expected_connection_access_version" IS NULL
          AND "google_import_items"."expected_credential_generation" IS NULL
          )
        )
        AND "google_import_items"."retry_revision" >= 0
      )),
  CONSTRAINT "google_import_items_authorization_snapshot_valid" CHECK ((
        (
          "google_import_items"."expected_execution_policy_version" IS NULL
          AND "google_import_items"."expected_actor_role" IS NULL
          AND "google_import_items"."expected_permission_digest" IS NULL
          AND "google_import_items"."expected_principal_kind" IS NULL
          AND "google_import_items"."expected_permission_version" IS NULL
        )
        OR (
          char_length("google_import_items"."expected_execution_policy_version") BETWEEN 1 AND 32
          AND char_length("google_import_items"."expected_actor_role") BETWEEN 1 AND 50
          AND "google_import_items"."expected_permission_digest" ~ '^[a-f0-9]{64}$'
          AND char_length("google_import_items"."expected_principal_kind") BETWEEN 1 AND 32
          AND "google_import_items"."expected_permission_version" >= 0
        )
      )),
  CONSTRAINT "google_import_items_attempt_fence_valid" CHECK ((
        "google_import_items"."highest_attempt_for_revision" BETWEEN 0 AND 5
        AND ("google_import_items"."claim_fence" IS NULL) = ("google_import_items"."claim_lease_expires_at" IS NULL)
        AND ("google_import_items"."status" = 'processing') = ("google_import_items"."claim_fence" IS NOT NULL)
        AND (
          "google_import_items"."status" <> 'processing'
          OR ("google_import_items"."claim_fence" IS NOT NULL AND "google_import_items"."highest_attempt_for_revision" BETWEEN 1 AND 5)
        )
      )),
  CONSTRAINT "google_import_items_status_outcome_valid" CHECK ((
        ("google_import_items"."status" IN ('pending', 'processing') AND "google_import_items"."outcome_code" IS NULL)
        OR ("google_import_items"."status" = 'imported' AND "google_import_items"."outcome_code" = 'imported')
        OR ("google_import_items"."status" = 'relinked' AND "google_import_items"."outcome_code" = 'relinked')
        OR ("google_import_items"."status" = 'already_exists' AND "google_import_items"."outcome_code" = 'already_exists')
        OR ("google_import_items"."status" = 'failed' AND "google_import_items"."outcome_code"::text IN ('active_binding_conflict', 'stale_binding', 'reauthentication_required', 'reconnect_required', 'temporarily_unavailable', 'cleanup_required', 'internal_error', 'tenant_profile_invalid'))
        OR ("google_import_items"."status" = 'cancelled' AND "google_import_items"."outcome_code"::text IN ('authorization_changed', 'user_cancelled', 'policy_disabled', 'organization_suspended', 'property_suspended', 'property_deleted'))
      )),
  CONSTRAINT "google_import_items_terminal_valid" CHECK ("google_import_items"."outcome_code" IS NULL OR "google_import_items"."first_terminal_at" IS NOT NULL),
  CONSTRAINT "google_import_items_invalid_profile_field_valid" CHECK ((
        ("google_import_items"."invalid_profile_field" IS NULL AND ("google_import_items"."outcome_code" IS NULL OR "google_import_items"."outcome_code"::text <> 'tenant_profile_invalid'))
        OR ("google_import_items"."outcome_code"::text = 'tenant_profile_invalid' AND "google_import_items"."invalid_profile_field" IN ('name', 'timezone', 'country'))
      ) IS TRUE),
  CONSTRAINT "google_import_items_deadline_valid" CHECK ("google_import_items"."effect_deadline_at" = "google_import_items"."created_at" + interval '24 hours'),
  CONSTRAINT "google_import_items_provider_reference_retention_valid" CHECK ((
        (
          "google_import_items"."status" IN ('pending', 'processing')
          AND "google_import_items"."connection_id" IS NOT NULL
          AND "google_import_items"."provider_account_suffix" IS NOT NULL
          AND "google_import_items"."provider_location_suffix" IS NOT NULL
        )
        OR (
          "google_import_items"."status" NOT IN ('pending', 'processing')
          AND (("google_import_items"."provider_account_suffix" IS NULL) = ("google_import_items"."provider_location_suffix" IS NULL))
        )
      )),
  CONSTRAINT "google_import_items_provider_suffix_valid" CHECK ((
        ("google_import_items"."provider_account_suffix" IS NULL OR "google_import_items"."provider_account_suffix" !~ '[/?#[:space:][:cntrl:]]')
        AND ("google_import_items"."provider_location_suffix" IS NULL OR "google_import_items"."provider_location_suffix" !~ '[/?#[:space:][:cntrl:]]')
      )),
  CONSTRAINT "google_import_items_google_review_uri_valid" CHECK ("google_import_items"."google_review_uri" IS NULL OR "google_import_items"."google_review_uri" ~ '^https://'),
  CONSTRAINT "google_import_items_google_primary_category_valid" CHECK ("google_import_items"."google_primary_category" IS NULL OR (char_length("google_import_items"."google_primary_category") BETWEEN 1 AND 512 AND "google_import_items"."google_primary_category" = btrim("google_import_items"."google_primary_category"))),
  CONSTRAINT "google_import_items_org_id_key" UNIQUE ("organization_id", "id"),
  CONSTRAINT "google_import_items_parent_tenant_fk" FOREIGN KEY ("organization_id", "import_id") REFERENCES "google_imports" ("organization_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "google_import_items_connection_tenant_fk" FOREIGN KEY ("organization_id", "connection_id") REFERENCES "google_connections" ("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "google_import_items_property_tenant_fk" FOREIGN KEY ("organization_id", "existing_property_id") REFERENCES "properties" ("organization_id", "id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

