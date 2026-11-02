# Components — Context

**Audience:** Developers and agents working in `src/components/`.

## Responsibility

Components own reusable UI primitives, forms, layouts, hooks, and feature-facing
presentation. Business state and effects remain in bounded contexts; route loaders
and actions supply server state.

- `ui/` holds vendored shadcn primitives plus app-wide presentation primitives
  that no feature owns (Fact, OwnerDisc, MetricStrip, SegmentedControl, Timeline,
  StarRating, RatingFigure, ConfirmationDialog, EmptyState, RegionError,
  RowActionsMenu, DataTable, DescriptionList, SectionTitle, LoadMoreButton). Every
  confirmation goes through `ConfirmationDialog`, never an AlertDialog put together
  by hand (`dialog-sources.test.ts` fails on one). Its `tone` is `destructive` only
  for an action the person cannot take back or that loses data; archive, restore,
  disable-a-public-page and turn-off-AI-features are `neutral`, and so are their
  menu items, but reversible means the app has the way back: a Portal group has no
  restore, so its archive is `destructive`, in the menu too. A destructive
  confirm is started from a `ConfirmationTrigger` (a destructive Button). Only a
  low-blast action the person can undo on the spot skips the dialog (remove a
  language from a draft, delete an unsent reply draft, dismiss one notification);
  Leave organisation is a `Dialog` because it is a transfer form, and the Inbox's
  Reject opens its reason inline. `onConfirm` returns the action's promise: the dialog
  stays open with a pending Button, refuses Escape and Cancel meanwhile, closes
  when it resolves and says a refusal once, above its actions (focus returns to the
  confirm). The mutation behind it therefore passes no `errorMessage`, and a caller
  returns the promise rather than dropping it. A dialog that holds a confirmation as
  its body (the Portal Version dialog) is `<Dialog busy>` while the request runs. A dialog is `Dialog`: it gets its width
  from `size` (`sm` 24rem, `md` 32rem the default, `lg` 42rem, `xl` 56rem, never wider
  than the window less 1rem a side: `dialog-width.ts`, which a confirmation shares) and its
  height bound and scroll from the primitive, so no `DialogContent` types a
  `sm:max-w-*`, a `max-h-*` or a `p-*` (a dialog that wants less padding sets
  `--dialog-pad`, which the footer reaches over). Its footer is `DialogFooter` (`note` is the line
  at the start of the row) with `DialogCancel` then the primary; when the body
  scrolls the footer stays pinned to the bottom, so it must be the last thing in the
  dialog or in the form that is, and a wrapper between it and the dialog may not
  scroll or clip. The corner close is
  one Button named "Close"; a dialog whose footer has Cancel or Close may drop it
  (`showCloseButton={false}`, as the Inbox's two do). A dialog that is committing
  cannot be dismissed: `<Dialog busy={isPending}>`, or `useDialogBusy(isPending)`
  in a body that owns the mutation (`dialog-dismissal.ts`). A refusal a mutation in
  the page still holds from the last time a dialog was open is not shown again:
  the dialog's banner is `DialogErrorBanner`, which shows only an error from an
  attempt made since the dialog opened. A region with nothing to show, nothing that matches, or
  a read that failed is `EmptyState` (`size` default or compact, `tone` neutral or
  error, `description` and `action` slots) or `RegionError`, whose only recovery is
  "Try again" wired to the region's refetch. Never hand-build a dashed box or a
  "Retry" button; `region-states.test.ts` fails on both. A region keeps its failure
  on screen, its button busy, while the retry reads: key the panel on
  `hasFailed(query)` and pass `retrying` (`isRetrying(query)`) from
  `hooks/is-retrying`, because a query with no data drops its error and goes
  `pending` the moment it refetches. A dense workspace (the Inbox) passes
  `data-density="compact"` on its container (36px on a phone, not the 44px target).
  The bell's could-not-load body is plain markup on purpose: it sits in the
  first-paint closure.
  A control's height is not spelled by the caller. `Button`, `Input`,
  `SelectTrigger` and the menu items are 44px below `md` (the `--control-touch`
  token) and keep their desktop height from `md`; a dense workspace (the Inbox, the
  top bar) sets `data-density="compact"` on its container and the same controls
  are 36px there. A menu, sheet or dialog that portals out of the container says
  `data-density="compact"` itself. A small button that must stay a tap target on a
  phone is `touch` (`size="xs"`, `icon-xs`), and one whose label hides below a width
  is `iconBelow="md"` (or `"sm"`): no caller spells `--control-touch`. A bar in a pane the
  window does not size (the Inbox's detail pane is 472 px wide in a 1280 px window) asks the
  width it has instead: `iconBelow="@lg"` is the square below 32rem of its nearest `@container`
  (the bar declares it), and the label hides under the same `@max-lg:`. `Button` owns `pending` / `pendingLabel` (a
  spinner that stops for reduced motion, `aria-busy`, disabled, an optional label
  swap) and `SubmitButton` is that Button wired to a mutation: never draw a
  spinner beside a Button or swap its label while it runs. An icon-only control is
  an `IconButton` (a required `label` that is its name and its tooltip; the root
  mounts the one `TooltipProvider`; one that opens a menu or popover shows no
  tooltip), a link set in a sentence is `InlineLink`, text that explains itself on
  request is `ExplainTrigger` (a Popover with the one dotted-underline cue,
  `EXPLAIN_UNDERLINE`), a key hint prints the modifier this platform has
  (`useShortcutModifier`), and a control that is not a Button wears `focus-ring`. `button-sources.test.ts` fails
  on a per-file height, a hand-placed spinner, a Button label swapped for a pending
  word (`{saving ? 'Saving…' : 'Save'}`, whatever the flag is called), an
  icon-only Button, the old ring,
  a hand-typed inline link or dotted underline, a `--control-touch` class and a
  hand-copied form submit.
  A notice is an `Alert`: `destructive`, `warning`, `success` and `info` each
  draw the one icon their tone wears (`ui/tone.ts`, which Alert, Badge and
  StatusBadge all read), and `default` is a plain card for a notice that brings
  its own icon. `destructive` and `warning` are announced at once
  (`role="alert"`); `info`, `success` and `default` are `role="status"`, so a
  notice already on the page does not interrupt a screen reader. A typed toast
  wears the same icons and the information notice's colours. A status pill is a
  `Badge` tone (`positive`, `warn`, `negative`, `neutral`) or, for a domain status, `StatusBadge`: the feature writes a
  `StatusMap` once (label and tone per status) and never prints the raw enum.
  Red text is `text-negative`, the text-grade red; the fill-grade red belongs to
  a destructive button or bar. Colour comes from the tokens in `styles.css`: no
  Tailwind palette class, no `oklch()` or hex in a component, no hand-tinted
  box. `tone-sources.test.ts` fails on all three, and `token-contrast.test.ts`
  holds every tone's ink on its own tint to 4.5:1 in both themes. The guest
  renderer keeps its own colours.
  A navigation link is a `NavLink`, never a router `Link` carrying its own
  `aria-current`: the router marks a link current whenever the location is at or
  below its path, after every prop, so a nav that draws its own active row from a
  different test announced several current pages. `NavLink` drops the router's
  current marks and sets `aria-current` once, from the `current` the nav passes; the
  sidebars, every section nav and every `LinkTab` use it, and a row is styled from
  `aria-[current=page]`, so what is drawn and what is announced are one answer. The
  sections of one place (Property settings, the Portal editor's page parts) are a
  `SectionNav`: items with an optional icon, summary, count and group, drawn as a
  strip (one scrolling row that fades the side that continues, keeps the open item in
  view and hides its scrollbar) or a list, or `auto`, a strip until the space the nav
  shares with its content is wide enough. That is a container width, not a viewport
  breakpoint, so an open sidebar or a preview pane counts: put the nav and its
  content in a `SectionNavLayout` (`frame="rail"` for a full-bleed workspace,
  `"inline"` for a page's own content), which declares the container the nav waits
  for. The current row wears the sidebar's accent-muted fill, hover and keyboard
  focus are shared (`focus-ring`), and rows take the touch token; no nav draws its
  own active fill or its own ring. A group that must stay apart (Danger zone) is a
  group of its own, never an offset that depends on which section is open. The Inbox
  queue rail and the phone's queue sheet keep their own composition (buttons that
  change a filter, grouped under the Reviews and Private feedback headings) but wear
  the same fill (from `aria-current`), the same ring and `NavCount`, the shared
  trailing figure. The sidebar drawer on a phone closes when a
  link in it is chosen and its rows are the touch height.
  A page's sibling views are underline tabs, drawn from one recipe
  (`tabs-line-styles.ts`): `LinkTabs` / `LinkTab` when each view is a route or a
  search value of one (Properties, Goals, the Portal workspace and the
  Notifications filters), and `Tabs variant="line"` when the
  views swap a panel in the same document (no page does today). `LinkTabs` is a navigation landmark of
  links, not a tablist, and a `LinkTab` is a `NavLink` in a list item: it takes the
  router link's own `to`, `params` and `search` and the one `current` the page gives
  it, so no tab needs `activeOptions`, and what is drawn and what is announced are
  one answer. The row is a strip like every scroll row (one line, scrollbar hidden,
  the side that continues fades, the current tab scrolled into view). A tab is 36px
  from `md` and the touch token below it. Its focus outline is inset, on purpose: a
  row that scrolls sideways clips an outer ring where a tab sits flush against the
  baseline, while the section navs' rows have room around them for `focus-ring`.
  The pill `Tabs` is for a mode inside a component (the composer's Reply / Note, a
  dialog's choice) and nothing else; `TabCount` is the one count beside a label. A
  short, always-answered value choice is `SegmentedControl` (a radio group; `touch`
  makes its segments a tap target below `md`), and a time range is `RangeControl`:
  segments from `sm`, a Select below, one name ("Time range"), the page's own preset
  list worded from the one table (`RANGE_PRESET_LABELS`: "30 days" everywhere, never
  "Last 30 days"). A range is a window on its page, so a route changes it by
  replacing the history entry (a radio group chooses as focus moves). A dashboard
  topic page keeps the range in `?range=` (`dashboardRangeSearch`; Guest voice has
  its own list, `GUEST_VOICE_RANGES`, which adds Automatic, the default, and 12
  months, because its evidence is reviews with text and the other pages' reads
  cannot answer 12 months); the Portal
  Results window is a reader-wide preference that follows the reader from portal to
  portal and to the overview, so it is remembered per reader. That is two mechanisms
  for one vocabulary, and unifying them (the URL as the source of truth on the Portal
  side, with the stored preference as its default) is an open owner decision, not
  settled here. `view-switcher-sources.test.ts` fails on a pill on a page, a
  hand-drawn underline, a toggled-Button view switch, a second range picker and a
  range change that pushes history; `nav-link-sources.test.ts` fails on a router
  `Link` that writes its own `aria-current` and on a `Link` inside a `LinkTab`.
  A list's search, filter, sort, count and Clear are one set of parts in a
  `ListToolbar` row: `SearchField` (it keeps what is typed as a draft until the URL's
  committed value catches up, so a slow navigation never drops a key), `ListFilterMenu` (a filter), `ListChoiceMenu` (how the
  list is shown, as Group by), `ListSortMenu`, and `ResultCount` with `ClearFiltersButton`
  inside a `ListToolbarStatus` (the two wrap together, so Clear never starts a line); the
  Properties list, the Portals overview and All properties compose them and write the
  URL, and the Inbox composes the same parts in its compact header. The field is
  `type="search"` with the one length limit (`MAX_LIST_SEARCH_LENGTH`, which the URL
  schemas share: a longer search is dropped from the URL, so the box stops typing
  there), and a list matches with `searchMatcher` (`property/property-search.ts`),
  which folds case and accents, never its own `includes`. The count is "N of M" while
  the list is narrowed. Clear takes away the search and the filters and never the
  sort, and reads "Clear filters" or, while a search is in force, "Clear search and
  filters"; a list with a search and no filter (All properties, Google import) passes
  `filters={false}` and it reads "Clear search", so it never promises a reset that does
  not exist. An empty result offers the same control (`variant="outline"`), and a list
  with no match for a search or a filter always does. A removed choice is a
  `RemovableChip` (one button named "Remove ...", a 32px pill from `md` and a tap
  target below it: 44px in a form, 36px in the compact Inbox), never a Badge with a
  button in it. The field's own X is a tap target on a phone too. `SortDirection` lives in `ui/list-sort.ts` and the direction labels are the
  list's. `list-toolbar-sources.test.ts` fails on a hand-built search input, a second
  Clear wording, a filter or sort glyph of its own and a second `SortDirection`. Where a
  form asks "which property?" it is `PropertyPicker` (`property/property-picker.tsx`):
  its search field appears from eight properties and there is none below that, so a
  plain `Select` of properties is never the answer; the sidebar's property switcher is
  navigation, shell chrome with its own menu, and is not a form control.

  The menu of one row, card or block is a `RowActionsMenu`: a ghost `IconButton` with
  the one three-dots glyph (touch-sized from the Button, `size="small"` for a dense
  feed row, `variant="outline"` among outline controls), named "More actions for
  {name}" and with no tooltip, and `RowActionsItem` items (`destructive` for an
  action that cannot be taken back, like a confirmation's tone; `opensDialog` ends
  the label in an ellipsis; a link item is `asChild` and spells its own; an item
  that runs a request is `pending` with a `pendingLabel`, as a Button is: the
  Button's spinner replaces its glyph, it is `aria-busy` and ignores a second
  choice, and the menu, held open with `open` / `onOpenChange`, closes when the
  request settles — the Inbox's "Check on Google"). A row
  keeps at most two labelled actions inline (Edit and Share, Remove) and puts the rest
  in the menu (a pending invitation's Resend and Cancel are its menu's items); the
  dialog an item opens is held outside it. `row-actions-sources.test.ts` fails on a hand-built kebab and an off-pattern
  name. A list of rows is a `DataTable` (frame, header cells, rows that stack as small
  grids below the container's own width: `layout="rows"`; `"cards"` for the Portals
  tables, whose rows are cards; `"scroll"` for a table wide by nature), with an
  "Actions" column that is `actions` (named for a screen reader, no word on screen; its
  cells are `<DataTableCell actions>`, which pulls a stacked row's menu trigger to the
  text edge, in the corner of the first row) and `DataTableSortHead` for a header that
  orders. The raw `ui/table` stays for a
  matrix, a wizard step and a chart's data table (`data-table-sources.test.ts` names
  each and fails on a new one). A row opens things one way (`row-link.ts`): the name
  is the accent link (`ROW_NAME_LINK`), any other link in the row is a figure or a
  note in the text's ink (`ROW_FIGURE_LINK`, never the accent), and a row that is a
  link as a whole wears `ROW_LINK_SURFACE`; a selectable master-detail row (the Inbox)
  is a button. A number with a caption is a `MetricStrip` (`boxed`, `ruled`,
  `embedded` in a Card, or wrapping `tiles`), never a local figure; a figure that is a
  link keeps its link and wears `METRIC_LABEL_CLASS` and `METRIC_TILE_FIGURE_CLASS`.
  A cursor feed's "Load more"
  is a `LoadMoreButton` (aria-disabled while it loads, so focus stays; "Try again"
  after a failure); the Portals numbered pager is the only other kind of paging.

  A fact the person reads and cannot change is a `DescriptionList`, never a disabled
  Input, a bare paragraph or a hand-built `<dl>`: a term column from `sm` (`termWidth`
  `default` 8rem or `wide` 10rem), or `stacked`, the term over the value at every width,
  where it sits among form fields (the Profile email, a Property's address from
  Google). A `note` is the quiet line under the value ("From Google"). A glossary, a
  list of key hints and a chart's readout are other shapes and keep their own
  `<dl>`; `description-list-sources.test.ts` names each and fails on a new one.
  A page has one `h1`, drawn by `PageHeader` (or, where the surface is compact, by the
  Inbox's list header, the Portal workspace's header, or an `AuthCard`'s title, which is
  the page): a feature never writes its own. The Inbox's queue name stays in the page on
  a phone, read and not drawn (`max-md:sr-only`), because a heading that is `display:
none` is not in the outline. Under it a section's title is a `CardTitle as="h2"` (a
  `CardTitle` is a div until the page gives it a level, and wears the same type at
  every level) or, for a section that is not a Card, a `SectionTitle` (h2 at
  `text-base` semibold; `level={3}` for a part of a section, a step smaller). Nobody
  sets a title's size or writes `role="heading"`; `heading-sources.test.ts` fails on a
  second `h1`, a Card title with no level and an h2 or h3 of its own in the settings
  pages. A Property's settings page names the section that is open, as an account
  settings page does: its header title and the end of its breadcrumb are the section
  (`propertySettingsHeader`), under "Settings", which links back to the hub.

- `forms/` contains shared TanStack Form fields, submission, and error UI. A
  settings group that saves on a button ends in one `FormActions` row, whatever
  its container (a `CardFooter`, the end of a card's body, a bordered panel; the
  section's own look stays): the actions at the end of the group, right-aligned,
  the primary last (a `SubmitButton`, or a `Button` for a group that is not a
  `<form>`). `Reset` is the row's and shows only while the group holds edits; it
  puts back the values the page last saved and never leaves the page, so a
  settings group has no Cancel (a dialog or a bounded task keeps one, before its
  primary). Pass `form` for a TanStack group (dirty while a field differs from the
  form's defaults, Reset is `form.reset()`) or `dirty` and `onReset` for a group
  that keeps its own state (the responsible managers, the quiet hours); a create
  form passes neither and gets just the right-aligned primary. A command of the
  group that is not its save (Turn off AI features) is `leading`. The saved
  values must reach the form as its `defaultValues` and a save that changes them
  must remount it (key the component on the saved values): TanStack keeps a
  touched form's dirtiness from before its defaults moved, so a form that is not
  remounted stays "dirty" after a save. The key is the values that form saves and
  nothing else: the Profile name form is keyed on the name, not on the avatar beside
  it, which saves on its own and would otherwise drop a name being typed. Reset
  hands the focus to the group's first
  field (its own button leaves with the edits; a row in a Card footer outside a form
  looks in the Card, and with no field at all the focus goes to another button of the
  row, never to the page) and drops the refusal of the save it discarded. Save is not
  gated on dirty: a group whose empty or default values are a valid save (the reply
  profile) stays savable. `form-actions-sources.test.ts`
  fails on a Cancel `Link` in a settings group, a `SubmitButton` outside a
  `FormActions` row or a `DialogFooter`, and a hand-spelled Reset.
  A choice is drawn by the shared controls, never a native one. One of a few named
  values is `FormSelectField` (the `ui/Select` in the field frame; no browser
  `<select>`, no raw `<input type="checkbox">`). "How low a rating" is
  `RatingThresholdField`, worded "3★ or lower" for the eye and "3 stars or lower" for
  the ear (`rating-threshold.ts`), with `offLabel` where the answer may be Off and
  `thresholds` where the rule stops short of five stars: the Portal's private note, the
  notification page's channels and the Organization's low-rating target are all it. A
  boolean setting is a `SettingSwitchRow`: the label (and its help and note) at the
  start, the Switch at the end, and `commit`, which is required because the row must
  say when it saves, and it does: the moment the Switch moves the row says what becomes of
  it. `immediate` saves as it is flipped, so the caller's mutation reports a refusal in a
  toast and `onCheckedChange` returns its promise: the row says "Saving…" while it runs
  and "Saved" when it lands, and nothing more when it was refused (a rejection, or
  `false`). `pending` also keeps the Switch waiting, and an optimistic row passes none
  (the notification channels: the Switch has moved and a second flip queues).
  `deferred` is one field of a group that saves on its Save, so the group's own button
  carries the pending state and the row says "Unsaved" (`unsaved`, from the field's
  `!isDefaultValue`) while its value is not the saved one; a group with no saved value
  yet, a wizard step, passes none. `layout="cell"` is the Switch in a table or list that
  already names it (the label is read, not drawn, and `stateWords` print beside it). A
  Checkbox is not a setting: it stays for choosing several things from a list and for a statement the
  person agrees to. That statement ("I have read this notice and agree...", "I have
  checked these details", "This property owns this photo...") is a `ConsentCheckbox`:
  one frame, the sentence, a line of help and the refusal, once a person has tried to go
  on without ticking it. So is any one framed yes that stands for a whole list ("Select
  all current portals": a choice, not an agreement), while the rows of the list keep
  plain `Checkbox`es. "Follow the parent, or
  set my own" is an `InheritedSetting`: it says what the place follows (pass a link
  where the owner has a page, as the Property's target does) and what that is worth,
  whether the place has a value of its own, and one button that puts the inherited
  value back ("Use inherited value"; the place may word it) or starts one of its own
  (`onOverride`, left out where editing the value is what overrides it, as on a
  notification row). It draws no editor: the value is the caller's field beside it,
  enabled while `overridden`. Its `commit` is the same two modes: `immediate` buttons
  save at once and show busy while they do, and a row that saves its own end of an
  override keeps showing the override until the save lands. `controls-sources.test.ts`
  fails on a native select, a raw checkbox, a Switch drawn outside the row, a consent
  sentence in a bare Checkbox and a threshold worded anywhere but one place.
  An avatar or a logo is an `ImageSetting`: the picture, with Upload, or Replace and
  Remove, as Buttons named for what it is (never a hover or an icon alone), and one line
  of help printed from the formats and the size the file is checked against. `onUpload`
  stores the file and saves its address, resolving with the address to show;
  `onRemove` saves the removal, and a removal that is only drawn is the bug (the
  avatar's Remove used to clear the page and nothing else; a removal passes `null`
  to the server, and the update that maps a null to `undefined` saves nothing, because
  Better Auth skips an undefined field). Pending is a spinner and a word on the Button,
  with the progress on the picture; a refused upload or removal is a toast in the
  words every action uses (`Couldn't upload that logo. Try again.`) and the picture
  stays exactly as it was (a removal that landed takes the Remove button with it, so the
  focus moves to Upload), so the mutations behind it pass no `errorMessage` and only
  say what succeeded. The Property look logo is the exception: it crops, sets a focal
  point and checks a light version, so it keeps its dialog. `image-setting-sources.test.ts`
  fails on a second image field. One `ConnectGoogleButton`
  (`features/integration/connect-google-button`) starts every Google authorization:
  "Connect Google" (`label="Connect another account"` where an account is already
  connected, `request` and `label` for Reauthorize and Show account email), the one
  glyph for adding an account, a spinner on the Button with its label kept, and a
  failure toast; no place redirects to the sign-in address itself
  (`connect-google-sources.test.ts`).
  A field is a `FormTextField`, `FormTextarea` or `FormNumberField`, or, for a
  control of another kind, a `FormFieldFrame` (a `Field` holding the `FieldLabel`,
  the control, the `FieldDescription` and the error, in that order); never a
  hand-built label, control and `FieldError`. Help under a control is the
  `description` prop (a `FieldDescription`, wired to the control by
  `aria-describedby`, which names the error too while the field is invalid, through
  `describedByOf`) and a field the person may leave empty is `optional`, which
  prints "Optional" inside the label so the control's name carries it; no
  "(optional)" suffix and no `text-xs` hint. The text fields report after the field
  has been touched; the number field reports as soon as the schema names a fault,
  because a refused target must show its reason. A failure has one reporter. A
  form submit reports through `FormErrorBanner`, which `FormActions` draws
  directly above its row (a form that is not a settings group places it directly
  above its actions), and never also toasts. A row or immediate action (a switch, a menu
  item, a download) reports through a toast,
  `errorMessage` on its `useActionMutation`, and never also a banner. A toast for
  a failure reads "Couldn't …. Try again." (`actionFailureMessage`), shows the
  server's own sentence only for a 4xx refusal, and a success says what changed
  without "successfully". `FormErrorBanner` follows the same rule (a 4xx
  refusal's sentence, a rejected schema's issue list, one generic sentence for
  anything else), so hand it the mutation's error as it is. The setup wizard's
  results list is neither a toast nor a banner and words each failed write by
  the same rule (`property-setup/run-setup-plan.ts`). A Goal command's
  refusal is worded first: it arrives with its code as the message, so
  `goals/goal-refusal.ts` gives each code its sentence and the banner or the
  toast prints that. An autosaved portal
  form (`usePortalFormAutosave`) has no actions to sit above and renders no
  banner: the editor header's save status reports its failure. The Private note
  form also shows a refusal beside its private-rating switch, so the manager
  can see why a running rating goal prevents that change (ADR 0044, 2026-11-02).
  `feedback-ownership.test.ts` reads the sources and fails on a file that does
  both, a hand-built red paragraph, or a toast that
  echoes `error.message`. Typed toasts take their colours from the tone tokens
  (`toaster-theme.ts`) and follow the applied theme.
- `ui/metric-delta` draws a period-over-period change (arrow, size, baseline,
  and the direction in words) and `#/lib/format` is the one place a date or a
  number becomes text: en-US, UTC unless a zone is named, `null` for an instant
  that is not one. Notifications and the guest renderer keep their own
  formatters because they honour a person's or a guest's own locale. A clock
  time printed on its own says whose clock it is (`formatZonedTimestamp`). The
  Inbox prints every stamp of its own on the reader's clock (`inbox/utils.ts`:
  the relative stamps, the day past a week, the review's date and each hover
  title, which names the zone); it can, because its list and detail are read
  after mount and never rendered on the server. Its Response Target is due on
  the Property's clock and names that zone. `inbox/inbox-instants.test.ts`
  fails on an Inbox instant printed on the UTC default.
- `layout/` contains app-shell and navigation pieces. `PageState` is the one
  page-level state (`loading`, `error`, `notFound`, `unavailable`): the router's
  defaults and every route fallback draw it through `RoutePending`, `RouteError`
  and `RouteNotFound`, in the title, breadcrumbs and `PageShell` tier the loaded
  page has. A page is named once, on its route (`staticData: { page: { title,
tier, under } }`, see `page-identity.ts`): that gives its fallbacks their frame
  and its tab title (`<Page> | Reputation Key`). A loading page also draws the
  shape of its content (`loading`, `headerLines` on `staticData.page`, resolved
  by `loadingShapeOf` in `page-identity.ts`; bodies in `page-state-loading.tsx`),
  so the title and the first block stay where the page lands: a Settings page is
  `narrow`, the Properties list, Staff and Notifications a `list`, Goals `cards`, the Property look
  and a Portal group `split` (the group header is two lines), the Inbox and
  Reviews `inbox`, the Portal workspace a `workspace`. The workspace and Inbox
  placeholders are containers whose breakpoints are the surfaces' own (editor
  preview beside the form from `@4xl`, 30rem from `@6xl`, section column from
  `@7xl`; Inbox queue rail from `@min-[1022px]`, the floor of
  `use-inbox-compact-layout` beside the sidebar), so change them together. The router
  keeps the old page for the first 250 ms of a navigation, counted from the click
  and including the shell's own `beforeLoad` stage (`defaultPendingMs`), and holds
  a placeholder that did appear for 300 ms (`defaultPendingMinMs`), so a quick
  load shows none and a slow one shows no flash. A route does not write its own
  `pendingComponent`, `errorComponent` or `notFoundComponent` unless it names a
  missing entity (`RouteNotFound` with `entity`). The error state takes the
  guarded behaviour (sanitised message, report, 401 sign-in redirect, Try again,
  and one reload when the failure is a tab whose code is older than the server's,
  drawn as the loading state) from `useGuardedRouteError`. A component's own
  query refused for that reason needs nothing of its own: the release check
  reloads the page when the refusal answers a view a navigation has just drawn
  (a selection made through search parameters included), and otherwise the
  refusal's sentence stands until the next navigation reloads. A refusal is
  drawn by the shell route's not-found boundary (`ShellNoticeBoundary`), which
  replaces the shell; what a person set (the sidebar's open state, the focused
  sidebar link) is kept in `shell-continuity` so the swap does not reset it, and
  the refusal takes the frame of the page it replaces (`refusal-frame`).
- `hooks/` contains cross-feature React behavior and action wrappers.
- `inbox/` and `goals/` contain large cohesive manager experiences.
- `features/<feature>/` contains feature presentation grouped by user concept;
  `shared/` inside one feature is not a cross-feature dumping ground.

Use named exports. Export page-level feature components from the feature barrel;
keep concept-specific children internal.

Filename, feature-barrel, dependency, and 300-counted-line limits are enforced by `scripts/check-filenames.mjs` and `eslint.config.js`.

## Pattern index

Before adding UI, find the family here. Each one has a single implementation:
the UI consistency scan of 2 October 2026
(`docs/design/ui-system/ui-consistency-scan-2026-10-02.md`) found about a hundred
places where a second had grown beside the first, and every stage of
`docs/plan/ui-consistency-implementation.md` folded one family back into one
primitive. Use the canonical component. When it lacks something you need, extend
it with a prop or a variant (the owner approves new primitives and variants)
rather than overriding it with `className`. The paragraphs above say how each one
behaves; this index says where it lives, what it is for and what keeps it that
way.

- **Import** is the `#/` alias for `src/`.
- **Differs on purpose** is a decision, not drift (section 4 of the scan report).
  Do not "fix" it, and do not copy it into a place it does not belong.
- **Guard** is a Vitest unit test that reads the sources and fails with the file
  named (`pnpm exec vitest run --project=unit <path>`), given relative to
  `src/components/` unless it starts with `src/`. **Review** means nothing enforces
  the family yet, so a reviewer does. A guard's allowlist grows only with a reason
  written beside the entry.
- The `ui-pattern/*` ESLint rules flag the commonest ways around a family as you
  type (a raw `<button>`, a height typed on a control, a route drawing its own
  state). `pnpm lint` caps their warnings at the number of sites already there
  (the `lint` script in `package.json`; `docs/standards.md`, section 9), so that
  number cannot grow, though one site can still be traded for another.
- `pattern-index.test.ts` checks that every path and guard named here exists.

### Page frame and states

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Page header and title | `PageHeader` from `#/components/layout/page-header`<br>`trailCrumbs` from `#/components/layout/page-identity`<br>`NAV_LABEL` from `#/components/layout/nav-labels` | The title, breadcrumbs, state line, purpose and actions of every page, and its one `h1`. A trail is `trailCrumbs`, the places named as the sidebar names them | `breadcrumbs`, `meta` (where you are, what state it is in), `description` (one sentence of purpose, never a count, a name or a status), `actions` (primary controls and their captions); `titleAside` (a short explanation beside the title); the tab title comes from the route's `staticData.page` | The Inbox list header, the Portal workspace header and an `AuthCard` title are compact `h1`s of surfaces that own their frame; two pages print a dynamic `description` and say why | `ui/heading-sources.test.ts`, `layout/header-sources.test.ts` |
| Back control | `BackLink`, `BackButton` from `#/components/ui/back-link`<br>`BackIconButton` from `#/components/ui/back-icon-button` | The way back where there is no breadcrumb trail: a surface with no room for one, and a step that returns to the step before. A ghost small Button with the one arrow, `Back to <place>` | `BackLink` for an address, `BackButton` for a step or a view; `iconBelow` (the arrow alone on a narrow row), `flush` (the arrow on the content edge) | The Inbox detail pane has no room for words: it is the arrow alone, `BackIconButton`; the settings sidebar keeps its "Back to app" row, a menu item | `layout/header-sources.test.ts` |
| Top bar, account menu, theme | `AppTopBar` from `#/components/layout/app-top-bar`<br>`ThemeModeControl` from `#/components/layout/theme-mode-control` | The signed-in chrome; the theme as one Light / Dark / System control in the menu and on Preferences | | The public Header and Footer keep the public chrome; the approved personal-Portal staff surface has its own Property/account bar in `features/staff-home/staff-home.tsx`, without manager navigation or notifications | Review (`layout/theme-mode-control.test.ts` covers the control) |
| Page gutter and width | `PageShell`, `FullBleedFrame` from `#/components/layout/page-shell`<br>`isFullBleedRoute` from `#/components/layout/full-bleed-route` | `<main>` owns the gutter and the document scrolls padded pages; the sticky top bar and page elements share `--app-top-bar-height`. A page picks a width `tier`; a surface that owns its pane scroll asks `isFullBleedRoute` and takes the gutter back from `FullBleedFrame` | `tier`: `dashboard` 1200, `standard` 1024 (lists, management), `narrow` 768 (forms, settings) | The Inbox, property Reviews and the Portal workspace are full-bleed | `layout/page-shell.test.ts`, `layout/full-bleed-route.test.ts` |
| Sidebar | `Sidebar` from `#/components/ui/sidebar` | The app and settings sidebars, one collapse mode (the icon rail) | | Account and Organization settings swap the sidebar; a Property's settings keep it beside an in-page nav | `ui/sidebar.test.ts` |
| Page state | `PageState` from `#/components/layout/page-state`<br>`RoutePending`, `RouteError`, `RouteNotFound` from `#/components/layout/route-page-state` | A page that is loading, failed, missing or unavailable, in the page's own title and tier. A loading page draws the shape of its content: the title and the header lines under it, then a body that holds the content's place. A route never writes its own | `kind`: `loading`, `error`, `notFound`, `unavailable`; a page's `staticData.page` may add `loading` (`scorecard` for a dashboard page, `list`, `cards` for anything else, `split`, `workspace` for a full-bleed surface, `inbox`) and `headerLines` (0, 1 or 2 lines under the title; 1 when left out) | `/unavailable` is only for an account with no workspace; a missing entity names itself through `RouteNotFound`. The workspace and Inbox shapes are whole surfaces: they draw their own header, tabs and panes with no `PageShell` or gutter around them | `src/routes/route-boundaries.test.ts`, `src/routes/page-identities.test.ts`, `layout/page-state.test.ts` |
| Region state | `EmptyState` from `#/components/ui/empty-state`<br>`RegionError` from `#/components/ui/region-error` | A region with nothing to show, nothing that matches or a failed read, with "Try again" | `size`: `default`, `compact`; `tone`: `neutral`, `error` | A dashed box is kept for a drop zone, a private-note cue, a chart line and a chip | `ui/region-states.test.ts` |
| Document title | `pageHead` from `#/components/layout/page-identity` | The tab title `<Page> \| Reputation Key`, named once on the route | `staticData.page`: `title`, `tier`, `under` | | Review (`layout/page-identity.test.ts` and `layout/page-head.test.ts` cover the rules) |

### Navigation and views

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Section navigation | `SectionNav` from `#/components/ui/section-nav`<br>`SectionNavLayout` from `#/components/ui/section-nav-layout` | The sections of one place (Property settings, the Portal editor's parts) | Items with icon, summary, count and group; `presentation` `list`, `strip`, `auto` (by container width) | The Inbox queue rail and the phone's queue sheet keep their own composition, with the same fill, ring and `NavCount` | `ui/nav-link-sources.test.ts`, `ui/section-nav-styles.test.ts`, `ui/nav-contrast.test.ts` |
| Navigation link | `NavLink` from `#/components/ui/nav-link` | Any link that says where you are: it sets `aria-current` once, from the `current` the nav passes | | | `ui/nav-link-sources.test.ts` |
| Page views | `LinkTabs`, `LinkTab` from `#/components/ui/link-tabs`<br>`Tabs`, `TabCount` from `#/components/ui/tabs` | Sibling views of one page (a route or a search value): underline tabs | `Tabs variant="line"` for views that swap a panel; the pill `Tabs` only for a mode inside a component | `LinkTabs` is a navigation landmark of links, an in-page `Tabs` is a tablist | `ui/view-switcher-sources.test.ts` |
| Value choice and range | `SegmentedControl` from `#/components/ui/segmented-control`<br>`RangeControl` from `#/components/ui/range-control` | A short, always-answered choice (a radio group); a time range, worded from `RANGE_PRESET_LABELS` in `#/shared/dashboard-range` | `touch` | The Portal Results window keeps its own preset list and is remembered per reader | `ui/view-switcher-sources.test.ts` |

### Collections

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| List toolbar, search, filter, sort | `ListToolbar`, `ListToolbarStatus` from `#/components/ui/list-toolbar`<br>`SearchField` from `#/components/ui/search-field`<br>`ListFilterMenu`, `ListChoiceMenu` from `#/components/ui/list-choice-menu`<br>`ListSortMenu` from `#/components/ui/list-sort-menu`<br>`ResultCount` from `#/components/ui/result-count`<br>`ClearFiltersButton` from `#/components/ui/clear-filters-button`<br>`RemovableChip` from `#/components/ui/removable-chip`<br>`searchMatcher` from `#/components/property/property-search` | A list's search, filter, sort, count and Clear; a removed choice; matching that folds case and accents | `ClearFiltersButton filters={false}` reads "Clear search" | The Inbox composes the same parts compactly (popover on desktop, sheet on a phone) | `ui/list-toolbar-sources.test.ts`, `ui/list-menus.test.ts` |
| Property choice | `PropertyPicker` from `#/components/property/property-picker` | A form that asks "which property?" | Search from eight properties | The sidebar's property switcher is shell chrome | Review |
| Table and rows | `DataTable`, `DataTableCell`, `DataTableSortHead` from `#/components/ui/data-table`<br>`ROW_NAME_LINK`, `ROW_FIGURE_LINK`, `ROW_LINK_SURFACE` from `#/components/ui/row-link` | A list of rows that stacks on a phone, and how a row opens things | `layout`: `rows`, `cards`, `scroll`; an `actions` column | The raw `ui/table` stays for a matrix, a wizard step and a chart's data table; Inbox rows are buttons | `ui/data-table-sources.test.ts` |
| Row actions | `RowActionsMenu`, `RowActionsItem` from `#/components/ui/row-actions-menu` | The menu of one row, card or block, named "More actions for {name}" | `size="small"`, `variant="outline"`; items `destructive`, `opensDialog` | A notification row reveals its small kebab on hover; removing a Property routes to the danger zone | `ui/row-actions-sources.test.ts` |
| Load more | `LoadMoreButton` from `#/components/ui/load-more-button` | A cursor feed's "Load more" | | The Portals list pages by number | Review |
| Metrics | `MetricStrip` from `#/components/ui/metric-strip`<br>`MetricDelta` from `#/components/ui/metric-delta` | A number with a caption; a period-over-period change | `boxed`, `ruled`, `embedded`, `tiles` | | `ui/metric-delta.test.ts` (the delta); the strip is Review |
| Read-only facts | `DescriptionList` from `#/components/ui/description-list` | A fact the person reads and cannot change | `termWidth` `default`, `wide`; `stacked`; `note` | A glossary, a list of key hints and a chart's readout keep their own `<dl>` | `ui/description-list-sources.test.ts` |

### Status, notices and feedback

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Status and tone | `Badge` from `#/components/ui/badge`<br>`StatusBadge` from `#/components/ui/status-badge`<br>`RoleBadge` from `#/components/features/identity/shared/role-badge`<br>`TONE_ICON` from `#/components/ui/tone` | A status pill: a `Badge` tone, or a `StatusBadge` where a feature maps its domain status to a label and a tone | Tones `positive`, `warn`, `negative`, `neutral` | | `ui/tone-sources.test.ts`, `ui/token-contrast.test.ts` |
| Notice | `Alert` from `#/components/ui/alert` | A notice on the page, with the tone's one icon | `destructive`, `warning`, `success`, `info`, `default` | | `ui/tone-sources.test.ts` |
| Feedback ownership | `FormErrorBanner` from `#/components/forms/form-error-banner`<br>`useActionMutation` from `#/components/hooks/use-action-mutation`<br>`Toaster` from `#/components/ui/sonner` | A form's failure is a banner above its actions; a row or immediate action reports in a toast. Never both | `DialogErrorBanner` for a dialog | An autosaved Portal form reports in the editor header; the private-rating switch also shows its refusal inline | `forms/feedback-ownership.test.ts` |
| Hints and tooltips | `ExplainTrigger` from `#/components/ui/explain-trigger`<br>`Tooltip` from `#/components/ui/tooltip` | Text that explains itself on request; the name of an icon-only control | | | `ui/button-sources.test.ts` |

### Actions and dialogs

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Button | `Button` from `#/components/ui/button`<br>`SubmitButton` from `#/components/forms/submit-button` | Every action. `pending` and `pendingLabel` own the spinner; the density (44px below `md`) is the primitive's | `variant`, `size`, `touch`, `iconBelow`; lazy `RowButton` / `SummaryButton` from `ui/button-layouts` for multiline evidence rows and a stable copy pill; `data-density="compact"` on a container | The Inbox and the top bar are compact (36px on a phone) | `ui/button-sources.test.ts` |
| Add action | `AddAction`, `AddActionLink` from `#/components/ui/add-action` | The control that adds a thing to a list: the Plus, then a sentence-case label, in the default Button. It sits in the header's `actions`; a card or a tab that owns a list may carry its own | `AddAction` opens a dialog or a menu or runs a command, `AddActionLink` goes to a page; `size` `default`, `sm` (in a card header) | Portals repeats "New portal" in a fixed bar at the foot of a phone (`PortalPhoneNewPortalBar`); Add staff sits above its table | `ui/add-action-sources.test.ts` |
| Icon-only control and link in text | `IconButton` from `#/components/ui/icon-button`<br>`InlineLink` from `#/components/ui/inline-link` | A control with no visible label (a required `label`, which is its name and its tooltip); a link set in a sentence | `tooltip`; `TouchInlineLink` from `ui/inline-touch-link` for a standalone touch target; `focus-ring` for a control that is not a Button | A control that opens a menu or popover shows no tooltip | `ui/button-sources.test.ts` |
| Confirmation | `ConfirmationDialog`, `ConfirmationTrigger` from `#/components/ui/confirmation-dialog` | Every confirmation. It stays open and pending until `onConfirm` settles, then says a refusal once | `tone`: `destructive` (cannot be undone, or loses data), `neutral` (reversible) | Leave organisation is a `Dialog` (a transfer form), Inbox Reject is inline (it needs a reason); a draft language, an unsent reply draft and one notification skip it | `ui/dialog-sources.test.ts` |
| Dialog | `Dialog`, `DialogFooter`, `DialogCancel` from `#/components/ui/dialog`<br>`useDialogBusy` from `#/components/ui/dialog-dismissal` | Any other dialog: its width and height bound come from the primitive | `size`: `sm`, `md`, `lg`, `xl`; `busy` while a mutation runs | The two Inbox dialogs drop the corner close; a popover on desktop is a sheet on a phone | `ui/dialog-sources.test.ts`, `ui/dialog-dismissal.test.ts` |

### Forms and settings

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Save group | `FormActions` from `#/components/forms/form-actions` | The one row an explicit-save group saves from: Reset (only while dirty), Save last, right-aligned | `form`, or `dirty` and `onReset`; `leading` | A dialog or a bounded task keeps Cancel; a settings group has none | `forms/form-actions-sources.test.ts` |
| Fields | `FormTextField` from `#/components/forms/form-text-field`<br>`FormTextarea` from `#/components/forms/form-textarea`<br>`FormNumberField` from `#/components/forms/form-number-field`<br>`FormFieldFrame` from `#/components/forms/form-field-frame`<br>`FormSelectField` from `#/components/forms/form-select-field` | A labelled control with `description`, `optional` and its error | | The Property look keeps its label-left rows | `forms/form-actions-sources.test.ts` (field anatomy, no "(optional)"), `forms/controls-sources.test.ts` (no native control) |
| Switches, inherited values, consent | `SettingSwitchRow` from `#/components/forms/setting-switch-row`<br>`InheritedSetting` from `#/components/forms/inherited-setting`<br>`ConsentCheckbox` from `#/components/forms/consent-checkbox`<br>`RatingThresholdField` from `#/components/forms/rating-threshold-field` | A boolean setting; "follow the parent or set my own"; a statement the person agrees to; "how low a rating" | `commit`: `immediate`, `deferred` | A `Checkbox` stays for choosing several things from a list | `forms/controls-sources.test.ts` |
| Image and Google | `ImageSetting` from `#/components/forms/image-setting`<br>`ConnectGoogleButton` from `#/components/features/integration/connect-google-button` | An avatar or a logo; every Google authorization | `label`, `request` | The Property look logo keeps its crop and focal-point dialog | `forms/image-setting-sources.test.ts`, `features/integration/connect-google-button/connect-google-sources.test.ts` |
| Section titles | `CardTitle` from `#/components/ui/card`<br>`SectionTitle` from `#/components/ui/section-title` | The title of a section: `CardTitle as="h2"` in a Card, `SectionTitle` outside one | `level` 2 or 3; `StrongSectionTitle` from `ui/section-title-strong` for evidence sections | | `ui/heading-sources.test.ts` |

### Tokens, links, text and copy

<!-- prettier-ignore -->
| Family | Import | Use it for | Variants | Differs on purpose | Guard |
| --- | --- | --- | --- | --- | --- |
| Colour | The tokens in `src/styles.css` | Every colour: no palette class, no `oklch()` or hex in a component. Red text is `text-negative` | | The guest renderer keeps its own colours | `ui/tone-sources.test.ts`, `ui/token-contrast.test.ts` |
| Links | `InlineLink` from `#/components/ui/inline-link`<br>`NavLink` from `#/components/ui/nav-link` | A plain `<a>` or `Link` is a content link in the accent ink; a link with its own ink opts out by `data-slot` | | | `ui/link-ink.test.ts` |
| Dates and numbers | `formatDate`, `formatNumber`, `formatZonedTimestamp` from `#/lib/format` | The one place a date or a number becomes text. A clock time printed on its own names its zone | | Notifications and the guest renderer honour a person's or a guest's own locale; the Inbox prints its own stamps on the reader's clock | `src/lib/format-usage.test.ts`, `inbox/inbox-instants.test.ts` |
| Goal measure names | `goalMetricLabel` from `#/components/goals/goal-metric-label` | What a goal's measure is called, everywhere: "Scans", "Private ratings", "Average private rating" on the Goals page, in its results matrix, on a group's goal card, on a goal's own page and in its forms, and in a goal's name | | | `goals/goal-metric-label-sources.test.ts` |
| Check-in section | `CheckInSection` from `#/components/features/shared/check-in-section` | Answer/evidence card; ReactNode icon, string answer, hint, tone, aside and footer. GuestVoiceSection maps its existing icons onto this primitive. | | One question and answer on the left, evidence on the right; stacks in narrow containers | Review |
| Guest voice check-in | `GuestVoiceSection`, `GuestVoiceDisclosure` and `GuestVoiceIssueTitle` under `features/property/guest-voice` | Four answer/evidence bands: urgent, rating trend, fix (other concerns nested), praise; `answer`, `aside`, `tone` and `footer` slots on the section, stacked in narrow page containers. Whole rows open lazy URL-backed issue, concern or topic details. `RangeControl` stays in `PageHeader.actions`. The manual summary uses only fixed topic labels and unique counts | | No quotes in page rows; sentence evidence only in detail. Topics start collapsed; small pages retain concerns and three live previews | `features/property/guest-voice/guest-voice-check-in-sources.test.ts` |
| Responsive detail sheet | `SheetContent`, `SheetFooter` from `#/components/ui/sheet` | `layout={RESPONSIVE_DETAIL_SHEET}` from `ui/sheet-layouts` and `variant="safe-area-actions"`: `SheetDetailTitle` is the strong title variant from `ui/sheet-layouts`; one modal, side sheet on desktop, bottom sheet below md, bounded by the dynamic viewport. Header and safe-area footer stay outside the independently scrolling body; the footer is phone-only, desktop actions remain after evidence | | No feature width/position overrides. Back restores linked-sheet scroll/control focus; close restores the page opener | `ui/dialog-sources.test.ts`, `features/property/guest-voice/guest-voice-check-in-sources.test.ts` |
| Goal design parts | `GoalCardFrame`, `GoalCardColumns` and `GoalCardActions` from `#/components/goals/goal-card-frame`; `GoalHeadline` from `#/components/goals/goal-headline`; `GoalMeter` from `#/components/goals/goal-meter`; `GoalRuler` from `#/components/goals/goal-ruler`; `GoalColumns` from `#/components/goals/goal-columns`; `GoalCheckIn` and `GoalWithCheckIn` from `#/components/goals/goal-check-in`; `GoalDetailLayout`, `GoalWhere` and `GoalTiles` from `#/components/goals/goal-detail-layout`; `GoalActionRows`, `GoalActionWords`, `GoalActionButton` and `GOAL_ACTION_LINK` from `#/components/goals/goal-action-row`; `GoalHistoryList` and `GoalClosedCard` from `#/components/goals/goal-history-list`; `GoalSheetFrame` and `GoalSheetHeader` from `#/components/goals/goal-sheet-frame`; `GoalHeroStepper`, `GoalSetupStatusLine`, `GoalRecommendedTag`, `GoalSetupPanel`, `GoalAside`, `GoalSetupLinks`, `GOAL_SETUP_LINK`, `HERO_STEPPER_GAP` and `HERO_STEPPER_TOUCH` from `#/components/goals/goal-setup-parts`; `GOAL_PACE_STATUS` from `#/components/goals/goal-pace-status` | How every goal's card is drawn: its title with the one status pill in the corner, the two columns of a card (what the goal says, and its week or month beside it), the row its actions sit in, the headline that says what is left (its target and the ruler's end are the figures in the link ink), the progress meter (a caption, the figure and a bar with no verdict), the ruler (the setup screen's ruler with the way already climbed filled in: where the goal started, the stops on the way, the goal's number and a label for where it stands now, one picture named by one sentence that a screen reader hears whole; each goal works out its own figures and words), the bars (a goal's weeks against its plan, or its months against their own numbers: one scale and one baseline, the bars from before the goal in a quieter ink, the one still counting dashed, one keyboard stop, and the same figures read out as a list), the three pace pills (Getting started, On pace, Below pace), and the check-in strip above a card (a region named by its title, not a heading; the headline, the line under it, the choices with the first the one to take, the note; a refusal only where the goal passes one), the sheet a goal is set in (a dialog on a desktop and a full-screen sheet on a phone, found by the attribute the goal passes, opening on the step's own first stop), and the parts of its one-screen setup (the goal's number between round steppers, the line under it as a tag, words and links (in a row, or one part to a line where a goal asks for it, as a phone's narrow room does), the muted panel the way to choose sits in, the recommendation's tag, the quoted aside and the row of links), and the page a goal's detail is laid out in (a column of blocks that the page orders itself; the card that says where the goal stands, with its headline and its ruler; the check-in bands of its questions, and under them the whole-row actions, each an icon, what to do, why and a chevron, a router link wearing `GOAL_ACTION_LINK` or a button; the tiles in a titled strip, one to a row until there is room for three, only on the average goal's page; the History list, a card of dated facts closed until asked (`GoalClosedCard`: its title is the button that opens it) with each date in a column of its own, an optional control under the list, the row that control revealed taking the focus once, a landmark named by its title and a date column wide enough for a year, only where a goal asks). A goal passes in its own `data-slot`, words and figures; a part holds none, and imports no `rating-goal-*` or `portal-goal-*` module and no server context | | Each goal keeps its own names, notices and rhythm, and no number of one is derived from the other (ADR 0068, amended 2026-10-19 and 2026-11-01). The Google rating goal draws with the parts; the Monthly portal goal's card, Overview slot and page header draw with the card, headline, ruler and pill, its month-start check-in with the strip, its set, change and add sheets with the sheet frame and the setup parts, and its page with the detail layout, `GoalWhere`, the bars, the action rows and the closed History list (the average goal's page keeps the tiles) | `goals/goal-shared-sources.test.ts` |
| Portal goal words | `portal-goal-copy.ts`, `portal-goal-words.ts` and `portal-goal-offer-words.ts` in `#/components/goals/` | The Monthly portal goal's name, its three approved lines (P-8, verbatim, spelled only in the copy file) and every line its card says, the number it offers and "How we worked this out" included. Its card and Overview slot are drawn on the shared Goal design parts: the pace is the shared pill (`portalGoalPace` in `portal-goal-status-view.ts`: Getting started, On pace, Below pace, or none for a month the rule does not judge; the Goals page's rows of the other Portal goals wear it too, On pace or Below pace on a count with one subject that the rule judged, in `goal-live-line.tsx`), what is left is the shared headline (`GoalHeadline`, whose target is in link ink, as the ruler's end is), and the month is the shared ruler, from none to the month's number with a stop labelled "steady pace" where a steady month would stand today (`portal-goal-ruler-view.ts`; the Portals' counts beside it are the list "From your portals" at every width); its page (the goal's, or a Portal's or a group's) is the shared detail layout: where the goal stands, then three check-in bands (where they are coming from, with the counts in name order and never a winner; how the month compares, as the shared bars; what to do this week, as the shared action rows) in `portal-goal-bands-view.ts`'s words, with "What changed" (a region of that name, the date in its own cell) and "How this goal counts" as the shared History list's closed card; the average's page keeps the tiles titled "Your goal, so far" and its month strip; its month-start check-in is the shared strip above the card (`GoalCheckIn`, `portal-goal-check-in.tsx`: a region named "For December", not a heading, with Use, Keep and Other number as buttons, Use first); none of the Google rating goal's words, lines or modules, and no `text-link` ink written in a Portal file | | Kept apart from the Google rating goal on purpose in data, words and modules; only the design parts are shared (ADR 0068, amended 2026-10-19 and 2026-11-01) | `goals/portal-goal-sources.test.ts` |
| Portal goal set sheet | `PortalGoalSheet` from `#/components/goals/portal-goal-sheet` (a lazy chunk), worked out by `portal-goal-sheet-view.ts` and `portal-goal-sheet-words.ts` (the rows, the status parts, the counting sentence and the notes the set, change and add sheets say alike) | The one sheet a Monthly portal goal's number is set in, from every door of its card: a `Dialog` on a desktop, a full-screen bottom `SheetContent` on a phone, both drawn by the shared `GoalSheetFrame` (so are the two change sheets and the Add sheet, on the same `lg` width), with nothing of the Google rating goal's words, lines or modules (ADR 0068, amended 2026-10-19). The number is the hero between round steppers (`GoalHeroStepper`) with what it counts under it ("private ratings in November"), the suggested numbers are radio rows in an unlabelled `GoalSetupPanel` (the radio group is the one name) with the asking line as its `GoalAside`, and the explanation links are `GoalSetupLinks`; its draft mounts afresh with a key per opening | | Round steppers on the hero number (PLAN Q-7's square ones are superseded by the goals unification); the Add sheet's per-portal rows keep their small square steppers (`portal-goal-add-each.tsx`) | `goals/portal-goal-sources.test.ts` |
| Portal goal results | `PortalGoalResults` from `#/components/goals/portal-goal-results` (the `/goals/portal-results` route chunk), its words in `portal-goal-results-view.ts`; the way there `PortalGoalResultsLinks` from `#/components/goals/portal-goal-results-links`, decided by `portal-goal-results-foot.ts` | Every month's result of the Portal goals, one card for each goal titled by its name (and whom it counted), with its months as the shared bars once it has two and a row for each month in a manager's words in `portal-goal-results-list-view.ts` ("41 of 40", Met, Missed by 4, The final figure is on its way) that opens on a tap to when the figure was final and who set the number (`PortalGoalResultsList`, drawn from the matrix the route builds; no longer on the Goals page), and the ended Portal goals, each with the day it ended. The Portal goals section's foot leads there once a month has closed ("All monthly results") and once a goal has ended ("Ended portal goals (n)", to `#ended`); so does the goal page's "All monthly results". Both for `goal.update`, the gate the matrix had. "Ended portal goals (n)" hands the list's title the focus; with nothing to show yet the page goes back to the Portal goals section | | The Goals page loads none of the results page: the foot's words are a module of their own | `goals/portal-goal-sources.test.ts`, `goals/portal-goal-results-foot.test.ts` |
| Google rating goal views | `RatingGoalViews` from `#/components/goals/rating-goal-views`, its tabs `GoalViewTabs` from `#/components/goals/goal-view-tabs` | The Google section of the Goals page: one region named "Google rating goal" that holds the Active / History tabs ("Google rating goal views", `?view=`), then the view they choose. What it holds (the card, the door, History) titles itself but draws no region of its own, so no landmark is named twice | | The tabs are the Google rating goal's own (P-7a, ADR 0068): the Portal goals below the section are the same on both views, and their ended goals are on the Portal goal results page | Review (the `goals/rating-goal-section.stories.tsx` plays `HistoryTabInsideSection` and `ActiveTabInsideSection`, and e2e J12, check it) |
| Action copy | The Action copy section of this file | The words of a button, a confirmation and a crumb | | Domain verbs (Archive, Remove, Restore) and "Keep X" cancel labels | `ui/copy-sources.test.ts` |

## Server-function boundary

Routes are the normal runtime import site for context server functions. A route
creates an `Action` with `useActionMutation` or `useAction`, then passes it to the
component. Type-only server imports are allowed to spell those props.

A component — or the single hook that owns its mutations — with five or more
closely related mutations may value-import its server functions when prop
drilling would obscure one cohesive workflow. Document the exception in that file
and add it to the checker allowlist; do not widen the exception to its whole
feature without the same mutation density.

Component/server value-import rules and their allowlist are enforced by `scripts/check-component-boundaries.mjs`; database and context-layer boundaries are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Forms

Use TanStack Form, Zod v4 DTO schemas, and shadcn fields. The owning context's
`application/dto/` schema is the source; derive a form shape with `.required()`,
`.extend()`, or `.omit()` rather than copying validation.

Validate on submit unless the interaction has a specific live-validation need.
Drive pending/error/result UI from the sanctioned `Action`; do not call a server
function directly or hand-roll submission state. Shared building blocks include
`SubmitButton`, `FormErrorBanner`, `FormTextField`, and `FormTextarea`. A form's
`onSubmit` is `submitHandler(form)` (`forms/form-submit.ts`), never a copy of its
`preventDefault` / `stopPropagation` / `handleSubmit`; a key shortcut calls
`submitForm(form)`.

## Queries and actions

SSR-critical route data is primed by the route and read with the same
`useSuspenseQuery` options. Interactive reads use `useQuery`; cursor lists use
`useInfiniteQuery`. Use key factories from `src/shared/queries/query-keys.ts` and
invalidate the narrow parent key rather than the router. The signed-in `user` in
the route context is not a Query: the route that saves it has the router load
again with `_authenticated` alone marked stale (`src/routes/CONTEXT.md`,
"Server-function bundles and mutations").

`use-action-mutation` wraps `useMutation` with the shared `Action` shape, success
toasts, and targeted invalidation. `use-action` covers non-form fire-and-forget
work. `use-hydrated` provides an SSR-safe client signal;
`use-page-visible` pauses sensitive polling while the page is hidden (focus is deliberately not part of it); `use-property-id` reads
Property route scope; `use-theme-mode` owns persisted theme state.

Four rules keep a cached page in step with the server it sends commands to.

- **A revision lives wherever the entity is cached.** A command result that
  advances a revision other commands are fenced on is written into every cached
  copy, not only the one the command was issued from. An Inbox item's command
  revision is in its detail and in its row in each cached list, and the bulk
  commands read the row: a note that advanced only the detail made the next bulk
  assign fail (`inbox/inbox-cache-policy.ts`, `advanceListRowFence`).
- **A write into a cached read leaves it as stale as it was.** `setQueryData`
  dates the read "just now" and clears a pending invalidation, and a read that is
  cached but not on screen is re-read only when it is shown again and only if it
  is stale. A write that is not followed by an invalidation therefore writes only
  the reads that hold the entity, passes `updatedAt` (the date the read already
  had) and marks an invalidated read invalidated again
  (`invalidateQueries` on the family's factory key, with a `predicate` for that
  one read and `refetchType: 'none'`). Otherwise one note made every cached Inbox
  queue look fresh, and a queue was shown without the item a status command had
  just moved into it (`advanceListRowFence`).
- **A refused command re-reads what it was refused about.** A refusal usually
  means the page is behind, and often nothing else will bring it forward (no
  poll, no refetch until the window is refocused). Give the mutation an
  `onError` that invalidates the entity it named, read from the command's own
  input because neither the Inbox pane nor a route is remounted when the entity
  on screen changes (`inboxCachePolicy.onReplyCommandFailed`,
  `onFeedbackHandlingFailed`, the responsible-managers saves of the Property
  people tab and the Portal editor), and re-read the list when a bulk command
  changed nothing. The refusal must outlive that read: a toast does, and a
  sentence held inside what the read replaces is gone with it. A confirmation
  drawn inside what it asks about therefore keeps the page as it was while it
  is open, and stays a confirmation: the Inbox pane shows the detail a reply
  confirmation was opened on until the dialog closes, when it shows the detail
  as read (`inbox/use-reply-confirmation-hold.ts`). The cache is re-read at
  once either way.
- **A draft kept across a refetch keeps the revision it was started from.** Save
  it with that revision, never the refetched one: the fence exists so a change
  the person has not seen is refused, and a kept draft has not seen the refetch
  (`features/responsible-managers/selection.ts`). A form that remounts on its
  version drops the draft instead, which is also sound.

Viewport breakpoints go through `useViewportBelow` (`useIsMobile`,
`useInboxCompactLayout`). It reads `matchMedia` in the browser, and on the
server, and during the hydration that must match it, it answers from the
request's viewport hint: the width the authenticated layout keeps in the
`rk_viewport` cookie, else a mobile user agent. A phone's first paint is then
already the phone layout. Do not add a `matchMedia` hook with a fixed server
answer. `useInboxCompactLayout` adds the room the app sidebar takes (256 px open,
48 px folded, none on a phone) to the Inbox's 1,022 px floor, so the three panes
need 1,278 px of window beside an open sidebar and 1,070 px beside the rail.

## Presentation

Use `src/components/ui/chart.tsx` for Recharts composition. Define a `ChartConfig`,
wrap the chart in `ChartContainer`, and use generated `--color-*` variables. Choose
bar, area, or pie geometry from the data relationship, not decoration.

A plain `<a>` or `Link` is a content link: `styles.css` gives it the accent ink as
a default in `@layer base`, so any utility on the anchor wins and nothing needs
an `!`. A link that belongs to a component with its own ink opts out by
`data-slot` (button, badge, sidebar entry, dropdown-menu-item, breadcrumb-link).
Navigation-like links (nav items, tabs, whole-row links) name their ink in
classes. `link-ink.test.ts` fails on an important modifier on colour or
decoration. What colour a link's classes actually resolve to, in both themes, is
read only by `e2e/storybook-metrics/link-ink.metrics.ts` (`pnpm
test:storybook:metrics`), because the Storybook Vitest runner compiles no
Tailwind. That spec is not wired into CI (see `playwright.storybook.config.ts`),
so a change to link ink, `@layer base` in `styles.css` or the sidebar entry
classes must run it by hand before merge.

Use `usePermissions()` for presentation affordances rather than threading
`canEdit` flags. These affordances never replace server authorization. Prefer one
cohesive component over one-caller fragments; extract only independently meaningful
UI or behavior.

## Page header and the way up

`PageHeader` has four slots with one job each: `title` (what the page is, or the
entity it is about), `meta` (where you are and what state it is in: the Property a
page is about, a count, a status Badge; each item is one fact and the header puts
the dot between them), `description` (one sentence of purpose, help text and nothing
else: no count, no name, no status, no filler such as "Monthly Goal Program") and
`actions` (what the page lets you do). A header that has no sentence of purpose
draws none. `header-sources.test.ts` fails on a dynamic `description`; the two pages
that print one say why.

A page goes up through its breadcrumbs, and there is no back link above them.
`trailCrumbs(under, where, current)` (`layout/page-identity.ts`) is the one place a
trail is spelled: every crumb above the page links, the Property's included (to its
Overview, on Overview too), a loaded page and its fallback draw the same trail, and a
place is named as the sidebar names it (`NAV_LABEL`, `layout/nav-labels.ts`), so the
trail says "Property settings" where the sidebar does and a Property's settings
section is the label of its nav row. A surface with no room for a trail (the
full-bleed workspace header, the Inbox's detail pane) and a step that returns to the
step before use the one back control: `BackLink` for an address, `BackButton` for a
step or a view (`ui/back-link.tsx`), a ghost small Button with the one arrow reading
"Back to <place>"; `iconBelow` draws the arrow alone on a narrow row and keeps the
words as the name, `flush` puts the arrow on the content edge, and a row with no room
for words at all (the Inbox's detail pane) is `BackIconButton`, the arrow with the
label as its name and tooltip. `PageState`'s way out is the same BackLink, and a way back is never
announced as the current page.

The page's own add is `AddAction` (a button) or `AddActionLink` (a router link),
`ui/add-action.tsx`: the default Button, the Plus before a sentence-case label, no
size or margin on the glyph. It sits in the header's `actions`; a card or a tab that
owns a list may carry its own (Add staff, Add link). A header's actions are
default-size Buttons directly in the slot, whose phone height is the Button's.
Portals alone repeats "New portal" in a fixed bar at the foot of a phone (round-4
board 11, `PortalPhoneNewPortalBar`): a primary action moves to a bottom bar only for
a list the person scrolls a long way, with the header's copy hidden below `sm`, and
everywhere else it stays in the header. Where a word means another scope in another
nav, the label carries the scope: a Property's settings sections are Property
profile, Google connection, AI features and Responsible managers, because the
account has a Profile and an AI overview and the sidebar a Staff and a Google of
their own.

## Action copy

One list of words for what every page repeats.

- **Case.** A label (a button, a menu item, a tab, a nav row, a dialog title, a
  crumb) is sentence case: the first word capitalised, the rest lower case, so a
  domain noun is a common noun in it ("Archive portal", "New group", "Back to
  properties", "Open in goals"). Google, a product role name (Account Admin, Property
  Manager) and something a person typed keep their capitals. In a button `&` joins two
  verbs ("Review & publish", "Confirm & publish"); a title or a sentence says "and".
  Help text and descriptions are prose and follow the glossary, not this list.
- **Save.** A page with one form saves it with `Save changes`. A page that holds
  several independent forms (Profile, Organization), and every group of a section that
  holds several (Property settings), names what each one saves, lower case after
  "Save": "Save profile", "Save organization", "Save timezone and format", "Save
  target", "Save reply language", "Save feature access". A form that runs a command
  names the command: "Update password", "Send invitation", "Create goal". The pending
  word is the verb in -ing ("Saving…").
- **Success.** What a Save saved is "<Thing> saved" ("Profile saved", "Responsible
  managers saved"); a command is its verb in the past tense ("Password updated",
  "Invitation sent", "Logo removed"). Say what changed: never "successfully".
- **Cancel, Keep, Close, Done.** Cancel leaves a dialog or a bounded task, before the
  primary. A destructive confirmation may name what is kept instead ("Keep property",
  "Keep invitation"): that is deliberate, it says what "no" leaves in place. Close
  dismisses a dialog that only informs (the Version dialog). Done ends a task that
  finished and left a receipt. A settings group has no Cancel: it has Reset.
- **Try again.** Every retry is "Try again" (`RegionError`, `PageState`,
  `LoadMoreButton`), and never "Retry". A control that runs one named action again
  says which: "Try saving again" (a draft), "Try this property again" (an import
  step), "Try publishing again", "Check Google again". A retry of a read presses
  through `useReadRetry`, which those three do for you: in a tab left open across a
  deploy the read can only be refused again, so the press loads the page afresh
  (`src/shared/CONTEXT.md`, Stale tabs). A retry of a save does not.
- **Clear.** One meaning: take the search and the filters off a list ("Clear filters",
  "Clear search and filters", "Clear search": `ClearFiltersButton`). Deselecting is
  "Clear selection". Nothing else says Clear.
- **Mark all read** on the page, in the popover and in a stack's menu; never "Mark all
  as read". **Dismiss** hides a notification; it is not Delete.
- **Add, New, Create, Invite, Import.** "New <thing>" starts an entity with a page or
  a life of its own (New portal, New group). "Add <thing>" puts a row or a part into
  a list in place (Add staff, Add link, Add language, Add portal to a group, Add a
  portal goal: a sheet on the page, since the New goal page is gone). "Create" is the
  confirm of a make form that is neither ("Create template"). "Invite" is for a person who has to accept;
  "Import from Google" brings records in from Google (the header and the sidebar's
  property menu say it so).
- **Remove, Delete, Archive, End, Disable, Cancel.** By what happens. Remove takes a
  thing out of a place and it can come back or still exists (a member, a language, a
  portal from a group, a property from the workspace for 30 days). Delete erases it
  (a link, an unsent draft). Archive retires what is kept for history (a portal, a
  group, a participation, a property). End closes what does not resume (the Google
  rating goal); a portal goal stops, the monthly one or one portal's, group's or the
  average's: it keeps its running month.
  Disable switches a public surface off and keeps it. Cancel as a verb withdraws
  something pending that never took effect ("Cancel invitation"). The menu item that
  opens a confirmation says the same verb as the confirmation's button.
- **On and off.** A feature turns "on" and "off" ("Turn on AI analysis", "Turn off AI
  features"). The AI data-use consent is the exception: its call to action is the
  versioned notice's own words, "Enable AI features", so that dialog says Enable and
  "Confirm & enable". The call to action names no property, however many the consent
  covers; the acknowledgement above it names every one, as a list under its sentence
  when there are several (`ConsentCheckbox` `listed`, which the checkbox's description
  reads as one comma-separated sentence), and the settings confirmation names its
  property in its description, as turning off does in its title.
- **Back** is "Back to <place>" (the back control above), the place being the
  sidebar's name for it in lower case ("Back to portals"). The Import page is "Import Google properties" in its title and
  trail; the actions that lead to it say "Import from Google".

## Verification

Keep behavior-focused unit tests and stories beside components. Verify forms across
success, tagged error, pending, and disabled states; verify query transitions and
cache preservation at observable boundaries. Use a running browser for layout,
hydration, keyboard, responsive, and visual behavior.

## Staff account manager surfaces (ADR 0076)

`features/staff/accounts/` holds Add staff, the Property roster provider and the
shared Rename, Resend and Remove controls. The provider requires an explicit
`staff.accounts` capability and reads `listStaffMembers` once per Property query
key; a nested overview reuses its parent. The route binds server functions through
StaffAccountFunctionsContext; components import only their types. No loader or shell starts a staff read
while the capability is off. Add uses the standard Dialog, field frames and
footer, keeps one operation id per draft row, checks the batch before sending,
and sends sequentially with independent retry states. Remove uses the destructive
ConfirmationDialog and says sign-in ends only when the roster confirms it.

The Portals overview's shared builder separates place Portals and people. A
Group with people starts folded; Other staff and the flat Staff section come
last. People always stay in name order, including Needs attention. Search opens
the matching section. Initials use OwnerDisc; the manager-only small-sample hint
uses ExplainTrigger with its touch target variant. Staff settings use SettingSwitchRow and default off.

## Staff home (ADR 0076)

`features/staff-home/` is the canonical personal Code and My results family,
shared by `/my` and the manager's My code. It receives its server functions
from the lazy route bundle. `StaffHome` owns the small Property/account bar,
the full-screen modal notice (`DialogContent presentation="screen"`, no dismissal before acknowledgement) and URL-backed bottom `Tabs` (`bottom` variant, 44px targets).
`StaffCode` draws only through `portal-qr.ts`, refreshes on focus and hides an
old symbol during refresh or refusal. `useScreenWakeLock` is best-effort and
releases pending locks when leaving Code.

Results use `SegmentedControl`, the `MetricStrip` `personal` variant for scans,
`GoalMeter` without pace and a plain colleague list in server order. Ratings
are cached under the server's returned `ratingsCutoff`; the browser never
works out a Property's day. Staff account actions reuse the password form
(`staff` omits its coaching) and the existing beta feedback dialog body through
staff-only endpoints. No guest address, download or link opens on this phone.
