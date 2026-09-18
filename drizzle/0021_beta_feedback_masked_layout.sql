-- The optional masked layout a reporter may consent to on a Bug.
--
-- BETA.md §3 permits media on a Bug with explicit per-submission consent,
-- preview and removal, retained no more than 30 days. This table is the shape
-- that permission is spent on, and the shape is the privacy control: a viewport
-- size and a bounded list of rectangles carrying a role from a closed
-- vocabulary. There is no column a page's text, URL or attribute could occupy,
-- so content-freeness holds by construction rather than by filtering.
--
-- It is deliberately NOT part of beta_feedback_triage. That table is declared
-- content-free and holds only pseudonyms, controlled enums, provider linkage,
-- classifications, ownership and state-transition evidence; geometry is none of
-- those, and quietly widening it would make its own header comment false.
--
-- The 30-day horizon is the database's, not the application's: the CHECK below
-- means an application bug cannot mint a row that outlives the accepted policy,
-- and the retention sweep deletes on expires_at.
CREATE TABLE "beta_feedback_masked_layouts" (
  "feedback_reference" uuid PRIMARY KEY NOT NULL,
  "viewport_width" integer NOT NULL,
  "viewport_height" integer NOT NULL,
  "box_count" integer NOT NULL,
  "boxes" jsonb NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  CONSTRAINT "beta_feedback_masked_layout_viewport_valid" CHECK (
    "viewport_width" BETWEEN 1 AND 20000 AND "viewport_height" BETWEEN 1 AND 20000
  ),
  CONSTRAINT "beta_feedback_masked_layout_box_count_valid" CHECK (
    "box_count" BETWEEN 1 AND 240 AND jsonb_array_length("boxes") = "box_count"
  ),
  CONSTRAINT "beta_feedback_masked_layout_boxes_are_array" CHECK (
    jsonb_typeof("boxes") = 'array'
  ),
  CONSTRAINT "beta_feedback_masked_layout_retention_valid" CHECK (
    "expires_at" > "captured_at"
    AND "expires_at" <= "captured_at" + interval '30 days'
  )
);
--> statement-breakpoint
ALTER TABLE "beta_feedback_masked_layouts"
  ADD CONSTRAINT "beta_feedback_masked_layouts_feedback_reference_beta_feedback_triage_reference_fk"
  FOREIGN KEY ("feedback_reference") REFERENCES "public"."beta_feedback_triage"("reference")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "beta_feedback_masked_layout_expiry_idx"
  ON "beta_feedback_masked_layouts" USING btree ("expires_at");
