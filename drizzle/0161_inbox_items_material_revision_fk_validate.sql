-- Every existing row has a NULL revision or one the check accepts; validate them.
ALTER TABLE "inbox_items" VALIDATE CONSTRAINT "inbox_items_material_revision_fk";
