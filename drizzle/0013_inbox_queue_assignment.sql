CREATE INDEX "inbox_items_org_assigned_to_idx" ON "inbox_items" USING btree ("organization_id","assigned_to");
