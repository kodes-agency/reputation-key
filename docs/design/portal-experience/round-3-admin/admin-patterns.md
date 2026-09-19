# Admin patterns for the portal admin redesign

Date: 2026-09-19. Design research only; no product code. Input for the admin redesign (portal creation and management, analytics, monitoring) that follows guest round 3.

## Sources and how much to trust them

| Tag        | Meaning                                                                                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[R3]**   | Round-3 research (`round-3-guest/research.json` / `research.md`). Each competitor carries its own evidence level (observed-live, vendor-page, third-party). Vendor claims stay claims.                                                   |
| **[R2]**   | `admin-round-2.md` and the earlier `README.md` (owner feedback, Local Character critique, three admin models).                                                                                                                           |
| **[F]**    | Primary doc fetched on 2026-09-19: Vercel Instant Rollback, Shopify theme editor overview, Plausible metric definitions, Atlassian Statuspage components, Google Analytics data thresholds.                                              |
| **[K]**    | Prior knowledge that was not re-verified this round. Fetches failed for Uniqode (404), Linktree Insights and Typeform preview (redirect, then 403) and HappyOrNot (DNS). Treat as a hypothesis and check before quoting it to the owner. |
| **[Code]** | Read from the codebase at `rk-portal-redesign` (current main).                                                                                                                                                                           |

## The RepKey lens every pattern passes through

- **Equal Google access.** Every guest gets the same Google action after any rating. No admin control, preview, metric or copy can suggest score-dependent routing. The Private Feedback Threshold (1..5, default 3) only decides who is _also_ offered a private note.
- **Gamification, leaderboards and staff attribution are permanently denied.** A placement names a _place_, never a person, shift or server.
- **Honest metrics.** The measures are exactly `qualified_scans`, `portal_rating_count` and `portal_rating_average`, plus guests who opened Google and private feedback volume, at Property, Portal Group and Portal scope. A Google selection is a click, never a review.
- **Deliberate publication.** A draft working copy becomes an immutable published snapshot only through a deliberate publish. Rollback is append-only. Stable QR/NFC tokens survive edits.
- **Inbox visual language.** Neutral plus purple, hairlines instead of cards, facts versus controls, one primary action per area, ledger timelines, availability by exception. The admin stays neutral and the guest page carries the property brand.
- **Beta limits.** Image upload is safety-blocked. The question, buttons and receipts come from immutable language packs and cannot be edited.

---

## 1. Creating and editing a branded guest page

### 1.1 Structure, preview and settings as three coordinated regions, stacked when narrow

- **Seen in:** Shopify theme editor [F]: a left tree of sections and blocks, a live preview with a mobile/desktop toggle, and a settings panel. At 1600px and wider it uses a "double sidebar" (structure left, settings right). Narrower screens get a "single sidebar" with a draggable divider and settings that slide up from the bottom. Duve arranges sections and posts by drag and drop [R3]. Round 3 found that "every vendor puts the live phone preview beside the editor" [R3].
- **Why it works:** the admin always sees what they are changing and its effect together, and the layout degrades predictably.
- **RepKey fit: Adapt.** RepKey's editable surface is small: a placement or welcome line, a short description, links, languages, the threshold and managers. The whole page does not need a block canvas. The owner preferred **Refined Sections** (a section list that expands in place, beside a device-framed preview) [R2]. Use a two-region layout (sections | preview) that expands the selected section inline, and let the preview slide into a sheet below `lg`, as the current 480px Preview sheet does. Frame the preview in a 320/390 device outline and never restyle the admin in the property palette.

### 1.2 Selecting in the preview selects the setting

- **Seen in:** Shopify preview inspector [R2 ref]: clicking a visible section opens its settings. Framer on-page editing [R2 ref].
- **Why it works:** it removes the mapping step ("which row is that heading?"), which was round 2's main critique of section editors.
- **RepKey fit: Adapt lightly.** Clicking a region of the preview (title, description, a link row) should highlight and open the matching section row, with one selection outline shared by the list and the preview. Do not make the preview a WYSIWYG canvas. Round 2 judged Visual Studio's three regions "more technical", and in-canvas editing is expensive for keyboard and screen-reader use.

