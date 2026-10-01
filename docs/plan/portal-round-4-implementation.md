# Round 4 portal redesign: final implementation plan

**Scope.** This plan covers two approved designs:

- the guest page ("Immersive Hub", boards G01–G12);
- the admin workspace ("A+ Workspace", 14 boards).

The owner approved both on 2026-09-30. The plan was checked against `/Users/bozhidardenev/kodes/worktrees/rk-portal-round-4`, a clean checkout of `main` at 22010bfb1. Paths are relative to that root. Every file and line reference, and every point from the review, was re-checked in the code.

---

## 1. Goal and scope

### What "done" means for round 4

1. **The guest page is live for newly published portals.** It has:
   - the photo look, or the no-photo look (G09 is the production default until uploads are allowed);
   - a wordmark or a logo;
   - a language chip and sheet that list only the portal's own languages;
   - the new rating card;
   - the after-rating layout, with the Google card first and identical for ratings 1–5;
   - a private-note card that appears only at or below the threshold;
   - the Linktree in every state;
   - the "Your response" section;
   - the visit notice inline in the footer;
   - the restyled unavailable page;
   - self-hosted Cormorant Garamond and Ysabeau Office;
   - its own first-paint checks.
2. **Six languages (en, es, it, fr, de, bg) work end to end.** This covers the database checks, the types, publication snapshot v3, the guest session and `<html lang>`.
   - en and bg ship with new copy packs (`guest-ui-<locale>-v2`).
   - es, it, fr and de are offered to managers as soon as their packs are drafted (owner decision 5: no native-speaker check during the closed beta).
   - Each property sets default languages, and each portal picks its own. A portal with one language shows no language switch.
   - When a text is missing in a language, the portal's fallback-language text is copied into the snapshot at publish time and tagged with its source language.
3. **The admin workspace works end to end, without uploads and without AI:**
   - the Portals overview: grouped, with results, status shown only when something needs attention, a phone layout, and an All properties view;
   - the New portal dialog;
   - the editor: section list, autosaved draft, Linktree, Languages and live preview;
   - Review & publish, including publishing changes while a portal is live;
   - Share, including "Download again" for an existing code, backed by an encrypted copy of the address;
   - Results with honest measures;
   - History, with "Make live again";
   - groups: move a portal, a group page, a goal card and group history;
   - Property look, without photo upload.
4. **Governance changes ship in the same PRs as the behaviour they describe:**
   - ADR 0061 for languages, snapshot v3 and pack generations; `docs/adr` currently ends at 0060;
   - further ADRs for the encrypted address and for portal media;
   - edits to the Portal `CONTEXT.md` invariants 4, 9 and 11;
   - `docs/BETA.md` §3 (Portal and Properties bullets) and §8;
   - the capability fates.

### Explicitly deferred (built dark, or not started)

- **Uploads are not switched on.** This covers the property photo, link-tile photos and the logo. The code ships dark behind `portal.upload`, which stays `safety_blocked` (`src/shared/governance/capability-fate.ts:122-126`). Switching it on needs the signed SAFE-01 completion record (ADR 0032, BETA.md §8).
- **AI translation is not switched on.** A fourth AI capability would:
  - change the merchant AI notice, which turns off all AI for every enabled property until an AccountAdmin consents again;
  - need 14 days' notice to participants for the privacy-notice change.

  Languages and manual translation ship first. The AI capability is a separate later release, gated by an owner decision.

- **Deferred, and needing the owner's agreement (listed in §5):**
  - the print-kit PDF beyond the small version of slice 45 (the Share board also shows an NFC card, a sticker and a poster);
  - counting "Guests by language" from private ratings rather than qualified scans (the board caption says scans).
- **Deferred by us:**
  - localized `/privacy` legal documents (the link label is localized, the notice stays English);
  - an Inbox portal facet and the "N waiting in Inbox" figure;
  - separate QR and NFC measures;
  - removing the legacy guest renderer, which waits until every v1/v2 snapshot has been republished.
- **Out of scope:** widening the property classifications in `docs/BETA.md:37` (barbers and salons are not listed). That belongs to the Property context and needs the owner (§5). The v2 guest copy is written industry-neutral anyway: "visit", never "stay".

---

## 2. Principles for the build

1. **Bounded contexts stay intact.**
   - Portal owns the model, the snapshot, codes, groups, the history ledger and media.
   - Guest owns the session and response capture.
   - Reporting owns measures.
   - AI owns the provider call.
   - Code crosses context lines only through `application/public-api.ts` (ADR 0008, `src/shared/architecture/cross-context-public-api.test.ts`).
   - Components value-import only `createServerFn` results (`scripts/check-component-boundaries.mjs`).
   - Layer rules come from `eslint.config.js:263`: domain code may import only `src/shared/domain/**`. So pure shared code that a domain uses lives in `src/shared/domain/`, and zod schemas and SQL fragments live elsewhere in `src/shared`.
2. **The capability fate is the only switch for risky features.**
   - `portal.upload` stays `safety_blocked`.
   - A new AI capability needs an explicit fate, or it does not compile (`capability-fate.ts` is `satisfies Record<Capability, …>`).
   - `BETA_ALLOWLIST_ORGS` can open only `controlled_beta` capabilities.
3. **The guest redesign is gated by snapshot schema, not by a new flag.**
   - The renderer is chosen by `schemaVersion >= 3`. v1/v2 snapshots get the legacy renderer; v3 snapshots get the Immersive Hub.
   - The verifier ties schema and pack generation together. It rejects a v1/v2 snapshot with a v2 pack, and a v3 snapshot with a v1 pack.
   - New publications write v3 in exactly one slice (19). Until then the redesign merges to `main` and is developed in Storybook and in the admin preview.
   - Two things reach guests on merge, and are called out where they happen:
     - the unavailable page (slice 17), because it has no snapshot to gate on;
     - the guest font strategy (slice 7), which keeps legacy pages on today's fonts.
4. **Readers ship before writers.**
   - Every widened enum, CHECK constraint and new `schemaVersion` first ships in a release that only reads it. Web and worker roll separately, and `verifyPortalPublicationSnapshot` fails closed on an unknown version.
   - The v3 JSON shape is fixed completely in slice 8. The digest is recomputed over the zod-parsed object (`portal-publication.repository.ts:187-216` → `application/portal-publication-snapshot.ts:16,226`), so a field the reader does not know would be stripped, change the digest, and make the portal unavailable.
   - Any later guest-visible field therefore needs v4, with its own reader-first release.
5. **Snapshots are immutable and must verify forever.** Guest-response evidence points at snapshots through RESTRICT foreign keys, so historical v1/v2 rows and v1 packs must always verify. Historical constants are pinned as literals, never derived from a "current" value. Golden fixtures of real v1/v2 rows and their digests (slice 0) guard every slice that touches the snapshot.
6. **No big-bang merges.**
   - Each slice is one PR, keeps CI green, and auto-merges when the required checks pass (standing owner rule).
   - Anything data-destructive, any fate change, and any legal-copy or BETA.md change waits for the owner.
   - Ratcheted files are split before they grow. `scripts/ci/file-length.baseline.json` pins:

     | File                                        | Baseline |
     | ------------------------------------------- | -------- |
     | `events.ts`                                 | 1016     |
     | `portal-command-store.ts`                   | 2045     |
     | `schema-registrations.ts`                   | 1741     |
     | `scripts/seed-e2e-user.ts`                  | 1399     |
     | `src/shared/testing/scenarios/executors.ts` | 1335     |

     `portal.schema.ts` has no baseline and is already over the limit: 831 non-blank lines against 800 counted lines. Slice 0 splits it.
7. **Tests come first** (repository rules: TDD and 80% coverage).
   - Every new pure module gets a colocated unit test.
   - Every new command also gets an entry in `src/shared/testing/in-memory-portal-command-store.ts`.
   - Every new table gets two-organisation repository tests and data-fate, export and purge coverage.
   - The vitest `unit` project runs in `environment: 'node'` (`vitest.config.ts:100-101`) and has no jsdom or testing-library. DOM assertions therefore use `react-dom/server` `renderToStaticMarkup` or Storybook play tests.
   - Integration suites use a per-branch `TEST_DATABASE_URL`, and all tests run on the Node version pinned by fnm.
8. **Events carry identifiers only** (ADR 0030, `content-free-facts.test.ts`). Wording, alt text, names and previous names live in Portal-owned ledger and text tables.

**Standard gates** (every slice):

- `pnpm typecheck`;
- `pnpm lint` (ESLint with the 300-line component limit, architecture boundaries, filenames, component boundaries, product-state consistency);
- `pnpm check:file-length`;
- `pnpm check:changed-code`;
- `pnpm check:unchecked-indexed-access`;
- `pnpm check:typescript-project-coverage`;
- `check-test-quality` (from `lint:ci`);
- `pnpm test`;
- `pnpm format:check`.

---

## 3. Phases and PR slices

Each slice below lists: goal, scope, model changes, tests, gates beyond the standard set, dependencies, size, risk, and whether it needs the owner or ops.

### Phase 0: foundations (no guest-visible change)

**0. Split `portal.schema.ts`, capture golden snapshots (F0).** Details in §6.

- Move the publication tables (snapshots, activations, pending content changes; lines 470–745) into `src/shared/db/schema/portal-publication.schema.ts`.
- Update the `schemaFile`/`exportName` keys in `data-fate-authority.ts`.
- Capture v1/v2 snapshot golden fixtures.
- Depends on nothing. Size M. No owner action.

**1. Shared guest-locale catalogue and pack registry (F1).** Details in §6.

- Two modules:
  - pure `src/shared/domain/guest-locale.ts`;
  - `src/shared/guest-locale-schemas.ts` (zod schemas and SQL fragments).
- Pinned historical pack literals.
- One `isLocalizedConfiguration` helper replaces the eleven `schemaVersion === 2` branches.
- An exhaustive version switch in the verifier.
- The silent en/bg coercions are removed.
- One intended behaviour change: `selectPortalGuestLocale` now honours Accept-Language q-values. It has its own test.
- Depends on 0. Size L (mechanical, about 35 files). No owner action.

**2. Migration 0043: CHECKs for six locales, wider readers, ADR 0061 (F2).** Details in §6.

- Hand-written SQL plus a journal entry. No drizzle snapshot, because `drizzle/meta` stops at `0013_snapshot.json`.
- Depends on 1. Size M. No owner action; ops deploys as usual.

**3. Results measures tell the truth (R1).**

- **Goal:**
  - count qualified scans instead of raw `portal.scan`;
  - count Google opens only (today `getPortalKpiSums` sums secondary-link clicks in);
  - hold back the average below 5 private ratings;
  - return absolute prior values.
- **Scope:** `src/contexts/reporting/**` and the existing analytics tab.
  - **Repository** (`infrastructure/repositories/portal-analytics.repository.ts`):
    - Add `QUALIFIED_SCAN_POLICY = portalMetricPolicy(METRIC_VERSION_IDS.qualifiedScanGoal)` and use it in place of `PORTAL_SCAN_POLICY` in `PORTAL_ANALYTICS_POLICIES`.
    - The evidence family `scans` uses `guest.qualified_scan.recorded` and `guest.qualified_scan.retracted`; retraction handling follows `goal-metric-source-status.ts`.
    - Add the predicate `(metric_key <> 'portal.review_link_click' OR portal_destination_kind = 'google_review')`.
    - Add `countUnattributedDestinationClicks`. When it finds any, the Google-opens evidence is `insufficient` with reason `destination_unattributed`.
  - **Domain:** new `reporting/domain/portal-results-thresholds.ts` defines `PORTAL_AVERAGE_MIN_SAMPLE = 5`, `MIN_RATING_COMPARISON_SAMPLE = 10`, `isAverageShowable` and `isComparisonShowable`.
    - `application/utils.ts:48` imports from it instead of defining the constant. This is the right direction: domain must not import from application.
    - The duplicate constant in `components/features/property/property-overview.tsx:35` is left for a follow-up.
  - **Use case:** in `PortalKPIs` (`domain/dashboard-types.ts:137`, already separate from the property `KPIs` at :46), rename `reviewLinkClicks` to `googleOpens`. `scans` now means qualified scans. Count KPIs gain `priorValue: number | null`. The average is `null` with evidence `insufficient` below the floor.
  - **Lifetime:** `portal-lifetime-analytics.ts:105` uses only `googleReviewSelectionCount`.
  - **UI:**
    - labels become "Qualified scans", "Private ratings", "Average private rating (n = …)", "Guests who opened Google" and "Private notes";
    - "Too few" is driven by the server's `insufficient` state and `n`, with no constant in the client;
    - the funnel is qualified scans → ratings → Google opens. Qualified scans exist only from 2026-08-01, so earlier windows can show more ratings than scans. When a step exceeds the one before it, the funnel shows counts only, with an evidence note, and never a percentage over 100.
- **Model changes:** none.
- **Tests:**
  - repository integration: secondary clicks excluded, null-kind readings flagged, retractions subtracted, raw scans ignored;
  - use case: n = 4 gives `null`, n = 5 shows the average, the comparison floor of 10, `priorValue`, all-time uses Google selections only;
  - threshold unit test;
  - funnel presentation test with more ratings than scans;
  - Storybook with axe.
- **Gates:** standard, plus integration. If `portal-analytics.repository.ts` (551 lines) passes about 600, extract `portal-analytics-evidence.sql.ts`.
- **Depends on:** nothing. **Size:** M.
- **Risk:** visible numbers drop. The evidence lines and "Data through" say why.
- **Owner:** no. The design names these measures. Property dashboard and Fleet vocabulary follow in slice 24.

**4. Headroom splits in ratcheted files (F3).**

- **Goal:** room for new commands and events without growing ratcheted files.
- **Scope:**
  - Move group events to `src/contexts/portal/domain/portal-group-events.ts` and link events to `domain/portal-link-events.ts`. These are flat files, never a `domain/events/` folder next to `events.ts`. `events.ts` re-exports them unchanged.
  - Move link, group and token commands out of `portal-command-store.ts` into `infrastructure/portal-link-commands.ts`, `portal-group-commands.ts` and `portal-token-commands.ts`, composed behind the same `PortalCommandStore` port and the same `commandStore` dependency.
  - Lower the baselines.
- **Model changes:** none.
- **Tests stay green:** `portal-atomic-lifecycle.test.ts` (which asserts `createAtomicPortalCommandStore(deps.db)`), `portal-command-store.integration.test.ts`, `events.test.ts` and the in-memory store tests.
- **Gates:** standard.
- **Depends on:** 1 (to avoid rebasing over the same lines). **Size:** M.
- **Risk:** the ADR 0060 lock order must be kept byte for byte. **Owner:** no.

**5. One working-copy reader (F4).**

- **Goal:** replace the three places that assemble the working copy with one `readPortalWorkingCopy(executor, scope)`:
  - `PortalPublicationRepository.loadWorkingCopy`;
  - `assertSnapshotMatchesCommittedWorkingCopy` (`portal-command-store.ts:553-775`);
  - `comparableWorkingContent`/`publishedContent` (`get-portal-publication-history.ts`).
- The `LOCK TABLE` list lives next to the reader.
- **Model changes:** none.
- **Tests:**
  - new `portal-working-copy.reader.integration.test.ts`: identical output for publish, in-transaction verification and history;
  - golden fixtures captured before the refactor;
  - existing publish, rollback and history tests.
- **Depends on:** 4. **Size:** L.
- **Risk:** if the readers drift, every publish fails with `revision_conflict`. **Owner:** no.

**6. Guest page: pure view and container; anti-gating test (G1).**

- **Goal:**
  - Split `PublicPortalContent` into a pure `GuestPageView` and the container bound to the token.
  - Add a controlled `previewState` (arrival | rated(n) | note-writing | done | googleUnavailable) that never mounts server actions.
  - Use height relative to the container, so the view fits a phone frame.
- **No visual change.** The three manager previews keep compiling.
- **Tests:**
  - an anti-gating test that uses `renderToStaticMarkup` over `GuestPageView` for ratings 1–5, both note-eligible and not eligible, and asserts the same DOM position, accessible name and copy for the Google card;
  - Storybook stories per state.

  This closes a governance gap. ADR 0044 line 29 says the invariant "is enforced by architectural test", but no such test exists. This slice adds it and links it from the ADR.

- **Gates:** standard, `pnpm test:storybook`, `check:product-state-consistency`.
- **Depends on:** 1 (it touches `portal-localization.ts`). **Size:** M. **Owner:** no.

**7. Self-hosted guest fonts; app fonts kept on legacy pages (G2).**

- **Goal:**
  - Vendor woff2 subsets of Cormorant Garamond (600, 500 italic) and Ysabeau Office (400, 600), in latin, latin-ext, cyrillic and cyrillic-ext. Both are OFL. They go under `public/fonts/guest/`, with `font-display: swap` and fallbacks adjusted for size.
  - A child route's `head` cannot remove the root stylesheet (`src/routes/__root.tsx:16,43`), and `src/styles.css:1-2` @imports Satoshi, Plus Jakarta Sans and JetBrains Mono for every page. So:
    - move those two `@import`s out of `styles.css` (Tailwind stays) into `<link>` tags added by the root `head` from `matches`;
    - `/p/$token` declares a `fontSet` (`'app' | 'guest'`) from its loader, according to whether the resolved snapshot is v3;
    - legacy v1/v2 pages keep the app fonts, so nothing a guest sees changes before slice 19;
    - the guest `@font-face` CSS and the preload of the above-the-fold pair apply only for `'guest'`.
  - Record a guest-surface exception in `DESIGN.md`.
- **Tests:**
  - `e2e/helpers/request-log.ts`: `/p` with a v3 fixture makes no third-party requests, while `/p` with v2 still loads today's fonts;
  - a Storybook story with `lang=bg` for local Bulgarian letterforms;
  - login, `/privacy` and invite pages keep their fonts (visual check);
  - `security-headers.test.ts` is unchanged (`font-src 'self'` suffices).
- **Gates:** standard, `pnpm build && pnpm check:bundles`, `pnpm check:security-headers`.
  - Every emitted `.css` file counts toward the closure (`scripts/check-bundle-budget.mjs:119,226`). The last measurement was 317,727 of 329,105 B, about 11.4 KB of headroom. Re-measure, and record the new figure in the script header.
- **Depends on:** nothing (the v3 branch is inert until slice 19). **Size:** M.
- **Risk:** font load order on app routes. **Owner:** no.
- **Carried forward (from slice 7):**
  - slice 19, or whichever slice first seeds a v3 fixture: the v3 guest journey calls `assertNoFontCdnRequests()` and asserts that `/fonts/guest/guest-fonts.css` and the preloaded pair are requested;
  - the guest fonts have unversioned names and Nitro's static defaults (ETag, no max-age). A long immutable cache needs versioned paths (`/fonts/guest/v1/`) and a `Cache-Control: public, max-age=31536000, immutable` route rule;
  - stock Android has neither Times New Roman nor Arial, so the size-adjusted fallbacks do nothing there. Add measured Noto Serif and Roboto fallback faces;
  - slice 17's unavailable page and slice 30's live preview render the guest look without guest loader data: each links `GUEST_FONT_STYLESHEET` itself (or adds a route `staticData` flag).

