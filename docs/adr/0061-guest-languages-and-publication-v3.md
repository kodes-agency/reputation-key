---
status: accepted
date: 2026-09-30
---

# 0061 — Guest languages and publication v3

## Context

The guest surface reads in two languages today (en, bg), and every place that
said so spelled the pair out on its own: the database CHECKs, the event
schemas, the snapshot reader, the guest session and the manager forms. Round 4
of the Portal redesign (ADR 0044 still governs the guest policy) offers six
languages: en, es, it, fr, de and bg. Getting from two to six touches
immutable evidence:

- A publication snapshot is verified for as long as it exists. Guest response
  evidence points at snapshots through RESTRICT foreign keys, so a v1 or v2
  snapshot, and the v1 language packs it names, must verify forever.
- Web and worker roll separately. A writer that emits a value an older reader
  does not know makes the Portal unavailable: `verifyPortalPublicationSnapshot`
  fails closed on an unknown version, and the digest is recomputed over the
  zod-parsed object, so a field the reader does not know is stripped and the
  digest stops matching.
- The copy for es, it, fr and de is not written yet, and the redesigned guest
  page needs new copy for en and bg too.

## Decision

1. **One catalogue is the only authority for which languages exist.**
   `src/shared/domain/guest-locale.ts` (pure, so domain code may import it)
   lists the six locales, which of them managers may offer today, and which
   language packs exist for each. `src/shared/guest-locale-schemas.ts` holds
   the zod schemas and the SQL renderings built from it. Production code reads
   the catalogue and never spells the set out; an architecture test
   (`guest-locale-literals.test.ts`) fails on a hand-written `'en' | 'bg'`.
   Historical values stay pinned as literals on purpose, because a snapshot
   must verify forever, and each is allowlisted with its reason.
2. **The database is broad and the application is strict.** The CHECK
   constraints on `portals`, `property_portal_brand_contents`,
   `portal_localized_overrides` and `portal_publication_snapshots` accept every
   catalogue locale, and any pack id shaped `guest-ui-<locale>-v<n>`. Which
   locales a manager may offer and which packs exist is decided by the
   application registry, which fails closed. Offering any of the six catalogue
   locales, or adding a pack id for one of them, therefore needs no migration.
   Adding a locale to the catalogue itself needs a new widening migration, and
   `check:schema-drift` fails until one exists. Migration 0043 widened the
   CHECKs; it is hand-written SQL with a journal entry, because `drizzle/meta` stops at
   snapshot 0013. The model renders the same expressions from the catalogue,
   so `pnpm check:schema-drift` compares them at expression level and a parity
   test pins the migration to the catalogue.
3. **Language packs have generations, bound to the snapshot schema.** A pack
   is `guest-ui-<locale>-v<n>`. Generation 1 belongs to snapshot schema
   versions 1 and 2 and is frozen. Generation 2 belongs to schema version 3.
   The verifier rejects a v1 or v2 snapshot that carries a generation 2 pack,
   and a v3 snapshot that carries a generation 1 pack. The set of supported
   packs is append-only.
4. **The guest renderer is chosen by the snapshot's schema version.** Version
   3 and later get the redesigned page. Versions 1 and 2 keep the legacy
   renderer until the Portal is republished. There is no separate feature
   flag: the snapshot is the switch.
5. **A missing text is materialised at publish time.** When a text is missing
   in a locale, the publication copies the Portal's fallback-language text
   into the snapshot and tags it with its source language (`fallbackFrom`).
   The guest never resolves a fallback at read time, so what a guest read is
   exactly what the snapshot says.
6. **Readers ship before writers.** Every widened enum, CHECK constraint and
   new schema version first ships in a release that only reads it. Migration
   0043 and the widened readers (event schemas, the Portal mapper, the
   experience mapper, the additional-locales cap) are that release for
   locales. Writers accept only the locales in `OFFERED_GUEST_LOCALES`. A
   language is added there when its pack is registered in the catalogue; during
   the closed beta that happens when the pack is drafted, with no
   native-speaker check (owner decision, 2026-09-30). Any later guest-visible
   field needs its own schema version and its own reader-first release.
7. **The manager app stays English.** Guest languages are a property of the
   guest page. Geographic availability is not localization (BETA.md §3), and
   the operational email stays English.

## Consequences

- Offering a language later is a registry entry and a pack, not a migration.
  The database accepts any of the six from migration 0043 on.
- The application, not the database, is what keeps an unregistered language away
  from guests. A snapshot row naming `guest-ui-de-v2` passes the CHECK and is
  still rejected by the reader; an integration test proves both halves.
- Re-narrowing the CHECKs is safe only while no row uses a new locale. That
  holds until the first non-en, non-bg language is offered.
- The same catalogue feeds events, DTOs, mappers and schema. Offering one of
  the six is one edit and a migration-free release; adding a seventh locale to
  the catalogue is one edit plus a widening migration, which drift detection
  demands.
