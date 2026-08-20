CREATE INDEX "properties_org_lower_name_id_active_idx"
  ON "properties" USING btree ("organization_id", lower("name"), "id")
  WHERE "deleted_at" IS NULL;
