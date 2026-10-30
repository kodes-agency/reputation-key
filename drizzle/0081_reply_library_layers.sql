-- Layered reply library and reply voice (ADR 0073).
--
-- Built-in content remains repository-owned. These tables hold only account and
-- property voice overrides, tenant-authored template revisions, visibility rows,
-- and informational provenance on replies. The legacy property library tables
-- remain for a later cleanup migration, but application reads move to these rows.
CREATE TABLE "organization_reply_voices" (
	"organization_id" varchar(255) PRIMARY KEY NOT NULL,
	"use_first_name" boolean,
	"privacy_mode" boolean,
	"greeting_positive" varchar(16),
	"greeting_negative" varchar(16),
	"contact" varchar(200),
	"emoji_mode" varchar(16),
	"emoji_set" text[],
	"signer_name" varchar(120),
	"signer_title" varchar(120),
	"business_name_short" varchar(120),
	"visit_word_key" varchar(40),
	"localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_reply_voices_greetings_valid" CHECK (("organization_reply_voices"."greeting_positive" IS NULL OR "organization_reply_voices"."greeting_positive" IN ('hi', 'hello', 'dear')) AND ("organization_reply_voices"."greeting_negative" IS NULL OR "organization_reply_voices"."greeting_negative" IN ('hi', 'hello', 'dear'))),
	CONSTRAINT "organization_reply_voices_emoji_mode_valid" CHECK ("organization_reply_voices"."emoji_mode" IS NULL OR "organization_reply_voices"."emoji_mode" IN ('off', 'positive')),
	CONSTRAINT "organization_reply_voices_version_positive" CHECK ("organization_reply_voices"."version" >= 1)
);--> statement-breakpoint
CREATE TABLE "property_reply_voices" (
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"use_first_name" boolean,
	"privacy_mode" boolean,
	"greeting_positive" varchar(16),
	"greeting_negative" varchar(16),
	"contact" varchar(200),
	"emoji_mode" varchar(16),
	"emoji_set" text[],
	"signer_name" varchar(120),
	"signer_title" varchar(120),
	"business_name_short" varchar(120),
	"visit_word_key" varchar(40),
	"localized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overridden_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_reply_voices_pk" PRIMARY KEY("organization_id","property_id"),
	CONSTRAINT "property_reply_voices_greetings_valid" CHECK (("property_reply_voices"."greeting_positive" IS NULL OR "property_reply_voices"."greeting_positive" IN ('hi', 'hello', 'dear')) AND ("property_reply_voices"."greeting_negative" IS NULL OR "property_reply_voices"."greeting_negative" IN ('hi', 'hello', 'dear'))),
	CONSTRAINT "property_reply_voices_emoji_mode_valid" CHECK ("property_reply_voices"."emoji_mode" IS NULL OR "property_reply_voices"."emoji_mode" IN ('off', 'positive')),
	CONSTRAINT "property_reply_voices_version_positive" CHECK ("property_reply_voices"."version" >= 1)
);--> statement-breakpoint
CREATE TABLE "reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"builtin_key" varchar(80),
	"based_on_template_id" uuid,
	"based_on_builtin_version" integer,
	"current_revision_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by" varchar(255) NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_templates_base_valid" CHECK (("reply_templates"."property_id" IS NOT NULL OR "reply_templates"."based_on_template_id" IS NULL) AND num_nonnulls("reply_templates"."builtin_key", "reply_templates"."based_on_template_id") <= 1),
	CONSTRAINT "reply_templates_builtin_version_positive" CHECK ("reply_templates"."based_on_builtin_version" IS NULL OR "reply_templates"."based_on_builtin_version" >= 1)
);--> statement-breakpoint
CREATE TABLE "reply_template_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" varchar(120) NOT NULL,
	"stars_min" smallint NOT NULL,
	"stars_max" smallint NOT NULL,
	"review_kind" varchar(20) NOT NULL,
	"topic" varchar(40),
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_template_revisions_number_positive" CHECK ("reply_template_revisions"."number" >= 1),
	CONSTRAINT "reply_template_revisions_rating_valid" CHECK ("reply_template_revisions"."stars_min" BETWEEN 1 AND 5 AND "reply_template_revisions"."stars_max" BETWEEN 1 AND 5 AND "reply_template_revisions"."stars_min" <= "reply_template_revisions"."stars_max"),
	CONSTRAINT "reply_template_revisions_kind_valid" CHECK ("reply_template_revisions"."review_kind" IN ('text', 'rating_only')),
	CONSTRAINT "reply_template_revisions_topic_valid" CHECK ("reply_template_revisions"."topic" IS NULL OR "reply_template_revisions"."topic" IN ('staff_service', 'speed_waiting', 'booking_arrival', 'main_service', 'food_drink', 'cleanliness', 'facilities_equipment', 'price_billing', 'atmosphere_noise', 'location_access', 'safety', 'communication')),
	CONSTRAINT "reply_template_revisions_title_nonblank" CHECK (char_length(btrim("reply_template_revisions"."title")) > 0)
);--> statement-breakpoint
CREATE TABLE "reply_template_wordings" (
	"revision_id" uuid NOT NULL,
	"wording_key" varchar(80) NOT NULL,
	"language_group" varchar(35) NOT NULL,
	"body" text NOT NULL,
	CONSTRAINT "reply_template_wordings_pk" PRIMARY KEY("revision_id","wording_key","language_group"),
	CONSTRAINT "reply_template_wordings_language_valid" CHECK ("reply_template_wordings"."language_group" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'),
	CONSTRAINT "reply_template_wordings_body_valid" CHECK (octet_length("reply_template_wordings"."body") <= 4096 AND char_length(btrim("reply_template_wordings"."body")) > 0)
);--> statement-breakpoint
CREATE TABLE "reply_template_visibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid,
	"builtin_key" varchar(80),
	"template_id" uuid,
	"created_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_template_visibility_one_ref" CHECK (num_nonnulls("reply_template_visibility"."builtin_key", "reply_template_visibility"."template_id") = 1)
);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_layer" varchar(20);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_ref" text;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_revision" integer;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_wording_key" varchar(80);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "voice_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "voice_choices" jsonb;--> statement-breakpoint
ALTER TABLE "replies" DROP CONSTRAINT "replies_ai_provenance_valid";--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_ai_provenance_valid" CHECK ((
  (
    "authorship" = 'ai_assisted'
    AND "origin_operation_id" IS NOT NULL
    AND "origin_source_epoch" >= 0
    AND "origin_source_revision" >= 1
    AND "origin_base_reply_state_revision" BETWEEN 0 AND '9007199254740991'::bigint
    AND "origin_reply_drafting_epoch" >= 1
    AND "origin_property_profile_version" >= 1
    AND (
      (
        "origin_ai_profile_version" = 'reply-suggestion-v1'
        AND "origin_reply_template_id" IN ('appreciation_positive', 'appreciation_neutral', 'recovery_service', 'acknowledge_concern')
        AND "origin_reply_template_catalogue_version" = 'gbp-reply-template-catalogue-v1'
        AND "origin_reply_template_catalogue_digest" = 'ff5f572e9c8ce06fc384bdc4cdd911457510fdd0daed571a53d2348faa8bd89f'
      )
      OR (
        "origin_ai_profile_version" IN ('reply-draft-v1', 'reply-draft-v2', 'reply-draft-v3')
        AND "origin_reply_template_id" IS NULL
        AND "origin_reply_template_catalogue_version" IS NULL
        AND "origin_reply_template_catalogue_digest" IS NULL
        AND "origin_template_group" IN ('en-Latn', 'bg-Cyrl')
      )
    )
    AND "origin_template_group" IN (
      'en-Latn', 'es-Latn', 'fr-Latn', 'de-Latn', 'pt-Latn', 'it-Latn', 'nl-Latn',
      'pl-Latn', 'tr-Latn', 'uk-Cyrl', 'ru-Cyrl', 'ar-Arab', 'he-Hebr', 'hi-Deva',
      'bn-Beng', 'ta-Taml', 'th-Thai', 'vi-Latn', 'id-Latn', 'zh-Hans', 'zh-Hant',
      'ja-Jpan', 'ko-Kore', 'bg-Cyrl'
    )
    AND (
      "origin_concrete_language_tag" = "origin_template_group"
      OR "origin_concrete_language_tag" ~~ ("origin_template_group" || '-%')
    )
    AND "ai_draft_expires_at" IS NOT NULL
  )
  OR (
    "origin_operation_id" IS NULL
    AND "origin_source_epoch" IS NULL
    AND "origin_source_revision" IS NULL
    AND "origin_base_reply_state_revision" IS NULL
    AND "origin_reply_drafting_epoch" IS NULL
    AND "origin_property_profile_version" IS NULL
    AND "origin_ai_profile_version" IS NULL
    AND "origin_reply_template_id" IS NULL
    AND "origin_reply_template_catalogue_version" IS NULL
    AND "origin_reply_template_catalogue_digest" IS NULL
    AND "origin_concrete_language_tag" IS NULL
    AND "origin_template_group" IS NULL
    AND "ai_draft_expires_at" IS NULL
  )
));--> statement-breakpoint
INSERT INTO "organization_reply_voices" (
	"organization_id", "contact", "emoji_mode", "localized",
	"overridden_fields", "version", "updated_by", "created_at", "updated_at"
)
SELECT "organization_id", "escalation_contact",
	CASE WHEN "emoji_allowed" THEN 'positive' ELSE 'off' END, '{}'::jsonb,
	ARRAY['contact', 'emojiMode']::text[], "version", "updated_by", "created_at", "updated_at"