### Phase 1: release A, snapshot v3 reader and content models

**8. Snapshot schemaVersion 3: complete shape, reader and verifier (F5).**

- **Goal:** fix the complete v3 JSON schema now, so no later slice changes it:
  - `localeSet` (1–6, primary first);
  - `languagePackVersions` (v2 packs only);
  - `localizedContent[locale]`: `{title, shortDescription, heroAlt, linktreeTitle}`, each text as `{value, fallbackFrom: GuestLocale | null}`;
  - `linktree: {enabled}`;
  - flat ordered `links[]`: `{id, url, iconKey | null, imageAssetId | null, texts[locale]: {label, line | null, fallbackFrom}}`;
  - `brandProfile`: `{displayName, wordmark | null, logo: {assetId, width, height} | null, hero: {assetId, width, height, focalX, focalY} | null, accentColour, fieldColour, lookVersion}`;
  - `timeZone`;
  - an optional `provenance: {aiDraftTextKeys: string[]}` for history. It is never exposed in the public DTO.
- Media is referenced by asset id and turned into a URL when the page is read, so a takedown works on immutable snapshots.
- **Verifier:**
  - an exhaustive switch over versions 1, 2 and 3, replacing `!== PORTAL_PUBLICATION_SCHEMA_VERSION` at `application/portal-publication-snapshot.ts:201`;
  - v3 requires every locale to be complete (fallbacks are materialised at publish), v2 pack versions, and consistent `fallbackFrom`;
  - v1/v2 keep their exact current checks.
- **Resolver:**
  - maps v3 into the extended `PublicPortalResult` (`application/public-api.ts`);
  - the guest `toPublicPortalLoaderData` allowlist is extended, and every new field goes into the resolved-configuration digest;
  - `renderer: 'legacy' | 'immersive'` is derived from `schemaVersion`. Slice 7 already ships it as `guestSurface` on `PublicPortalResult` (`guestSurfaceOfConfiguration`, `schemaVersion >= 3`), and the guest fonts follow it; reuse that field rather than adding a second one.
  - The verifier ties pack generation to schema, and a test fails if they can diverge: v3 requires generation 2 packs, v1/v2 generation 1. Nothing enforces this before this slice (only the hard-coded generation 1 checks in `resolve-public-portal-token.ts` and `portal-experience.ts`).
- `portal-command-store.ts:781-795` writes the mirror columns from v3 correctly. It must never write `['en']` for a bg-primary portal.
- `shortDescription` stays in v3 for `og:description` only and is never rendered. The owner can confirm (§5).
- **No v3 writer in this slice.**
- **Model changes:** none (jsonb).
- **Tests:**
  - v3 build-and-verify fixtures, built by a test-only builder;
  - v1/v2 golden rows still verify;
  - v3 with a v1 pack and v2 with a v2 pack are both rejected;
  - an unknown version fails closed;
  - the resolver (`resolve-public-portal-token.test.ts`);
  - the DTO allowlist (`public-portal.dto.test.ts`: no ids, digests, object keys or provenance);
  - an in-memory store fixture.
- **Gates:** standard, plus integration.
- **Depends on:** 1, 2, 5. **Size:** L.
- **Risk:** the digest is a security boundary. This slice must be deployed and rolled out to web and worker before slice 19. **Owner:** no.

**9. Guest copy packs v2 for en and bg; one pack per request (L1).**

- **Goal:**
  - Define the `GuestPortalCopyV2` key set:
    - rating words per star and the scale ends;
    - "Send privately" and the privacy line;
    - the note card;
    - the response section, including today/tomorrow wording and the "Remove…" confirmation;
    - the language-sheet strings;
    - the short visit notice and the footer;
    - "Useful links";
    - the unavailable page.
  - Use placeholder templates, not functions, so packs serialise to JSON.
  - One module per locale under `public-portal/language-packs/`.
  - The loader returns only the selected pack.
  - v1 en/bg packs stay frozen.
  - Add `guest-ui-en-v2` and `guest-ui-bg-v2` to the supported sets. Slice 8's verifier accepts them only in v3.
  - The copy is industry-neutral ("visit"), because the owner rejected place types.
