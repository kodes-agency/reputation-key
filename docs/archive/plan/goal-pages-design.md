# Goal Pages — Design Plan

> Planning document for the **Goals** surface in rep-key. This file is the source
> of truth for the next (Design-mode) generation step. Edit it freely — every
> `[TODO]` / `[OPEN]` marker is a decision waiting on you.

**Intent.** Improve the design of the property **Goal pages** — the list, the
detail view, and the create flow — so they feel like a calm, scannable,
shipped-by-a-top-tier-team product surface rather than a spec table.

**Status:** draft v1 · **Owner:** you · **Handoff:** Design-mode responsive HTML prototype, then map back to the React/shadcn components.

---

## 1. What exists today

### Screens (5 routes under `/properties/$propertyId/goals`)

| Screen      | Route file            | Component                           |
| ----------- | --------------------- | ----------------------------------- |
| Goals list  | `…/goals/index.tsx`   | `GoalsListPage`                     |
| Goal detail | `…/goals/$goalId.tsx` | `GoalDetailPage`                    |
| New goal    | `…/goals/new.tsx`     | `GoalCreateForm` (+ fields/preview) |

### Component inventory (`src/components/features/property/goals/`)

- `goals-list-page.tsx` — page shell, toolbar, active/history views
- `goal-list-sections.tsx` — attention-grouped sections + history status filters
- `goal-list-row.tsx` — `GoalRow` + `GoalEmptyState`
- `goal-list-toolbar.tsx` — Active/History tabs, type filter links
- `goal-list-types.ts` — item types, comparators, sort priority
- `goal-detail-page.tsx` — progress card + settings grid + cancel + instances
- `goal-detail-parts.tsx` — `SummaryMetric`, `Detail`, `CancelGoalDialog`
- `goal-progress-track.tsx` — **linear** bar with expected-pace marker (token-themed)
- `goal-create-form.tsx` / `-fields.tsx` / `-preview.tsx` / `-schedule-section.tsx` / `-track-section.tsx` / `-tiles.tsx` / `goal-entity-picker.tsx`
- `instance-history-table.tsx` — recurring-template instances

### Second progress component (flag)