FROM "property_reply_profiles" AS "legacy_profile"
WHERE (
	SELECT count(*) FROM "properties"
	WHERE "properties"."organization_id" = "legacy_profile"."organization_id"
) = 1;--> statement-breakpoint
INSERT INTO "property_reply_voices" (
	"organization_id", "property_id", "contact", "emoji_mode", "localized",
	"overridden_fields", "version", "updated_by", "created_at", "updated_at"
)
SELECT "organization_id", "property_id", "escalation_contact",
	CASE WHEN "emoji_allowed" THEN 'positive' ELSE 'off' END, '{}'::jsonb,
	ARRAY['contact', 'emojiMode']::text[], "version", "updated_by", "created_at", "updated_at"
FROM "property_reply_profiles" AS "legacy_profile"
WHERE (
	SELECT count(*) FROM "properties"
	WHERE "properties"."organization_id" = "legacy_profile"."organization_id"
) > 1;--> statement-breakpoint
INSERT INTO "reply_templates" (
	"id", "organization_id", "property_id", "current_revision_id", "created_by",
	"updated_by", "created_at", "updated_at"
)
SELECT "id", "organization_id",
	CASE WHEN (
		SELECT count(*) FROM "properties"
		WHERE "properties"."organization_id" = "legacy_template"."organization_id"
	) = 1 THEN NULL ELSE "property_id" END,
	"id", "updated_by", "updated_by",
	"created_at", "updated_at"
