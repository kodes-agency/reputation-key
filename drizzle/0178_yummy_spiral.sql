CREATE UNIQUE INDEX "reviews_org_id_key" ON "reviews" USING btree ("organization_id","id");--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "reviews" VALIDATE CONSTRAINT "reviews_property_tenant_fk";--> statement-breakpoint
ALTER TABLE "replies" ADD CONSTRAINT "replies_review_tenant_fk" FOREIGN KEY ("organization_id","review_id") REFERENCES "public"."reviews"("organization_id","id") ON DELETE restrict ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "replies" VALIDATE CONSTRAINT "replies_review_tenant_fk";--> statement-breakpoint
ALTER TABLE "metric_readings" ADD CONSTRAINT "metric_readings_property_tenant_fk" FOREIGN KEY ("organization_id","property_id") REFERENCES "public"."properties"("organization_id","id") ON DELETE cascade ON UPDATE no action NOT VALID;--> statement-breakpoint
ALTER TABLE "metric_readings" VALIDATE CONSTRAINT "metric_readings_property_tenant_fk";