- **Tests:**
  - table-driven: every key present, plurals for 1/2/5, a pack/locale mismatch throws, v1 byte-identical;
  - SSR-versus-client date formatting per locale (`src/lib/format-date-time.ts`, React #418).
- **Gates:** standard, `check:bundles`.
- **Depends on:** 1. **Size:** L.
- **Owner:** EN is ours. BG needs the native check before slice 19 (it does not block this merge).

**10. Linktree working model (F6).**

- **Goal:** migration 0044, in the new `src/shared/db/schema/portal-localization.schema.ts`:
  - `portal_link_texts`: org, property, portal, link, locale, `label`, `line?`, provenance (defaults to null), `version`, `updated_by`; unique on org + link + locale; tenant foreign key;
  - `portals.linktree_enabled` (default true);
  - `portal_localized_overrides.linktree_title`;
  - a closed-set CHECK on `portal_links.icon_key`;
  - backfill one text row per existing link in the portal's primary language.
- **The column additions go in `portal.schema.ts`, which slice 0 made room for.**
- **Dual write:**
  - `savePortalLinkTexts` also writes `portal_links.label` for the primary locale until slice 44;
  - `createLink` writes both;
  - readers fall back to `portal_links.label` for the primary locale when a text row is missing. This covers links created by old code after the migration but before the deploy.
- **Pending changes:** `savePortalLinkTexts`, the Linktree title and the enabled switch record rows in `portal_pending_content_changes` with structured keys (`link:<id>:text:<locale>`, `linktree:title:<locale>`, `linktree:enabled`). Kind `portal_links` is reused, so no CHECK change is needed.
- **Cap:** at most four links, enforced under the Portal row lock on create. Existing portals with more are kept, but no more can be added.
- **Categories are not collapsed here.** The legacy UI and the v2 builder still use them. The collapse happens in slices 19 (snapshot) and 28 (UI).
- **Tests:**
  - integration: fence, cap, backfill, dual write, fallback for a link with no text row, pending rows recorded;
  - in-memory store entries;
  - data-fate, export and purge rows;
  - `tenant-predicate-canary`.
- **Gates:** standard, `check:schema-drift`, `db:reset`.
- **Depends on:** 0, 2, 4, 5. **Size:** L. **Owner:** no (default for more than four links in §5).

**11. Property look model and default languages (F7).**

- **Goal:** migration 0045.
  - On `property_portal_brand_profiles`:
    - `wordmark varchar(24)`;
    - `background_mode 'auto'|'manual'`;
    - `default_guest_locales jsonb`: a non-empty subset of the six, backfilled from the union of the property's portal locale sets, minimum `["en"]`;
    - `look_version`, split from `version`, so that look edits do not invalidate AI reply drafts in flight (`ai-reply-brand-profile-authority.ts` fences on `version`).
  - `property_portal_brand_contents.hero_alt_text`.
  - A shared pure `src/shared/domain/portal-field-colour.ts` (contrast plus the derived dark field colour) replaces both contrast implementations.
- **Pending changes:**
  - look edits fan out one pending row per live portal, with kind `property_brand_profile` and key `look:*`;
  - edits to the default languages bump neither `look_version` nor `version`, and create no pending rows, because they only seed new portals.
- **Tests:**
  - field-colour vectors: dark, light, saturated and greyscale;
  - the AI reply authority test (version unchanged by look edits);
  - pending-row fan-out;
  - default-locale edits have no side effects.
- **Depends on:** 0, 2, 8. **Size:** L. **Owner:** no.

### Phase 2: Immersive Hub on the guest side (renders only for v3; developed in Storybook)

**12. Glass shell, backdrop, hero and the no-photo state (G3).**

- `GuestBackdrop`, and `GuestHero` with focal point, explicit dimensions and `fetchpriority=high`.
- Glass tokens, an `@supports not (backdrop-filter)` fallback, the G09 arch motif, `color-scheme: dark`.
- Under the immersive renderer, neutralise the global link rule, `html.dark` and `overflow-wrap:anywhere`.
- New files under `public-portal/immersive/`. A resolver replaces `portal-theme-style.ts` for v3.
- **Tests:** stories for G01 and G09 with axe; contrast by construction through the slice 11 vectors.
- Depends on 6, 7, 11. Size L.

**13. Header, title block, language chip and sheet (G4).**

- Wordmark or logo. The `h1` is the portal-title kicker; the display name is the large serif line.
- The chip opens a native `<dialog>` sheet (no Radix in the guest chunk). Each row is `<a hreflang href=?locale=…&accessArtifact=…>` with the catalogue's `chipLabel` (EN, ES, IT, FR, DE, БГ) and native names with `lang`.
- `<html lang>` covers all six (`src/routes/__root.tsx:71`).
- **Tests:** keyboard, focus trap, Esc; the locale-set matrix of 1, 2, 4 and 6 languages (one language shows no chip).
- Depends on 12. Size M.

**14. Rating card and after-rating layout (G5).**

- Outline SVG stars (54 px targets), scale ends, "Send privately", an error banner, the privacy line.
- After a rating, in order: the receipt strip, the Google card (same position for every value), then the note card (collapsed, writing or sent), shown only when the server sets `privateFeedbackEligible`.
- The G08 unavailable-Google card.
- The v3 accessible names are new (for example "1 star, Poor"). The v1 names stay for the legacy renderer, so the current e2e keeps passing.
- **Tests:** the slice 6 anti-gating test on the new DOM; the threshold boundary (3 is offered, 4 is not); stories.
- Depends on 12. Size L.

**15. Linktree in every state (G6).**

- A two-column tile grid, a lucide icon map, per-locale labels with `lang` taken from `fallbackFrom`, and a nav `aria-label` equal to the title.
- Before a rating, skip `selectSecondaryLinkFn` (it returns 404 today) and let the anchor use `GET /api/public/p/:token/click/:linkId`.
- Update e2e (`guest-portal.spec.ts`, `core-surfaces.spec.ts`, `beta-product-journeys.spec.ts`) for v3 portals only. The legacy rule "destinations appear after the rating" stays pinned for v2.
- **Governance:** `docs/BETA.md:38` says the visitor rates first. Amend the Portal bullet, and add a note to ADR 0044, stating that the rating card stays first and dominant while the Linktree is visible from arrival. This needs the owner's sign-off (§5) and must land before slice 19.
- Depends on 8, 12. Size M.
- Default: a tap before any rating is not a Qualified Link Action.

**16. "Your response" section (G7).**

- One collapsible section with four rows. Deadlines use the snapshot `timeZone` with today/tomorrow wording.
- Full withdrawal gets a confirmation step.
- **Tests:** hydration-safe formatting per locale; keyboard.
- Depends on 9, 14. Size M.

**17. Inline visit notice, footer, unavailable page (G8).**

- **v3 only:** the notice sits inline in the footer (no overlay), and visit recording stays independent of acknowledgement. The footer reads "Privacy notice · Made with Reputation Key".
- **Live immediately:** the `PortalUnavailable` restyle. It has no snapshot to gate on, so it reaches guests on merge.
  - It stays identical for every denial reason.
  - Its language does not vary with the token: fixed EN plus BG, per the design.
  - Its three e2e assertions ("Portal Unavailable") change in the same PR.
- `e2e/helpers/guest-consent.ts` gains a v3 path.
- Depends on 12. Size M.
- **Owner:** the short notice copy must still disclose the session cookie and the network marker (ADR 0044). Until the owner rules, the full disclosure copy is used. The v2 packs carry it as `visitNoticeDetail` (session cookie, network marker, no ads or trackers); slice 17 renders that key, not the shorter `visitNotice`, until the owner approves shorter copy.
- **Carried forward (from slice 17):**
  - slice 18: the footer server-renders the acknowledged row (the server cannot read `localStorage`), so an unacknowledged guest sees it swap to the taller notice after hydration. The notice is in flow, so this is a layout shift at the page's end. The CLS observer must measure it on a first visit (no acknowledgement stored), and if it counts, reserve the notice's height until the client snapshot resolves;
  - the footer's two softer texts are white at 92% and 90%, not the boards' 66% and 56%: the boards' values fail AA on the lightest accepted field and on the peak of a painted wash (`immersive-footer-styles.test.ts`). Ask the designer to redraw G01 and G04 with the contrast-safe values;
  - slice 30: the unavailable page no longer links a font stylesheet of its own (`fontSetOfMatches` treats a `/p/$token` match with no loader data as the guest set), but the admin live preview still has no such match and links `GUEST_FONT_STYLESHEET` itself.

**18. Guest quality gate (G9), re-scoped.** There is no `toHaveScreenshot` or LCP harness in `e2e/` today. This slice adds:

- the Storybook geometry gate (`e2e/storybook-metrics/pane-metrics.ts`) extended to the G01–G12 stories at 320, 375 and 768 px: overflow, clipping, touch targets and long German words;
- a Chromium-only Playwright check of LCP (< 2.5 s) and CLS (< 0.1) through a `PerformanceObserver`, on the seeded v3 portal with and without a photo fixture;
- a reduced-motion check;
- the bundle measurement recorded in `check-bundle-budget.mjs`.

Screenshot baselines are deferred until fonts, OS and baseline storage are designed.

- Depends on 12–17. Size L.
- **As built.**
  - **Run it with `pnpm test:guest:quality`** (`scripts/e2e/guest-quality.sh`). It builds Storybook twice and serves each build from this run's own static server (`e2e/storybook-metrics/static-server.ts`, `STORYBOOK_METRICS_STATIC`), so no dev server and no port 3000. The default `pnpm test:storybook:metrics` is unchanged and still runs against the dev server.
    - A **development-flavoured build** (`NODE_ENV=development storybook build`) for the geometry and reduced-motion halves. The stories' `play` functions read the DOM straight after the render, and React's `act` exists only in a development build: in a production one the first `getByRole` finds an empty root.
    - The ordinary **production build** for LCP and CLS, since a development bundle's numbers are React's warnings and unminified code.
  - **Geometry** (`guest-immersive.metrics.ts`, `guest-stories.ts`). All 65 stories of the Immersive Hub and board G12 (`Features/Guest/ImmersiveHeader`, `…Shell`, `…Response`, `…Linktree`, `…Footer`, `…Page`, and `PortalUnavailable`) at 320, 375 and 768 px. A story is opened at 390 px, as its play expects, then the window and every phone frame in it are set to the width under test. The checks are the `pane-metrics.ts` ones: no sideways overflow of the page, its scrollers or the document, nothing clipped by the box that clips it, and every target at least 44 px on its smaller side.
    - The 44 px floor is one number at every width (`Expectations.minimumPx`): the page is only ever a phone-width column, so the Inbox pane's 36 px and 24 px floors do not describe it.
    - A hidden native radio is judged by the `<label>` around it (the 54 px star), not its own 1 px box; an input with no shown label still fails. This is `PaneOptions.hiddenInputUsesLabel`, set by the guest harness only: the Inbox gate still judges an input by its own box.
    - `PaneOptions.hiddenRootBleedIsDecorative` (guest only): a pane with `overflow-x: hidden` is judged by the clip probe alone, which skips `aria-hidden` content. The 390 px arch motif bleeds past a 320 px phone on purpose; a real element that does is still flagged. Proved by making the display name `nowrap`, which goes red at 320 px on `ImmersivePage--german-long-words` and `ImmersiveHeader--long-name-on-narrow-phone`.
    - **A word that overflows its own element** is a probe of its own (`PaneOptions.textMustFitItsBox`, guest only). A block element's box stays its container's width while a word it cannot break runs out of it, so with the root's `scrollWidth` set aside no element box shows it (review found the title was caught only because it is a flex item that grows its own box). Each text node's line boxes (a `Range`) must lie inside the padding box of the nearest ancestor that makes a box, unless that element scrolls or truncates with an ellipsis; `aria-hidden` text is measured, since it is painted (the rating scale's end words are `aria-hidden`). Proved in the harness itself (`a word that overflows its own element`): with `overflow-wrap: normal; hyphens: manual` forced on `.ih-root *`, the tile labels of `ImmersiveLinktree--long-words-at-three-twenty` and `Verbesserungsbedürftig` on `ImmersivePage--german-long-words` go red at 320 px, and the unforced stories are clean.
    - **Accounting.** The list is hand-written, so the first test checks it against Storybook's `/index.json` (`e2e/helpers/story-accounting.ts`, unit-tested): every story under `src/components/features/guest` is measured or excluded with a reason, and every id still exists. The legacy renderer's stories (`GuestPageView`, `GuestResponseForm`, `PublicPortalContent`, `GuestAnalyticsNotice`) and the fonts specimen are excluded by title.
    - **Long German words.** `ImmersivePage--german-long-words` puts "Donaudampfschifffahrtsgesellschaft Kapitän", "Poolterrassenöffnungszeiten" and long compounds in the title, the rating words, the tiles and the footer, on a whole page at page height. The existing `LongWordsAtThreeTwenty`, `G10German` and `LongNameOnNarrowPhone` stories are measured at all three widths too.
  - **Reduced motion.** At 375 px under `prefers-reduced-motion: reduce`, every element and its `::before`/`::after` has no transition or animation longer than 1 ms, and the browser reports no running animation. `src/styles.css` already floors every duration to 0.01 ms for the whole app, and the guest stylesheets add their own `transition: none`; the browser gate cannot tell a dropped guest rule from the global one, so it proves the page is still, not who made it so, and it reads styles at rest (motion that starts on hover, focus or when the sheet opens is not triggered). Proved by raising the global floor to 150 ms and dropping the star's own rule, together with a 28 px footer link: 113 red tests. The guest's own half is a unit test (`guest-reduced-motion.test.ts`): every guest stylesheet that declares a transition or an animation outside a `no-preference` block must carry a `prefers-reduced-motion: reduce` block that turns that kind off, so the page stays still if the global rule is ever narrowed.
  - **LCP and CLS** (`guest-vitals.metrics.ts`, `e2e/helpers/web-vitals.ts`). A `PerformanceObserver` on `largest-contentful-paint` and `layout-shift`, drained before the read, with CLS as the worst session window as Chrome computes it. Budgets: LCP under 2.5 s, CLS under 0.1 (`.claude/rules/web/performance.md`). Four whole pages (photo, no photo, first visit with the footer swap, German long words) at 375x812, 430x932 (the largest footer-swap shift), 768x1024 and 1280x900. The tests run one at a time (`mode: 'default'`), because LCP is a paint time and parallel Chromium instances inflate it. Measured with the stylesheet in the head (below): LCP 172 to 216 ms one tab at a time (468 to 1,112 ms under the default parallelism), CLS 0 to 0.0062.
  - **Measured on a production build,** on this machine with no CPU or network throttling: the largest paint is the display name or the hero, and the figures leave more than a second of room under the 2.5 s budget.
  - **First-visit footer swap.** The story paints the one-row acknowledged footer, then shows the notice two frames later, the same two paints a server render and its hydration make. On a window as tall as the page the footer is pinned to the bottom, so the notice moves its top edge up: that footer is the only element that shifts, and the CLS is 0.0033 at 768x1024, 0.0062 at 430x932 (the largest measured) and 0.0018 at 1280x900. **No height needs reserving** (the worst is 6% of the 0.1 budget), and the slice 17 carry-forward is closed. Proved against a mutation that inserts a 160 px banner above the page after the first paint, which goes red.
  - **The font stylesheet in the head matters; the preloads do not.** `public/fonts/guest/guest-fonts.css` holds the size-adjusted fallback `@font-face` rules and the `--font-guest-*` tokens. A story that links it from its body (after Storybook's runtime has booted) paints the first frame without them, and it measured **CLS 0.141** on the German long-words page at 375 px in three runs of four: the late stylesheet re-wraps the long words. With the stylesheet render-blocking in the document `<head>` and every woff2 delayed 1,500 ms, CLS is 0.0000 to 0.0002 with or without the preloads: the fallbacks hold, and the preloads (slice 7) are an LCP nicety that carries no CLS weight. So what the route must keep is the stylesheet link in the head. **This story-level check does not guard that:** the vitals test builds its head from `fontSetLinks('guest', 'en')` and never renders `__root.tsx`'s `FontSetLinks`, so a route that stopped emitting the stylesheet would stay green here. The guarantee moves to slice 19's seeded-route check (below).
  - **What the gate found.** Story defects, not product ones: the Linktree stories' decorators put the 390 px phone frame inside the shell's padded column (32 px wider than the column it sat in; the first decorator is innermost), and the response stories' stand-in footer link was an 18 px target. Both fixed. The page itself held at every width.
  - **Deviation: not the seeded v3 portal.** The route mounts the Immersive Hub only for a v3 snapshot, and nothing writes one before slice 19 (the seed builds v1 and v2 only, `scripts/seed-e2e-user.ts`). So the check runs on `ImmersivePage`, the real header, rating card, Linktree and footer composed at page height (`__fixtures__/guest-page-composition.tsx`), and the photo is the stories' SVG data URI: the transfer of a real JPEG is not in the number. **Carried forward to slice 19:** repeat the check on the seeded v3 portal, with and without an uploaded photo, using `installWebVitals` / `readWebVitals` / `vitalsViolations`, and call `assertNoFontCdnRequests()` there (slice 7's carry-forward). On that route, assert that the served document's `<head>` holds the guest font stylesheet link (it is what carries the sized fallbacks and the tokens), and measure CLS with the woff2 files throttled, so a head that loses the stylesheet goes red where it can actually happen.
  - **Not in CI.** Like the Inbox gate, `pnpm test:guest:quality` is not wired into `.github/workflows/ci.yml`: about 90 seconds of Chromium plus two Storybook builds on every guest change is a decision about CI budget, and the owner has not made it. Until then, run it before merging a change under `src/components/features/guest`.
  - **Not covered.** Screenshot baselines (deferred, as planned), Firefox and WebKit (`largest-contentful-paint` and `layout-shift` are Chromium-only), a real phone, CPU or network throttling.
  - **Bundle.** Production build of this change merged onto the main it will land on: see the `check-bundle-budget.mjs` header for the figure and the commit it was measured against. The slice adds no production module, so nothing moved; it is recorded there, with the warning that slice 19 will exceed the 271 B of headroom and must raise the budget with its own measurement.

### Phase 3: release B, the writer switch

**19. v3 builder, v2 packs, category flattening (F8).**

- `buildPortalPublicationSnapshot` writes v3 only.
- The silent v1 fallback is removed (`hasCompleteExperience`, `portal-publication.repository.ts:353-356,390`):
  - a property without a brand profile gets the default profile (champagne accent on a dark field);
  - a primary locale with missing text is a readiness **blocker**;
  - a non-primary gap is a **warning**, filled from the primary with `fallbackFrom`.
- Links are flattened in category-then-link order.
- Carried forward from slice 30 (live preview): switch `DRAFT_DESIGN_NOTICE` and the `earlier_design` body in `portal-preview-rules.ts` to wording that is true once Publish writes v3 (and remove the notice), and keep the preview's gap rules in step: a tile's words and Property wording copy the primary in with `fallbackFrom`, the Linktree title per language reads its pack default when none was written.
- Drops the started category's title, which the slice 28 editor writes in the Portal's primary language only so that the legacy guest page does not print an English heading to guests of another language (`startedCategoryTitle`, `src/contexts/portal/domain/portal-linktree.ts`).
- The `current` pack becomes v2 for en and bg.
- `scripts/seed-e2e-user.ts` moves to v3 with no net growth; helpers are extracted if needed.
- **Tests:**
  - full guest e2e on v3;
  - a seeded v2 portal still renders the legacy layout;
  - the in-transaction comparison covers every v3 field;
  - a property with no brand profile publishes v3.
- Depends on 8–18 and the BETA.md amendment from slice 15. Size L.
- **Owner:** native check of BG v2 (blocking; owner decision 5 removed it). **Ops:** deploy only after slice 8 is everywhere.
- **As built.**
  - **The resolver.** `domain/portal-publication-source.ts` is the one function that turns the working copy (`PortalPublicationSource`: languages, the wording each language was given, the look, links in guest order) into a v3 snapshot's content, with the blockers and warnings. The builder, the publish transaction's comparison and the history read all call it, so none can disagree about what a gap means. Blockers: a missing primary title, short description or link label; a language with no generation 2 pack; a Property time zone that is not a canonical IANA name. A copied text is a warning. The hero description is empty (decorative, not missing) when the primary language wrote none or there is no photo. Slice 31's Review & publish should list these same blockers rather than invent its own.
  - **The reader reports facts, not policy.** Unwritten text is null, an image that may not be served (taken down) is absent (the page shows its no-photo look), only approved links are listed, in category-then-link order, and a Property with no Brand Profile has no look: the resolver gives it the default (champagne accent, the derived dark field, the Portal's name as display name, look version 1). The Property time zone is read from `properties` in the same SQL the other portal infrastructure already uses. `lockOrganization` is gone: v3 carries no organisation name. `portal_link_texts` joins the `LOCK TABLE` list.
  - **A v1 or v2 snapshot never matches a working copy** (`workingCopyMatchesSnapshot`): publishing would write v3, so a Portal published before this slice reads as having changes until it is published again (slice 20 makes that one click).
  - **Tests.** The v1 and v2 builders moved verbatim to `application/__fixtures__/legacy-snapshot-builder.ts` so every golden row still verifies and the legacy resolver tests still build their snapshots; nothing in production imports it. The reader integration suite pins each v3 field twice: the reader's output (golden) and one mutation per field that must make the publish transaction refuse a snapshot of the earlier working copy (`revision_conflict`).
  - **Deviation: the route did not mount the Immersive Hub.** The plan (slice 18's note, and "the route mounts the Immersive Hub only for a v3 snapshot") assumed it did. It did not: slices 12 to 17 built the pieces and the preview drew them, but `routes/p/$token.tsx` rendered the legacy page for every snapshot, so switching the writer alone would have left new publications on the old design. This slice adds `ImmersivePublicPortal` (the pure pieces bound to the token, the session and the seven server actions: `guest-response-actions.ts` holds what each choice does, with the failure each card owns, and is tested without a browser), mounts it for `data.immersive`, loads the one copy pack with the loader data, and adds `servedAt` to the loader data so deadlines are written against the server's clock. A Google address that is not https is a failure, not a redirect.
  - **Deviation: the `current` pack.** `GUEST_LANGUAGE_PACKS[locale].current` stays the generation 1 pack: the legacy page resolves a snapshot-less default through it, and flipping it to v2 would make `getGuestPortalCopy` throw. The writer reads `currentGuestLanguagePack(locale, 2)`, which is what "current becomes v2" meant; the registry's comment says so.
  - **Deviation: the started category.** Its title is now the fixed `STARTED_CATEGORY_TITLE` ("Links") and `createLink` no longer reads the Linktree titles; the category commands stay for legacy snapshots. `resolveLinkTexts` also lets a link renamed after its primary text was written read its own label (the window the slice 10 note said slice 19 would reconcile), so the editor, the preview and the writer agree.
  - **Deviation: no browser journey for a seeded v2 portal.** The seed makes P1, P2 and P3 v3 (default look, English and Bulgarian). P2 and P3 are unavailable by design, and a fourth guest-visible portal would change the Property and Portal counts several specs assert. The legacy page's guarantees stay pinned where they were: `resolve-public-portal-token` builds v1 and v2 snapshots with the legacy builder and expects `guestSurface: 'legacy'`, and the legacy components keep their own tests.
  - **The e2e specs are rewritten but were not run.** The slice may not start the local stack. `guest-portal.spec.ts`, `core-surfaces.spec.ts` and `beta-product-journeys.spec.ts` use the v3 accessible names ("2 stars, Fair", "Send privately", the note card, "Your response") and assert the Linktree from arrival. `guest-immersive-quality.spec.ts` is the carry-forward from slice 18 on the seeded portal: the served `<head>` links `/fonts/guest/guest-fonts.css`, no font CDN is contacted, LCP and CLS hold on a first visit (the footer swap), and CLS holds with every woff2 delayed 1.5 s. There is no photo case: uploads are not seeded.
  - **Known gap: the draft preview still draws the Brand Profile's photo and logo addresses** (nominal sizes) while a v3 publication carries only uploaded assets, so a Property whose photo is still a legacy address previews it and publishes the no-photo look. Slice 39 (Property look) puts the asset ids and the focal point into the experience read and the preview together. **Closed by 42c2** (the experience read carries `media`, and the draft preview draws only uploaded assets).

**20. Publish changes while live (F9).**

- `publishPortalChanges`, mutation kind `republish`: close the active activation with reason `replaced` and insert a snapshot and activation in one transaction under `lockPortalPublicationProperty`, with the same readiness gates as publish.
- Emit `portal.publication.published` (extend `assertLifecyclePayloadMatchesPublication`).
- A Property-look publish runs N per-portal commands in sequence and reports the result per portal.
- New `use-cases/publish-portal-changes.ts` and `infrastructure/portal-publication-commands.ts`.
- Add a line to Portal `CONTEXT.md` next to invariant 4: a live portal can be republished, and the previous activation closes as `replaced`.
- **Tests:** integration for the fence and lock order; a no-op when nothing is pending; an in-memory store entry.
- Depends on 4, 5, 19. Size L.
- **As built.**
  - **A command of its own, not a mutation kind.** `republishPortal` is a `PortalCommandStore` command in `infrastructure/portal-publication-commands.ts`, composed like the link, group and token modules. It is not a `republish` kind on `updatePortal`'s `publication` mutation (deviation): `updatePortal`'s patch, Health and locale-set parameters mean nothing to a command that leaves the Portal Published, and a command of its own states exactly what may be written. The module also took over the rows of a snapshot and activation, `closeActivePublication` and the in-transaction comparison, which `updatePortal` now imports from it (`portal-command-store.ts` went from 729 to 628 lines).
  - **The transaction.** Property publication fence (`lockPortalPublicationProperty`), then the Portal row (`UPDATE ... WHERE publication_state = 'published' AND updated_at = expected`), then the working-copy tables and the comparison of the snapshot against the committed rows, then the close of the live activation as `replaced` (exactly one, otherwise `revision_conflict`; a published row with no live activation is refused rather than invented), then the snapshot, the activation, the pending-change resolution and the two facts. That is the order a first publication takes. The activation's `kind` stays `publish` (the CHECK is `publish | rollback` and a republish is a deliberate publication), so there is no migration.
  - **Facts.** `portal.publication.published` (the same fact a first publication emits, quoting the new snapshot's identifier, version and digest, and nothing of its content) and `portal.updated` Published to Published, as rollback does. The store checks both against the command and the snapshot before it opens a transaction; no Health fact is written because nothing about Health changes. `assertLifecyclePayloadMatchesPublication` itself is unchanged: republish has its own check, `assertRepublishFacts`, because the generic one is written around `updatePortal`'s command.
  - **The use case.** `publishPortalChanges` (`portal.update`, the Portal must be Published and have a live version) returns `published` or `unchanged`. It is `unchanged`, with no write, when no change is recorded as open and the draft resolves to what the live version says, which is the question the History tab asks (`hasPendingChanges`); a live version of the earlier design is therefore always pending. The readiness gates (Property active, verified Google destination, a responsible manager, a resolvable public address, then the builder's blockers) are the ones a first publication asks: they moved to `application/portal-publication-readiness.ts`, which `updatePortal` also uses, so "ready" means one thing. A Portal with nothing to publish is not asked any of them.
  - **A Property-look publish.** `publishPortalsChanges` runs the single command for each named Portal in the order given (a Portal named twice is published once) and returns each one's `published`, `unchanged` or `failed` with the Portal error's code and message. One that cannot be published does not hold back the rest; a fault that is not a Portal error stops the batch, and running it again is safe because a Portal that went live reads as `unchanged`. A batch is 1 to 50 Portals (the DTO bounds it).
  - **Server functions.** `publishPortalChanges` and `publishPortalsChanges` (`server/portal-publish-changes.ts`) are in place for slices 31 and 39. Each Portal named is scope-checked for `portal.update` and the `portal.write` capability before the first is published, so a Portal outside the actor's scope refuses the whole request.
  - **Tests.** Use case (including every gate and the batch), the DTO, the server functions, the store composition, the in-memory store entry (which refuses a Portal that is not Published, like the real one), and a real-PostgreSQL suite: the replacement, the served version, the facts, pending-change resolution, stale revision, drifted draft, a fact that cannot be written (everything rolls back), a Portal that is not Published, no live activation, an inconsistent command, two competing republishes, waiting for the Property fence, and the Portal-first order against a content edit.

### Phase 4: admin workspace and supporting reads (starts alongside Phase 2 once 0–5 have merged)

**21. Workspace shell and routes (A1).**

- A tested pure `isWorkspaceRoute(pathname)`, used by `_authenticated.tsx` and `$propertyId.tsx`.
- `$portalId.tsx` becomes a layout route with `index` and `review` children.
- The tab search becomes `page|share|results|history`, and legacy values are mapped (`settings`/`links` → `page`, `analytics` → `results`).
- `PortalWorkspaceShell` and `PortalWorkspaceHeader`.
- **Tests:** `portal-detail-rules.test.ts`, `notification-templates.test.ts`, `safe-return-path.test.ts`; `routeTree.gen.ts` regenerated.
- Size L.

**22. Shared UI pieces (A2).**

- `ui/radio-group` and a segmented control, from the shadcn CLI.
- Hoist `CaseFact` to `ui/fact.tsx`; extract `MetricStrip`; add an owner disc.
- Inbox stories stay green. Size S.

**23. Batched portal overview read (F10).**

- `listPortalOverview({propertyId}|{organization})` returns, per portal: locales, health and reason, pending-change count, group, responsible managers, token summary and publication state.
- Scoped like `listPortals`. Adds `listActiveForPortals`.
- Deletes the dead `PortalRepository.findGroupIdsByPortalIds` and its in-memory stub.
- Size M.
- **As built.** Input is a discriminated `scope`: `{ scope: 'organization' }` or `{ scope: 'property', propertyId }`, with optional `propertyIds` narrowing the organization scope. The server function is `listPortalOverview`. Rows carry responsible managers as user ids only, and no live-version field. Slice 25 must resolve manager display names itself (per Property through the eligible-manager read, not per Portal).

**24. Batched results overview read (R2).**

- `getPortalResultsOverview({scope, portals, properties, timeRange, compare})` returns Portal rows, Portal Group rows, one "not in a group" row and one subtotal row per Property, and a total, for the five measures, with evidence states and never a coerced zero. Every row also carries the scan funnel.
- **Each Property is read through its own window.** The caller lists each Property's time zone; Reporting builds the window with the same `timeRangeToDates` and `priorPeriodDates` a Portal's own Results view uses. Properties in the same time zone share one read, so the statements follow the number of distinct time zones, not Portals. The total adds Property readings and carries no period of its own; each Property row carries its `period` and `comparePeriod`.
- **All Time is not read here.** `timeRange` excludes `all`, because a lifetime figure comes from the lifetime aggregate, not from readings, and the two would disagree. Slice 25 hides the All time choice on the overview (it stays on a single Portal's Results view).
- A group speaks for every Portal whose readings in the window sit under it, counted or not (`readingGroups`), so a Portal that moved out is not left out of its old group's evidence. Rows split `memberPortalIds` (the Portals in the group today, for "3 portals") from `contributingPortalIds`.
- Known limit: a source fact that no consumer has applied yet has no reading, so its group is not known. A moved Portal's still-unapplied facts show as "updating" on its current group and Portal row, and on an old group only once a reading exists there. The outbox fact carries `portalGroupId`; reading it would take a second outbox scan.
- Known cost: the evidence statement filters the outbox on `payload->>'occurredAt'`, which no index covers, so each read scans the Organization's guest events from all time (about 1.2 s for 690k rows). It grows with history and is tracked as a follow-up (an expression index, or a `created_at` prefilter once late arrival is bounded); the single-Portal read has the same shape.
- Benchmark it, and avoid the CTE shape that made the Fleet projection quadratic.
- Align the property dashboard and Fleet scan vocabulary as a follow-up.
- Depends on 3. Size L.

**25. Portals overview (A3), two PRs.**

- **(a)** A table with one `<tbody>` per group, a pure `portal-attention.ts`, a row menu, the phone card layout in the same component, and URL state. **`PortalGroupManagement` stays until slice 38 lands.** The theme swatch and badge columns are retired.
- **(b)** The results strip and measure cells, with "Too few".
- Uses the slice 24 read for board 10 ("All properties"): Property subtotal rows, each Property's own window, and the per-Property "not in a group" row. Takes group Portal counts from `memberPortalIds`, and the "% of scans" figures from the row's `engagementFunnel`.
- Depends on 21–24. Size L + M.
- **As built (a).**
  - Data comes from `listPortalOverview` for one Property; responsible managers are named from the organisation member list when the role may read it, and drawn as a disc without initials when not (never as an id).
  - The row's code reads **QR and NFC** whenever the Portal has a code, and **No code yet** otherwise; a code from before access artifacts is not called out here or counted as an issue (it works, and the Share tab alone says its scans are left out of scan-based goals) (one code per Portal, so the board's separate "QR" rows do not occur).
  - The one quiet line is decided by `portal-attention.ts`: a draft, disabled or archived Portal names its state; a live one shows "N issues" (a popover that says what and where to fix it) or "N changes not live"; a live Portal that needs nothing shows nothing.
  - URL state is `q`, `groupBy` (`group` | `none`), `show` (`attention`), `sort` (`name` | `attention`), `dir` and `page`, with the defaults left out. "Most scans" arrives with (b), which adds the measure columns between Portal and Responsible.
  - Group heads have no link and no menu until the group page exists (slice 38); groups fold in local state.
  - The overview read is refetched on arrival (a 5 s `staleTime`, so the loader's fetch is not repeated at once), and every Portal Group write invalidates `portalKeys.overview`.
  - Archived Portals are listed, and so are counted: in the page description and in the group heads. Slice 25b, which takes group counts from `memberPortalIds`, must keep the two counts aligned with this rule.
  - Phone differs from board 11 in two small ways: "New portal" stays in the page header (no sticky bottom action), and there is no "N portals · By group" summary line.
  - Archive and Restore need the organisation's `portal.write` capability as well as the role, because the server refuses both without it.

- **As built (b).**
  - The read gained what a label needs: `thresholds`, and each Property row's `timezone` and `localDays`. `getPortalResultsOverviewFn` (Reporting server) takes one Property: the roster and each Portal's group are Portal's `listPortalOverview` (so `portal.read` scoping applies), the window is cut in the Property's zone, and `dashboard.read` is asked for as on the Results tab. The organisation scope is not wired: no route reads it until slice 40, which adds it beside the All properties page.
  - The page reads results as a separate query, so a slow or refused read never holds the list back. A role without `dashboard.read`, or a beta-dark posture, gets the list without the strip or columns; a real failure says so and offers "Try again".
  - The strip is the Results tab's own cells (`measureCells`), with "% of scans" read from the row's `engagementFunnel`. The window is a viewing preference shared with the Results tab (All time is not offered and falls back to 30 days).
  - Measure columns sit between Portal and Responsible. Group heads carry all five measures and a count from `memberPortalIds`; a draft says "No results until it's published". Below 56 rem the same row carries one summary line ("412 qualified scans · 4.4 ★ from 118").
  - "Sort: Qualified scans" is offered only with results; groups follow their own scans and a row with no figure follows the others. The default sort stays Name, so the list does not reorder when the results arrive.
  - Not built: "Open results" and "N waiting in Inbox" on the strip (no destination or read exists for them yet).
  - Review fixes. The overview reads the stored window first on every render, so a range picked on a Results tab is what the overview shows next; a pick storage refused is held for the page only. A Portal's own refusal while listing (`PortalError`) is answered tagged (403, 404), not as an untagged 500. A Property with more than 1000 Portals gets a tagged `too_many_portals` (422), and the page shows its list without results rather than a "Try again" that can never succeed. While a new window loads, the table and footer are dimmed and `aria-busy` like the strip. The measure headers wrap so the table fits from 56 rem up; `e2e/storybook-metrics/portal-overview.metrics.ts` holds that (no sideways scroll from 900 to 1920 px, cards and one summary line below).

**26. New portal: dialog and server side (A4 + F11).**

- `create` gains `groupId?`, `guestLocales?` (default: the property defaults), `startFrom` and `responsibleManagerUserIds?`, all in one transaction. The slug gets an automatic suffix.
- `duplicatePortal` never copies codes, snapshots or managers.
- `PortalNewDialog`; `/portals/new` becomes a redirect.
- Update the inventory in `portal-form-standards.test.ts` and the in-memory store.
- Depends on 10, 11, 22. Size L.
- **As built.**
  - **No place types** (owner decision): the dialog asks for a name, a group, languages and what to start from, as board 03 draws it. The group choice is left out while the Property has no group, and the copy choice while it has no other Portal.
  - `createPortal` takes `groupId`, `guestLocales`, `startFrom` (`{kind:'property'}` or `{kind:'portal', portalId}`) and `responsibleManagerUserIds`, and commits them with the Portal in one transaction (the group is fenced like a membership change). `CreatePortalCommand.initialResponsibleManagerId` became `initialResponsibleManagerIds` (empty means nobody, with the recovery fact). The create command lives in `portal-create-command.ts` and `portal-create-guards.ts`, out of `portal-command-store.ts`, whose baseline entry is gone.
  - **Deliberate deviation from board 03.** The language chips mark the first chosen language with a "Fallback" label (and the note below names it), which the board does not draw: with English switched off and on again the first chip drawn is no longer the one guests fall back to, so it is marked rather than implied.
  - **Languages.** Default: the Property's default languages (slice 11), or those of the copied Portal; English when there are none. Every catalogue language can be chosen since slice 41.
  - **Copy.** There was no `duplicatePortal` use case to extend, so the copy is part of `create` (`planPortalContentCopy`, a pure plan). It takes the settings, the wording and Linktree title per language, approved links with their categories and link texts, with fresh identifiers, for the languages the new Portal offers. It never takes codes and their artifacts, publication snapshots or activations, responsible managers, health or history. It leaves behind photos and every link whose destination is not approved now (disabled, quarantined, pending, or a legacy URL with no destination); those take no slot of the four-link limit. An archived Portal cannot be a starting point (`portal_inactive`, HTTP 410). Categories are copied with their links: the editor no longer shows them (slice 28), but the legacy guest page still prints them as headings.
  - **Address.** A name whose derived address is taken gets the next free numbered one (`rooftop-pool-2`); a database refusal at commit (two creates at once) is mapped to `slug_taken` and retried once. An address typed by the manager must be free. A name that gives no address (no Latin letters or digits, such as a Cyrillic one) is addressed from the start of the new Portal's id (`portal-` plus 8 hex characters, a longer slice if that is held) instead of a counter, so a Bulgarian-named Property pays one lookup per create and never runs out; the error when fifty numbered addresses are taken says the address, not the name, ran out. The create merges main's group writes (`portal-group-writes`), so a Portal created into a group records the same `portal_added` group history entry as `addPortalToGroup`.
  - `getPortalCreationOptions` returns the Property's default languages and the eligible manager ids; the groups and the Portals to copy come from the reads the Portals page already holds. Manager names come from the member list when the role may read it, and are never replaced by an id.
  - `/portals/new` redirects to `/portals?new=true`; the dialog's open state is the `new` key of the Portals overview URL. The old create form, its preview composite and their stories are gone.

**27. Editor section nav and autosave (A5).**

- A section registry driven by `?section=`, and `usePortalDraftAutosave`, which submits forms and serialises per portal.
- Fields that apply property-wide keep an explicit save.
- Depends on 21. Size L.

**28. Linktree editor; categories retired in the UI (A6).**

- A tile list and editor: per-locale label tabs, the line under the label, an icon picker, a cap fact, keyboard move controls, and the approval fact in place.
- The category UI is removed.
- Bringing `link-tree.tsx` under the limit needs an owner patch to `eslint.config.js`.
- Depends on 10, 27. Size L.
- **As built.**
  - `getPortalLinktree` reads the whole section in one call (switch, written titles, each link in guest order with its texts, icon and destination approval); `savePortalLinkTexts` and `saveLinktreeSettings` get server functions. The section's title is "Title on the page" (default "Useful links"), per language, with a "Use default" reset.
  - `createLink` may leave the category out: the link joins the Portal's last category, and the first link starts one. The category is built only after the label, icon, cap and destination pass, and is handed to the link write (`startCategory`), which commits it, its fact and the link in one transaction under one fence, so a link refused at any point leaves no category behind (a real-PostgreSQL test pins this).
  - **Guest-visible on merge (principle 3).** Until slice 19 every publication is a v1/v2 snapshot, and the legacy renderer prints a category's title as a heading above the links. The started category is therefore titled in the Portal's primary language: the Linktree title the manager wrote for it, else that language's default ("Useful links", "Полезни връзки"; a small pinned map, tested against the v2 packs). Managers cannot rename it, and a title typed in another language does not reach those pages. Slice 19 drops it when links are flattened.
  - Moving a tile saves one category's order, so a tile moves only among those of its own category; at a boundary between two older categories its move control is disabled. The category server functions, the drag-and-drop code and the `@dnd-kit` dependencies are removed; the category use cases stay until slice 19 flattens categories in the snapshot.
  - Typed text (labels, lines, titles) saves through the portal autosave. Re-ordering, icons, the address, adding, deleting and the switch are their own saves, each after any typed text still waiting. The address is checked on the server, so it saves when the field is left.
  - No photo choice and no "Translate with AI": both wait for uploads and for the AI capability. The approved-destinations card stays under the tiles, because it is where an Account Admin approves a custom address.
  - The exemption for `link-tree.tsx` in `eslint.config.js` is stale now that the file is under the 300-line limit; removing it is the owner patch (`s28-eslint.patch`).
  - Moves are planned from the order on screen, including moves still being saved, and the section's saves run one after another, so two quick presses move a tile two places.
  - **Differences from board 02, accepted for now.** The board draws the section title as an inline row above the tiles (built: a "Title on the page" field with language tabs), drag handles beside each tile (built: keyboard move controls only, because drag-and-drop was removed), photo thumbnails on the tiles (built: icons only, uploads are slice 42), and a per-tile missing-language chip at phone width (built: the language list inside the tile). Slice 30 owns the title row, the handles and the phone chip as a design-fidelity pass beside the preview; slice 42 owns the thumbnails.

**29. Languages section and coverage read (A7).**

- `getPortalLanguageCoverage`, and `PortalLanguagesSection` with an add menu limited to the launch set.
- The AI controls stay hidden.
- Retire `portal-locale-configuration.tsx` and its ledger entries.
- Depends on 2, 10. Size L.

**30. Live preview pane (A8).**

- `getPortalPreview({portalId, source})` builds a v3-shaped guest DTO from the working copy or a verified snapshot.
- **The draft preview never includes destinations that are not approved;** it shows a "waiting for approval" placeholder tile instead. A test covers this.
- `PortalPreviewPane`: filmstrip, toggles, and "Try as guest", which writes nothing.
- Retire the preview Sheet and `use-preview-toggle.ts`.
- Bring the Linktree section to board 02 where slice 28 differs: the inline title row, drag handles (or an agreed keyboard-only substitute), and the missing-language chip on each tile at phone width.
- Depends on 6, 8, 12. Size L.
- **As built.**
  - `getPortalPreview({ portalId, source: 'draft' | 'live' })` returns `{ status: 'ready', preview }` or `{ status: 'unavailable', reason }`. A preview carries every language the Portal offers (`experiences[locale]`), so switching language is a client choice, not a second read. It is gated by `portal.read` in the Portal's Property and writes nothing.
  - **No address in the DTO, at all.** The guest page never sees a destination (a tap goes through the tracked click endpoint by link id), so the preview carries tile words, icon and a state: `ready`, `awaiting_approval` (a request an admin has yet to answer) or `not_approved` (disabled, quarantined or an unreviewed legacy address). Those tiles are dashed placeholders reading "Waiting for approval" and "Not approved, hidden from guests". A unit test, a use-case test and a real-PostgreSQL test each assert that no address (approved, pending or legacy) appears in the serialised DTO.
  - **The draft** is composed from the same reads the Linktree and Languages sections use (`buildPortalLinktreeView`, the Property's wording and look, the Portal's overrides), not from `PortalPublicationSource`, which is still the v2 shape until slice 19. Gaps are filled the way publishing will fill them, but leniently: a draft with a gap still shows. Wording a Property wrote and a tile's words copy the primary language in, tagged with `fallbackFrom`; the Linktree title does not (it is one title per language with "Use default"), so a language with none reads its pack default, never another language's title (pinned by a test). A Property with no Brand Profile previews as champagne on a derived dark field, named after the Portal.
  - **The live version** is the verified active snapshot, presented with `presentImmersivePortal` per language, filtered by current approvals with the guest edge's validation cut-off (one shared constant, `APPROVED_DESTINATION_MAX_VALIDATION_AGE_MS`), and with no tiles when the Linktree is off. It does not apply the edge's other admission facts (Portal Health, the Property's status, the public-read decision), so it shows the version guests are served when the Portal is open to them; a snapshot that fails verification reads as `not_published`. **A live version published before slice 19 is v1 or v2, which the new page design cannot draw, so `live` is `unavailable` (`earlier_design`) until the Portal is republished.** The pane says so, without promising that publishing again fixes it. Until media can be served (slice 42) no photo or logo appears in the live preview. **Closed by 42c2:** the live preview resolves each image the version names through the same servable-media rule as the guest edge, so a taken-down image is left out.
  - Draft photo and logo are still addresses (the Brand Profile holds `logoUrl` and `defaultHeroImageUrl`), so their sizes are nominal (1600 x 1000, 480 x 120); the page boxes them with CSS.
  - **`PortalPreviewPane`** is the editor's third column, 30rem wide and bounded to the viewport height from `xl` (stacked under the section below it): a language switch (absent for one language), Draft | Live, "Try as guest", the phone, the line over it ("Draft · Arrival · English") and the filmstrip (Arrival, After 2★, After 5★, Done; the low rating is the threshold when that is below 2), a column beside the phone as board 02 draws it, and under it below `sm`. The page is drawn at 390 px and scaled with a transform (0.7). The pane links `GUEST_FONT_STYLESHEET` itself (the carried-forward note of slice 7).
  - **The response area is the guest page's own view; the rest is still preview-local.** Slice 14 (#693) put the real rating card, receipt strip, Google card (with its unavailable state) and private note card on `main` as `ImmersiveResponseView`. The pane draws that view, fed by `immersiveResponseProps(guestPreviewState(state))`, so the preview and the page agree on what each state means and on focus, keyboard and radio semantics (`preview-rating-card.tsx`, `preview-after-rating.tsx` and `preview-copy.ts` are gone). Until slices 13 (header), 15 (Linktree) and 17 (footer) merge, `preview-page-top.tsx`, `preview-linktree.tsx` and `preview-footer.tsx` (with `preview-page-styles.ts`) still draw those three parts from the shell, glass and v2 copy packs; when a slice merges, replace its `preview-*` component with the real view. The pane, the DTO and the states do not change. Slice 16's "Your response" section is not drawn in a preview. `ImmersiveShell`, `GlassSurface`, `ImmersiveResponseView`, `immersiveResponseProps`, `loadGuestPortalCopyV2`, `guestCopyText` and `formatGuestPlural` are exported from the guest feature barrel for this. The Google card's unavailable state exists in the view but the preview has no Google fact, so it always draws the available card.
  - **"Try as guest"** swaps the phone for an interactive copy driven by a small pure reducer (`tryAsGuestReducer`): the real forms' rating, note and Change play locally (`rate`, `sendNote`, `change`, `restart`); opening and writing the note are the note card's own state. Choosing a state in the filmstrip leaves Try mode. It calls no server function, opens no address and records nothing; a story asserts the reader is not asked again.
  - The query key is `portalKeys.preview(portalId, source)`, nested under `publicationHistory`: every working-copy write already invalidates that key, so the preview follows the draft as it autosaves instead of each writer remembering a second key. Typed text shows once it has autosaved.
  - Retired: the preview Sheet (`portal-preview-panel.tsx`), `use-preview-toggle.ts`, `PortalDetailPreview`, `PortalPreviewToggle` and `derivePortalDetailView().showPreview`. The create-portal page keeps its own preview toggle as plain state (it is no longer remembered between visits).
  - **Linktree against board 02.** "Title on the page" is one row, the label beside the field from `sm` up, with the default and "Use default" beneath. Each tile has a grip handle, the keyboard stand-in for dragging (drag and drop stays removed): focus it and press Up or Down; the two chevron buttons remain for a pointer or a finger, and focus stays on the control that was used. At phone width a tile shows one chip, "DE missing", "ES, DE missing" or "3 missing", in place of the list of languages. The handle is left out below `sm`, where it would squeeze the tile's label, and shows no grab cursor. Not built: the board's hint "Click any part of the page to edit it" and its outline on the phone around the section being edited (both need the page to know which section a part belongs to) and tile photo thumbnails (slice 42).
  - **Deviations recorded.** (1) The preview draws the new design's colours from the Property Brand Profile only; the portal's own palette (`portal.theme`), which the retired Sheet drew, colours the earlier page alone, so the Look section's palette control now says so, until slice 39 retires it. (2) Until slice 19 publishing still writes the earlier design, so the Draft column carries a notice that the new design reaches guests in an upcoming release (`DRAFT_DESIGN_NOTICE`), and the `earlier_design` note promises nothing about publishing. **Slice 19 must switch both to publish-truthful wording** and drop the notice. (3) A language with no guest copy pack draws its fixed text in English and the stage says so; a pack that fails to load shows the pane's failure with a retry.

**31. Review & publish (A9).**

- A pure `portal-review-rules.ts`.
- `portal_pending_content_changes.changed_by`, in `portal-publication.schema.ts` after slice 0.
- History exposes `activatedBy`.
- A plain-words change list, a 1-star/5-star pair showing the same Google card, and a footer wired to slice 20.
- Depends on 20, 29, 30. Size XL; ship as rules plus reads, then the UI.
- **As built (a: rules and reads).**
  - **`domain/portal-review-rules.ts`** (pure, tested): `evaluateReviewChecks`, `buildReviewChanges` and `reviewLanguageRows`. The checks take the same facts the publish use case refuses on (Property active, verified Google address, a responsible manager, a working address) plus the resolver's blockers and warnings, so the review shows no button the server would refuse. A blocked check is a refusal; a text copied from the fallback language is a warning; each language and each missing-text group is one check.
  - **`getPortalReview`** (`portal.read`, no writes; server function `server/portal-review.ts`): the checks, the language rows (the slice 29 coverage plus a count of AI-draft texts per language), the change list, the live version with who published it, `publishesAsVersion`, `nothingToPublish` (exactly the question `publishPortalChanges` answers `unchanged` to) and `canPublish` (no blocked check, something to publish, and the viewer holds `portal.update`; the server function also passes whether the `portal.write` capability is open, as `mayPublish`, so a Member or a dark capability never sees a button the server refuses). `action` says what the primary button does: `publish` for a Portal that is not live, `publish_changes` for one that is, `none` for an archived one. A Portal that is not live has no change list.
  - **Deviation: the change list comes from the page-edit ledger (slice 35b), not from `changed_by`.** The plan was written before the ledger existed. The ledger already carries the person, the part of the page and the wording before and after, so the list reads it, since the live version was published (the live one, not the newest: "Make live again" can put an older version live, and the draft still holds everything since; a publication takes every edit made up to its commit and the ledger never spans an activation, so only later edits count). `portal_pending_content_changes.changed_by` (migration 0051, nullable, written by `recordPortalContentChange` with the actor it already receives, exported with the Organization export) is still added as planned, and the review uses it for a fence kind the ledger has no row for ("unrecorded", with the person). Several saves of one part are one change (first wording to last); wording put back (including a text added and cleared), a tile added then removed in the same draft, and edits to a tile that is removed, are not listed, and an added tile reads its newest wording; when the draft differs and nothing nameable is left the list says "unlisted" rather than claiming nothing changed, and when changes were recorded but the draft says what is live it says "no_visible_change". A live version of the earlier design and a Google address the Property has left each lead the list.
  - **`activatedBy` and `changedBy`** are on the plain publication history (`PortalPublicationHistoryItem.activatedBy`, `pendingChanges[].changedBy`) as a person the directory can name, or an unnamed placeholder. The merged History read (slice 35a) already carried the actor; this is the read the editor header uses.
  - **Refactors the reads needed:** `propertyAllowsPublication`, `portalHasResponsibleManager` and `portalHasPublicAddress` in `portal-publication-readiness.ts` (the `assert*` functions now call them), and `readPortalLanguageCoverage` (shared by the coverage and review reads). The server function repeats the scope check inline, as the others do: `dark-capability-enforcement.test.ts` reads each server file's own source for the capability seam, so a shared helper would hide it.
  - **Not in this slice (31b).** The page itself: the plain-words list, the "Show" action, the 1-star and 5-star previews, the footer wired to `publishPortalChanges`, and "Who can fix" on a blocked check (it needs the Portal's responsible managers by name; the Portal Workspace already has that read). The ledger page is bounded to the newest 100 rows; `changesMayBeIncomplete` says when that page held nothing older than the live version (the read asks for exactly `MAX_HISTORY_SOURCE_ROWS`, the repository's cap).

- **As built (b: the page).**
  - **`portal-review/`** replaces the interim `portal-workspace/portal-review-page.tsx`. The left column is the plain-words change list, the checks, the languages and "See every guest state"; the right column is the draft page after a 1-star and a 5-star rating side by side under "Every guest gets the same Google card" (the private note shows only where the threshold reaches the rating). The footer is sticky: "Publishes as version N", "Printed codes keep working" (a first publication says "start working"), Back to editing, and the one publish button. Wording lives in pure modules with unit tests (`portal-review-changes.ts`, `-checks.ts`, `-languages.ts`, `-footer.ts`, `-pair.ts`, `-scroll.ts`); the History tab's sentence builder is reused for each change, so a change reads the same here as in the ledger once published.
  - **Publish.** A live Portal calls `publishPortalChanges` (`actions.publishChanges`, new); a Portal that is not live goes live through `updatePortal` (the silent variant, so the page's own toast is the only one). The toast names the version ("Version 6 is live"); "unchanged" says nothing was published. The manager then returns to the tab they came from. A refusal shows the server's sentence. The button is the one `getPortalReview.canPublish` allows; when it cannot be used the footer says why ("Fix 2 things first", "Nothing to publish").
  - **Query.** `portalKeys.review` sits under `publicationHistory` (every working-copy write and every publication refreshes it). The route's loader fetches it with `staleTime: 0` on each entry; the page reads it from the cache.
  - **Missing translations are a warning** ("Deutsch · 1 label missing. German guests see ‘Olive Terrace menu’ in English. You can publish without it.") with a link to the Languages section; there is **no AI button** (owner decision 3). The language row's "AI drafts not checked" shows only when a draft exists.
  - **"Who can fix"** lists the Portal's responsible managers by name ("you or Georgi Ivanov"), or the managers who could be made responsible when no one is; the route joins the existing responsible-managers and members reads.
  - **"Show"** switches the preview to the change's language and scrolls both phones to the part of the page it changed (the welcome block, the Linktree, or the top; `data-preview-part` marks the two parts in the preview). The row stays pressed. It does not outline the part (it needs the page to know which section a part belongs to, the same limit slice 30 recorded).
  - **Deviations.** (1) `ReviewLanguageRow` gains `missing` (the coverage's missing texts), so a warning can name a link label by its wording. (2) `PortalPageEditKind` is exported from the public API. (3) The board's dashed line across both phones ("The Google card starts at the same place after every rating") is not drawn; the heading says it. (4) "Disable public page" is kept for a live Portal in a quiet "Public page" section under the lists: the interim page was the only place the workspace offered it. (5) "Try as guest" and a state chosen under "See every guest state" replace the pair with one phone (`TryPhone` and the filmstrip are reused from the editor's preview; the filmstrip gains a `row` layout). (6) Not visually compared against the board render: the Storybook browser run does not apply the app stylesheet to screenshots, so layout was checked by the play tests and the axe gate only.

**32. Share: code block, replace and stop (A10a).**

- A code block, QR with a 4-module quiet zone and SVG output, replace choices (planned or security), and stop all codes.
- **`PortalLinkReveal` stays** until slice 33 is active with the keyring provisioned, so a newly issued code always shows its address somewhere.
- Size M.

**33. Encrypted address and "Download again" (F12 + A10b).**

- A new ADR amending ADR 0044 decision 1 and invariant 9.
- `portal-address-cipher.ts` (AES-256-GCM, with authenticated data [format, org, property, portal, tokenId, version]), registered as a third owner in `ciphertext-format-singleton.test.ts`.
- An optional `PORTAL_ADDRESS_ENCRYPTION_KEYS`.
- Issue and rotate seal the address; revoke and rotate clear both columns.
- `revealPortalAddress` returns no-store responses, is rate-limited, and writes its audit row first.
- `issued_by` and `portal_address_downloads`.
- The reveal-once flow is removed only when the keyring is present.
- In-memory store entries.
- Depends on 4, 32. Size L.
- **Ops:** the keyring.
- **As built.**
  - The ADR is 0064 (`0062` and `0063` are taken on other branches). It amends ADR 0044 decision 1 and invariant 9.
  - The cipher is `infrastructure/adapters/portal-address-cipher.ts`, behind `PortalAddressCipher` (`seal`, `open`, `canOpen`). The keyring is `<version>:<64 hex>[,...]`, at most four entries, parsed at boot in `env.ts` and again in the adapter; the first entry seals. Production also checks it against the placeholder family.
  - The `encrypted_raw_token` pair already existed and was never written. Migration 0046 adds `issued_by`, `portal_address_downloads` and a CHECK that only an `active` token holds a sealed address, so every path that leaves `active` (replace, stop, delete) clears both columns in the same statement or the database refuses.
  - `revealPortalAddress` takes `{ portalId, purpose: 'download' | 'copy' | 'show' }` (saved a file, put an address on the clipboard, or only had it displayed). The order is authorise, find the sealed copy, insert the audit row, decrypt. The insert is one statement that writes nothing for a code that is no longer active and sealed, and a request that cannot disclose writes no row. The server function is a no-store POST with the actor (30 per hour) and Organization (200 per day) limits in `portal-address-rate-limit.server.ts`.
  - Issue and replace also return `addressRecoverable` (the new address was sealed), which the Share tab trusts over `tokenStatus` until the detail refetch lands, so a newly made sealed code is not told to save the address. "Copy NFC address" starts its clipboard write before the fetch returns (`copyResolvedText`), which Safari needs.
  - Deferred: board 06-share shows "Made 12 Mar by Georgi Ivanov". `issued_by` is recorded and History names the person, but the Share code block still reads "Made <date>": showing the name there needs the issuer's display name on `tokenStatus` (the summary query, the actor directory in `getPortal` and `listPortalOverview`, and the in-session case where the client does not know the current user's name). Slice 36 did not build it (see its As built); no slice owns it yet.
  - Rolling back below this release needs the sealed copies cleared first (migration 0046's CHECK); runbook §26 "Rolling back below this release" and ADR 0064 consequences say how.
  - `getPortal` and `listPortalOverview` return `addressRecoverable`: the live code was sealed and the keyring still holds that key. The reveal-once warning and wording go per code when it is true; without a keyring nothing changes. `PortalLinkReveal` stays as the public-address row ("Show address" after a reload).
  - History gains the issuer's name on address entries and a `code_downloaded` entry per download (the History tab is slice 36). There is no download event: the row is the record.
  - The new table has its data-fate row, export collection (without the token id) and purge step before `portal_tokens`. `PortalAddressRepository` is the only reader of the ciphertext; the in-memory command store writes and clears a test address repository.
  - `PORTAL_ADDRESS_ENCRYPTION_KEYS` is documented in `.env.example`, `env.ts` (a runtime environment contract file, so its snapshot is refreshed) and runbook §26.

**34. Results tab (R3 + A11).**

- Ranges aligned to local midnight and a compare toggle.
- A weekly series anchored to the window start, computed as sum over count, with a 5-rating floor per bucket and version markers.
- The funnel from slice 3; the rating mix; "Private ratings by page language" (a Guest public read over `guest_response_experience_snapshots.guest_locale`); "About these measures".
- Depends on 3, 22. Size L.

**35. History reads (F13).**

- **(a)** A merged read: publications with actor, health (`PortalHealthRepository.listHistory`), code events and creation.
- **(b)** A page-edit ledger written at the six `recordPortalPendingContentChange` call sites.
- (a) M, (b) L.

**36. History tab and "Make live again" (A12).**

- Filters, the timeline, a versions rail, and an inline confirmation from `diffPublicationContent`. The diff handles v1, v2 and v3.
- Depends on 35. Size L.
- **As built.**
  - **Reads.** `getPortalVersions` (every published version, newest first, with who published it, whether it is live and what it added; plus what the draft is based on and who last edited it) and `getPortalVersion` (what one version shows guests, and what making it live would change, compared from the live version to that one), both `portal.read`. `diffPublicationContent` is a pure comparison in `domain/portal-publication-content.ts`: it reads v1, v2 and v3 into one neutral view first, so a part a schema cannot tell is never reported as changed, and a move between the legacy page and the Immersive Hub is one `design_changed`. `PortalHistoryRepository.listPublishedVersions` returns at most 201 verified snapshots, so a version that no longer verifies is left out rather than shown with an action that would fail.
  - **Deliberate deviation: Make live again works for any version but the live one.** `rollbackPortalPublication` refused any version not older than the live one, so after restoring version 4 the later version 5 could never be made live again except by publishing the draft. It now refuses only the live version (a real-PostgreSQL test pins the roll-forward). Invariant 5 in the Portal `CONTEXT.md` is reworded to match. The page must still be published, and the viewer needs `portal.update` and the `portal.write` capability, as before.
  - **The tab (board 08).** A segmented filter (All, Publishing, Codes, Page edits; health shows on All only), the ledger as the shared `Timeline`, and the Versions rail beside it from 64 rem and below it on a phone. On All, a page edit that went into a version is folded under that version's line, and all but the newest two versions fold into one "N earlier versions · Show" line. A page edit says "In draft" or, on the Page edits filter, "published in version N" (the first version published after it). Times read in the Property's zone (`yesterday` is the property's day). A publish line shows View and Make live again on hover, on focus, and always on touch. The confirmation is inline under the line (a region, focused on open, Cancel returns focus to its button) and says what changes back for guests, what stays (printed codes, results and private notes, the draft's N changes) and what publishing the draft later does.
  - **Rail tiles and View open a dialog.** Slice 30's preview does not exist yet, so "View" shows the version in words (languages, title, tiles) in a dialog instead of a rendered page; from there "Make live again…" turns the dialog into the same confirmation. Replace it with the preview when slice 30 lands.
  - **Differences from board 08, accepted.** The print-kit line is absent (slice 45). A "download" entry says "downloaded the code again" without the format ("PNG for print"), and a copy says "copied the NFC address" without "for new tags": neither is recorded. The filter is local state, not a URL key.
  - **Removed.** `PortalPublicationHistoryCard` and its story, and the `loadMorePublicationHistory` plumbing; the header still reads the plain publication history.
  - **Not built, handed on from slice 33: "Made <date> by <name>" on the Share tab (board 06).** It needs the issuer's display name on `tokenStatus` through `getPortal` and `listPortalOverview`, and the session user's name for a code made in this session. It belongs to the Share tab, not to History, and nothing else in this slice depends on it. **No slice owns it.** It needs a GitHub issue (`ready-for-agent`) opened on `kodes-agency/reputation-key` when this merges; until then this line is its only record.
  - **What a version "shows guests" is what the guest renderer reads.** The neutral view carries a tile's photo (its asset, so one photo swapped for another is seen) and icon, the hero's focal point, a v2 page's hero of each language (`localizedContent[locale].heroImageUrl`, never the brand's default hero, which no guest is shown), the legacy category headings, and a v3 short description only as link preview text (it is `og:description`, never on the page).
  - **The draft is based on the newest version.** Making an earlier version live never touches the working copy, so `getPortalVersions` reports the draft as based on the newest published version whichever one is live, and `getPortalVersion` carries `newestVersion` so "publishing the draft later" is reasoned from it. The confirmation words a move to a later version as what it brings ("is added", "takes version N's order"), not as what comes back. The draft's "keeps its N changes" still counts the working copy against the live version, so after an earlier restore it includes what the newest version added; the publication history read owns that count (`countPendingChanges`) and was left alone.
  - `e2e/storybook-metrics/portal-history.metrics.ts` pins no sideways scroll from 320 to 1920 px, the rail's place, and the line's actions on focus (run with `pnpm test:storybook:metrics`).

**37. Groups: atomic move, history, batched list (F14).**

- `movePortalToGroup` and create-with-move, taking group fences in sorted id order and ending memberships with `moved_to_group`.
- `portal_groups.created_by`, and a `portal_group_history` table.
- `listPortalGroupsWithPortals`.
- In-memory store entries.
- Size L.

**38. Group dialog, group page and goal card (A13 + R4).**

- `PortalGroupDialog`, and the route `portals/groups/$groupId`.
- Group results from the event-time `group_id`.
- A live month-to-date `getGoalProgress` (never shown as the monthly result), and a subject prefill on `goals/new`.
- **Retires `PortalGroupManagement`.**
- Depends on 24, 37. Size L.
- Ships the three measures BETA.md permits until the owner rules on the other two (§5).
- **As built.**
  - **Five measures** (owner decision 2, which supersedes the line above). A group's strip is the group's own row of `getPortalResultsOverviewFn` (group figures follow the event-time group, slice 24), so there is no new results read: `OverviewResultsIndex.groupStrip(groupId)` prints the same cells as the Property strip, with shares of the group's own scans, in the window of the group's Property.
  - **Goal card.** `getGoalProgress({propertyId, subject})` (Reporting; server function `getGoalProgress`) lists the Property's Programs through the Program list's own authorisation and visibility, keeps the goals whose assignment of this subject is in force, and reads the whole calendar month in the Program's zone through the same governed metric the monthly result uses. It is never the result: a scheduled or paused goal has no figure, an average under the metric's minimum sample is `too_few` and a figure the read cannot trust is `unavailable`, never a zero. The card says "so far" after the target, and "the month ends today / tomorrow / in N days". Every goal that targets the group is a card; none is "No goal for this group yet" with "Set a goal". `goals/new?subject=portal_group:<id>` prefills the subject (used only if it names one of the Property's own groups, portals or the Property).
  - **History** comes from `listPortalGroupHistory`; people, Portals and the other group are named in the browser (a person who cannot be named is "Someone", an archived other group "another group", never an id). Creation absorbs the `portal_added` rows of the same instant ("created Pools with 3 portals"); a `portal_moved_in` keeps its own line, which says where the earlier results stay.
  - **Dialogs.** New group (name and a checklist grouped by where each portal is now, with "Moves from X. Its results so far stay with X." under a ticked portal that is in another group), Add portals (one atomic `movePortalToGroup` per Portal, in order, stopping at the first refusal), Rename, and an Archive confirmation (the Portals stay and become "Not in a group"). A refusal inside a dialog shows in place only after an attempt made in that opening.
  - **Overview.** A group head links to the page and carries "Actions for group X" (Open group, Rename, Set a goal, Archive group); "New group" sits in the page header. A group with no Portal keeps its head ("0 portals", before the ungrouped Portals, on the last page, and only while the list is grouped and not narrowed), so it stays reachable now that `PortalGroupManagement` is gone. The table gains a `compact` density (a table from 42 rem instead of 56 rem, narrower columns, Share as an icon) for the group page's left column, which is about 46 rem beside the goal and history; `portal-overview-density.ts` holds both sets of classes.
  - **Retired:** `PortalGroupManagement`, its row, members, create and rename forms. `PortalGroupView` stays (the editor's Group section uses it).
  - **Not built (still no destination or read):** "Open results" and "N waiting in Inbox" on the strip. The board's separate Rename button is built; the group page's ⋯ holds Set a goal and Archive group.
  - **Gates not run:** the Playwright storybook geometry harness (`pnpm test:storybook:metrics`, it starts a Storybook dev server), so the compact table's widths at 672 to 1440 px are reasoned, not measured.
  - Bundle: the first-paint closure moves 331,093 B to 332,424 B (budget 332,800 B, breakdown in the script).

**39. Property look page (A14).**

- Accent colour with a contrast readout, wordmark, default languages, affected portals, and a batch review & publish (slice 20 run in sequence).
- The photo and logo controls are inert while `portal.upload` is blocked.
- Depends on 11, 20, 30. Size XL; split into the page, then the batch.
- **As built (39a, the page).**
  - **Route and entry points.** `/properties/:propertyId/portals/look` (`routes/_authenticated/properties/$propertyId/portals/look.tsx`, board 9), reached from a "Property look" button in the Portals header and from the editor's Look section. `look` joins `new` as a static sibling of `$portalId` in `isWorkspaceRoute`, so the page keeps the padded shell. Everyone who may read portals can open it; only an Account Admin (`portal.admin`, with `portal.write` on) edits.
  - **Sections.** Photo (a slot), Colours (accent with a hex field and the browser picker, an Automatic | Custom background tint, and the contrast readout), Name and logo (the display name read-only with a link to Property settings, the wordmark, a logo slot) and Languages offered by default (the portal Languages section's own add/remove/make-fallback rules). No design picker. The preview column has With photo | Without photo, the chosen portal's arrival page in its primary language with the draft laid over it before it is saved, and "Portals using this look" (live and draft, archived and switched-off left out).
  - **Writes.** `savePropertyLook` (new use case and server function) writes accent, background mode and colour, and wordmark through its own repository method (`savePropertyLook`), which reads and writes the profile inside the Property's publication lock, so a display-name or image write beside it is never put back. It touches only the look's columns and the `look_version`, pending changes and fact as for any look edit: the display name, images, text colour and `updated_by` stay as they are, so a look save never confirms an automatic public display name (the setup wizard keeps asking about it); the actor is recorded in the page-edit ledger only. It refuses a colour that is not `#rrggbb` and a manual background that light text cannot be read on (AAA). It does **not** refuse an accent that is hard to see on its field: the default palette every Property starts with (#2563EB reads 3.68:1 on its field) is such an accent, and the guest resolver already draws the text colour in its place, so the readout says "Hard to read · guests see it as light text" and the save goes on. `savePropertyDefaultGuestLocales` (use case existed) gained its server function. Both autosave through the portal editor's coordinator (600 ms) under its own provider on the page, with the editor's leave guard (`PortalUnsavedChangesPrompt`, with the look's wording) mounted beside it: a reload or tab close with a write waiting or in flight asks first, an in-app navigation writes what is waiting and asks only when a save failed or was refused. The status line shows the server's sentence for a 4xx refusal (with no Retry) and "Not saved" with Retry for a failure a retry could fix.
  - **Readout.** `shared/domain/portal-look-readout.ts`, built on `portal-field-colour`, the arithmetic the guest resolver uses. Ratios are rounded down, so a failing pair never reads as passing.
  - **Retired.** The editor's legacy Property-brand form (three colours with an explicit Save), the per-portal palette presets and the theme draft plumbing, as slice 30 promised. `portal.theme` stays for the legacy renderer until slice 44.
  - **Slots left for later.** `photoSlot` and `logoSlot` (42c2): 42c2 built the photo and logo controls into the page itself and removed both. The batch "Review & publish N portals" is built (see 39b).
  - **Layout.** Three columns (form, phone, "Portals using this look") from 90 rem, as board 09 draws them, each side column sticky; below it the phone and the portal list stack in one column and scroll with the page. `e2e/storybook-metrics/property-look.metrics.ts` measures it at 320, 375, 768, 1024, 1440 and 1920 px (no sideways scroll, the columns where they should be, and at 1440 and 1920 x 900 the phone and the picker on screen); it passed against a static development build of Storybook.
  - **Deviations.** (1) The asset ids and focal point are not yet in the experience read or the draft preview (slice 20's known gap): nothing can set them before 42c2, which owns the controls and the read. Until then "With photo" previews a legacy URL hero that a v3 publication drops; 42c2 has to close this (see its "Inherited from 39a" bullet). (2) The board's accent name ("Champagne") is not drawn: no read gives it. (3) Display name stays in Property settings (it is the AI reply fence), shown here read-only. (4) The first version of this slice refused an accent below AA on its field and wrote `updated_by` on every look save; both were wrong for the reasons under Writes and are fixed.
  - Bundle: the first-paint closure moves 334,045 B to 334,186 B (budget 334,300 B).
- **As built (39b, the batch).**
  - **The button.** "Review & publish N portals" (board 09) sits in the status bar, N being the live portals the look reaches (drafts are not counted: they go live through their own review). It is absent when no portal is live or the viewer lacks `portal.update` or the `portal.write` capability (the route passes `canPublish`), and disabled while an edit is waiting, being saved or refused, so a review never reads a draft that is about to change. It replaces the `publishSlot` the page carried for it: the page takes `getPortalReview`, `publishPortals` and `canPublish` instead.
  - **The review.** The dialog reads `getPortalReview` for every live portal (four at a time, only while it is open, and afresh at every opening: `portalKeys.lookReview`) and sorts each into what the batch can do. A ready portal ("Publishes as version N · M changes") has a tick, which a manager may clear to leave it out. A portal with nothing new is not asked the gates, as on the server. A blocked one names why in words, worded by slice 31b's `describeReviewCheck` (a check per language is named once), so a line here and the review page its "Open" link leads to read alike. A portal the viewer cannot publish, one that stopped being live, and one whose review could not be read each say so without hiding the others. The ticked ones are what is sent, so the dialog offers nothing `publishPortalsChanges` would refuse.
  - **The publish.** One press sends the ticked portals to `publishPortalsChanges` in the order shown, in requests of at most 50 (the DTO's bound; a longer list is split and a test pins the two numbers together). The result names each portal: "Published as version N", "Already up to date", or "Not published" with the server's own sentence. One that failed does not hold back the rest and can be tried again on its own. A request that fails as a whole stops the run and says why in the server's words; the server publishes a request's portals one by one, so a fault partway through leaves it unknown which went live, and the portals of that request read "Not confirmed · may have been published; trying again is safe" (a republish reads as unchanged), while those of later requests read "Not tried". While a request is in flight the ticks are locked and the dialog cannot be closed; on a retry the outcome list stays on screen with the retried portals marked "Trying again…". A publish, whether it succeeds or fails, refreshes the overview, the experience and each portal's publication history (and with it the live and draft previews); it does not re-read the batch's own reviews (the next opening reads them afresh, and waiting for up to fifty reviews would hold every request back).
  - **Deviations.** (1) No new server read or write: the batch is built on `getPortalReview` and `publishPortalsChanges`, which slices 20 and 31a shipped. (2) Choosing portals to leave out is not on board 09, which draws only the button; it costs one tick per row and keeps the manager in charge of a portal whose draft is not ready for guests. (3) The dialog's list scrolls inside it (at most 24 rem or 45% of the window), so fifty live portals never push "Publish" off a phone.
  - `e2e/storybook-metrics/property-look-batch.metrics.ts` measures the open dialog at 320 x 568, 375 x 667, 768 x 1024 and 1440 x 900 (inside the window, no sideways scroll, both buttons on screen); and, over fifty live portals, at 320 x 568 and 375 x 667 (the list scrolls inside the dialog, both buttons stay in the window); it passed with the page's own harness against a development-flavoured static Storybook build (`NODE_ENV=development storybook build`, `STORYBOOK_METRICS_STATIC`, private port).
  - Bundle: measured on a fresh production build after merging main (88e765619, slice 31b): the first-paint closure moves 335,082 B to 335,331 B (83 js + 1 css; budget 335,700 B, 369 B of headroom; the dialog sits in the route's own chunk, so the shared query-key members are the likely source of the growth).

**40. All properties view (A15).**

- `src/routes/_authenticated/portals/index.tsx`, an org-scope branch in `ManagerNavRow`, grouping by property, and organisation totals kept separate from the Google review average.
- Inherited from 25b (the read already answers an organisation scope; nothing calls it that way yet):
  - an organisation branch of `getPortalResultsOverviewFn` over the reader's Properties, which needs one roster and one zone per Property (the use case takes `properties[]`);
  - rendering of the Property subtotal rows, each Property's own window on board 10 (Properties in different time zones read different windows), and the per-Property "not in a group" row;
  - stories for board 10, and the 1000-Portal roster limit (`too_many_portals`) decided for a whole organisation, which can exceed it where one Property cannot.
- Depends on 23–25. Size L.
- **As built.**
  - Route `/portals` (`src/routes/_authenticated/portals/index.tsx`), reached from the Portals entry whenever no Property is in scope (`ManagerNavRow` links to it, and `useActiveSection` marks it). The page is `PortalAllPropertiesPage`, over the same row, group head, header, strip and toolbar as the Property page.
  - Reads: `listPortalOverview` with no Property (the organisation scope, narrowed to the Properties whose policy allows `portal.read`) and `getPortalResultsOverviewFn` with no Property. The organisation branch asks `portal.read`, `dashboard.read` and the D6-001 assignment for each Property before reading, builds one roster with one zone per Property (`organizationRoster`), and leaves out the Portals of a Property with no zone on record (the list still shows them, with no figure). It does not require every Property to answer.
  - Properties are the primary grouping, ordered by the page's sort (name, the Property's own subtotal of qualified scans, or the most pressing Portal); a Property's Portals sit under its head, in its groups only when it has groups (the per-Property "not in a group" row is that group's head, with its own figures). Search also matches a Property's name and then keeps all of its Portals. Paging runs across Properties (20 Portals a page); a Property appears on each page it has Portals on.
  - The strip is the organisation total: its five measures from the read's total row, "vs the 30 days before" taken from the length of any Property's window, "% of scans" from the total's funnel. The total names no date range (each Property reads its own days, in its own zone) and says so in the footer. The average is the average private rating; Google's review average is a different thing and is not part of any figure here.
  - A folded Property stays folded for the reader (browser storage, never the URL; `collapsed-properties-store`), as the board's footer says. Groups under a Property fold in page state, as on the Property page.
  - **The 1000-Portal limit, decided for the organisation.** The whole-Organization read keeps the use case's limit of 1000 Portals. Past it the read answers the tagged `too_many_portals` (422) and the page shows its list without results, exactly as a Property over the limit does; each Property's own page still shows its own results. A single Organization is not expected to reach it in the closed beta; paging the read by Property is the way out if one does.
  - Deviations from board 10: the Property head shows no accent name ("Champagne accent") because no read gives it (the three accent colours live in the Property brand profile and a batched read of them was not part of this slice), and "Open results" and "N waiting in Inbox" on the strip are still not built (no destination or read). The sidebar tile still reads "Select property" on this page. The Show and Group by controls are not offered here, as on the board; a Property's groups show when it has them. Google's state is shown as "Google link needs reconnecting" for a disconnected binding only. "New portal" asks which Property when there is more than one.
  - `e2e/storybook-metrics/portal-all-properties.metrics.ts` holds the same widths as the Property page's (no sideways scroll from 900 to 1920 px, cards and summary lines below).

**41. es, it, fr and de packs (L2).**

- We draft the four v2 packs (formal Sie in German, per the LANGUAGES.md glossary).
- Each locale is added to `OFFERED_GUEST_LOCALES` only after the native check.
- Compatibility e2e for de and one other Latin-script language in Chromium, Firefox and WebKit.
- Depends on 9, 19. Size M. **Owner:** native checks.
  - **As built (owner decision 5: no native check, so every locale is offered in this PR).** `es-v2.ts`, `it-v2.ts`, `fr-v2.ts` and `de-v2.ts` sit beside `en-v2.ts`/`bg-v2.ts`, each with the same 100-odd keys, its own plural forms and its own place names for the zones the product offers. `GUEST_LANGUAGE_PACKS` registers `guest-ui-{es,it,fr,de}-v2` as generation 2 only (no v1 pack: these languages never had the legacy page), `OFFERED_GUEST_LOCALES` lists all six, `loadGuestPortalCopyV2` imports each pack on its own, and the Linktree default title is pinned for every language (`portal-linktree.ts`). German is the formal "Sie", from the owner's German glossary and board G10; the pack test pins the glossary rows. French, Spanish and Italian use "vous", "usted" and "Lei".
  - The admin needed no other change: the language menus, creation form and publication checks already read the registry (`hasGuestCopyPack` looks for a generation 2 pack), so "More languages later" disappears on its own.
  - **Compatibility e2e** (`e2e/compatibility/core-surfaces.spec.ts`): German (longest words) and French (accents, no-break punctuation) at 320 px in Firefox, WebKit and the two mobile projects, with axe and the no-sideways-scroll check. The seeded Portal now publishes all six locales; only en and bg carry wording, so the other four read the English text as a materialised fallback. Not run here (it needs the local stack).
  - Deviations: `LANGUAGES.md` is not in the repository (the plan names it); the German glossary was read from the design session's copy and from board G10. "huésped" is the Spanish word for "guest" (the owner keeps the word in every industry); a native reader may prefer another for places that are not lodging.

### Phase 5: built dark or gated

**42. Portal media, built dark (U1–U6).**

- **U1:** `portal_media_assets` in `portal-assets.schema.ts`, and asset foreign keys (the snapshot fields already exist from slice 8).
- **U2:** a sharp adapter and a pure `portal-image-policy`, with adversarial fixtures.
- **U3:** server-side ingest with a request body limit scoped to its path, gated on `capability: 'portal.upload'`.
- **U4:** a same-origin media route, and removal of the AWS-only `getPublicUrl`.
- **U5:** garbage collection, takedown, and purge and export deleting the stored objects.
- **U6:** the board 14 UI (Replace photo dialog, focal-point picker, alt text, rights checkbox, preview), inert while the capability is blocked.
- Linktree tile photo thumbnails from board 02, which slice 28 leaves as icons.
  - **42c1, as built.** The Linktree editor's picker is "Icon or photo", with a dashed upload tile that opens a "Photo for this tile" dialog (file, rights checkbox, a refusal shown in place), uploads to `POST /api/portal-media` and then puts the returned asset on the link through `updateLink({ imageAssetId })`. The tile row and the picker show the photo from the media route. Choosing an icon over a photo saves `imageAssetId: null` in the same write. `updateLink` checks the asset (active, `link_image`, the Portal's own Property) and refuses anything else as `media_not_found` before any write. A tile photo reaches guests with the v3 builder (slice 19), which must copy `links[].imageAssetId` from the working copy; the guest tile already renders `imageUrl` (slice 15). No preview of the chosen file in the dialog: the CSP's `img-src` has no `blob:`, and the photo shows on the tile as soon as it is saved.
- **Inherited from 39a (42c2), closed.** The Property look page's photo and logo slots (`photoSlot`, `logoSlot`) mount here. The experience read (`getPropertyExperience` and the Property experience server read) and the draft preview (`portal-preview.ts`) do not yet carry `heroAssetId`, `heroFocalX/Y` or `logoAssetId` (slice 20's known gap, assigned to 39 and deferred to here). Until they do, the page's "With photo" preview draws a legacy URL hero that a v3 publication drops, so the preview can show a photo that will not publish. Close it with the controls: read the asset ids and the focal point, and make the preview's hero null unless the photo is backed by an asset.
  - **42c2, as built (U6: board 14 and board 09's logo).**
    - **Writers.** `savePropertyHero` (asset or null, focal point 0 to 1 and defaulting to the middle, a description per language) and `savePropertyLogo` (asset or null), Account Admin only, behind `portal.write` (attaching an image already uploaded needs no `portal.upload`, so taking one off keeps working if uploads are ever switched off). Each accepts only an active image of the right purpose uploaded for this Property and answers any other id as `media_not_found`. They write inside the Property's publication lock and move what every look edit moves: `look_version`, a `look:images` pending change for each live Portal, the profile fact; the display name and `updated_by` are left alone. Taking the photograph off clears its focal point. The answer is `{ profile, media }`.
    - **Descriptions.** The "Describe the photo" text is per language in `property_portal_brand_contents.hero_alt_text` (at most 160 characters; empty clears). The dialog offers one field for each of the Property's default languages (one language reads "Describe the photo", several name the language); the primary language's description is what pages in other languages read until they have their own. A language with no wording row gets one holding the description alone, with `title` and `short_description` `''`: every reader (publication, the preview, the language coverage) asks the one `hasPropertyWording` rule, which is false for such a row, so it claims no wording and a Portal override on that language still does not count; it exists only because the description lives in it. No migration was needed.
    - **Reads.** `getPropertyPortalExperience` carries `media` (`resolvePropertyLookMedia`: size, focal point and the media route's address for an asset of this Property that may still be served; a taken-down image reads as none). `buildDraftPortalPreview` takes that `media` and draws only it: an address left on the profile or typed into a Portal override (which a v3 publication drops) is no longer previewed. The draft preview also shows a tile's uploaded photo (42c1 left `imageUrl` null there), and the live preview shows the version's photograph and logo while they may be served.
    - **UI.** The Photo section shows the photograph with the focal-point circle (drag it, or move it with the arrow keys, Shift for a bigger step; it autosaves through the page's coordinator like the colours, so the status line and the leave guard see it), "Replace photo" and "Remove photo", or "Add a photo" when there is none. "Replace photo" is board 14: the chosen picture with the circle, its name, size and weight, the checks (large enough, format and weight, and the shape only when it is the problem), the description, the permission checkbox naming the Property, the phone drawing the picture on the guest page (from 768 px), and "Use photo". With a photograph in place and no new file the same dialog edits its focal point and descriptions ("Save"). A new file starts afresh (focal point in the middle, descriptions emptied, because the old description was about the old photograph). A file already sent is not sent again when putting it on the look fails and the button is pressed again; the dialog cannot be closed while a file is on its way. Name and logo: the logo on a dark swatch (it is a light logo), "Upload logo", "Replace logo" and "Remove logo", through the same steps to purpose `logo`. The browser reads the picture's real size (`createImageBitmap`, which applies the EXIF orientation as the server does) and shows a copy of it from a data address, because the page's CSP lets images load from `data:` but not from `blob:`. `PORTAL_MEDIA_SIZE_RULES` (shared) is now the one place the image policy and the browser read the minimum and maximum sizes from.
    - **Differences from board 14, accepted.** The board's checks name "1600 px wide" and HEIC and 15 MB; the policy says 1000 px on the long side (500 on the short), JPEG, PNG or WebP, and 10 MB (owner action 4 about HEIC and the cap is still open), so the dialog says what the policy says. A logo is raster only (PNG or WebP; no SVG), which is the policy's decision under owner action 4's "raster-only logos". The board's accent name is still not drawn (39a). The logo copy does not say it shows on printed codes (the Share QR does not draw it until the print kit, slice 45), and it accepts JPEG like every image (a JPEG keeps its own background), so it recommends PNG or WebP rather than requiring them.
    - **Not run here.** The geometry harness (`property-look.metrics.ts`) gained a dialog check at the six widths. The harness's static-Storybook mode starts every play before the router has painted (an unrelated story fails the same way), and the dev-server mode starts a server this slice may not, so the new assertions were run as a Playwright script against the same static build instead (320 to 1920 px: the dialog inside the window and not taller than it, no sideways scroll, the primary button reachable, the phone from 768 px).
- **Owner/ops:** §5.

**43. AI translation capability (AI1–AI4).** Gated on owner decision 3 (§5).

**46. Republish live v1/v2 Portals as v3 (ops command).** Prepares slice 44: the legacy renderer can only go once no live Portal is on a v1 or v2 snapshot, and slice 20 makes a manager's republish one click but does not move Portals nobody opens.

- `pnpm ops republish-legacy-portals --operator <id> --org <id> [--property <id>] [--batch-size <n>] [--include-pending-edits] [--reason <text> --apply]`. Dry run is the default.
- **As built.**
  - **Selection** (`PortalLegacyPublicationReader`, `infrastructure/repositories/portal-legacy-publication.reader.ts`): a Portal that is `published`, not deleted, whose OPEN activation's snapshot stores `schemaVersion` 1 or 2, ordered by Portal id with a keyset cursor. It reads the live version, never history, so a draft-only, disabled, archived or deleted Portal (whatever its last snapshot) is never selected.
  - **The publication is the ordinary one.** `publishPortalChanges` was split into a plan (authorise, pending check, readiness gates, build the snapshot and command) and the write; `previewPortalChanges` is the plan with no write, so a dry run reports exactly the refusals the apply would meet. `republishLegacyPortals` plans each selected Portal first, then (on apply) publishes it, and reports `republished`, `would_republish`, `skipped` (a Portal error: its code and message, which are the gate's; or `pending_edits`), `unchanged` or `failed`. A fault that is not a Portal error stops the run with the partial report (and exit 1), the cause logged; a rerun is safe.
  - **Manager drafts are not pushed live.** A legacy Portal always reads as pending, so the publication would put the Portal's whole working copy live. A Portal with open `portal_pending_content_changes` rows is skipped as `pending_edits` (dry run included); `--include-pending-edits` is the explicit opt-in and the report counts the edits that went live.
  - **Actor.** `ops:<operator>` on the snapshot's `createdBy`, the activation's `activatedBy` and the `portal.publication.published` fact, under an organisation-wide `AccountAdmin` context built in `portal-ops-actor.ts` and reachable only through `container.portalMaintenanceRuntime` (operator container). It is never a user identifier. The Operational Action History files the publication fact as an `operator` actor (Recent Activity names it System, with no user lookup), and the version history and Portal History show it as "Reputation Key" with no operator id in the DTO. The id is stored in immutable snapshots, so operator handles must be non-personal.
  - **Fleet view.** The command is per organisation; the read-only SQL in `docs/operations/operator-commands.md` lists the organisations that still have live v1/v2 Portals (slice 44's precondition).
  - **Idempotent:** a republished Portal is on v3 and drops out of the selection; a Portal that is not ready reports the same reason every run.
  - **Tests.** Use case (selection, paging, dry run, apply, not-ready, idempotence, halt, organisation and Property scope), the preview, the action and its rendering, the command table, a real-PostgreSQL suite for the selection, and a real-PostgreSQL end-to-end run (the old activation closes as `replaced`, a verified v3 is served, the operator is on every row and fact, a second run writes nothing, a draft-only Portal and a Portal that is not ready are left as they were).

**45. Print kit, the small version (owner decision 6).** A "Print kit" section on the Share tab, with the print drawn on the right as on board 06.

- A table tent (A6, folded) or a counter card (A6), in one or two of the Portal's languages, with one call to action, and "Download print kit (PDF)".
- Depends on 19, 31 and 32 (all merged) and on 33 for the address. Size L.
- **As built.**
  - **The file.** PDFKit (MIT, 0.20.2) draws it server-side, as vectors: the QR is rectangles with a 4-module quiet zone on a light plate, the type is the guest fonts embedded as subsets (Latin, Latin-ext, Cyrillic, Cyrillic-ext, split per character by the guest stylesheet's `unicode-range`, so a bilingual line works), and only a photo or a logo is raster. A page is the trim plus a 3 mm bleed plus a 10 mm slug with crop marks (registration colour), and declares `TrimBox` and `BleedBox`. A table tent is one flat 105 x 296 mm sheet of two A6 panels with the back upside down and a fold mark, so it folds into a standing tent; a counter card is one A6 page per face (one page when there is one language).
  - **What it says.** Industry-neutral copy in all six languages (`PRINT_KIT_COPY`; es, it, fr and de are drafted without a native check, as decision 5 allows). Two calls to action: "Rate your visit, private, about 30 seconds" and "How was your visit? Tell us privately". The board's "How was your stay?" is not offered. Two languages: the front leads with the first and the back with the second.
  - **One source of measures.** `src/shared/domain/portal-print-kit.ts` (vocabulary, copy, faces, sheets, short address), `portal-print-kit-layout.ts` (every millimetre and point) and `portal-print-kit-palette.ts` are read by the PDF and by the preview, so they cannot drift. What a print is made of is the **live version**, not the draft: its languages, its titles (a language with no title reads the primary's, as the guest page does) and its look (the field and accent the guest page uses), because a printed card is permanent and its code opens the live page. A language added in the editor and not published is neither offered nor accepted (`locale_not_offered`); a Portal with nothing live has no print kit; a live version from before the Immersive Hub keeps the working copy's look but only its own languages. A long brand or title gives way inside the margins: the wordmark and the title shrink to a floor (8 pt, 6 pt) and then take a second line (`BRAND_FIT`, `fitLines`). The preview estimates line breaks and the address size, the PDF measures them; the two use the same rules, so a long name wraps in both, though the preview's break can differ by a word.
  - **The address.** Only `createPortalPrintKit` puts the address in a file. Order: authorise, check the languages against the Portal's, read the pictures, then fetch the address through `revealPortalAddress` with purpose `download` (so the disclosure is recorded before it is decrypted, History shows it as a download, and a code that was not sealed is refused). The download shares the "Download again" rate limit, is a no-store POST, and the preview read carries no address. The button is off, with the reason, for a code that cannot be fetched again; the preview then draws a sample code and says so.
  - **Pictures.** The photo and logo come from Portal media by asset id (checked against the stored hash and size, converted with sharp), never from a stored URL, so nothing is fetched. They exist only once uploads are on (slice 42); until then the print is the field colour, the wordmark and the washes.
  - **Fonts.** The guest woff2 files cannot be embedded: fontkit mis-reads their transformed `glyf` table (Ysabeau fails to subset at all, Cormorant draws headlines as blobs). The same subsets ship as TrueType in `infrastructure/print-kit/fonts/` (a lossless `fontTools` conversion, licences beside them), imported with `?inline` so the web bundle and, through a `.ttf` data-URL loader in `tsup.config.ts`, the worker bundle carry them. A test embeds every character of every subset.
  - **Build.** `pdfkit` is external to the Nitro bundle (`vite.config.ts`) and loaded when a print is made, like `sharp`.
  - **Checked by decoding.** The PDFs of a tent and a card were rendered with `pdftoppm` and the front and the upside-down back codes both decode to the full address.
- **Deviations.** The board's short address under the code (a 12-character path) is not what prints: the address under the code is the host and the full token path (about 89 characters at 6.5 to 8 pt, four fifths white), which is the QR's own secret in plain text. Owner question: print only the host (for example the app's domain), or keep the full address. Until answered it stays, set a little larger and brighter than the board. The plan did not say which fonts could be embedded or that the address needs a sealed code. A code made without a keyring cannot be printed from Share (Replace the code to get one that can). The Share tab now runs edge to edge and carries its own columns. The History entry is the existing "downloaded the code again": no print-kit line (no purpose column for it, so no migration).

**44. Contract cleanup.**

- Remove the legacy renderer and v1 UI once no active v1/v2 snapshots remain.
- Stop the dual write to `portal_links.label`.
- Drop the remaining `portal_group_members` reads.
- **As built.**
  - **The legacy renderer stays.** The guest renderer for v1/v2 snapshots and their verification are untouched: historical snapshots must verify forever (principle 5), and an environment may still hold live v1/v2 snapshots until `republish-legacy-portals` (slice 46) has run there. Removing the renderer is a separate release that waits for the fleet query in `docs/operations/operator-commands.md` to come back empty everywhere.
  - **`portal_links.label` is no longer written.** The primary-language text in `portal_link_texts` is the only name of a link. Creating a link writes `''` to the column (it is NOT NULL until a later migration drops it) and the text; `CreatePortalLinkCommand` carries the label as its own field (`label`) and `UpdatePortalLinkCommand.patch.label` is optional, so an icon, photo or address change leaves the text alone (before, `updateLink` re-sent the stored label, which now is not the name). Saving texts no longer touches the link row (not even `updated_at`), and a copied link carries no label. `newLinkToRow` is the mapper for links written today; `linkToRow` stays the faithful mapping for fixtures that stand for older links.
  - **Readers keep a fallback, but the rename heuristic is gone.** `resolveLinkTexts` still reads the legacy label as the primary-language text when a link has no text row (the e2e seed and any link written before migration 0044's backfill rely on it), but it no longer lets a label that is newer than the text win: with the mirror gone a stale column would beat the truth. `reconcileLinkTextsToPrimary` no longer re-mirrors the column on a primary-language switch; it keeps each link named in the old primary language (starting that text from the legacy label for a link that never had one, when the label is not empty) and starts the new primary text from it where none exists.
  - **Ledger and delete.** A rename records the wording it replaced from the primary text (not the column); a delete reads the primary text before the link and its texts go.
  - **Backfill before the rule goes (migration 0052).** The rename heuristic exists because migration 0044 and the dual write shipped together: code running between the migration and the text-aware editor could rename `portal_links.label` and leave the primary text stale, and every reader showed the label. Removing the rule without settling those rows would send such a link back to its stale text, and the next publish would carry the old wording to guests. Migration 0052 copies the trimmed label into the primary-language text wherever the label is not blank, differs from the text and is newer than it (the text's version moves on, its AI-draft provenance goes, `updated_by` is `system:migration-0052`), and writes a `link:<id>:updated` History row with the wording replaced (no person; the instant of the rename). It opens no pending-change fence: the label is what the live page already carries. It is idempotent and non-destructive, and `link-labels-newer-than-primary-text` in `docs/operations/operator-commands.md` is the read-only detection query: run it before the deploy and expect no rows after. `portal-link-label-backfill.integration.test.ts` runs the migration against seeded rows. The result of the pre-deploy run per environment is recorded here when the release goes out.
  - **One release, ordered.** The reader change (a stored text wins) and the writer change (no label mirror) ship together. The migration above must have run before any instance of this release serves, so the only rows the heuristic could have decided are already settled; the old code's dual write kept every other pair equal. Splitting into a reader release and a writer release was considered and not done: it would keep the dual write alive for a release for no row that migration 0052 does not already settle.
  - **Rollback hazard.** A release from before this slice treats a link label newer than its text as a rename, so rolling back after links were edited here would read the empty column as the wording. `src/contexts/portal/CONTEXT.md` says so; deploy order is the usual one (this release everywhere before the column is dropped).
  - **`portal_group_members`.** Its only remaining read, the Organization Export collection, is gone (group membership is `portal_group_memberships`, which the Staff export carries), the e2e seed no longer writes it, and its data-fate row is `bounded_contraction`. The lifecycle purge still deletes its rows and the table stays: dropping it is a data-destructive migration for the owner. The export keeps the format id `portal-organization-export/v1` with the collection removed (nothing parses the id, and a mirror row is expected to have its `portal_group_memberships` row, which the check `portal-group-members-without-membership` in `docs/operations/operator-commands.md` confirms: run it in each environment before the deploy, and keep exporting the mirror until it returns no rows).
  - **Admin pieces removed.** The link-category management chain: the four use cases (`createLinkCategory`, `updateLinkCategory`, `deleteLinkCategory`, `reorderCategories`) and their wiring, `portal-link-category.dto.ts`, the four `PortalCommandStore` commands and their implementations (database and in-memory), and the repository methods only they used (`updateCategory`, `deleteCategory`, `reorderCategories`, `findCategoryCommandTarget`). A category now exists only as the one a first link starts (`startCategory`). The event schemas, event types, ledger keys and `insertCategory` stay: facts recorded earlier still replay, and the History still reads the old ledger keys. Also removed: the caller-less `PortalSavedSettingsStatus` component and `findPublicPortalById` (a public read of the live labels with no caller).
  - **Already gone before this slice** (slices 28, 30, 34): the preview Sheet, the category UI and `PortalGroupManagement`. **Kept on purpose:** `PortalLinkReveal` is still the Share tab's public-address row (slice 33: "Show address" after a reload).
  - **Not done (separate decisions):** `portals.theme` still has writers with no UI (create from a copy, the `updatePortal` input); the legacy renderer reads a theme from legacy snapshots only, so the working-copy column could be retired with the legacy renderer. `softDeletePortal` is wired in `build.ts` and has no caller (the `deletePortal` server function archives through `updatePortal`).

---

## 4. Parallel tracks

| Track                   | Slices                                                                    | Files it owns (conflict notes)                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F: Portal model**     | 0 → 1 → 2 → 4 → 5 → 8 → 10/11 → 19 → 20; then 23, 26 (server), 33, 35, 37 | `portal-command-store.ts`, `portal-publication.repository.ts`, the schema files and `in-memory-portal-command-store.ts` are hot, so F slices that touch them run one at a time. After slice 4 each command family has its own module. Migrations are numbered in merge order: rebase and renumber. |
| **G: Guest UI**         | 6, 7 (after 1); then 12 → 13/14/17 in parallel → 15, 16 → 18              | `src/components/features/guest/**`, `src/routes/p/$token.tsx`, `src/styles.css`, `public/fonts`. Slice 7 also touches the `__root.tsx` head, so coordinate with slice 13.                                                                                                                          |
| **R: Reporting**        | 3 (day one), 24, 34 (reads), 38 (goal progress)                           | `src/contexts/reporting/**` only.                                                                                                                                                                                                                                                                  |
| **L: Language content** | 9 (after 1), 41                                                           | `language-packs/**`. Slice 9 defines the key names before G uses them.                                                                                                                                                                                                                             |
| **A: Admin UI**         | 21, 22 after 1; then 25, 27–32, 34, 36, 38–40 as their reads land         | `src/components/features/portal/**`, portal routes, `routeTree.gen.ts` (regenerated, never hand-merged), and the product-state ledger (append-only).                                                                                                                                               |
| **U, AI**               | 42, 43                                                                    | New files, after slice 8.                                                                                                                                                                                                                                                                          |

- **Day one:** 0 and 3 in parallel.
- **After 0:** 1.
- **After 1:** 2, 4, 6, 7, 9, 21 and 22 in parallel.
- **After 5:** 8.
- **After 8:** 10, 11 and 12.

---

## Owner decisions (2026-09-30)

The owner answered the §5 questions on 2026-09-30. Where this section differs from the rest of the plan, this section wins.

1. **Linktree from arrival: approved.** Slice 15 amends the `docs/BETA.md` §3 Portal bullet (the rating card stays first and dominant, and the Linktree is visible from arrival) and adds the ADR 0044 note. This no longer blocks slice 19.
2. **Group totals for Google opens and private notes: widen.** Amend `docs/BETA.md` line 54 and ADR 0041, and widen the metric registry scopes for those two measures. Slices 24, 25b and 38 show all five measures on group rows and the group page.
3. **AI translation: manual first.** Slice 43 stays deferred, and slice 29 ships without AI controls.
4. **SAFE-01 prerequisites removed.** The owner is the sole developer and the beta is a closed team, so there is no signed completion record, named signer, independent reviewer or drill. Slice 42 ships uploads switched on: it changes the `portal.upload` fate and amends `docs/BETA.md` §8 and ADR 0032 in the same PR. The technical safeguards stay in the build: re-encoding, metadata stripping, size and type limits, and same-origin serving.
5. **No native language checks during the closed beta.** BG v2 ships without a check, so slice 19 is not blocked. es, it, fr and de are offered as soon as their packs are drafted (slice 41).
6. **Print-kit PDF: the small version, after the core.** It covers the table tent (A6, folded) and the counter card (A6), in one or two languages with one call to action. It is built as a new slice 45 once the guest page and the admin workspace are live (after slices 19, 31 and 32). Until then, Share offers the QR code as PNG and SVG plus the NFC address.

## 5. Owner and ops actions still needed

| #   | Action or decision                                                                                                                                                                                                                          | Who           | What it blocks                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------- |
| 1   | Native check of the BG v2 guest copy; later es, it, fr and de. **Superseded by decision 5: no check during the closed beta; slice 41 no longer waits for it**                                                                               | Owner         | Slice 19 (BG); slice 41 (offering each language)                           |
| 2   | Short visit-notice copy against ADR 0044: it must still disclose the session cookie and network marker. Confirm the English `/privacy` link is acceptable for all six languages                                                             | Owner         | Final copy in slice 17 (full disclosure is used until then)                |
| 3   | AI translation: accept the merchant-notice bump (AI turns off until re-consent) and 14 days' privacy notice. Recommendation: manual first                                                                                                   | Owner         | All of slice 43                                                            |
| 4   | SAFE-01: name the signer and the independent reviewer; run the four deployed drills against the new ingest; sign `docs/release-evidence/safe-01/completion-record-<date>.md`. Decide HEIC, the size cap (10 or 15 MB) and raster-only logos | Owner + ops   | Switching on slice 42; the photo and logo controls in 39                   |
| 5   | Check `AWS_S3_*`, `S3_INTERNAL_ENDPOINT` and region `auto` on web and worker (Railway `sjc`)                                                                                                                                                | Ops           | Slice 42 drills; live Identity uploads                                     |
| 6   | Provision `PORTAL_ADDRESS_ENCRYPTION_KEYS` on web and worker; add it to the rotation runbook                                                                                                                                                | Ops           | Switching on "Download again" and removing the reveal-once flow (slice 33) |
| 7   | Group totals of Google opens and private notes: amend BETA.md line 54 and ADR 0041, or drop the two cells                                                                                                                                   | Owner         | Two measures on group rows and the group page (25b, 38)                    |
| 8   | Amend the BETA.md §3 Portal bullet (`docs/BETA.md:38`, "rates first") for a Linktree visible from arrival, with the rating card still first and dominant                                                                                    | Owner         | Slice 19 (the v3 guest switch)                                             |
| 9   | Deferring the print-kit PDF (it is on the Share board), and counting "Guests by language" from ratings rather than scans (the board caption says scans)                                                                                     | Owner         | Scope of slices 32/33 and 34                                               |
| 10  | Multi-industry: widen the BETA.md §3 Properties classifications (barbers and salons are not listed) or keep them out of scope                                                                                                               | Owner         | Nothing in this plan; affects onboarding                                   |
| 11  | Patch `eslint.config.js` to remove the `link-tree.tsx` max-lines exemption (the hook blocks agents from editing it)                                                                                                                         | Owner applies | The final step of slice 28                                                 |

**Defaults we apply unless the owner says otherwise (not blockers):**

- portals with more than four links keep them, but cannot add more;
- "QR and NFC" is shown whenever a code exists;
- a Linktree tap before a rating is not qualified;
- an emptied group stays, and archiving is offered;
- legacy snapshots keep the legacy renderer until republished;
- the language sheet follows the portal's order, and the Bulgarian chip reads БГ;
- deadlines use the snapshot's time zone;
- rollback stays limited to lower versions;
- link deletion stays AccountAdmin-only;
- `shortDescription` is kept for `og:description` only;
- the unavailable page shows EN plus BG.

---

## 6. The first slices in implementation-ready detail

Slices 0, 1 and 2 need no owner input. Slice 3 (fully specified in §3) runs in parallel from day one.

### Slice 0: split `portal.schema.ts`; golden snapshot fixtures

**Branch:** `refactor/portal-schema-split`.

**Schema split:**

- Move `portalPublicationSnapshots` (line 470), `portalPublicationActivations` (624) and `portalPendingContentChanges` (689), with their local helpers, into the new `src/shared/db/schema/portal-publication.schema.ts`. `portal.schema.ts` drops to about 555 counted lines.
- Add `export * from './portal-publication.schema'` to `src/shared/db/schema/index.ts`.
- Update the importers of the moved tables. 29 files import `schema/portal.schema`; change only those that use the three moved tables. There is no re-export shim in `portal.schema.ts`, because the data-fate guard classifies each `pgTable` by the file that exports it.
- In `src/shared/governance/data-fate-authority.ts`, change `schemaFile` to `'portal-publication.schema.ts'` for the three tables. Dispositions are unchanged.
- No SQL change: `pnpm check:schema-drift` must be clean, and `db:reset` must be identical.

**Golden fixtures:**

- Add `src/contexts/portal/application/__fixtures__/publication-snapshots.golden.ts` with one real v1 row and one real v2 row (bg primary with en additional): `configuration`, `configurationDigest` and the mirror columns (`guest_locale`, `language_pack_version`, `locale_set`, `language_pack_versions`, `localized_content`).
- Capture them from `scripts/seed-e2e-user.ts` output on a fresh `db:reset`, plus a hand-built bg-primary v2 case, and check that its digest is computed by the production `digestConfiguration`.

**Tests:**

- `portal-publication-snapshot.golden.test.ts`: each golden row passes through `snapshotFromRow` and `verifyPortalPublicationSnapshot` unchanged, and gives the same digest.
- A test that `PORTAL_LANGUAGE_PACK_VERSIONS` deep-equals `{en:'guest-ui-en-v1', bg:'guest-ui-bg-v1'}`. `portal-publication.repository.ts:394` writes this map whole into every v2 snapshot, and `:193` compares its canonical form.
- The existing `schema-migration-parity.test.ts` and data-fate guard stay green.

**Gates:** standard, `check:schema-drift`, `db:reset`, the integration project.

**Acceptance:**

- no counted-line breach;
- no schema diff;
- the golden tests are green on `main` code.

### Slice 1: shared guest-locale catalogue and pack registry

**Branch:** `feat/guest-locale-catalogue`. **Depends on:** slice 0.

**New `src/shared/domain/guest-locale.ts`.** This is the pure module, with no zod, and it may be imported from domain code (`eslint.config.js:263`).

```ts
export const GUEST_LOCALES = Object.freeze(['en', 'es', 'it', 'fr', 'de', 'bg'] as const)
export type GuestLocale = (typeof GUEST_LOCALES)[number]
export type GuestLocaleMetadata = Readonly<{
  code: GuestLocale; nativeName: string; englishName: string
  chipLabel: string   // EN ES IT FR DE БГ
  intlTag: string     // en es it fr de bg-BG
  script: 'Latn' | 'Cyrl'
}>
export const GUEST_LOCALE_METADATA: Readonly<Record<GuestLocale, GuestLocaleMetadata>>

// Pack generations. `supported` is append-only forever; `generation` ties a pack to snapshot schemas.
export const GUEST_LANGUAGE_PACKS = Object.freeze({
  en: { current: 'guest-ui-en-v1', supported: [{ id: 'guest-ui-en-v1', generation: 1 }] },
  bg: { current: 'guest-ui-bg-v1', supported: [{ id: 'guest-ui-bg-v1', generation: 1 }] },
  es: { current: null, supported: [] }, it: { current: null, supported: [] },
  fr: { current: null, supported: [] }, de: { current: null, supported: [] },
} as const satisfies Record<GuestLocale, { current: string | null; supported: readonly { id: string; generation: 1 | 2 }[] }>)
export type GuestLanguagePackVersion = /* union of every supported id */

export const OFFERED_GUEST_LOCALES = Object.freeze(['en', 'bg'] as const satisfies readonly GuestLocale[])
export type OfferedGuestLocale = (typeof OFFERED_GUEST_LOCALES)[number]

export function isGuestLocale(value: unknown): value is GuestLocale
export function parseGuestLocale(value: unknown): GuestLocale | null
export function matchGuestLocale(tag: string): GuestLocale | null          // 'es-MX'→'es', case-insensitive
export function isSupportedGuestLanguagePack(locale: GuestLocale, version: unknown, generation: 1 | 2): version is GuestLanguagePackVersion
export function currentGuestLanguagePack(locale: GuestLocale): GuestLanguagePackVersion | null
export function guestLocaleFormatTag(locale: GuestLocale): string
```

**New `src/shared/guest-locale-schemas.ts`.** This is for the application, infrastructure, routes, `src/shared/events` and `src/shared/db/schema` layers:

```ts
export const guestLocaleSchema = z.enum(GUEST_LOCALES) // readers
export const offeredGuestLocaleSchema = z.enum(OFFERED_GUEST_LOCALES) // manager inputs
```

Slice 2 adds the SQL fragments here.

**Snapshot versions** (`src/contexts/portal/application/portal-publication-snapshot.ts` and the domain):

- In `domain/portal-publication-snapshot.ts`, historical constants stay **literal**:
  - `LEGACY_V1_GUEST_LOCALE = 'en'` and `LEGACY_V1_LANGUAGE_PACK = 'guest-ui-en-v1'` (renamed from `PRIMARY_GUEST_LANGUAGE_PACK_VERSION`, with the old name re-exported);
  - `PORTAL_LANGUAGE_PACK_VERSIONS` stays the literal `{en:'guest-ui-en-v1', bg:'guest-ui-bg-v1'}` and is renamed internally to `V2_LANGUAGE_PACK_VERSIONS` (old name re-exported).
  - `PortalGuestLocale = GuestLocale`.
- New `isLocalizedConfiguration(c): c is PortalPublicationConfigurationV2` (true for `schemaVersion >= 2` once v3 exists; for now `=== 2`). It replaces all eleven branches:
  - `resolve-public-portal-token.ts:121,222,232,235,237,254,325`;
  - `portal-command-store.ts:625,781`;
  - `get-portal-publication-history.ts:58`;
  - `portal-publication.repository.ts:190`.
- In `hasCompleteSchemaVersionedContent` (lines 191–216), replace `!== PORTAL_PUBLICATION_SCHEMA_VERSION` (:201) with an exhaustive `switch (configuration.schemaVersion)`:
  - case 1 keeps the current literal check;
  - case 2 passes `configuration.languagePackVersions` through with generation 1;
  - the default returns `false`.

**Domain edits:**

- `domain/portal-experience.ts`:
  - delete `ACTIVE_PORTAL_GUEST_LOCALES`;
  - the locale check becomes `isGuestLocale`;
  - the pack check becomes `isSupportedGuestLanguagePack(locale, v, 1)` (membership).
- `selectPortalGuestLocale` gets an **intended behaviour change**:
  - Accept-Language is parsed with q-values (stable sort, `q=0` dropped) through `matchGuestLocale` and `allowed.has`;
  - the order of precedence stays: requested, then signed session, then Accept-Language;
  - the final fallback stays `allowed.has(primary) ? primary : localeSet[0] ?? PRIMARY_GUEST_LOCALE`.
- `domain/types.ts`, `constructors.ts` and the `events.ts` asserts (lines ~786/806/827/831) use `GuestLocale`/`isGuestLocale`. `events.ts` does not grow.

**Application and infrastructure:**

- `application/dto/update-portal.dto.ts` and `dto/portal-experience.dto.ts` use `offeredGuestLocaleSchema`. `.max(1)` stays.
- `application/public-api.ts:96-103`: `GuestLocale` and `GuestLanguagePackVersion`.
- `resolve-public-portal-token.ts:258-259` uses `isSupportedGuestLanguagePack(…, 1)`.
- `portal-publication.repository.ts`:
  - **the v1 and v2 zod branches stay frozen exactly as they are** (lines 110–111, 117–128; no `partialRecord` widening);
  - line 318 uses `parseGuestLocale(portal.primaryGuestLocale) ?? failClosed()`;
  - line 394 is unchanged (the literal map).
- `portal-experience.repository.ts:65,81` uses `parseGuestLocale(row.locale)`, and throws the repository's existing malformed-row error on `null`.
- `portal-command-store.ts:781-795` goes through `isLocalizedConfiguration`; the default stays the literal v1 map.
- `infrastructure/mappers/portal.mapper.ts` parses instead of casting.

**Shared, guest, routes and components:**

- `src/shared/events/schema-registrations.ts:1190-1199` uses `offeredGuestLocaleSchema`, with the same line count.
- `contexts/guest/domain/guest-session.ts` (28, 52) uses `parseGuestLocale` from `shared/domain`. `guest/server/guest-session.ts` does the same, so old en/bg cookies still verify.
- `guest/server/guest-scans.ts:205` uses `guestLocaleSchema`.
- `src/routes/p/$token.tsx:27,56` uses `guestLocaleSchema.optional().catch(undefined)`.
- `src/routes/__root.tsx:71` uses `isGuestLocale(selected) ? selected : 'en'`.
- Components drop the four `locale==='bg'` pack defaults:
  - `portal-localization.ts`;
  - `guest-language-pack.ts:188-193` (`formatDate` uses `guestLocaleFormatTag`);
  - `guest-response-form.tsx`;
  - `portal-secondary-links.tsx`;
  - `guest-analytics-notice.tsx:147`.

  Beyond that:
  - `portal-language-nav.tsx:45` uses `GUEST_LOCALE_METADATA[l].nativeName` with `lang`;
  - the admin types use `OfferedGuestLocale`.

- `scripts/seed-e2e-user.ts:474-477` and `src/shared/testing/scenarios/executors.ts` use the constants, with **no net line growth** (both are ratcheted).
- `in-memory-portal-command-store.ts`: types only.

**Tests (write first):**

- `src/shared/domain/guest-locale.test.ts`:
  - the order of the six locales;
  - metadata present, with БГ for bg;
  - supported ids match `^guest-ui-<locale>-v[1-9]\d*$` for their own locale;
  - `current` is either `null` or in `supported`;
  - every offered locale has a `current`;
  - `matchGuestLocale`: `es-MX`→es, `DE-at`→de, `pt`→null, `''`→null.
- `domain/portal-experience.test.ts`:
  - q-values (`de;q=1, bg;q=0.9` with set {en, bg} gives bg), `q=0`, region tags, unsupported languages;
  - **the primary still wins over `localeSet[0]`** when nothing matches;
  - the verifier accepts v1 packs and rejects `guest-ui-bg-v1` for `en` and unknown ids.
- The slice 0 golden fixtures stay green; add a case that an unknown `schemaVersion` fails closed.
- The repository mapper throws on `'de'` and never returns `'en'` for it.
- An old cookie with `locale:'bg'` still verifies.
- New `src/shared/architecture/guest-locale-literals.test.ts`: scans production `src/**` and `scripts/**` (tests and stories excluded) for `'en' | 'bg'`, `['en', 'bg']`, `=== 'bg'` and `'guest-ui-(en|bg)-v1'`. The allowlist is:
  - `src/shared/domain/guest-locale.ts`;
  - `domain/portal-publication-snapshot.ts` (pinned historical literals);
  - `language-packs/*` and `guest-language-pack.ts` (the v1 pack constants);
  - `portal-publication.repository.ts` (the frozen v1/v2 zod branches);
  - `src/shared/db/schema/portal.schema.ts` (until slice 2).
- Run `pnpm lint` early; `scripts/check-architecture-boundary-controls.mjs` must pass for the domain import.

**Gates:** standard, the unit and integration projects, `pnpm test:storybook` (guest stories), `check:product-state-consistency`.

**Acceptance:**

- every existing test passes unchanged, except the new Accept-Language q-value cases;
- managers can still choose only en or bg;
- no silent coercion remains;
- the golden v1/v2 rows verify;
- lint is clean on all boundaries.

### Slice 2: migration 0043, six-locale CHECKs, wider readers, ADR 0061

**Branch:** `feat/guest-locales-six-checks`. **Depends on:** slice 1.

**Additions to `src/shared/guest-locale-schemas.ts`:**

```ts
export const GUEST_LOCALE_SQL_LIST = GUEST_LOCALES.map((l) => `'${l}'`).join(', ') // 'en', 'es', 'it', 'fr', 'de', 'bg'
export const GUEST_LOCALE_JSONB_LITERAL = `[${GUEST_LOCALES.map((l) => `"${l}"`).join(', ')}]` // ["en", "es", ...] — comma-space, as Postgres renders jsonb
export const GUEST_LANGUAGE_PACK_SQL_PATTERN = `^guest-ui-(${GUEST_LOCALES.join('|')})-v[1-9][0-9]{0,2}$`
```

The existing CHECKs are written `'["en", "bg"]'` with a space after the comma (`portal.schema.ts:91,575`, `drizzle/0000_baseline.sql:3040,3120`). `JSON.stringify` has no spaces, so it is not used. The drift test below confirms the normalised expressions match.

**`src/shared/db/schema/portal.schema.ts`** (after slice 0) and **`portal-publication.schema.ts`**, using `sql.raw` from the catalogue (precedent: `reply-library.schema.ts:113`):

- `portals_primary_guest_locale_active` becomes `IN (${sql.raw(GUEST_LOCALE_SQL_LIST)})`.
- `portals_additional_guest_locales_array` becomes `<@ '${GUEST_LOCALE_JSONB_LITERAL}'::jsonb`.
- `property_portal_brand_contents_locale_active` and `portal_localized_overrides_locale_active` get the same `IN` list.
- In `portal-publication.schema.ts`:
  - `portal_publication_snapshots_locale_valid` gets the `IN` list;
  - `_language_pack_valid` becomes `~ '${GUEST_LANGUAGE_PACK_SQL_PATTERN}'`, so the database is broad and the application registry stays authoritative and fails closed;
  - `_locale_set_valid` gets the jsonb literal and keeps `@> jsonb_build_array(guest_locale)`.
- Defaults are unchanged. Remove `portal.schema.ts` from the slice 1 literal-guard allowlist.

**Migration: hand-written, no drizzle-kit.** `drizzle/meta` holds only snapshots 0000–0013, and 0042 was added as SQL plus a journal entry only. File `drizzle/0043_guest_locales_six.sql`:

```sql
ALTER TABLE "portals" DROP CONSTRAINT "portals_primary_guest_locale_active";--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_primary_guest_locale_active" CHECK ("portals"."primary_guest_locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
ALTER TABLE "portals" DROP CONSTRAINT "portals_additional_guest_locales_array";--> statement-breakpoint
ALTER TABLE "portals" ADD CONSTRAINT "portals_additional_guest_locales_array" CHECK (jsonb_typeof("portals"."additional_guest_locales") = 'array' AND "portals"."additional_guest_locales" <@ '["en", "es", "it", "fr", "de", "bg"]'::jsonb);--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" DROP CONSTRAINT "property_portal_brand_contents_locale_active";--> statement-breakpoint
ALTER TABLE "property_portal_brand_contents" ADD CONSTRAINT "property_portal_brand_contents_locale_active" CHECK ("property_portal_brand_contents"."locale" IN ('en', 'es', 'it', 'fr', 'de', 'bg'));--> statement-breakpoint
-- same drop/add: portal_localized_overrides_locale_active, portal_publication_snapshots_locale_valid
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_locale_set_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_locale_set_valid" CHECK (jsonb_typeof("portal_publication_snapshots"."locale_set") = 'array' AND "portal_publication_snapshots"."locale_set" <@ '["en", "es", "it", "fr", "de", "bg"]'::jsonb AND "portal_publication_snapshots"."locale_set" @> jsonb_build_array("portal_publication_snapshots"."guest_locale"));--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" DROP CONSTRAINT "portal_publication_snapshots_language_pack_valid";--> statement-breakpoint
ALTER TABLE "portal_publication_snapshots" ADD CONSTRAINT "portal_publication_snapshots_language_pack_valid" CHECK ("portal_publication_snapshots"."language_pack_version" ~ '^guest-ui-(en|es|it|fr|de|bg)-v[1-9][0-9]{0,2}$');
```

- Append journal idx 43: `"tag": "0043_guest_locales_six"`, `"when"` greater than `1792300000000`, no snapshot file.
- The migration only widens. Existing rows already satisfy it, and the tables are small.

**Readers widened in the same PR (release A):**

- `schema-registrations.ts:1190-1199`: `guestLocaleSchema`, and `additionalGuestLocales: z.array(guestLocaleSchema).max(GUEST_LOCALES.length - 1)`. No net line growth. This widening needs no new event version; web and worker deploy together.
- `domain/events.ts` asserts: six locales, at most 5 additional.
- `update-portal.dto.ts`: input stays `offeredGuestLocaleSchema`. The cap becomes `.max(GUEST_LOCALES.length - 1)`, refined to be unique and to exclude the primary.
- Writers still accept only en and bg.

**ADR 0061** (`docs/adr/0061-guest-languages-and-publication-v3.md`, index regenerated with `scripts/adr-index.mjs`). It records:

- the six-locale catalogue as the single authority;
- the database-broad / application-strict layering;
- pack generations bound to snapshot schema (generation 1 ↔ schema v1/v2, generation 2 ↔ v3);
- renderer choice by `schemaVersion >= 3`;
- materialised per-text fallback with `fallbackFrom`;
- readers before writers;
- the manager app staying English (BETA.md §3).

**Tests:**

- `src/shared/db/schema/guest-locale-check-parity.test.ts`: reads `drizzle/0043_guest_locales_six.sql` and asserts that each of the seven CHECK bodies contains `GUEST_LOCALE_SQL_LIST`, `GUEST_LOCALE_JSONB_LITERAL` or `GUEST_LANGUAGE_PACK_SQL_PATTERN`.
- `pnpm check:schema-drift` on a migrated database proves that the model expressions equal the catalogue rendering, including the jsonb literal format (`src/shared/db/schema-drift.ts` compares CHECKs at expression level).
- Integration (per-branch `TEST_DATABASE_URL`):
  - a `de` primary passes the database;
  - `pt` fails with the named constraint;
  - a snapshot row with `guest-ui-de-v2` passes the CHECK but `verifyPortalPublicationSnapshot` rejects it (layering proven).
- Event schema: 5 additional locales parse, 6 are refused.
- `update-portal.test.ts`: `de` is still refused as manager input.

**Gates:** standard, `check:schema-drift`, `db:reset`, `db:migrate-deploy` on an upgraded copy, `event-job-catalogue.test.ts`, `protected-field-registry.test.ts`.

**Deploy:** additive migration, under the standing auto-merge and deploy rule, with web and worker together.

**Rollback:** re-narrowing is safe while no row uses a new locale (true until slice 41).

**Acceptance:**

- drift is clean and the parity test is green;
- no manager-visible change;
- later releases can write any of the six locales without another migration;
- ADR 0061 is indexed.

---

## Changes from review

- **A1:** the catalogue is split into the pure `src/shared/domain/guest-locale.ts` (domain may import only `shared-domain`, `eslint.config.js:263`) and `src/shared/guest-locale-schemas.ts` (zod and SQL). Lint runs first.
- **A2:**
  - historical pack and locale constants are pinned as literals and allowlisted in the guard test;
  - an exhaustive version switch replaces `!== PORTAL_PUBLICATION_SCHEMA_VERSION`;
  - one `isLocalizedConfiguration` helper replaces the eleven `schemaVersion === 2` branches (verified);
  - the `portal-command-store.ts:781-795` mirror columns are handled for v3.
- **A3:** migration 0043 is hand-written with a journal-only entry (verified: `drizzle/meta` stops at 0013). The jsonb literal uses comma-space separators (verified against `portal.schema.ts:91` and the baseline), and `check:schema-drift` confirms it.
- **B1:** slice 8 now fixes the complete v3 schema, with asset-id media, `fallbackFrom`, the time zone and provenance. Any later guest-visible field means a v4.
- **B2:** a test pins `PORTAL_LANGUAGE_PACK_VERSIONS`, and the v2 zod branch stays frozen.
- **B3:** new slice 0 splits the publication tables out of `portal.schema.ts` (831 non-blank lines, no baseline) and updates the data-fate keys. It also captures golden fixtures.
- **B4:** the thresholds live in the reporting domain, and `application/utils.ts` imports them. The UI gets `insufficient` and `n` from the server. The hedge about the KPI type is dropped (`PortalKPIs` is already separate).
- **B5:** the anti-gating test uses `renderToStaticMarkup` (the unit project runs in `node`), and it closes the ADR 0044 "architectural test" gap.
- **B6:** slice 18 is re-scoped to the geometry gate plus a Chromium LCP/CLS observer; screenshot baselines are deferred. Size raised to L.
- **C1/C2:** slice 7 moves the app font `@import`s to root `<link>`s chosen per route, keeps app fonts on legacy `/p` pages, and budgets for the closure. Slice 17 states that the unavailable page goes live on merge.
- **C3:** `PortalLinkReveal` stays until slice 33 is active with the keyring.
- **C4:** `PortalGroupManagement` stays until slice 38.
- **C5:** slice 10 dual-writes `portal_links.label`, and readers fall back to it. The category collapse moves to slices 19 and 28.
- **C6:** pending-change rows are recorded in slices 10 and 11, including look fan-out. Default-language edits have no side effects.
- **C7:** slice 19 removes the silent v1 fallback and adds a default brand profile.
- **C8:** the renderer is chosen by `schemaVersion >= 3`, and the verifier binds pack generation to schema version.
- **C9:** the fallback is materialised with `fallbackFrom`, and v3 requires every locale complete. `shortDescription` is kept for OG only (a default, listed for the owner).
- **C10:** U6 (the board 14 UI, built dark) is added to slice 42.
- **D1:** the BETA.md Portal bullet amendment and the ADR 0044 note are added (slice 15; §5 item 8, blocking slice 19).
- **D2:** multi-industry is marked out of scope (§5 item 10), and the copy is industry-neutral.
- **D3:** ADR 0061 ships in slice 2, and slice 20 adds a CONTEXT.md line next to invariant 4.
- **D4:** deferring the print kit and counting guests by language from ratings are both added to §5 for owner agreement.
- **E:**
  - in-memory command store entries are required for every new command;
  - the seed and executors ratchets allow no growth;
  - the new files are named `domain/portal-group-events.ts` and `domain/portal-link-events.ts`;
  - the `selectPortalGuestLocale` change is called a behaviour change, and primary-first precedence is kept;
  - the standard gates gain `check:changed-code`, `check:unchecked-indexed-access`, `check:typescript-project-coverage` and `check-test-quality`;
  - the funnel handles steps over 100%;
  - the preview never exposes destinations that are not approved.
