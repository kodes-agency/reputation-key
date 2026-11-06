# Populated upgrade fixture

This is synthetic scenario-builder data, captured before that builder retired.
`manifest.json` pins its source revision, PostgreSQL major, archive and SQL
SHA-256 digests, journal length and tenant identities. The archive contains no
production data. Preserve the captured SQL bytes; restore into a fresh disposable
database rather than rewriting an old dump to match current schema.

The integration proof runs the supported deploy command against these populated
rows. It compares retained customer identities, tenant relationships, replies and
guest ratings, checks interrupted recovery and reapplication, and plants a
migration that only fails with rows present. The image gate additionally executes
the actual released and candidate web and worker entry points. Its containers
can reach only the disposable PostgreSQL and Redis services.

Future upgrade and restore proofs should reuse this fixture. A deliberate recut
must capture both tenants through the supported migration path and verify a
fresh restore before updating the pinned digests.
