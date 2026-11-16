-- All three facts are present or absent together; check every existing row.
ALTER TABLE "inbox_items" VALIDATE CONSTRAINT "inbox_items_cycle_head_facts_valid";