### 1.3 A state switcher that previews every guest state, including a fairness proof

- **Seen in:** GatherUp Request Setup (per-step page editing with preview) [R3]. Birdeye templates sectioned into General, Header, Feedback page and Thank-you page [R3]. Guest Journey model [R2].
- **Why it works:** admins review the later screens, not just the attractive entry screen. That is where copy and translation errors hide.
- **RepKey fit: Adopt, with a RepKey-only twist.** Add a preview state menu: Arrival, Rating selected, After rating, Private note, Receipt, Withdrawn, Google temporarily unavailable, and the "code no longer active" page. Add one special view, **After rating: 1★ and 5★ side by side**, showing the identical Google action. It turns the equal-access rule into a visible product feature and answers buyers who arrive expecting "filtration" [R3]. Label optional states ("only when the guest chooses to add a note") so the list never reads as a routing builder.

### 1.4 "Try as guest" as a simulation that writes nothing

- **Seen in:** Birdeye "scan with your phone to preview end-to-end" and NiceJob's walk-your-own-link [R3]. Typeform and Tally preview modes, whose preview submissions are not stored as responses [K].
- **Why it works:** admins can feel the flow, including errors, without polluting data.
- **RepKey fit: Adopt, with explicit guarantees.** Keep it separate from edit selection (a round-2 finding). In the simulation: no response stored, no `qualified_scan`, no notification to responsible managers, and no navigation to Google. Show an in-frame "Google would open here" card instead. Offer a simulated submit failure. State the guarantee once, in a tooltip, per inbox principle 5 (no standing explanatory lines). An "Open this draft on my phone" link is valuable but needs a **security decision**: it must not be a portal token and must not qualify scans.

### 1.5 Curated styles with account defaults and a scoped override

- **Seen in:** Canary (3 title × 3 body type choices, primary and secondary colours), Duve (16 curated fonts, one brand colour), and Touch Stay Appearance (curated font and colour sets, account-level defaults with per-guidebook override) [R3]. Shopify splits global Theme settings from section settings [F].
- **Why it works:** curated choices look better and carry less risk than free pickers. Two scopes (global and local) match how multi-location owners think.
- **RepKey fit: Adopt.** The Property scope (AccountAdmin) holds the composition (A Carved Stillness, B Folio, C Table Card), the three hex values and the display name. The Portal scope holds the placement line, description, links, threshold, managers and languages. Show the scope next to each field ("Property-wide · affects 5 portals") and offer one "Use property wording" reset per field. Don't show contrast as raw ratios. Show a pass or a suggested fix computed by the derived-token engine, and warn when a brand does not suit A (for example deep red or near-black) [R3].

### 1.6 Localisation side by side, with missing strings surfaced

- **Seen in:** TrustYou shows the original while you translate each message [R3]. ReviewPro shows yellow readiness warnings for missing translations [R3]. Hostfully auto-translates 16+ languages, Canary offers automated translations with a default language [R3], and Shopify has a market/language menu in the editor [F]. Ratestar's anti-pattern is a flag pill that swaps only the UI chrome, which produces mixed EN/BG pages [R3].
- **Why it works:** translation gaps become visible facts rather than surprises in production.
- **RepKey fit: Adopt.** One language selector drives both the editor and the preview [R2]. Show per-locale completeness facts ("Bulgarian · 2 fields missing"), with the English original shown under the Bulgarian field. Any machine translation is a draft suggestion marked "not reviewed". Enabling a locale never implies its copy is approved. Use native language names, never flags.

### 1.7 Link rows with order, cap, status and localized labels

