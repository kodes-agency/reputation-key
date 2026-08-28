CREATE UNIQUE INDEX "region_moves_one_active_per_property_idx" ON "region_moves" USING btree ("property_id") WHERE "region_moves"."state" NOT IN ('completed', 'rolled_back');
