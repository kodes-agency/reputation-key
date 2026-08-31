CREATE INDEX "reviews_lifecycle_cursor_idx" ON "reviews" USING btree ("created_at","id");
