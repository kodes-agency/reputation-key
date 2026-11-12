-- A staff command holds its address here instead of a pinned connection and a
-- session advisory lock. The primary key is the mutual exclusion; the key is a
-- hash of the address, so no contact data is stored. Rows live only while a
-- command runs, or until they expire after the holder stopped.
CREATE TABLE "staff_address_leases" (
	"address_key" bigint PRIMARY KEY NOT NULL,
	"holder" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
