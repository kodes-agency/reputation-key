-- notifications, notification_preferences and notification_property_delivery_windows
-- each carry a (organization_id, property_id) tenant FK ON DELETE CASCADE,
-- but none had an index leading with that pair: notifications' seven indexes
-- lead with user_id, organization_id alone, resource_id or created_at, and
-- the other two tables' only indexes are unique indexes leading with user_id.
-- A Property hard delete's cascade check for these FKs had no way to narrow
-- to the deleted property (database-06).
CREATE INDEX "notifications_org_property_idx" ON "notifications" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "notification_preferences_org_property_idx" ON "notification_preferences" USING btree ("organization_id","property_id");--> statement-breakpoint
CREATE INDEX "notification_property_delivery_windows_org_property_idx" ON "notification_property_delivery_windows" USING btree ("organization_id","property_id");
