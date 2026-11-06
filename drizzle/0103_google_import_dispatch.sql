ALTER TABLE gbp_import_request_items
  ADD COLUMN next_dispatch_at timestamptz,
  ADD COLUMN dispatch_epoch integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE gbp_import_request_items
  ADD CONSTRAINT gbp_import_request_items_dispatch_epoch_valid
    CHECK (dispatch_epoch >= 0) NOT VALID;
