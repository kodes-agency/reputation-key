# UI consistency implementation plan

**Status:** implemented, 6 October 2026 (approved for implementation on 3 October 2026; see [Delivered](#delivered)). Source: [UI consistency scan](../design/ui-system/ui-consistency-scan-2026-10-02.md) and its [evidence ledger](../design/ui-system/ui-consistency-scan-2026-10-02-evidence.md). Finding IDs (`ACT-01`, `NAV-04`…) refer to the ledger.

## Delivered

Each stage was one pull request. The scan's findings are closed by the stage that names them below; what stays deliberately different is listed in section 4 of the scan report and, for people adding UI, in the "Pattern index" of `src/components/CONTEXT.md`.

| Stage                                        | Pull request      | What it delivered                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1. Safety bugs, link layer, shell ownership | #736              | On-fill destructive ink, confirmations for the missing destructive actions, guarded Portal route errors, the anchor default in `@layer base`, `<main>` as the one gutter owner                                                                                                                     |
| S2. Page and region states                   | #738              | One `PageState` for router defaults and route fallbacks, in-shell unavailable state, route titles, `EmptyState` size and tone, `RegionError`                                                                                                                                                       |
| S3. Tones and feedback                       | #739              | `Alert` and `Badge` tones, `StatusBadge`, one feedback rule, themed toasts, `MetricDelta`, one formatting module                                                                                                                                                                                   |
| S4. Actions and dialogs                      | #742              | `Button` pending and density, `IconButton`, one `ConfirmationDialog` contract, dialog sizing and dismissal guard                                                                                                                                                                                   |
| S5. Navigation and view switchers            | #743              | `SectionNav`, `NavLink`, Link-backed `LinkTabs`, `RangeControl`                                                                                                                                                                                                                                    |
| S6. Collections                              | #744              | `ListToolbar` parts, `RowActionsMenu`, `DataTable`, `MetricStrip` adoption, `LoadMoreButton`, `DescriptionList`                                                                                                                                                                                    |
| S7. Settings and forms                       | #752              | `FormActions` with a real Reset, shared fields, `SettingSwitchRow`, `InheritedSetting`, `ConsentCheckbox`, `RatingThresholdField`, `ImageSetting`, `ConnectGoogleButton`, one `h1` per page                                                                                                        |
| S8. Copy, navigation labels and prevention   | this pull request | Action copy and up-navigation (I1). The Pattern index, the pull request checklist, the route-boundary test, the one-`h1` e2e assertion, and this plan, the scan report and the ledger committed (J1). The ESLint rules the stages asked for went to the owner as a patch, not in this pull request |

Two pull requests from other work landed between the stages and are not part of the plan: #737 (an expiry-dated ignore for an unfixed gcc-14 CVE in the image scan) and #741 (the `vendor-sentry` chunk taken out of the first-paint closure, which the first-paint budget needed).

## Owner decisions (accepted 3 October 2026)

The owner accepted the scan's recommendations. These are sign-off for the slices below.

| #   | Decision                                                                                                                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Density.** 44px touch targets below `md` by default. Inbox and dense workspaces use a named `compact` density (36px). Desktop default stays 36px / small 32px.                                                                                                       |
| 2   | **Confirm tone.** Reversible actions (Archive, Restore, Disable public page) confirm in a neutral tone, and their menu item is neutral too. Red only for irreversible or data-loss actions (Remove member, Delete link, Remove Property, Disconnect Google, End goal). |
| 3   | **Confirmation exemptions.** Only low-blast, undoable actions skip confirmation: remove a language from a draft, delete an unsent reply draft, dismiss one notification. Everything else destructive confirms with `ConfirmationDialog`.                               |
| 4   | **Settings Cancel.** Explicit-save groups get **Reset**, which discards the group's unsaved edits and shows only when dirty. No navigation Cancel in settings. Dialogs and bounded tasks keep Cancel.                                                                  |
| 5   | **Save footer.** One behaviour and placement: actions at the end of the group, right-aligned, primary last. Section container look stays as is.                                                                                                                        |
| 6   | **Feedback ownership.** Form submits: banner directly above the actions, no toast. Row and immediate actions: toast. Never both for one event.                                                                                                                         |
| 7   | **Page-level view tabs.** Underline (`line`) tabs, Link-backed when the view is a route. Pill tabs only for in-component modes.                                                                                                                                        |
| 8   | **"You are here".** Every list nav uses the main sidebar's accent-muted active fill.                                                                                                                                                                                   |
| 9   | **Denied or unavailable.** In-shell state with title, reason and "Back to …". `/unavailable` remains only for accounts with no workspace.                                                                                                                              |
| 10  | **Page width.** Accept Property pages gaining 24px per side once the double gutter goes. Goals and People move to the dashboard tier like Portals.                                                                                                                     |
| 11  | **Lint.** New rules start at `warn` with a checked-in baseline, then become `error` when a rule's baseline is empty. `eslint.config.js` changes go to the owner as a patch.                                                                                            |
| 12  | **Maintainer.** The owner (sole developer) approves new primitives, variants and baseline growth.                                                                                                                                                                      |

## Principles for every slice

- **Extract from the strongest existing implementation, with visual parity first.** The Portal editor is the reference composition. Do not introduce a generic card or settings template.
- **Keep the deliberate differences** in §4 of the scan report (Inbox compact density, full-bleed workspace headers, popover desktop / sheet phone, cursor Load more vs numbered pager, inline Inbox Reject, Leave organisation transfer form, "Keep X" cancel labels, Property look label-left rows, and the rest).
- **Primitives own behaviour.** Add a variant or prop to the primitive rather than restyling it with `className`. Migrate every caller the ledger names for the slice's IDs, not only one example.
- **Tests first** for new primitives and fixed behaviour (unit tests in the `unit` Vitest project; Storybook stories with play functions where the repo already does that). New primitives get a `Patterns/` story covering their states, both themes.
- **Gates:** ≤ 300 code lines per file, Fallow cognitive complexity ≤ 20, first-paint bundle budget (`pnpm build && pnpm check:bundles`) when touching `ui/button`, `styles.css`, layout or route shells. Update e2e and story selectors when an accessible name or visible label changes.
- No new dependencies. No edits to `eslint.config.js` (hook-protected); record wanted lint rules in the slice summary for the S8 owner patch.

## Stages

Each stage is one PR, stacked on the previous stage's branch and rebased onto `main` when its predecessor merges. Slices inside a stage run in parallel worktrees unless marked sequential.

### S1. Safety bugs, link layer and shell ownership

- **A1 — Safety bugs.** `ACT-01`, `SURF-01`, `ACT-02`, `FORM-02` (missing confirmations only), `SURF-03` (Leave organisation: add Cancel and an error surface), `FRAME-04`, `COLL-07`, `COLL-24`, `COLL-10`.
  - Give light-mode `--destructive-foreground` an on-fill value and use `variant="destructive"` on every hand-spelled destructive confirm.
  - Add a token-contrast unit test: every on-fill pair reaches 4.5:1 in both themes.
  - Confirm org Google Disconnect and End goal with an AlertDialog.
  - Portal route error components reuse the router default boundary's guarded logic: sanitised message, capture, 401 redirect, Retry. Extract it as a shared hook or component, which S2 builds PageState on.
  - Use the folded search matcher for Portal lists; add `maxLength` to Properties search; use RoleBadge in People Directory.
- **B1 — Link layer.** `FRAME-06`, `NAV-02`, `ACT-19`, plus the link-ink parts of `COLL-02` and `ACT-06`.
  - Move the global anchor default into `@layer base`, or scope it to content links, so Tailwind utilities win.
  - Exclude menu items and nav links; delete the ~18 `!` colour pins.
  - Move the sidebar active style into `ui/sidebar` tokens.
  - Content links (prose, inline links in copy) must keep their accent colour and underline.
- **B2 — Shell ownership.** `FRAME-01`, `FORM-04` (gutter part), `FRAME-14`, `FRAME-03` (Goals and People tier, decision 10), `NAV-03`, `NAV-06`, `FRAME-05`.
  - `<main>` becomes the only gutter owner: remove PropertyLayout `p-6`, add one full-bleed frame component and a shared `isFullBleedRoute`, and fix the settings-nav bleed.
  - Use one sidebar collapse mode (icon rail).
  - Use one theme control (segmented Light / Dark / System) in both places.
  - Align DESIGN.md with code (sidebar breakpoint, card shadow, header gradient).

### S2. Page and region states

- **C1 — PageState.** `FRAME-02`, `FRAME-03` (fallback tiers), `FRAME-07`, `FRAME-11`, `FRAME-13`, and `FRAME-04` moved onto PageState.
  - One `PageState` (`loading | error | notFound | unavailable`) used by router defaults and every route fallback.
  - Each fallback keeps the page's identity (title, breadcrumbs) and tier.
  - In-shell unavailable state (decision 9) for signed-in managers, including unknown URLs.
  - Make People's state branches live or delete them.
  - A route `head` title helper and titles on every authenticated route.
- **C2 — Region states.** `COLL-08`, `SURF-08`, `COLL-15`, `SURF-10`, `ACT-07`.
  - `EmptyState` gains `size` (`compact | default`) and `tone` (`neutral | error`).
  - Add a `RegionError` with "Try again".
  - Migrate the bespoke dashed panels and region failures.
  - Standardise collection loading on skeletons or the existing pattern per region.

### S3. Tones and feedback

- **E1 — Tones.** `SURF-05`, `COLL-05`, `SURF-11`, `COLL-09`.
  - `Alert` gains `warning | success | info` tones on existing tokens.
  - `Badge` gains `positive | warn | negative | neutral` tones.
  - Add a `StatusBadge` that maps domain status to label and tone (no raw enum text), with one icon per tone.
  - Replace bespoke callouts and tone maps; sweep raw palette and literal colours to semantic tokens.
- **E2 — Feedback.** `SURF-04`, `FORM-06`, `SURF-09`, `COLL-18`, `COLL-19`.
  - Apply decision 6 across forms and row actions; place `FormErrorBanner` directly above the actions.
  - Theme the Toaster from the app theme, with token-based typed colours.
  - Route upload errors through `actionErrorMessage`.
  - One `MetricDelta`.
  - One date/number formatting module replacing per-file `Intl` instances.

### S4. Actions and dialogs (sequential: D1 then D2)

- **D1 — Button.** `ACT-03`, `ACT-05`, `ACT-13`, `ACT-10`, `ACT-16`, `FORM-15`, `FORM-18`, `SURF-12`.
  - Button gains `pending` / `pendingLabel` (spinner with `motion-reduce`, `aria-busy`, disabled) and density (decision 1, via a prop or a density provider). SubmitButton becomes a thin wrapper.
  - Remove the per-file `min-h-11 md:min-h-8` constants and the other height overrides; replace raw `<button>`s that re-implement Button.
  - Add an `IconButton` with a required label and optional tooltip, plus one app-level TooltipProvider.
  - Keep the first-paint budget.
- **D2 — Dialogs.** `ACT-17`, `SURF-02`, `SURF-03`, `SURF-06`, `SURF-07`, `FORM-16`, `ACT-15`, `FORM-02` (trigger styles).
  - Add `ui/confirmation-dialog`, extracted from the Property lifecycle shell, with `tone` (decision 2).
    - Pending contract: `preventDefault` on the action, stays open, blocks dismissal while pending, one inline error.
    - Migrate every confirmation to it, applying decision 3, and match menu-item tone to the confirm tone.
  - Add a mutation-dialog dismissal guard, extracted from `UploadDialogShell`.
  - `DialogContent` gains `size` and a dvh height bound.
  - `DialogFooter` gains a note slot; use a Button-based close control.
  - Clear stale dialog errors on reopen.

### S5. Navigation and view switchers

- **F1 — SectionNav.** `NAV-01`, `NAV-05`, `NAV-07`, `NAV-09`, `FORM-07`.
  - Extract `SectionNav` from PortalEditorNav (summaries, counts and groups as optional slots), plus the Inbox strip's overflow mechanics.
  - Container-driven `list | strip` presentation; active, hover and focus treatment per decision 8; `aria-current`; touch height.
  - Adopt it in Property settings and wherever the ledger lists hand-rolled section navs.
  - Fix the Danger zone jump; one `aria-current` source shared with the sidebar.
- **F2 — View switchers.** `NAV-04`, `NAV-08`, `COLL-01`, `COLL-11`, `COLL-14`, `ACT-11`, `ACT-18`.
  - Link-backed `line` tabs for page-level views: Portal workspace, People, Properties, Goals Active/History, Notifications (decision 7).
  - SegmentedControl for the dashboard range, with a phone fallback.
  - One range vocabulary and persistence rule. Portal results keep their own preset list.

### S6. Collections

- **G1 — List toolbars.** `COLL-06`, `COLL-12`, `COLL-13`, `COLL-22`, `COLL-17`.
  - Extract `ListToolbar` parts from PropertyListToolbar: `SearchField` (`type=search`, `maxLength`, clear), filter menu, sort menu, `ResultCount` and Clear, plus `matchesSearch`.
  - Properties and Portals use them. Inbox keeps its compact composition but adopts the same glyphs and wording.
  - One clear-filters wording and chip anatomy.
- **G2 — Collections.** `COLL-02`, `COLL-03`, `COLL-04`, `COLL-16`, `COLL-20`, `COLL-23`, `ACT-06`.
  - Add `RowActionsMenu`: ghost icon trigger, touch-sized, labelled "More actions for {name}".
  - Add a `DataTable` shell from the Properties table (frame, header cells, stacked rows) for Members, Directory, Staff and Invitations.
  - Adopt MetricStrip (Ratings, Overview, Google, StatCard).
  - Add `LoadMoreButton` styling.
  - Make row-open and figure-link behaviour consistent.
  - Add a key/value `DescriptionList`, shared with H3.

### S7. Settings and forms (sequential: H1, H2, H3)

- **H1 — Save groups and fields.** `FORM-01`, `FORM-19`, `ACT-04`, `FORM-05`.
  - `FormActions`: Reset only when dirty, which restores saved values; Save last, right-aligned (decisions 4 and 5).
  - Wire it to every explicit-save settings group.
  - Extend `FormTextField` with description and an optional marker; migrate hand-built fields.
- **H2 — Controls.** `FORM-03`, `FORM-08`, `FORM-09`, `FORM-11`.
  - Use `ui/Select` and `ui/Checkbox` instead of native controls.
  - Add `SettingSwitchRow`, an `InheritedSetting` row (commit mode as a prop) and a `ConsentCheckbox`.
  - One rating-threshold field.
- **H3 — Facts, images and headings.** `FORM-12`, `FORM-13`, `ACT-09`, `FORM-14`, `FORM-10`, `FRAME-10`, `FORM-04` (section title).
  - `DescriptionList` adoption.
  - `ImageSetting` for avatar and logo; avatar removal must persist.
  - One `ConnectGoogleButton`.
  - Each Property settings section gets a title.
  - One `h1` per page on every breakpoint; section titles get a semantic heading level.

### S8. Copy, navigation labels and prevention

- **I1 — Copy and up-navigation.** `ACT-08`, `FORM-17`, `COLL-21`, `FRAME-08`, `FRAME-09`, `NAV-10`, `NAV-11`, `ACT-12`, `ACT-14`, `FRAME-12`.
  - Action-copy list: sentence case; "Save changes" unless a page holds several independent forms; one meaning for "Clear"; "Try again".
  - Crumb text equals the sidebar label.
  - One back control.
  - PageHeader slot rule.
  - Primary "add" action placement and phone treatment.
- **J1 — Prevention and docs.**
  - Pattern index (canonical import, when to use, variants, deliberate differences, guarding rule) in `src/components/CONTEXT.md`, with a pointer from `AGENTS.md`, and the action-copy list.
  - A PR-template UI checklist.
  - A route error-boundary test and a one-`h1` e2e assertion.
  - Commit the scan report, ledger and this plan.
  - An `eslint.config.proposed.js` with the scan's §6.1 rules at `warn`, plus a baseline, handed to the owner as a patch.

## Out of scope

- Guest renderer typography and composition.
- The earlier draft audit's behaviour bugs B3–B6 (quiet-hours rollback, Portal save-status scope, responsible-manager leave guard), except where a slice touches the same code.
- Product policy changes beyond the decisions above.
