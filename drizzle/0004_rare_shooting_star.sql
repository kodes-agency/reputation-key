CREATE TABLE "property_reply_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"greeting" varchar(120) NOT NULL,
	"sign_off_positive" varchar(200) NOT NULL,
	"sign_off_negative" varchar(200) NOT NULL,
	"emoji_allowed" boolean DEFAULT false NOT NULL,
	"escalation_contact" varchar(200),
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_reply_profiles_version_positive" CHECK ("property_reply_profiles"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "property_reply_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" varchar(255) NOT NULL,
	"property_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"rating_min" smallint NOT NULL,
	"rating_max" smallint NOT NULL,
	"has_text" boolean NOT NULL,
	"aspect" varchar(40),
	"open_label" varchar(80),
	"language_tag" varchar(35) NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_reply_templates_rating_valid" CHECK ("property_reply_templates"."rating_min" BETWEEN 1 AND 5 AND "property_reply_templates"."rating_max" BETWEEN 1 AND 5 AND "property_reply_templates"."rating_min" <= "property_reply_templates"."rating_max"),
	CONSTRAINT "property_reply_templates_aspect_valid" CHECK ("property_reply_templates"."aspect" IS NULL OR "property_reply_templates"."aspect" IN ('service', 'staff', 'quality', 'value', 'cleanliness', 'wait_time', 'atmosphere', 'location', 'accessibility', 'other', 'room', 'food_and_drink', 'noise', 'wifi_and_tech', 'check_in_out', 'parking', 'amenities', 'events')),
	CONSTRAINT "property_reply_templates_language_tag_valid" CHECK ("property_reply_templates"."language_tag" ~ '^(en-Latn|es-Latn|fr-Latn|de-Latn|pt-Latn|it-Latn|nl-Latn|pl-Latn|tr-Latn|uk-Cyrl|ru-Cyrl|ar-Arab|he-Hebr|hi-Deva|bn-Beng|ta-Taml|th-Thai|vi-Latn|id-Latn|zh-Hans|zh-Hant|ja-Jpan|ko-Kore|bg-Cyrl)(-(001|002|003|005|009|011|013|014|015|017|018|019|021|029|030|034|035|039|053|054|057|061|142|143|145|150|151|154|155|202|419|AC|AD|AE|AF|AG|AI|AL|AM|AO|AQ|AR|AS|AT|AU|AW|AX|AZ|BA|BB|BD|BE|BF|BG|BH|BI|BJ|BL|BM|BN|BO|BQ|BR|BS|BT|BV|BW|BY|BZ|CA|CC|CD|CF|CG|CH|CI|CK|CL|CM|CN|CO|CP|CQ|CR|CU|CV|CW|CX|CY|CZ|DE|DG|DJ|DK|DM|DO|DZ|EA|EC|EE|EG|EH|ER|ES|ET|EU|EZ|FI|FJ|FK|FM|FO|FR|GA|GB|GD|GE|GF|GG|GH|GI|GL|GM|GN|GP|GQ|GR|GS|GT|GU|GW|GY|HK|HM|HN|HR|HT|HU|IC|ID|IE|IL|IM|IN|IO|IQ|IR|IS|IT|JE|JM|JO|JP|KE|KG|KH|KI|KM|KN|KP|KR|KW|KY|KZ|LA|LB|LC|LI|LK|LR|LS|LT|LU|LV|LY|MA|MC|MD|ME|MF|MG|MH|MK|ML|MM|MN|MO|MP|MQ|MR|MS|MT|MU|MV|MW|MX|MY|MZ|NA|NC|NE|NF|NG|NI|NL|NO|NP|NR|NU|NZ|OM|PA|PE|PF|PG|PH|PK|PL|PM|PN|PR|PS|PT|PW|PY|QA|QO|RE|RO|RS|RU|RW|SA|SB|SC|SD|SE|SG|SH|SI|SJ|SK|SL|SM|SN|SO|SR|SS|ST|SV|SX|SY|SZ|TA|TC|TD|TF|TG|TH|TJ|TK|TL|TM|TN|TO|TR|TT|TV|TW|TZ|UA|UG|UM|UN|US|UY|UZ|VA|VC|VE|VG|VI|VN|VU|WF|WS|XA|XB|XK|YE|YT|ZA|ZM|ZW))?$'),
	CONSTRAINT "property_reply_templates_body_valid" CHECK (char_length(btrim("property_reply_templates"."body")) > 0 AND char_length("property_reply_templates"."body") <= 4096),
	CONSTRAINT "property_reply_templates_title_nonempty" CHECK (char_length(btrim("property_reply_templates"."title")) > 0),
	CONSTRAINT "property_reply_templates_version_positive" CHECK ("property_reply_templates"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "replies" ADD COLUMN "template_version" integer;--> statement-breakpoint
ALTER TABLE "property_reply_profiles" ADD CONSTRAINT "property_reply_profiles_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_reply_templates" ADD CONSTRAINT "property_reply_templates_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "property_reply_profiles_property_unique" ON "property_reply_profiles" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_reply_profiles_scope_id_key" ON "property_reply_profiles" USING btree ("organization_id","property_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "property_reply_templates_property_title_unique" ON "property_reply_templates" USING btree ("organization_id","property_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "property_reply_templates_scope_id_key" ON "property_reply_templates" USING btree ("organization_id","property_id","id");--> statement-breakpoint
CREATE INDEX "property_reply_templates_applicable_idx" ON "property_reply_templates" USING btree ("organization_id","property_id","enabled","has_text","rating_min","rating_max");--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_template_provenance_valid" CHECK ((
        ("replies"."template_id" IS NULL AND "replies"."template_version" IS NULL)
        OR ("replies"."template_id" IS NOT NULL AND "replies"."template_version" >= 1)
      ));