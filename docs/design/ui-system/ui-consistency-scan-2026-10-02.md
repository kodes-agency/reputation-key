# UI consistency scan: repeated functionality in the manager app

**Status:** 2 October 2026. Source-based scan of `main` at 4f58bbeb1. No application code was changed by the scan. The owner accepted its recommendations on 3 October 2026 and [the implementation plan](../../plan/ui-consistency-implementation.md) delivered them; this report stays as the record of what was found and why. Links point at the code as scanned, so a line anchor may have drifted and a file the implementation renamed or removed may no longer resolve.

Detailed evidence (every finding with variants, file and line references, verifier notes and per-dimension inventories) is in the [evidence ledger](ui-consistency-scan-2026-10-02-evidence.md). This report cites finding IDs such as `ACT-01`; look them up there.

## TL;DR

- About 100 verified inconsistencies sit in repeated functionality across six dimensions. Most are small on their own. Together they show eight root causes, and four of those account for about two thirds of the findings. Most findings do not need a new design. They come from a primitive that already exists but is bypassed, or that lacks one variant, so callers re-spell the variant in `className`.
- The most serious items are bugs, not style: four destructive confirm buttons whose label is the same colour as their fill in light mode (`ACT-01`, `SURF-01`); an organisation-wide Google disconnect, and End goal, with no confirmation (`ACT-02`); Portal route error screens that skip production error sanitising, Sentry capture, 401 handling and Retry (`FRAME-04`); AlertDialog "Removing…" states that can never be seen, and a Leave organisation dialog that can fail silently (`SURF-03`).
- An unlayered global anchor rule in `styles.css` repaints every link that lacks one of four `data-slot` values. Navs, breadcrumbs and menu items then fight it with `!` overrides in about 18 call sites (`FRAME-06`, `NAV-02`, `ACT-19`). One CSS change removes the whole class of problem.
- Property pages carry a second page gutter (`p-6` on top of `<main>`), and the gutter string is copy-pasted into four full-bleed surfaces (`FRAME-01`, `FORM-04`). Page loading, error and not-found screens have three unrelated implementations (`FRAME-02`, `FRAME-03`, `COLL-15`, `SURF-10`).
- Seven families have no shared primitive, so each surface builds its own: section navigation, row/overflow menus, list toolbars, metric tiles, status tones, confirmation dialogs and form footers. In most of these families a strong in-app candidate already exists and can be extracted. A new template is not needed.
- Recommended strategy: **fix at the primitive, guard, then migrate in waves.** Start with a bug wave of small PRs, then one-file primitive fixes that close many findings each, then ratcheting lint rules (handed to the owner as a patch), then family-by-family migration that extracts from the strongest existing implementation. The Portal editor stays the reference composition.
- Several differences are deliberate and must not be "fixed": Inbox compact density, workspace full-bleed headers, popover on desktop and sheet on phone, account versus Property settings scope, cursor feeds versus numbered pages, and others (see [Keep different](#4-deliberate-differences-to-keep)).
- Twelve owner decisions gate the later waves. The main ones are the touch-density policy, the destructive versus reversible confirm tone, which actions may skip confirmation, Save/Cancel/Reset semantics, feedback ownership (toast or banner), and the page-level tab look.

## 1. Method and limits

**Method.** Six parallel source reviews each covered one dimension of repeated functionality. A verification pass then re-read each claim and marked it confirmed, adjusted (narrowed or downgraded), intentional or refuted. Verifiers also added findings. Only verified findings appear here.

| Dimension                             | Prefix | Kept   | of which high | Intentional | Refuted |
| ------------------------------------- | ------ | ------ | ------------- | ----------- | ------- |
| Page frame, top bars, page states     | FRAME  | 14     | 2             | 1           | 0       |
| Sidebars, secondary nav, tabs         | NAV    | 11     | 0             | 1           | 1       |
| Toolbars, search/filters, collections | COLL   | 24     | 0             | 1           | 0       |
| Buttons, actions, menus               | ACT    | 19     | 1             | 0           | 0       |
| Settings pages, form structure        | FORM   | 19     | 3             | 1           | 0       |
| Overlays, surfaces, feedback          | SURF   | 12     | 3             | 2           | 0       |
| **Total**                             |        | **99** | **9**         | **7**       | **1**   |

Dimensions overlap by design, so several findings are the same defect seen from two sides. The destructive confirm colour, for example, appears as `ACT-01`, `FORM-02` and `SURF-01`. After de-duplication the scan holds roughly 70 distinct issues. The map in section 2 groups the duplicates.

**Limits.**

- Source inspection only. Nothing was rendered, run or measured in a browser or Storybook. Every visual claim is derived from class strings, Tailwind semantics and token values: colours, clipping, gutters, heights, the red-on-red label, Sonner in dark mode.
- Claims that most need a rendered check before anyone acts on them:
  - red-on-red confirm labels (high confidence, because the two token values are identical);
  - the mobile sidebar drawer staying open after navigation (`NAV-07`);
  - duplicate `aria-current` (`NAV-09`);
  - typed toasts ignoring dark mode (`SURF-09`);
  - the Properties search clearing at 101 characters (`COLL-24`);
  - stale invite errors on reopen (`SURF-07`);
  - unmatched URLs getting public chrome (`FRAME-11`, left unconfirmed).
- Counts come from `rg` over `src`, excluding stories, tests and the guest renderer. Dimensions sometimes disagree by a few (SegmentedControl is reported in 9, 11 or 12 files; FormErrorBanner in 46 or 51). Treat counts as approximate.
- Not covered:
  - the guest renderer, auth and legal pages, and the public Header, except where manager users are routed into them;
  - Inbox thread internals and most Portal editor section internals;
  - Storybook stories and e2e specs;
  - Inbox and Portal workspace internals, which were read only for their frame, toolbar and nav.
- Product intent was not checked with the owner. The "could be intentional" judgements are inferences.

## 2. Inconsistency map

Abbreviations: **Std** = standardise on the named candidate. **Keep** = deliberate difference, document it. **Owner** = needs an owner decision first.

| Pattern family                    | Impls found                                                                                              | Best existing candidate                                                                                                                                                                                         | Verdict                                                                                            | IDs                                                                                          |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Page header and title             | 5 (PageHeader, workspace header, Inbox list header, org second h1, AuthCard div)                         | [PageHeader](../../../src/components/layout/page-header.tsx) plus a compact variant that keeps the `h1`                                                                                                         | Std. Workspace and Inbox keep their compact layout but must keep one real `h1` on every breakpoint | FRAME-08, FRAME-10, FORM-10                                                                  |
| Global top bar and account menu   | 2 bars, 2 account menus, 3 theme controls                                                                | AppTopBar for any signed-in route; one AccountMenu; one ThemeMode control (segmented Light/Dark/System)                                                                                                         | Std (theme/menu); Keep (public vs app chrome)                                                      | FRAME-05, FRAME-11, FORM-03                                                                  |
| Page gutter and width             | 5 padding owners; 3 tiers plus 4 ad hoc max-widths                                                       | `<main>` padding as sole owner + [PageShell](../../../src/components/layout/page-shell.tsx) tiers (add a `wide` tier for 1280)                                                                                  | Std                                                                                                | FRAME-01, FRAME-03, FORM-04, FRAME-14                                                        |
| Breadcrumbs and back              | 5 (crumbs, `backTo`, ghost back Button, outline Back, sidebar "Back to app")                             | PageHeader breadcrumbs; one "workspace back" for full-bleed headers                                                                                                                                             | Std (property crumb always linked; crumb text = sidebar label)                                     | FRAME-09, NAV-10, ACT-12                                                                     |
| Main sidebar                      | 2 (ManagerSidebar icon-collapse, SettingsSidebar offcanvas) on one shared open state                     | ui/sidebar with one collapse mode (icon rail)                                                                                                                                                                   | Std (collapse mode); Keep (sidebar swap for account settings)                                      | NAV-03, NAV-09, NAV-11                                                                       |
| Secondary / section nav           | 5 (Property settings nav, Portal editor nav, workspace tabs, Inbox rail, Inbox strip)                    | [PortalEditorNav](../../../src/components/features/portal/portal-editor/portal-editor-nav.tsx) anatomy + Inbox strip overflow handling                                                                          | Std (shared shell, active/focus/height); Keep (summaries, counts as optional slots)                | NAV-01, NAV-05, NAV-06, NAV-07, FORM-07                                                      |
| Tabs and view switchers           | 6 (pill Tabs, line Tabs, link underline strip, two link Buttons, SegmentedControl, aria-pressed Buttons) | ui/tabs `line` for page views (with a Link-backed twin); SegmentedControl for value and range choices                                                                                                           | Owner (page tab look), then Std                                                                    | NAV-04, NAV-08, COLL-01, COLL-11, ACT-11, ACT-18, COLL-14                                    |
| List toolbars                     | 3 (Properties, Portals twins already drifting; Inbox compact header)                                     | [PropertyListToolbar](../../../src/components/features/property/property-list-toolbar.tsx) vocabulary, extracted as ListToolbar parts                                                                           | Std (shared parts; Inbox composes them compactly)                                                  | COLL-06, COLL-12, COLL-22, COLL-24                                                           |
| Search                            | 5 field recipes, 3 matchers                                                                              | InputGroup + `type=search` SearchField; `property-search.ts` folded matcher                                                                                                                                     | Std                                                                                                | COLL-07, COLL-13, COLL-24                                                                    |
| Filters, sort, range              | 8 control shapes                                                                                         | Labelled "Label: value" menu buttons; DashboardRangeControl shell on SegmentedControl with a preset list                                                                                                        | Std (Inbox popover/sheet kept)                                                                     | COLL-01, COLL-12, COLL-14, COLL-22                                                           |
| Collections (tables, row lists)   | 7 chromes, 4 responsive recipes                                                                          | Properties table shell (bordered `bg-card` `@container`, stacked rows)                                                                                                                                          | Std for list tables; Keep matrices and wizard lists                                                | COLL-03, COLL-16, COLL-20                                                                    |
| Metric tiles and deltas           | 1 primitive + 8 hand-rolled; 3 delta renderings                                                          | [MetricStrip](../../../src/components/ui/metric-strip.tsx) (+ link cell); one MetricDelta                                                                                                                       | Std                                                                                                | COLL-04, COLL-18, COLL-09                                                                    |
| Status badges and chips           | Badge has no tones; many hand-painted tone maps; raw enum text                                           | Badge tone variants on the existing `--positive/--warn/--negative` tokens; RoleBadge                                                                                                                            | Std                                                                                                | COLL-05, COLL-10, SURF-05                                                                    |
| Row / overflow actions            | ~10 trigger recipes, 4 label wordings, 9 copies of a touch-size constant                                 | Portal/Property kebab (ghost icon, `size-11 md:size-8`) as RowActionsMenu                                                                                                                                       | Std                                                                                                | COLL-02, ACT-06                                                                              |
| Buttons and action groups         | 1 primitive, ~170 className overrides, 6 pending treatments                                              | [Button](../../../src/components/ui/button.tsx) with `pending` and density; SubmitButton as a thin wrapper                                                                                                      | Std (density level is Owner)                                                                       | ACT-03, ACT-05, ACT-10, ACT-13, ACT-15, ACT-16, FORM-15, FORM-18, FRAME-12, ACT-14           |
| Destructive confirmation          | 4 colour recipes; AlertDialog, Dialog, inline panel or none                                              | ConfirmationDialog (then `property-lifecycle-confirmation-dialog.tsx`, now [ui/confirmation-dialog.tsx](../../../src/components/ui/confirmation-dialog.tsx)), moved to `ui/` with `tone` and a pending contract | Std (tone policy is Owner)                                                                         | ACT-01, ACT-02, ACT-17, FORM-02, SURF-01, SURF-02, SURF-03                                   |
| Action copy                       | Save/Update, case, Clear, Cancel/Keep/Done/Close, Remove/Delete/Archive                                  | Short action-copy list (sentence case, "Save changes" default)                                                                                                                                                  | Std; Keep deliberate "Keep X" and domain verbs                                                     | ACT-08, FORM-17, COLL-21, NAV-11                                                             |
| Settings structure                | 2 hubs (sidebar swap / in-page nav)                                                                      | Keep both frames; title each Property section; one gutter                                                                                                                                                       | Keep frame; Std title and gutter                                                                   | FRAME-K1, FORM-04, NAV-03                                                                    |
| Settings section and save footer  | ~8 footer shapes, 2 Cancel meanings, no dirty contract                                                   | Property business-profile card behaviour (primary last, right-aligned, real Reset); treat it as a contract, not a visual template                                                                               | Owner (Save/Cancel/Reset), then Std behaviour                                                      | FORM-01, FORM-19, ACT-04, FORM-06, FORM-10                                                   |
| Form fields                       | FormTextField + ~11 hand-built; native selects; raw checkbox                                             | FormTextField extended with description and optional; ui/Select; ui/Checkbox                                                                                                                                    | Std                                                                                                | FORM-03, FORM-05, FORM-11, FORM-12                                                           |
| Booleans and inherited values     | 5 row anatomies; 4 inherit controls                                                                      | SettingSwitchRow; InheritedSetting row (commit mode as prop)                                                                                                                                                    | Std (copy and source link); Keep (commit mode)                                                     | FORM-08, FORM-09                                                                             |
| Image settings and Connect Google | 3 image UIs; 2 Connect buttons                                                                           | Shared ImageSetting; ConnectGoogleButton                                                                                                                                                                        | Std (avatar/logo); Keep (Property look dialog)                                                     | FORM-13, FORM-14, ACT-09                                                                     |
| Dialogs and sheets                | 17 DialogContent recipes; 3 dismissal policies; bespoke sheet headers                                    | DialogContent `size` + built-in dvh bound; UploadDialogShell dismissal guard; DialogFooter with note slot                                                                                                       | Std                                                                                                | SURF-06, SURF-07, FORM-16, SURF-K2                                                           |
| Feedback (toast, banner, inline)  | Banner in 6 positions; toast, banner, red text or nothing; double reports                                | FormErrorBanner directly above the actions; `useActionMutation` toasts for row/immediate actions                                                                                                                | Owner (ownership rule), then Std                                                                   | SURF-04, FORM-06, SURF-09                                                                    |
| Notices and tones                 | Alert has 2 variants; 6+ bespoke callouts; 5 glyph families                                              | Alert with warning/success/info tones; one icon per tone                                                                                                                                                        | Std                                                                                                | SURF-05, SURF-11                                                                             |
| Page and collection states        | Router defaults, Portal fallbacks, ~25 dashed panels, 5 retry shapes                                     | One PageState recipe (keeps identity, guarded error, Retry); EmptyState `size`/`tone`; RegionError                                                                                                              | Std                                                                                                | FRAME-02, FRAME-03, FRAME-04, FRAME-07, FRAME-14, COLL-08, COLL-15, SURF-08, SURF-10, ACT-07 |
| Hints, tooltips, keyboard         | Tooltip in 3 places, `title`, popovers, nothing                                                          | One app-level TooltipProvider; IconButton with label; ExplainTerm popover                                                                                                                                       | Std (low priority)                                                                                 | SURF-12, ACT-16                                                                              |
| Tokens and formatting             | Raw palette, two red-text tokens, literal colours, per-file Intl                                         | Semantic tokens; one formatDate/formatNumber module                                                                                                                                                             | Std                                                                                                | SURF-11, COLL-09, COLL-19                                                                    |
| Global link colour                | 1 unlayered rule + ~18 `!` patches                                                                       | Anchor default in `@layer base` or scoped to content links; `data-slot` exclusions                                                                                                                              | Std (one CSS change)                                                                               | FRAME-06, NAV-02, ACT-19, COLL-02                                                            |
| Document title                    | Root default plus 4 routes                                                                               | Route `head` helper from the PageHeader title                                                                                                                                                                   | Std                                                                                                | FRAME-13                                                                                     |

## 3. Root causes

The labels below match the families named in the brief. Each cause cites the findings it explains. Several findings have more than one cause.

### RC1. The primitive exists, but is bypassed or lacks one variant

Callers re-implement a variant in `className` because the primitive is missing a prop or the author did not find it. This is the largest cause and also the cheapest to fix.

- AlertDialogAction already takes `variant="destructive"`. Six call sites hand-spell red instead, and four of those pick a token pair that is unreadable in light mode (`ACT-01`, `SURF-01`, `FORM-02`, `ACT-17`).
- SegmentedControl lists "range" as its use case, yet the dashboard range control bypasses it. Goals uses two Buttons as tabs (`NAV-08`, `ACT-11`, `ACT-18`, `COLL-01`, `COLL-11`).
- EmptyState is bypassed by about 25 dashed panels (`COLL-08`, `SURF-08`). MetricStrip serves 3 surfaces while 8 hand-roll figures (`COLL-04`).
- Smaller bypasses: RoleBadge (`COLL-10`), ConnectGoogleButton (`ACT-09`, `FORM-13`), FormTextField (`FORM-05`), ui/Select and ui/Checkbox (`FORM-03`), raw `<button>` (`ACT-10`), raw `<table>` (`COLL-03`).
- Missing props force overrides. Button has no `pending` and no density, so there are about 170 className overrides, 9 copies of `min-h-11 md:min-h-8` and 6 pending treatments (`ACT-03`, `ACT-05`, `ACT-13`, `FORM-15`, `FORM-18`). Alert and Badge have no tones (`SURF-05`, `COLL-05`). EmptyState has no size or tone. DialogContent has no `size` and no height bound (`SURF-06`).

### RC2. No shared primitive, so each surface hand-rolls it

These families have no shared component. Each copy then drifts on its own, as the Properties and Portals toolbars already have.

- Section nav (`NAV-01`, `FORM-07`).
- Row/overflow menus (`COLL-02`, `ACT-06`).
- List toolbar and search (`COLL-06`, `COLL-12`, `COLL-13`).
- Confirmation shell (`SURF-02`).
- Explicit-save footer and dirty contract (`FORM-01`, `ACT-04`, `FORM-19`).
- Description lists (`COLL-23`, `FORM-12`).
- Inherited-setting row (`FORM-09`).
- Consent checkbox (`FORM-11`).
- Status/tone chips (`COLL-05`).
- Region error and retry (`SURF-10`, `ACT-07`).
- Load-more control (`COLL-16`).
- MetricDelta (`COLL-18`).
- Date and number formatting (`COLL-19`).
- Page document title (`FRAME-13`).

### RC3. Two competing implementations for one role

Two answers exist side by side, and authors pick whichever they find first.

- Router default page states versus Portal LoadingState/ErrorState fallbacks (`FRAME-02`, `FRAME-03`, `FRAME-04`).
- Pill Tabs versus line Tabs versus the link underline strip (`NAV-04`).
- ThemeToggle versus the top-bar menu cycle, in opposite orders (`FRAME-05`).
- Two collapse modes on one shared sidebar state (`NAV-03`).
- `text-destructive` versus `text-negative` for the same error line (`SURF-11`).
- Two search matchers (`COLL-07`).
- Breadcrumbs versus `backTo` on the same page (`FRAME-09`).
- Toast and banner for the same failure (`SURF-04`).

### RC4. Global CSS fights the components

- The unlayered `a:not([data-slot=…])` rule beats every Tailwind utility on links. The result is accent-coloured nav labels and menu items, plus about 18 local `!` pins (`FRAME-06`, `NAV-02`, `ACT-19`, `COLL-02`, `COLL-20`).
- Sidebar active styling lives in global CSS, so editing ui/sidebar has no effect (`NAV-02`).
- `--destructive-foreground` is a red-text token named like an on-fill token (`ACT-01`).

### RC5. Layout ownership is not single

- `<main>` and PropertyLayout both pad (`FRAME-01`).
- Full-bleed surfaces copy the gutter string. The full-bleed predicate is split across two layouts (`FRAME-14`).
- Viewport breakpoints are used where container width matters (`NAV-06`).
- Page width tiers are chosen ad hoc and not recorded (`FRAME-03`).
- A downstream component hard-codes the 16px gutter (`FRAME-01`).

### RC6. Behaviour contracts are undefined, so each dialog or form decides

- When to confirm, and with what tone (`ACT-02`, `SURF-02`, `ACT-17`).
- Whether a dialog can be dismissed while pending, and the fact that AlertDialogAction closes on click, so its pending labels are dead (`SURF-03`).
- What Cancel means: it navigates and resets nothing (`FORM-01`, `ACT-04`).
- Who reports success or failure (`SURF-04`, `FORM-06`).
- What a denied or unavailable page shows (`FRAME-07`).
- How a Portal error is sanitised and reported (`FRAME-04`).

### RC7. No rule on copy, order or naming

Save and Update variants with mixed capitalisation, "Clear" meaning three things, Cancel/Keep/Close/Done, Retry versus Try again, crumb text that differs from sidebar labels, and the same noun used for different scopes (People, Profile, Google) (`ACT-08`, `FORM-17`, `COLL-21`, `COLL-22`, `ACT-07`, `FRAME-09`, `NAV-11`, `FRAME-12`).

### RC8. Docs and code disagree, and nothing checks either

- DESIGN.md says the sidebar becomes a sheet below 1024px; the code docks it from 768px (`NAV-06`).
- DESIGN.md says cards have no shadow; Card uses `shadow-sm` (`SURF-K1`).
- DESIGN.md says no gradients; the header uses one (`SURF-11`).
- The draft pattern-spec says dialog actions are 44px; the Inbox is documented at 36px (`SURF-06`).
- Comments contradict code: the top-bar compression comment covers one route family, the code applies to three (`FRAME-11`).
- There is no lint, contrast test or catalogue to catch drift, so RC1 to RC7 accumulate.

## 4. Deliberate differences to keep

These differences come from the task. Future consistency work should document them, not flatten them.

| Difference                                                                                                                | Why keep                                                                                                           | Source                            |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Account/Organization settings swap the sidebar; Property settings keep the app sidebar with an in-page nav                | Different scope (person/organisation versus one Property); the owner accepts different layouts for different tasks | FRAME-K1, NAV-03                  |
| Inbox queue rail (desktop) versus pill strip (compact), and Inbox icon-collapsed search/filter with a phone bottom sheet  | Narrow triage pane; density trade-off. Only glyphs, count wording and hover/focus states should be aligned         | NAV-K1, COLL-12                   |
| Inbox compact controls (36px on phones)                                                                                   | Explicit documented decision for a dense triage workspace. Encode it as a named density, not per-file classes      | ACT-03 (pending owner decision 1) |
| Bulk selection: Inbox header bar versus Google import footer                                                              | Feed with a hard bulk limit versus a wizard step                                                                   | COLL-K1                           |
| Full-bleed workspace and Inbox headers: compact, ghost back button, no breadcrumbs                                        | Must own their own scroll and height. Keep one real `h1`                                                           | FRAME-09, FRAME-10, NAV-10        |
| Portal workspace tabs as a nav landmark with links; in-page Tabs as a tablist                                             | Route navigation versus panel switching are different semantics. Share the look, not the element                   | NAV-04                            |
| SegmentedControl (radiogroup) versus Tabs (tablist)                                                                       | Value choice versus panel swap                                                                                     | NAV-08                            |
| Popover on desktop, sheet on phone, for the same filter or notification content                                           | Legitimate responsive split. Only header anatomy and the copied count pill drift                                   | SURF-K2                           |
| `/unavailable` for "feature switched off" versus in-route "this entity is gone"                                           | Documented in the `$portalId` route; defensible. Only the public-chrome presentation is the problem                | FRAME-07                          |
| Property removal routes to the danger zone; notification rows reveal a small kebab on hover                               | Deliberate safety routing; dense feed rows                                                                         | COLL-02                           |
| Cursor "Load more" (Inbox, Notifications) versus numbered pager (Portals)                                                 | Cursor feeds cannot show page numbers. Share only the button styling                                               | COLL-16                           |
| Portal phone "New portal" bottom bar                                                                                      | Documented Board 11 decision                                                                                       | FRAME-12, COLL-21                 |
| Add action placement by list context (page header, card action, empty state); Goal creation as a full page                | Follows list scope and entity size                                                                                 | FORM-K1                           |
| Property look label-left rows, logo dialog with crop/focal; Portal editor frame and panels; dense Portal workspace panels | Different layout family. The owner prefers the Portal editor                                                       | SURF-K1, FORM-10, FORM-14         |
| Portal results reporting windows (7/30/60/90 days, compare)                                                               | Different reporting context. Share the control shell and persistence rule, not the preset list                     | COLL-14                           |
| Inline confirmation for Inbox Reject (needs a reason) and Leave organisation as a Dialog (needs a transfer form)          | Input step, not just a yes/no confirm. Still owe a Cancel and an error surface                                     | ACT-02, SURF-03                   |
| "Keep X" cancel labels on destructive dialogs; domain verbs Archive, Remove, Restore                                      | Deliberate and explained in comments                                                                               | ACT-08                            |
| Portal preview density and the guest renderer typography                                                                  | Owner's reference experience; the guest renderer is out of scope                                                   | the design-direction draft note   |

## 5. Fix strategy and waves

### 5.1 Approaches compared

| Approach                                                               | What it is                                                                                                                                                                                                                                                                                                                                                       | Cost                                                                 | Risk                                                                                                                                     | What it prevents                                                                                     |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| A. Primitives-first migration                                          | Design and build every shared primitive (SettingsSection, DataTable, SectionNav, PageState…), then migrate all callers                                                                                                                                                                                                                                           | High: large PRs touching hundreds of files; long time to first value | High: tends to produce the generic template the owner rejected; big visual diffs under strict CI; merge conflicts with live feature work | Most future drift, but only once finished                                                            |
| B. Guardrails-first                                                    | Add ratcheting lint rules and a baseline now; migrate only when a file is touched                                                                                                                                                                                                                                                                                | Low upfront; slow cleanup                                            | Low, but the existing bugs stay until someone touches the file; lint without a primitive to point at only frustrates                     | New drift in the guarded classes                                                                     |
| C. Catalogue-only                                                      | Document patterns and Storybook references; no code change                                                                                                                                                                                                                                                                                                       | Lowest                                                               | Drift continues; agents and people do not read catalogues reliably                                                                       | Little, mechanically                                                                                 |
| **D. Recommended: fix at the primitive, guard, then migrate in waves** | Fix the bugs first. Then make one-file primitive changes that close many findings (variant, `pending`, density, CSS layer, tones). Add a lint rule together with each primitive, ratcheted against a baseline. Then migrate family by family, extracting from the strongest existing implementation, with visual parity first and any change reviewed separately | Medium, spread over small PRs                                        | Low to medium: each PR is narrow and reversible; visual changes are isolated                                                             | Each mechanism lands next to the primitive it protects, so new code has an approved path and a check |

D fits the owner's direction ("build from the strongest existing experiences") and the repo's working style (strict up-to-date merges, auto-merge on green, small PRs). It also gets the safety bugs out within days instead of waiting for a design system.

### 5.2 Proposed primitives and APIs

These are short sketches, not designs. Each primitive is extracted from the named existing source with visual parity.

- **Button**: `pending?: boolean`, `pendingLabel?: string`. The spinner uses `motion-reduce` and `aria-hidden`, plus `aria-busy` and `disabled`. Add a density mechanism: either `density: "touch" | "default" | "compact"`, or a CSS variable set by a section, page or workspace provider. Touch means 44px below `md`. Compact is the Inbox's named 36px. SubmitButton forwards `size` and `variant` and wraps `pending`.
- **DropdownMenuItem**: inherits the same density and is excluded from the global link rule.
- **ConfirmationDialog** (`ui/`, from the Property lifecycle shell): `tone: "destructive" | "neutral"`, an optional body slot, `confirmLabel`, `cancelLabel`, `onConfirm(): Promise`. It calls `preventDefault` on the action, stays open and blocks dismissal while pending, closes on success, and shows one inline error on failure.
- **Mutation dialog guard**: one `onOpenChange` wrapper. Extract it from UploadDialogShell and the batch dialog.
- **PageState** (used by router defaults and every route fallback): `kind: "loading" | "error" | "notFound" | "unavailable"`, `title`, `breadcrumbs`, `tier`. The error kind keeps the router's `publicErrorMessage`, capture, 401 redirect and Retry. Loading is shaped and `aria-busy`.
- **RegionError / EmptyState**: `size: "compact" | "default"`, `tone: "neutral" | "error"`, `description`, `action`. RegionError always has "Try again".
- **Alert and Badge tones**: `warning | success | info` (Alert) and `positive | warn | negative | neutral` (Badge) on existing tokens, with one icon per tone. StatusBadge maps domain status to a label and tone.
- **SectionNav** (from PortalEditorNav plus the Inbox strip's `useStripOverflow` and active-pill reveal): `items[{to, label, icon?, summary?, count?, group?}]`, `presentation: "list" | "strip" | "auto"` driven by container width. It owns active, hover and focus, `aria-current` and touch height.
- **Tabs `line`, Link-backed twin**: the same classes for route-backed views.
- **ListToolbar parts** (from PropertyListToolbar): SearchField (`maxLength`, `onClear`), ListFilterMenu, ListSortMenu, ResultCount ("N of M") and Clear. Plus `matchesSearch` from `property-search.ts`.
- **RowActionsMenu**: a fixed trigger (ghost icon, touch-sized, label "More actions for {name}") and items with a `destructive` flag and an ellipsis rule.
- **DataTable shell** (from the Properties list table): frame, header cell recipe and a stacked-row slot.
- **Settings building blocks**: FormActions (a footer with a real Reset when the group is dirty, Save last), FieldDescription, InheritedSetting, ConsentCheckbox, DescriptionList and ImageSetting. These are behavioural contracts with slots, not a mandatory card look.

### 5.3 Waves

Waves are ordered by user-visible impact against effort. Each bullet is meant to be one PR, or a few small ones.

**Wave 0. Bugs and safety (days, no design decisions needed).**

- Replace the six hand-spelled destructive classes with `variant="destructive"`, and either give `--destructive-foreground` an on-fill value or stop using it on fills. Check light mode rendered. Closes `ACT-01`, `SURF-01` and part of `FORM-02`.
- Confirm the organisation Google Disconnect and End goal with the existing AlertDialog. Closes `ACT-02`, part of `FORM-02` and part of `SURF-02`.
- Route Portal error components through the router default boundary (sanitise, capture, 401, Retry). Closes `FRAME-04`.
- Give Leave organisation an error surface and a Cancel. Closes part of `SURF-03` and part of `FORM-16`.
- Use the folded matcher for Portal searches and add `maxLength` to Properties search. Closes `COLL-07` and `COLL-24`.
- Use RoleBadge in People Directory. Closes `COLL-10`.

**Wave 1. Global CSS and shell ownership.**

- Move the anchor default into `@layer base`, or scope it to content links, and exclude `dropdown-menu-item`. Then delete the `!` pins and move the sidebar active style into ui/sidebar tokens. Closes `FRAME-06`, `NAV-02`, `ACT-19` and the code-level part of `COLL-02`.
- Make `<main>` the only gutter owner. Remove PropertyLayout `p-6`, export one PageFrame for full-bleed surfaces, add a shared `isFullBleedRoute`, and fix the settings-nav bleed. Closes `FRAME-01`, part of `FORM-04` and `FRAME-14`. This visibly widens Property pages by 24px a side; confirm with the owner.
- Use one sidebar collapse mode. Closes `NAV-03`.
- Align DESIGN.md with the code on sidebar breakpoint, card shadow and gradient. Closes part of `NAV-06`.

**Wave 2. Page and region states.**

- Build PageState and use it for the router defaults and every Portal fallback, with each fallback on the same tier as its page. Make the People state branches live or delete them. Use one in-shell "unavailable" state; keep `/unavailable` for no-workspace accounts.
- Build RegionError and add EmptyState `size`/`tone`. Standardise on "Try again".
- Add route head titles.
- Closes `FRAME-02`, `FRAME-03`, `FRAME-07`, `FRAME-13`, `COLL-08`, `COLL-15`, `SURF-08`, `SURF-10` and `ACT-07`.

**Wave 3. Actions and dialogs.**

- Button `pending` and density, with SubmitButton as a wrapper. ConfirmationDialog in `ui/` with tone and pending contract. The mutation-dialog guard. DialogContent `size` and dvh bound. DialogFooter note slot. Dialog close as a Button-based control.
- Closes `ACT-03`, `ACT-05`, `ACT-13`, `ACT-15`, `ACT-17`, `SURF-02`, `SURF-03`, `SURF-06`, `SURF-07`, `FORM-15`, `FORM-16`, `FORM-18` and part of `FRAME-12`.
- Depends on owner decisions 1 to 3.

**Wave 4. Feedback and tones.**

- Alert/Badge tones and StatusBadge. Apply the feedback-ownership rule (banner above actions for forms, toast for row and immediate actions, never both) and route upload errors through `actionErrorMessage`.
- Theme the Toaster from the app theme with token-based rich colours. One MetricDelta. One formatting module. A raw-palette sweep.
- Closes `SURF-04`, `SURF-05`, `SURF-09`, `SURF-11`, `COLL-05`, `COLL-09`, `COLL-18`, `COLL-19` and `FORM-06`.

**Wave 5. Navigation and switchers.**

- SectionNav, extracted from the Portal editor nav with parity, adopted by Property settings, with the Inbox strip's overflow mechanics.
- A Link-backed Tabs `line` for page views: Portal workspace, People, Properties, Goals Active/History.
- SegmentedControl for dashboard range, with a phone fallback.
- Fix the "Danger zone" jump. One `aria-current` resolver.
- Closes `NAV-01`, `NAV-04`, `NAV-05`, `NAV-07`, `NAV-08`, `NAV-09`, `FORM-07`, `COLL-01`, `COLL-11`, `COLL-14`, `ACT-11` and `ACT-18`.
- Depends on owner decisions 7 and 8.

**Wave 6. Collections.**

- ListToolbar parts shared by Properties and Portals, with Inbox using the same glyphs and wording. RowActionsMenu.
- DataTable shell for Members, Directory, Staff and Invitations. MetricStrip adoption (Ratings, Overview, Google, StatCard). LoadMoreButton.
- Closes `COLL-02`, `COLL-03`, `COLL-04`, `COLL-06`, `COLL-12`, `COLL-13`, `COLL-16`, `COLL-20`, `COLL-22`, `COLL-23` and `ACT-06`.

**Wave 7. Settings and forms.** Start only after owner decisions 4 to 6, and pilot on the four pages in the pilot plan (an earlier draft note, not in the repository).

- FormActions with real Reset. FieldDescription and an "optional" marker. ui/Select and ui/Checkbox replacing the native controls.
- One rating-threshold field, InheritedSetting, SettingSwitchRow, ConsentCheckbox, DescriptionList and ImageSetting.
- Title each Property settings section. One `h1` per page and a semantic level on section titles.
- Closes `FORM-01`, `FORM-03`, `FORM-04`, `FORM-05`, `FORM-08`, `FORM-09`, `FORM-10`, `FORM-11`, `FORM-12`, `FORM-14`, `FORM-19`, `ACT-04` and `FRAME-10`.

**Wave 8. Copy and naming.** Can run alongside earlier waves.

- An action-copy list in the pattern index, then a sweep: sentence case, "Save changes" unless a page holds several independent forms, one "Clear" meaning, Try again, and crumb text equal to the sidebar label.
- Scope-qualified labels for People, Profile, AI and Google. One header-slot rule for PageHeader.
- Closes `ACT-08`, `FORM-17`, `COLL-21`, `FRAME-08`, `FRAME-09`, `NAV-10`, `NAV-11` and `ACT-12`.
- Remaining low-priority items (`ACT-10`, `ACT-14`, `ACT-16`, `SURF-12`, `FRAME-11`, `COLL-17`, `FORM-13`, `ACT-09`) are picked up when a wave touches the same files.

## 6. Prevention

### 6.1 Lint rules, proposed to the owner as a patch

`eslint.config.js` is hook-protected, so these rules must reach the owner as a patch. Agents must not apply them. Introduce each rule in the same wave as the primitive it points to. Start each at `warn` with a checked-in baseline (or a file allow-list) so CI ratchets down rather than failing on existing code. Most can be written with `no-restricted-syntax` on JSX attribute and literal selectors, or `no-restricted-imports`.

| Rule (intent)                                                                                      | Selector idea                                                  | Would have prevented                                                                              |
| -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| No colour classes for destructive state on Button or AlertDialogAction; use `variant`              | `JSXOpeningElement[name.name=/^(Button                         | AlertDialogAction)$/] > JSXAttribute[name.name="className"]`whose literal matches`bg-destructive` | ACT-01, SURF-01, FORM-02, ACT-17                                             |
| Ban the token `text-destructive-foreground` on fills (or the token itself)                         | Literal matching `bg-destructive.*text-destructive-foreground` | ACT-01                                                                                            |
| No height or size overrides on Button or DropdownMenuItem `className`                              | className literal matching `\b(min-)?h-\d                      | size-\d                                                                                           | max-md:(h                                                                    | size)-` on those elements    | ACT-03, FORM-15, COLL-02, FRAME-12 |
| No raw `<select>`, `<input type="checkbox">`, `<table>` or `<button>` in `features/` and `routes/` | `JSXOpeningElement[name.name=/^(select                         | table                                                                                             | button)$/]`, `input[type=checkbox]`; allow-list `ui/` and the guest renderer | FORM-03, COLL-03, ACT-10     |
| No `<h1>` outside PageHeader and the named compact headers                                         | `JSXOpeningElement[name.name="h1"]` outside allow-listed files | FRAME-10, FORM-10                                                                                 |
| No important modifiers on colour utilities                                                         | className literal matching `text-[\w-]+!`                      | FRAME-06, NAV-02, ACT-19                                                                          |
| No raw Tailwind palette or literal colours in className                                            | `\b(amber                                                      | emerald                                                                                           | red                                                                          | neutral                      | green                              | yellow)-\d{2,3}\b`, `oklch\(` | SURF-11, COLL-09 |
| Routes may not set `errorComponent`/`pendingComponent` except to the shared PageState              | `Property[key.name=/^(errorComponent                           | pendingComponent                                                                                  | notFoundComponent)$/]` value not an allow-listed identifier                  | FRAME-02, FRAME-03, FRAME-04 |
| No `new Intl.DateTimeFormat`/`NumberFormat` outside the formatting module                          | `NewExpression[callee.object.name="Intl"]`                     | COLL-19                                                                                           |
| Bespoke dashed empty panels                                                                        | className literal matching `border-dashed` outside `ui/`       | COLL-08, SURF-08                                                                                  |
| Imports: Tabs for page views and SegmentedControl for choices (soft)                               | Review checklist, not lint; too semantic to lint reliably      | NAV-04, NAV-08                                                                                    |

### 6.2 Tests that catch what lint cannot

- **Token contrast unit test.** For every on-fill token pair (`--primary`/`--primary-foreground`, `--destructive` and its on-fill colour, badge tones), assert WCAG contrast of at least 4.5 in both themes. This would have caught `ACT-01`.
- **Route error-boundary test.** Iterate the route tree and assert that every authenticated route uses the shared PageState or the default boundary (`FRAME-04`).
- **One-`h1` e2e assertion** at phone and desktop widths on each top-level page (`FRAME-10`).
- **Matcher test.** Each list's search uses `matchesSearch`, with "cafe" finding "Café" (`COLL-07`).

### 6.3 Catalogue, index and rules

- **Storybook "Patterns/" stories** for each primitive above, showing every state (pending, error, empty, dirty, read-only) and both themes. Add complete-page reference stories in the real shell for the Portal editor, Property settings and Account settings, as the draft spec proposes. Render at 320, 768, 1024 and 1440 so gutter and nav regressions are visible.
- **Pattern index** in `src/components/CONTEXT.md`: one line per family, giving the canonical import, when to use it, the named variants, deliberate differences (from section 4) and the lint rule that guards it. Add a pointer from the root `AGENTS.md`, along the lines of "Before adding UI, find the family in src/components/CONTEXT.md; extend the primitive with a variant rather than overriding className". Agents follow these files; they do not reliably find a separate docs folder.
- **Action-copy list** in the same index (RC7).
- **PR checklist item** for UI changes: names the pattern family and canonical component used, or the reason for a new variant; includes light and dark plus phone screenshots for visual changes; no new lint baseline entries.
- **Ownership.** One named pattern maintainer approves new primitives, variants and baseline growth. Feature owners keep their domain modules. Re-run this scan quarterly, using the evidence ledger format.

## 7. Owner decisions

| #   | Decision                                               | Options                                                                                                                                   | Recommendation                                                                                                                                                                            | Gates         |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1   | Touch density                                          | (a) 44px phone targets everywhere; (b) 44px default with a named compact density for Inbox and dense workspaces; (c) per-feature as today | **(b).** It encodes the existing Inbox decision instead of overriding it, and resolves the draft spec's "44px dialog actions" conflict                                                    | Wave 3        |
| 2   | Confirm tone for reversible actions (Archive, Restore) | Red everywhere, or neutral for reversible actions and red only for irreversible or data-loss actions                                      | **Neutral for reversible, red for irreversible, applied to the menu item and the confirm together** (fixes Archive portal's red item and purple confirm)                                  | Wave 3        |
| 3   | Which actions may skip confirmation                    | Always confirm, or a written list of exemptions                                                                                           | **Exempt only low-blast and undoable actions** (remove a draft language, delete an unsent draft, dismiss one notification). Org Google disconnect, End goal and Dismiss all are confirmed | Waves 0 and 3 |
| 4   | Settings Cancel                                        | Keep navigation-Cancel, or replace with Reset                                                                                             | **Reset discards the group's edits; no navigation Cancel.** Matches the draft spec and `FORM-01`                                                                                          | Wave 7        |
| 5   | Explicit-save footer look                              | Keep current per-page looks, or one footer behaviour with placement right-aligned and primary last                                        | **One behaviour and placement; keep the container look (card, ruled or not) open** until the pilot comparison                                                                             | Wave 7        |
| 6   | Feedback ownership                                     | Toast, banner or both                                                                                                                     | **Banner directly above the actions for form submits; toast for row and immediate actions; never both**                                                                                   | Wave 4        |
| 7   | Page-level view tabs                                   | Pill (People, Properties) or underline (workspace, Notifications)                                                                         | **Underline (`line`)** for page views; pill kept for in-component modes (composer, dialogs)                                                                                               | Wave 5        |
| 8   | "You are here" treatment for list navs                 | Purple accent fill (sidebar) or grey fill (in-page navs)                                                                                  | **Use the sidebar's accent-muted fill for every list nav** so the cue is learnt once; keep the Portal editor nav anatomy                                                                  | Wave 5        |
| 9   | Denied or unavailable pages                            | Silent redirect, `/unavailable` in public chrome, or an in-shell state                                                                    | **In-shell unavailable state with title, reason and "Back to …"**; `/unavailable` only for accounts with no workspace                                                                     | Wave 2        |
| 10  | Property page width                                    | Accept the +24px per side after removing the double gutter; Goals/People tier                                                             | **Accept; move Goals and People to the dashboard tier** like Portals; record the tier rule per page type                                                                                  | Wave 1        |
| 11  | Lint enforcement                                       | Warn with baseline, or error                                                                                                              | **Warn with a checked-in baseline, then error once the baseline is empty for a rule**                                                                                                     | All waves     |
| 12  | Pattern maintainer                                     | Owner or delegated                                                                                                                        | Name one maintainer before Wave 3; the draft spec leaves this open too                                                                                                                    | Wave 3 onward |

## 8. Relation to the earlier draft docs

The earlier draft notes (a README, a design direction, a pattern spec, a pilot plan and an audit; not in the repository) were read for alignment. They were not treated as authority.

**Confirms.**

- One gutter owner (spec invariant 1; `FRAME-01`).
- Navigation colour must not be overridden by the global link rule (`NAV-02`).
- Mutation dialogs block dismissal while committing (spec §8). This scan adds that AlertDialogAction closes on click, so the contract needs `preventDefault` (`SURF-03`).
- Page states keep page identity (spec invariant 5; `FRAME-02`, `FRAME-03`).
- Reset versus Cancel (spec §3; `FORM-01`).
- Results must offer the retry it promises (`SURF-10`).
- The Portal editor is the reference, and successful current compositions are kept.
- No generic card template. This scan does not propose one, and settings work is framed as behaviour contracts.
- Audit items A1, A4, A5, A6, A7, A8, B2, B4, B7, C2, C4, C6, C7 and C8 are confirmed or extended in the ledger.

**Corrects or contradicts.**

- Part of audit A4 is stale. The Portal workspace tabs were fixed in #732. The root cause is still live in the Property settings nav, the editor nav icons and menu items.
- The spec's "phone dialog actions 44px" conflicts with the Inbox's deliberate 36px. This is now owner decision 1, not an accepted default.
- The spec defers ratcheting checks until "after a baseline exists". This scan recommends introducing them wave by wave from the start, at warn level with a baseline, because several high-severity defects (red-on-red, ungated disconnect, unsanitised Portal errors) are mechanically detectable and would otherwise recur.
- The pilot's four-page scope (User Profile, Property Profile, Property look, Portal editor) is centred on settings and commit modes. The highest user-visible inconsistencies found here are elsewhere: destructive confirmations, page and error states, the global link rule, collections, toolbars and row actions. The pilot remains a sound place to settle Wave 7, but Waves 0 to 6 do not need to wait for it.

**Goes beyond.**

- Collections and toolbars (COLL), row and overflow actions, status tones, toast theming, search matching, metric tiles, date formatting, document titles, the top bar and theme controls, and action copy. None of these is covered by the draft set.
- An explicit list of deliberate differences (section 4) and a lint and test plan tied to specific findings.