- **Seen in:** Birdeye (drag-and-drop site order, custom sites by name and URL) [R3]. NiceJob (a show/hide toggle per site) [R3]. Beacons (each link "individually scheduled, animated, and tracked") [R3]. Linktree and link hubs, which converge on full-width rows with Menu or Reservations first [R3].
- **Why it works:** owners want menus, spa and directions next to the ask, and order conveys priority.
- **RepKey fit: Adapt.** Link rows show a localized EN/BG label, an icon from the curated `iconKey` set, and **approval status in place** (Approved / Awaiting approval / Lapsed: not shown to guests), because unapproved links are silently dropped today [Code via R3]. Offer keyboard Move up/down beside the drag handle (WCAG 2.5.7), a soft cap of 4 visible links, and undo for removal within the draft. Allow Tripadvisor or Booking only as "Find us on" links, never styled as a review ask. Defer per-link scheduling.

### 1.8 One autosaved draft with a clear save state and undo

- **Seen in:** Shopify (Save, with Undo/Redo for unsaved changes) [F]. Round-2 behaviour spec ("Saving…", "Draft saved", "Could not save") [R2].
- **Why it works:** it removes the "did this save?" anxiety and the six or more independent save buttons on today's Settings tab [R3].
- **RepKey fit: Adopt.** Show one header fact: "Draft saved · 3 changes not live". A failure keeps local work and offers Retry. Destructive operations (remove link, remove locale) are draft operations with undo, reached through the row's menu rather than a red button beside the edit form [R2].

**Anti-patterns (1)**