FROM "property_reply_templates" AS "legacy_template";--> statement-breakpoint
INSERT INTO "reply_template_revisions" (
	"id", "template_id", "number", "title", "stars_min", "stars_max",
	"review_kind", "topic", "created_by", "created_at"
)
SELECT "id", "id", 1, "title", "rating_min", "rating_max",
	CASE WHEN "has_text" THEN 'text' ELSE 'rating_only' END, NULL, "updated_by", "created_at"
FROM "property_reply_templates";--> statement-breakpoint
INSERT INTO "reply_template_wordings" ("revision_id", "wording_key", "language_group", "body")
SELECT "id", '1', left("language_tag", 7), "body"
FROM "property_reply_templates";--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_revisions_template_id_key" ON "reply_template_revisions" USING btree ("template_id","id");--> statement-breakpoint
ALTER TABLE "property_reply_voices" ADD CONSTRAINT "property_reply_voices_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_based_on_template_id_reply_templates_id_fk" FOREIGN KEY ("based_on_template_id") REFERENCES "public"."reply_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_template_revisions" ADD CONSTRAINT "reply_template_revisions_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_templates" ADD CONSTRAINT "reply_templates_current_revision_fk" FOREIGN KEY ("id","current_revision_id") REFERENCES "public"."reply_template_revisions"("template_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_template_wordings" ADD CONSTRAINT "reply_template_wordings_revision_id_reply_template_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."reply_template_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_template_visibility" ADD CONSTRAINT "reply_template_visibility_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_template_visibility" ADD CONSTRAINT "reply_template_visibility_template_id_reply_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."reply_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_layered_template_provenance_valid" CHECK ((("replies"."template_layer" IS NULL AND "replies"."template_ref" IS NULL AND "replies"."template_revision" IS NULL AND "replies"."template_wording_key" IS NULL) OR ("replies"."template_layer" IN ('builtin', 'account', 'property') AND "replies"."template_ref" IS NOT NULL AND "replies"."template_revision" >= 1 AND "replies"."template_wording_key" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_voice_digest_valid" CHECK ("replies"."voice_digest" IS NULL OR "replies"."voice_digest" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_scope_id_key" ON "reply_templates" USING btree ("organization_id","property_id","id");--> statement-breakpoint
CREATE INDEX "reply_templates_scope_active_idx" ON "reply_templates" USING btree ("organization_id","property_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_account_builtin_unique" ON "reply_templates" USING btree ("organization_id","builtin_key") WHERE property_id IS NULL AND builtin_key IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_property_builtin_unique" ON "reply_templates" USING btree ("organization_id","property_id","builtin_key") WHERE property_id IS NOT NULL AND builtin_key IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_templates_property_base_unique" ON "reply_templates" USING btree ("organization_id","property_id","based_on_template_id") WHERE property_id IS NOT NULL AND based_on_template_id IS NOT NULL AND archived_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_revisions_number_unique" ON "reply_template_revisions" USING btree ("template_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_visibility_account_builtin_unique" ON "reply_template_visibility" USING btree ("organization_id","builtin_key") WHERE property_id IS NULL AND builtin_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_visibility_property_builtin_unique" ON "reply_template_visibility" USING btree ("organization_id","property_id","builtin_key") WHERE property_id IS NOT NULL AND builtin_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_visibility_account_template_unique" ON "reply_template_visibility" USING btree ("organization_id","template_id") WHERE property_id IS NULL AND template_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_template_visibility_property_template_unique" ON "reply_template_visibility" USING btree ("organization_id","property_id","template_id") WHERE property_id IS NOT NULL AND template_id IS NOT NULL;
