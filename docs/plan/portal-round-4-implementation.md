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
   - es, it, fr and de are offered to managers only after the owner's native-speaker check.
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
  - the print-kit PDF (the Share board shows it);
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

**18. Guest quality gate (G9), re-scoped.** There is no `toHaveScreenshot` or LCP harness in `e2e/` today. This slice adds:

- the Storybook geometry gate (`e2e/storybook-metrics/pane-metrics.ts`) extended to the G01–G12 stories at 320, 375 and 768 px: overflow, clipping, touch targets and long German words;
- a Chromium-only Playwright check of LCP (< 2.5 s) and CLS (< 0.1) through a `PerformanceObserver`, on the seeded v3 portal with and without a photo fixture;
- a reduced-motion check;
- the bundle measurement recorded in `check-bundle-budget.mjs`.

Screenshot baselines are deferred until fonts, OS and baseline storage are designed.

- Depends on 12–17. Size L.

### Phase 3: release B, the writer switch

**19. v3 builder, v2 packs, category flattening (F8).**

- `buildPortalPublicationSnapshot` writes v3 only.
- The silent v1 fallback is removed (`hasCompleteExperience`, `portal-publication.repository.ts:353-356,390`):
  - a property without a brand profile gets the default profile (champagne accent on a dark field);
  - a primary locale with missing text is a readiness **blocker**;
  - a non-primary gap is a **warning**, filled from the primary with `fallbackFrom`.
- Links are flattened in category-then-link order.
- The `current` pack becomes v2 for en and bg.
- `scripts/seed-e2e-user.ts` moves to v3 with no net growth; helpers are extracted if needed.
- **Tests:**
  - full guest e2e on v3;
  - a seeded v2 portal still renders the legacy layout;
  - the in-transaction comparison covers every v3 field;
  - a property with no brand profile publishes v3.
- Depends on 8–18 and the BETA.md amendment from slice 15. Size L.
- **Owner:** native check of BG v2 (blocking). **Ops:** deploy only after slice 8 is everywhere.

**20. Publish changes while live (F9).**

- `publishPortalChanges`, mutation kind `republish`: close the active activation with reason `replaced` and insert a snapshot and activation in one transaction under `lockPortalPublicationProperty`, with the same readiness gates as publish.
- Emit `portal.publication.published` (extend `assertLifecyclePayloadMatchesPublication`).
- A Property-look publish runs N per-portal commands in sequence and reports the result per portal.
- New `use-cases/publish-portal-changes.ts` and `infrastructure/portal-publication-commands.ts`.
- Add a line to Portal `CONTEXT.md` next to invariant 4: a live portal can be republished, and the previous activation closes as `replaced`.
- **Tests:** integration for the fence and lock order; a no-op when nothing is pending; an in-memory store entry.
- Depends on 4, 5, 19. Size L.

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
  - `createLink` may leave the category out: the link joins the Portal's last category, and the first link starts one titled "Links". The category is started only after the label, icon, cap and destination pass, and the Portal is read again before the link write (a real-PostgreSQL test pins this).
  - Moving a tile saves one category's order, so a tile moves only among those of its own category; at a boundary between two older categories its move control is disabled. The category server functions, the drag-and-drop code and the `@dnd-kit` dependencies are removed; the category use cases stay until slice 19 flattens categories in the snapshot.
  - Typed text (labels, lines, titles) saves through the portal autosave. Re-ordering, icons, the address, adding, deleting and the switch are their own saves, each after any typed text still waiting. The address is checked on the server, so it saves when the field is left.
  - No photo choice and no "Translate with AI": both wait for uploads and for the AI capability. The approved-destinations card stays under the tiles, because it is where an Account Admin approves a custom address.
  - The exemption for `link-tree.tsx` in `eslint.config.js` is stale now that the file is 200 lines; removing it is the owner patch (`s28-eslint.patch`).

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
- Depends on 6, 8, 12. Size L.

**31. Review & publish (A9).**

- A pure `portal-review-rules.ts`.
- `portal_pending_content_changes.changed_by`, in `portal-publication.schema.ts` after slice 0.
- History exposes `activatedBy`.
- A plain-words change list, a 1-star/5-star pair showing the same Google card, and a footer wired to slice 20.
- Depends on 20, 29, 30. Size XL; ship as rules plus reads, then the UI.

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

**39. Property look page (A14).**

- Accent colour with a contrast readout, wordmark, default languages, affected portals, and a batch review & publish (slice 20 run in sequence).
- The photo and logo controls are inert while `portal.upload` is blocked.
- Depends on 11, 20, 30. Size XL; split into the page, then the batch.

**40. All properties view (A15).**

- `src/routes/_authenticated/portals/index.tsx`, an org-scope branch in `ManagerNavRow`, grouping by property, and organisation totals kept separate from the Google review average.
- Inherited from 25b (the read already answers an organisation scope; nothing calls it that way yet):
  - an organisation branch of `getPortalResultsOverviewFn` over the reader's Properties, which needs one roster and one zone per Property (the use case takes `properties[]`);
  - rendering of the Property subtotal rows, each Property's own window on board 10 (Properties in different time zones read different windows), and the per-Property "not in a group" row;
  - stories for board 10, and the 1000-Portal roster limit (`too_many_portals`) decided for a whole organisation, which can exceed it where one Property cannot.
- Depends on 23–25. Size L.

**41. es, it, fr and de packs (L2).**

- We draft the four v2 packs (formal Sie in German, per the LANGUAGES.md glossary).
- Each locale is added to `OFFERED_GUEST_LOCALES` only after the native check.
- Compatibility e2e for de and one other Latin-script language in Chromium, Firefox and WebKit.
- Depends on 9, 19. Size M. **Owner:** native checks.

### Phase 5: built dark or gated

**42. Portal media, built dark (U1–U6).**

- **U1:** `portal_media_assets` in `portal-assets.schema.ts`, and asset foreign keys (the snapshot fields already exist from slice 8).
- **U2:** a sharp adapter and a pure `portal-image-policy`, with adversarial fixtures.
- **U3:** server-side ingest with a request body limit scoped to its path, gated on `capability: 'portal.upload'`.
- **U4:** a same-origin media route, and removal of the AWS-only `getPublicUrl`.
- **U5:** garbage collection, takedown, and purge and export deleting the stored objects.
- **U6:** the board 14 UI (Replace photo dialog, focal-point picker, alt text, rights checkbox, preview), inert while the capability is blocked.
- **Owner/ops:** §5.

**43. AI translation capability (AI1–AI4).** Gated on owner decision 3 (§5).

**44. Contract cleanup.**

- Remove the legacy renderer and v1 UI once no active v1/v2 snapshots remain.
- Stop the dual write to `portal_links.label`.
- Drop the remaining `portal_group_members` reads.

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
| 1   | Native check of the BG v2 guest copy; later es, it, fr and de                                                                                                                                                                               | Owner         | Slice 19 (BG); slice 41 (offering each language)                           |
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