- A block palette full of review-platform tiles (Ratestar "50+ integrations", Growth-tier scratch cards and wheels) [R3].
- Free colour pickers that ship unreadable pages. Today's legacy per-portal theme presets and list swatches do nothing for guests [R3].
- Invented editable question copy or character counters. The question and buttons come from language packs [R2].
- Editing the guest states as a flow builder with rating branches, like me&u's "minimum star rating" for the Google prompt [R3].
- A preview that does not render the real snapshot, composition, fonts and locale (today's problem [R3]).
- Restyling the admin in the property brand. Emoji as icons. Red "Remove" next to ordinary edits.

---

## 2. Publishing and versioning

### 2.1 Live and Draft always visible as plain facts

- **Seen in:** Shopify labels themes **Live** and **Draft** [F]. Webflow and Framer show unpublished changes in the publish control [K].
- **Why it works:** admins never have to guess whether guests already see an edit.
- **RepKey fit: Adopt.** Put two facts in the portal header, as 13px text with a glyph rather than pills (inbox principle 1): "Live · version 4 · published 12 Sep by Maria" and "Draft · 3 changes". A new portal reads "Draft saved · Not published" [R2]. Remove today's single "Publish portal / Disable public page" toggle.

### 2.2 Review before publish: a readiness checklist, a guest-worded diff and owners

- **Seen in:** ReviewPro shows readiness warnings, but then publishes immediately with "cannot be undone" [R3]. Canary advertises preview before publish [R3]. Vercel's rollback dialog makes you verify the affected domains before "Confirm Rollback" [F]. A pull-request diff [K].
- **Why it works:** it turns scattered prerequisites into one decision point and shows exactly what guests will see change.
- **RepKey fit: Adopt.** "Review & publish" opens a review step with three blocks:
  - **What changes for guests:** per locale, in guest words ("Welcome line: 'Spa reception' → 'Welcome to the Spa'").
  - **Checks, each naming who can fix it:** active public address, responsible manager, verified Google destination, complete brand profile, content for every enabled locale, and a primary-colour contrast pass. AccountAdmin fixes brand; PropertyManager fixes local content.
  - **Other portals affected** (property-wide edits only).

  The one primary action is **Publish changes**. Keep the existing post-publication content-review attestation as its own concept [R2].

### 2.3 Publish changes while live, as an atomic swap

- **Seen in:** Vercel, where promotion or rollback repoints domains instantly ("The rollback happens instantaneously") [F]. Shopify's Publish of a draft theme [K].
- **Why it works:** there is no outage window and printed codes keep resolving.
- **RepKey fit: Adopt.** Today a live portal has no "publish changes" action; admins disable and republish, which causes a brief outage [R3]. The stable token already resolves to the current published snapshot, so publishing is a pointer swap. The success toast carries the guarantee: "Version 5 is live. Printed codes keep working."

### 2.4 An append-only deploy ledger with instant rollback

- **Seen in:** Vercel Instant Rollback [F]. The dialog shows the current production deployment and the eligible ones ("Choose another deployment"), then "Continue" and "Confirm Rollback". The rolled-back deployment "stays disabled in your deployment list and can be … re-reverted". After a rollback, auto-assignment is switched off and an **Undo Rollback** button appears on the production tile. The docs warn that a restored deployment's configuration "may become stale".
- **Why it works:** recovery is one confident action, history is never lost, and the system says what state it is in after the rollback.
- **RepKey fit: Adopt, with RepKey semantics.** Show a publication ledger in the inbox Timeline (actor · verb · object · time, with system runs folded): "Maria published version 5 · 12 Sep"; "Ivan restored version 4 as version 6 · 14 Sep". The server fn `rollbackPortalPublication` already exists but has no UI [R3]. Differences from Vercel:
  - Rollback **creates a new version**. It never rewrites history.
  - There is no auto-assignment to pause, because publishing is always deliberate.
  - The draft is left alone, with one fact: "Your draft is based on version 5. Live is version 6 (a copy of version 4)."
  - The stale-config warning maps to re-running the readiness checks on the target. A restored version whose link approvals or Google destination have lapsed must say so before confirming.

### 2.5 Property-wide changes fan out with an impact list, never silently

- **Seen in:** Duve multi-brand editing with a scope warning [R3]. Touch Stay replicating content between rooms and properties [R3].
- **Why it works:** a brand change can alter a dozen live pages, so admins need to see the blast radius.
- **RepKey fit: Adopt.** A property-wide edit (composition, colours, fallback content, display name) produces "Affects 5 portals · 3 live" and becomes a pending change on each affected portal's draft. It never mutates a live snapshot. A batch review can publish several portals at once, but it lists each portal's checks. The same mechanism adopts a new guest-copy pack version: "Republish to adopt new wording (4 portals)" [R3].

### 2.6 Scheduled publishing (defer)

- **Seen in:** Beacons per-link scheduling [R3]. HappyOrNot surveys scheduled by time of day [R3]. Touch Stay scheduled notifications [R3]. CMS scheduled publishing, such as Contentful and Webflow [K].
- **Why it works:** seasonal content (a summer terrace menu, spa hours) changes on known dates.
- **RepKey fit: Defer (YAGNI for the beta).** If added later, schedule a reviewed snapshot rather than live edits. Re-run the checks when it executes, notify responsible managers if it fails, and record it in the ledger ("Scheduled by Maria · published automatically 1 Jun"). No time-of-day variants, which would complicate "one page for every guest".

### 2.7 Taking a page offline is a rare, explained action

- **Seen in:** Statuspage treats "Under maintenance" as a distinct status [F]. Today's primary toggle "Disable public page" [R3].
- **Why it works:** a rare destructive action should not share the primary slot with publishing.
- **RepKey fit: Adopt.** Move "Pause public page" to the overflow menu. Show what guests will see (the gentle "This page is paused – [Property]" page) and record the pause in the ledger.

**Anti-patterns (2)**

- Live edits with no draft ("Editable anytime", Ratestar) [R3].
- An irreversible publish ("cannot be undone", ReviewPro) [R3].
- Publish as an on/off toggle.
- A rollback that deletes versions or silently discards the draft.
- Restoring a version without re-checking its destinations.
- Property-wide edits that silently change live pages.
- Explanatory banners standing in place of a review step.

---

## 3. Distribution: QR, NFC, print, placements

### 3.1 The code is decoupled from the content ("same code, new content")

- **Seen in:** MENU TIGER dynamic QR ("edit the menu without reprinting") and Menu.app Dynamic Links (the code "stays the same" while its target changes) [R3]. Uniqode dynamic QR codes [K]. The shutdowns of Koji and Tap Bio show that printed codes pointing at a third-party hub are fragile [R3].
- **Why it works:** reprinting is the owner's biggest fear. W3C: "Cool URIs don't change" [R3].
- **RepKey fit: Already core** (ADR 0044 keyed-hash tokens). Surface it as confidence rather than explanation: the publish success toast says "Printed codes keep working". The Share area makes one plain statement about which version a code opens: "Codes open the live version (version 5)".

### 3.2 One code per placement, named by place

- **Seen in:** Ratestar ("a unique card or QR per employee, table, room or campaign"; "Reviews per card, e.g. '#0001 - Reception'") [R3]. NFC vendors assign codes per device [R3].
- **Why it works:** owners think in physical spots (reception desk, table tents, spa), and a name makes reprints and damage reports obvious.
- **RepKey fit: Adapt, and exclude people.** Allow placement naming on each access artifact ("Reception desk card", "Terrace table tents ×12"). A placement is always a _place_, **never an employee, shift or server**, because staff attribution is denied. Open question: today a portal has one active token with rotation (QR address plus NFC address). Several named placements per portal would be a **new domain concept** that needs a product decision. It is also the path to the QR versus NFC channel split (4.6).

### 3.3 Print kits generated per composition, with print-safe rules built in

- **Seen in:** HappyOrNot auto-generates printable QR and URL question sheets from its email report [R3]. Vendors sell acrylic stands, table tents and wobblers [R3]. Hostfully exports PDFs [R3]. QR platforms offer vector downloads and frame templates [K].
- **Why it works:** collateral that matches the interior is what makes owners proud to put the code on the table [R3].
- **RepKey fit: Adopt.** Provide a table tent, a reception card and an NFC card per composition (A, B, C), so print and screen share one design (C Table Card is built for this). Bake in the rules [R3 policy]:
  - QR on a light plate with a 4-module quiet zone.
  - Error correction M, or Q/H if a centre mark is added.
  - The short URL printed as text.
  - An honest CTA ("Rate your visit – private, about 30 seconds").
  - NFC instructions that match iOS and Android 17 ("Hold the top of your phone to the card, then tap the link").
  - Vector PDF with bleed and crop marks, and a true-size preview.

### 3.4 Re-download without rotation (needs a security decision)

- **Seen in:** QR management tools let you download any existing code again [K]. Today RepKey shows the address once, and a reprint requires rotation [R3].
- **Why it works:** printers lose files and a second batch is routine. Rotating tokens to reprint breaks every code already printed.
- **RepKey fit: Adopt, subject to a security decision.** Options:
  - (a) Store the token in a form that only AccountAdmins can retrieve, with an audit event.
  - (b) Store the generated print kit at issue time.
  - (c) Keep "shown once" but always generate the print kit at that moment.

  Every download is a ledger event ("Maria downloaded the Reception print kit · 15 Sep").

### 3.5 Rotation and revocation as a ledger, with grace and a gentle landing page

- **Seen in:** RepKey's existing planned rotation (1–90 day grace) or immediate rotation, and Revoke all [R3]. Policy research recommends "This code is no longer active – [Property]" instead of a 404 [R3].
- **Why it works:** the admin sees the overlap window and exactly what a guest with an old card experiences.
- **RepKey fit: Adopt.** A Share ledger: "Code version 2 active since 3 Sep"; "Code version 1 keeps working until 30 Sep". Put rotate and revoke in the overflow menu with a consequence sentence and a preview of the inactive-code page.

### 3.6 A pre-print check and an NFC write checklist

- **Seen in:** Birdeye scan-to-preview [R3]. Policy research asks for testing on older iPhones and Androids in low light, and for NFC tags that use NTAG213/215/216 with one NDEF URI record, are locked after writing, and use on-metal tags where needed [R3].
- **Why it works:** most distribution failures are physical (glare, curved surfaces, unlocked tags rewritten to phishing URLs).
- **RepKey fit: Adopt as a short checklist inside the print-kit download.** Caveat: a staff test scan hits the real token and would count as a `qualified_scan`. Either exclude authenticated admin sessions server-side or accept and state the small inflation. This needs a decision.

**Anti-patterns (3)**

- Third-party URL shorteners.
- Tracking query strings or per-guest identifiers in printed URLs.
- Light-on-dark inverted codes.
- Logos over finder patterns.
- Print CTAs like "Review us on Google 5★" (brand and gating problem) [R3].
- Per-employee cards [R3].
- Codes whose target breaks when content changes.
- "Shown once" forcing a rotation to reprint.

---

## 4. Analytics

### 4.1 Plain metric names with one-sentence definitions on demand

- **Seen in:** Plausible [F] defines every metric in one sentence ("Unique Visitors: the number of people who visited your site"; "Conversion Rate … unique conversions divided by unique visitors"), distinguishes unique from total, and offers familiar alternative names. Counter-examples [R3]: Ratestar's "Views, Clicks, Reviews, CTR", where "reviews" are attributed from taps and clicks, and the sunday and Birdeye review-increase claims.
- **Why it works:** a defined vocabulary builds trust, and an inflated one collapses the first time an owner compares it with Google.
- **RepKey fit: Adopt, and freeze the vocabulary.**

  | Label                    | Measure                 |
  | ------------------------ | ----------------------- |
  | Portal scans             | `qualified_scans`       |
  | Private ratings          | `portal_rating_count`   |
  | Average private rating   | `portal_rating_average` |
  | Guests who opened Google | Google selections       |
  | Private feedback         | Private note volume     |

  Each label has a dotted-underline detail that opens its definition, following the inbox fact/detail pattern. Never use "Reviews", "Review Clicks" (today's StatCard label [R3]), "Conversions" or "Review CTR".

### 4.2 A funnel in guest order with real counts

- **Seen in:** GatherUp's Performance report (requests sent, opened, completed, clicked through to review sites) [R3]. Plausible Funnels show "drop-off points" [F].
- **Why it works:** it shows where guests stop, which is actionable (placement, wording, language).
- **RepKey fit: Adapt.** Scans → Private ratings → Guests who opened Google. Private feedback sits beside the funnel as a count, not as a step, because it is optional and threshold-scoped. Show real numbers and percentages of scans. Today's chart clamps widths to look monotonic [R3], which hides data problems. **Do not break Google opens down by star rating** in the beta: it invites "gating" thinking even though routing cannot change.

### 4.3 Period comparison with a sample floor

- **Seen in:** Akia (NPS change versus the prior period) [R3]. Ratestar (30-day deltas per location) [R3]. Plausible (compare with the previous period) [K]. RepKey already requires at least 10 ratings in each period before comparing averages [R3].
- **Why it works:** a delta answers "is it working?" faster than a chart, but on small samples it becomes noise.
- **RepKey fit: Adopt.** Show a delta only when both periods pass the floor. Use a sign and an arrow in neutral text-grade colour (the inbox `--positive`/`--negative` rule). Align the range model with the dashboard: `?range=`, default rolling 30 days. Today's tab defaults to All time and stores the range in localStorage [R3].

### 4.4 Small samples say so, in one sentence with one action

- **Seen in:** Google Analytics thresholding [F]: a data-quality indicator states that data is shown only when it "meets the minimum aggregation thresholds". The remedy is to "expand date range".
- **Why it works:** honest withholding beats a misleading number, and the next step is obvious.
- **RepKey fit: Adopt, following the inbox's availability by exception.** Always show `n` beside an average ("4.6 from 7 private ratings"). Below the floor, show one sentence and one action ("Too few ratings to compare periods. Widen the range."), never a dash. Keep the provenance ("Data through 18 Sep, 14:00", response integrity) as details on demand, not above the numbers as today [R3].

### 4.5 A portfolio table of places, with no ranking

- **Seen in:** Ratestar's multi-location table with 30-day deltas, next to a team leaderboard [R3]. Customer Alliance filters by location or brand [R3]. ReviewPro's "internal ranking across group properties" [R3]. Statuspage component groups [F].
- **Why it works:** multi-portal owners need one view to spot the portal that stalled.
- **RepKey fit: Adapt; the ranking is denied.** Add a Property-level **Portals overview** with rows for each portal and each group (a group row shows the rollup). Columns: health, Portal scans, Private ratings, Average (with n), Guests who opened Google, Private feedback, Live version. An account-level portfolio view uses the same shape with property rows. Guardrails: no rank numbers, medals or "top/bottom performer" labels, and no staff, shift or server dimension. The default sort is by name or by "needs attention", never by score. Column sorting stays an ordinary table affordance.

### 4.6 Drill-down by placement and channel, never by person (later)

- **Seen in:** Ratestar clicks per block and reviews per card [R3]. HappyOrNot by time, location and touchpoint [R3]. Toast by order type and time of day, and by server [R3]. NFC vendors: taps per device [R3].
- **Why it works:** placement is the one lever an owner controls: move the card, reprint it, change the wording.
- **RepKey fit: Later.** Add a QR versus NFC split by access artifact, per-placement scans once placements exist (3.2), and useful-link selections (already in the reporting aggregate as `secondaryLinkSelectionCount` [R3]). Never break down by staff, shift or server.

### 4.7 Digests on a steady cadence (later)

- **Seen in:** Resy's morning email with each rating in context. sunday's morning snapshot. Toast's weekly Thursday email. Ratestar's daily, weekly and monthly digests with AI summary cards [R3].
- **Why it works:** managers who never open the admin still stay informed.
- **RepKey fit: Adapt later.** A weekly digest to responsible managers with the same five measures (with n), any portals needing attention, and a link to the Inbox for private feedback. No AI claims about causes or review outcomes, and no "you beat last month's record" framing.

**Anti-patterns (4)**

- Counting Google clicks as reviews or conversions [R3].
- Leaderboards, "team" or staff dashboards (Ratestar, sunday's Staff Performance, ReviewPro's internal ranking) [R3].
- "Live" vanity counters and vendor uplift claims ("+200%", "5X more 5★").
- Averages without n.
- Deltas on tiny samples.
- An All-time default that hides recency.
- Funnels clamped to look tidy.
- Provenance blocks above the numbers.
- Google opens split by star rating.

---

## 5. Monitoring and health

### 5.1 A small, fixed status vocabulary, always with a reason in words

- **Seen in:** Statuspage components [F]: exactly "Operational", "Under maintenance", "Degraded performance", "Partial outage" and "Major outage". Status can be set from an incident or directly. RepKey's domain has `healthy | degraded | unavailable` plus one reason: `publication_draft`, `publication_disabled`, `publication_archived`, `property_unavailable`, `publication_snapshot_unavailable`, `public_address_unavailable`, `responsibility_needed`, `google_destination_awaiting_refresh`, `google_destination_unavailable` [Code: `src/contexts/portal/domain/portal-health.ts`].
- **Why it works:** a few statuses are learnable, and the reason makes each one actionable.
- **RepKey fit: Adopt the three statuses and translate each reason** into a sentence, an owner and one fix. For example: "Degraded · Google link is refreshing"; "Degraded · No responsible manager · AccountAdmin: Assign manager"; "Unavailable · No active public code · Issue code". The domain returns **one** reason, the first failing check in priority order. The portal detail page should therefore list all failing checks, reusing the readiness checklist from 2.2.

### 5.2 Status by exception in every list

- **Seen in:** Statuspage shows each component's status inline [F]. The inbox renders availability by exception [R3].
- **Why it works:** healthy things stay quiet, so the one broken portal stands out.
- **RepKey fit: Adopt.** A healthy portal shows nothing in the health column, or a neutral dot. Degraded and unavailable portals show a text fact with the reason; colour is never the only signal. Add a list filter, "Needs attention (2)", and one line on the property overview, "2 portals need attention", instead of a banner stack.

### 5.3 Group rollups count issues instead of blending them

- **Seen in:** Statuspage component groups [F].
- **Why it works:** "1 of 4 portals degraded" keeps the problem findable, where a blended amber would hide which portal it is.
- **RepKey fit: Adopt** for Portal Group rows and the property overview.

### 5.4 Ownership and notification presets

- **Seen in:** Toast presets: "Notify for negative feedback only", "Notify for all feedback" and "No notification", with email or SMS recipients per user [R3]. Ratestar ("Notify me when a rating is 3 stars or lower", plus recipients) and MENU TIGER low-rating alerts [R3]. RepKey's responsible managers and the `portal.health_attention` and `portal.responsibility_needed` notifications [R3].
- **Why it works:** alerts reach the person who can act, and each person controls the noise.
- **RepKey fit: Adopt.** Responsible managers are the route. Offer per-person presets (private feedback only, health issues, both, none). Do **not** add a second "alert threshold": private notes already arrive only at or below the Private Feedback Threshold and land in the Inbox. Every health notification names who can fix it.

### 5.5 Health history in the ledger, with no uptime claims

- **Seen in:** Statuspage incidents and historical uptime [F].
- **Why it works:** "was it broken last weekend?" is a real owner question.
- **RepKey fit: Adapt.** Health transitions become ledger events in the portal Timeline ("Google link became unavailable · 14 Sep, 09:12"; "Restored · 15 Sep"), folded when routine. **Do not show uptime percentages.** RepKey does not probe portals, so the figure would be invented.

### 5.6 Silent-failure hints from scan volume (later, careful)

- **Seen in:** HappyOrNot alerts on "a certain amount of negative feedback" [R3]. NFC vendors' near-real-time taps [R3]. RepKey tracks observation loss internally (not tenant-facing) [R3].
- **Why it works:** a missing or damaged card shows up as a sudden silence, not an error.
- **RepKey fit: Later, as a proposal.** A soft check such as "No scans in 14 days at a portal that usually has some" could suggest checking the card. It must never become a target, quota or comparison between portals.

**Anti-patterns (5)**

- Health that exists only as notifications (today [R3]).
- Red and green dots without words.
- Engineering codes shown to admins (`google_destination_awaiting_refresh`).
- Uptime percentages without probes.
- A notification for every rating by default.
- A separate alert threshold that competes with the Private Feedback Threshold.
- Stacked banners on the property overview.
- Health reasons that don't say who can fix them.

---

## How the patterns map to the inbox language

| Inbox principle                                       | Where it lands in the portal admin                                                                                                                                   |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Facts, controls and details wear different clothes    | Live/Draft, health and version are 13px facts. Publish, Rollback and Download are outlined controls. Metric definitions and provenance are dotted-underline details. |
| Purple is interactive only                            | Health uses a neutral dot plus words. Metric volumes use neutral ink. Deltas use a sign and an arrow.                                                                |
| One primary action per area                           | Editor: none (autosave). Review: **Publish changes**. Share: **Download print kit**. Analytics: none. Health: the one fix per reason.                                |
| Ledger timeline                                       | Publication ledger (publish, restore), Share ledger (issue, rotate, download) and health transitions in one Timeline per portal.                                     |
| Availability by exception                             | Healthy portals are quiet. Thin data gets a number plus one sentence and one action, never a dash.                                                                   |
| Guarantees in tooltips and toasts, not standing lines | "Printed codes keep working", "Try as guest records nothing", "Google stays available to every guest".                                                               |
| Private is words plus a dashed edge plus amber        | Private ratings and private feedback in analytics, and the private-note state in preview.                                                                            |

## Decisions these patterns surface (not decided here)

1. Several named placements (access artifacts) per portal: needed for 3.2 and 4.6.
2. Re-download of an issued code without rotation: storage and audit model (3.4).
3. Excluding authenticated admin test scans from `qualified_scans` (3.6), and the "open draft on my phone" preview link (1.4).
4. Batch publishing after property-wide changes: one review for many portals or one per portal (2.5).
5. Scheduled publishing and per-link schedules: deferred (2.6, 1.7).
6. A property or account portfolio view: sorting rules that keep it from reading as a ranking (4.5).

## Gaps in this pass

- Not fetched (failures): Uniqode QR management, Linktree Insights, Typeform/Tally preview, HappyOrNot analytics. Statements tagged [K] come from memory.
- Not fetched (budget): Touch Stay and Duve appearance help. Their round-3 [R3] summaries cover the relevant branding and scope patterns.
- The Statuspage fetch confirmed the status names and groups but was thin on uptime display details.
