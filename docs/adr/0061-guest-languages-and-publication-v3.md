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
- The copy for es, it, fr and de was not written when this ADR was accepted
  (slice 41 drafted it, see Amendment 1), and the redesigned guest page needed
  new copy for en and bg too.

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
7. **Schema version 3 has one complete shape, and is read before it is
   written.** Release A (this ADR, slice 8) ships the v3 reader, the verifier
   and the resolver with no writer, so the JSON shape is fixed in full now. The
   digest is recomputed over the zod-parsed object, so a field the reader does
   not name would be stripped, change the digest and make the portal
   unavailable; a later field therefore needs a v4. A v3 configuration
   carries the locale set (primary first), generation 2 packs, per-locale
   title, short description, hero alt text and Linktree title (each
   `{value, fallbackFrom}`), the Linktree switch, a flat ordered link list
   with per-locale wording, the brand profile (display name, wordmark, logo
   and hero by asset id, accent and field colour, look version), the time zone
   and optional provenance for history. The verifier requires every locale to
   be complete, the primary never to be a fallback, and every fallback to be
   an exact copy of another locale's own text. Media is an asset id in the
   snapshot and a URL only when a page is read, so a takedown reaches an
   immutable snapshot; until Portal media exists the resolver serves none.
   `shortDescription` is kept for `og:description` only and is never rendered.
   Provenance never leaves the server. A switched-off Linktree serves no links
   at all, in either response shape, so none can be followed by id. The time
   zone must be a canonical IANA name (`Europe/Sofia`), never an offset or an
   abbreviation. The mirrored `brand_profile_version` column holds the Property
   Brand Profile version on a v2 row and the look version on a v3 row; the
   organisation export emits it under the same name.
8. **The manager app stays English.** Guest languages are a property of the
   guest page. Geographic availability is not localization (BETA.md §3), and
   the operational email stays English.

9. **The writer switched (2026-10-01, slice 19).** Publishing writes schema
   version 3 and nothing else; the silent fallback to a version 1 snapshot is
   gone. A publication source is resolved by one pure function, which the
   builder, the in-transaction comparison and the history read all use, so they
   cannot disagree about what a publication is: a gap in the primary language
   blocks publishing, a gap in another language is copied from the primary and
   tagged `fallbackFrom`, the Linktree title reads its pack default and is never
   copied, a language with no generation 2 pack cannot be published, a Property
   with no Brand Profile publishes the default look (champagne on a dark
   field), and an image that may no longer be served is left out. The pack a
   publication writes is `currentGuestLanguagePack(locale, 2)`. Links are
   flattened in category-then-link order, and categories reach no snapshot. A
   v1 or v2 snapshot never matches a working copy, so a Portal published before
   the switch reads as having changes to publish until it is published again;
   until then it keeps the legacy renderer, which the public route still
   chooses by `schemaVersion`.

## Consequences

- Offering a language later is a registry entry and a pack, not a migration.
  The database accepts any of the six from migration 0043 on.
- The application, not the database, is what keeps an unregistered language away
  from guests. A snapshot row naming a pack the registry does not hold, such
  as `guest-ui-de-v3`, passes the CHECK and is still rejected by the reader; an
  integration test proves both halves.
- Re-narrowing the CHECKs is safe only while no row uses a new locale. That
  held until the first non-en, non-bg language was offered; since Amendment 1
  a Portal may use any of the six, so the CHECKs stay wide.
- The same catalogue feeds events, DTOs, mappers and schema. Offering one of
  the six is one edit and a migration-free release; adding a seventh locale to
  the catalogue is one edit plus a widening migration, which drift detection
  demands.

## Amendment 1 — es, it, fr and de are offered (round 4, slice 41)

The four packs `guest-ui-es-v2`, `guest-ui-it-v2`, `guest-ui-fr-v2` and
`guest-ui-de-v2` are registered, each as a generation 2 pack with no generation
1 pack (these languages never had a legacy page, so `current` stays null for
them), and all six locales are in `OFFERED_GUEST_LOCALES`. Per owner decision 5
(2026-09-30) there is no native-speaker check during the closed beta: a
language is offered when its pack is drafted.

- **No migration and no new reader.** The CHECKs have admitted all six since
  0043, and the verifier, the resolver and the writer already read the pack
  registry. The registry and the packs ship in one release, so web and worker
  deploy together: a reader built before it refuses a snapshot that names one
  of the new packs, as it must.
- **Register of address.** German is the formal "Sie" (the owner's German
  glossary and round 4 board G10). French uses "vous", Spanish "usted", and
  Italian "Lei" in sentences with the short imperative on buttons. The private
  note is a "Nachricht" / "message" where "note" would collide with the rating
  in French; a pack test pins each register so a pack never mixes two.
- **Template slots drive wording.** The property name never follows "de" in
  French (it would need an elision before a vowel), and the French deadline
  names the zone in brackets for the same reason.
- **One loader entry per pack.** `loadGuestPortalCopyV2` reaches each pack
  through its own dynamic import, so a request still ships one language. The
  Linktree default title is pinned beside the Linktree rules for every
  language, and a test holds it to the pack's own wording.
- **Rollback.** Removing a language from `OFFERED_GUEST_LOCALES` stops
  managers choosing it; it must not remove its pack or its registry entry,
  because a snapshot that names the pack must verify for as long as it exists.