- `src/components/goals/goal-progress-ring.tsx` — **circular** ring with expected notch.
  Uses **raw Tailwind colors** (`stroke-green-500` / `amber` / `blue` / `gray-400`),
  bypassing the app's semantic tokens, and lives in a _different_ folder than the
  rest of the goal UI. `→` [OPEN: which is canonical?](#open-questions)

### Domain facts (from code + ADR `0020-progress-only-goal-model`)

- **Goal types:** `one_shot` · `recurring` · `rolling` · `open`
- **Statuses:** `active` · `completed` · `expired` · `cancelled`
- **Attention buckets:** `needs-attention` · `on-track` · `other`
- **Progress is computed**, not entered: a goal measures a `metricKey` +
  `aggregationFunction` against a `targetValue`. No manual check-ins.
- Pace is derived from period elapsed vs. target (`expectedPercent`, pace label).
- Entity scope: `property` or entity-level (guest/portal).

---

## 2. Observed design issues (grounded)

1. **Two progress viz, inconsistent theming.** Linear track uses semantic tokens
   (`bg-primary` / `bg-destructive` / `bg-muted-foreground`); the ring uses hardcoded
   Tailwind colors and sits outside the feature folder. Pick one canonical component;
   theme it with tokens; retire or relocate the other.
2. **Detail page reads like a spec sheet.** The "Goal settings" block is an 8-cell
   bordered grid (Scope/Type/Measured as/Metric/Aggregation/Target/Timeframe/Status…).
   It competes for weight with the progress hero and pushes the page long.
3. **Cancel gets too much stage.** A full-width destructive-bordered "Cancel this
   goal" section sits at peer level with Progress. Cancel is rare + destructive — it
   belongs in an overflow/menu, not a prominent card.
4. **No edit affordance.** Goals can be created and cancelled, never edited.
   Likely intentional (immutable target under a progress-only model) — **confirm**.
5. **List summary is plain text.** `"12 active · 3 need attention · 7 on track · 2 other"`
   is informative but flat; could become quiet stat chips — or stay text per
   restraint. [OPEN]
6. **"Other active goals" bucket is fuzzy.** Open/rolling/recurring goals without a
   time-pace land here; the label doesn't tell the user _why_ they're separate.
7. **Create→detail fidelity.** The create live-preview should match the real detail
   page's progress presentation 1:1; verify it does after we lock the canonical viz.

---

## 3. Proposed direction

**Posture:** calm, dense-but-quiet, product-utility (matches Neutral Modern +
the app's existing shadcn system). One accent (`primary`) for progress/on-track;
`destructive` reserved strictly for _needs-attention_ state and the cancel confirm.

**Per screen:**

- **List** — keep the attention-grouped IA (it's good). Tighten the summary into a
  quiet stat row; make rows scannable with the canonical progress viz + pace label.
  Sharpen "Other active goals" copy/identity.
- **Detail** — make **Progress the hero**. Demote settings into a quieter 2-column
  readout (or a `<details>` disclosure). Move Cancel into a header overflow menu.
  Give recurring instance history a clearer "pace over time" framing.
- **Create** — keep the two-column form + live preview (already strong). Align the
  preview to the locked detail presentation.
- **Progress viz** — decide linear-vs-ring (see open questions), then make it the
  single canonical component used in row, detail hero, and create preview.

---

## 4. Visual system notes

- **Exploratory prototype** will lean on the **Neutral Modern** active design system
  (cobalt `#2F6FEB` accent, Inter, `#FAFAFA` canvas, 8/12px radii, one accent/screen).
- **Implementation** maps back to the app's real shadcn/Tailwind tokens
  (`primary`, `destructive`, `muted-foreground`, `border`, `bg-muted`).
  Neutral Modern and the app tokens are aesthetically aligned, so the mapping is 1:1
  in spirit — confirm we prototype in Neutral Modern for exploration. [OPEN]

---

## 5. Screen-by-screen plan (Design mode)

> Filled after the open questions below are answered. Each becomes its own HTML
> screen file per the screen-file-first rule; `index.html` is a launcher only.

- [ ] **`goals-list.html`** — Active/History, attention sections, rows, empty states, responsive (360 → 1920)
- [ ] **`goal-detail.html`** — progress hero, settings readout, instance history, cancel-in-overflow
- [ ] **`goal-create.html`** — two-column form + faithful live preview
- [ ] **`index.html`** — launcher linking the three screens + design notes
- [ ] Canonical progress component spec (linear vs ring decision applied everywhere)

---

## 6. Open questions

> Please answer inline (edit this doc) or via the plan-brief form. These gate the
> Design-mode build.

- **[OPEN-A] Scope** — which screens? list / detail / create / all three?
- **[OPEN-B] Goal of this pass** — visual polish of the current look, a UX/IA rework, or both?
- **[OPEN-C] Progress visualization** — keep the **linear track** as canonical, elevate the **circular ring**, or use both contextually (ring in detail hero, track in rows)?
- **[OPEN-D] Editing goals** — in scope (implies backend work) or out of scope (targets stay immutable)?
- **[OPEN-E] Visual system for the prototype** — explore in **Neutral Modern** then map to app tokens, or prototype directly in the app's real shadcn tokens?
- **[OPEN-F] Driving input** — any known user feedback, analytics, or pain points behind this request?
- **[OPEN-G] Stakeholders / timeline / fidelity** — who reviews, any deadline, is high-fidelity right?

---

## 7. Risks & constraints

- Progress-only domain model: don't propose manual value entry without a backend plan.
- Don't break the existing route/search-param contract (`view`, `historyStatus`, `goalType`) unless intentional.
- Keep accessibility: progressbars already expose `aria-valuenow/min/max/text` — preserve.
- Restraint: one accent per screen; destructive only for needs-attention + cancel.

---

## 8. Deliverable & handoff

1. **This doc** reviewed + open questions answered.
2. **Design mode** → responsive HTML prototype (screen files + launcher).
3. **Implementation** → map prototype back to the React/shadcn goal components.

---

## 9. Next step

1. Read this doc and edit anything that's off.
2. Answer the **[OPEN-A…G]** questions (inline or the plan-brief form).
3. Say "go" (or "build the prototype") and I'll generate the goal-pages prototype in Design mode, starting from the locked direction.
