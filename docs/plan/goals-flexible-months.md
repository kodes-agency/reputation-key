# Flexible goal months (option B): implementation plan

Date: 2026-10-11. Status: approved direction, being built slice by slice. The plan was written from four code maps and three reviews (data integrity, product honesty, delivery) against a clean checkout of `main` at `0ab0c4427`. Paths are relative to the repository root. Line numbers refer to that revision and shift after Slice 0.

## What changes and why

Goals are monthly Goal Programs. Counting and month closing are sound and stay as they are. The rules for setting and changing a goal were written for fixed, audited targets and get in a manager's way:

- **R1.** A goal always started on the first full month after it was created.
- **R2.** A goal that had not started could not be changed; a change applied only from the next full month; only one change could wait.
- **R3.** Every change needed a written reason.
- **R4.** One target per goal, shared by every subject on it.

Owner decisions (2026-10-11):

- **D1. Start this month.** A new goal counts for the current calendar month when it is created on or before the 20th local day (the default), otherwise it starts next month. The creator can pick the other option. The UI always shows when the goal was set.
- **D2. The month carries its own target.** While a month is running, a manager can change that month's target. The change is shown ("changed on Oct 20, started at 400") and logged with who, when, old and new value and an optional note. Once the period ends the target is locked; closed months stay immutable. By default the new target also applies to the following months.
- **D3. The reason is optional**, and a goal that has not started can be edited.
- **D4. Per-portal goals are separate goals.** There are no per-subject targets inside one goal and no property total that portals share. A table sets goals for several portals at once, one goal each.
- **D5. Out of scope:** any Google-rating feature, a redesigned monitoring page, import-wizard changes, drafted goals, new measures, person or team goals.
- **D6.** Technical safeguards stay (constraints, tenant scoping, tests). Docs that state a changed rule are amended in the same change. Existing goals and closed months keep working unchanged. Migrations are additive and safe while old web or worker code still runs.

Aliases: **UC** `src/contexts/reporting/application/use-cases/goal-programs.ts` · **REPO** `src/contexts/reporting/infrastructure/repositories/goal-program.repository.ts` · **DOM** `src/contexts/reporting/domain/goal-program.ts` · **PR-RANGE** `src/shared/domain/period-range.ts` · **DTO** `src/contexts/reporting/application/dto/goal-program.dto.ts` · **SRV** `src/contexts/reporting/server/goal-programs.ts` · **PROG** `src/contexts/reporting/application/use-cases/goal-progress.ts` · **G/** `src/routes/_authenticated/properties/$propertyId/goals/` · **C/** `src/components/` · **UCT / RT** the unit and integration suites beside UC and REPO.

## Terms used below

- **Rowless head**: the Program's head version has no monthly result rows.
- **Never started**: `program.status === 'scheduled' && results.length === 0`. This replaces the old test `version.effectiveFrom > now`, which misreads a scheduled goal whose start has passed but which maintenance has not activated yet (or whose source is inactive).
- **Pending head**: a started Program whose head is rowless after the catch-up step (Slice 2).
- **Running month**: a result row with `status = 'open'` and `period_start <= now < period_end`.
- **Effective month target**: `row.targetValue ?? version.targetValue`.

## Design decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a   | **Start this month = version and assignments take `effectiveFrom` = the chosen local month's start, and create opens that month's row.** No schema change. The DTO carries the month itself, `startMonth: 'YYYY-MM'` (optional). The server accepts only the current or the next Property-local month and otherwise answers `start_month_changed`. Omitted keeps today's behaviour (`firstFullMonthlyPeriodAtOrAfter(now)`).                                             | The active-with-open-row shape already exists (`create`, UC:716-721). A month key cannot drift when a form or a bulk save crosses local midnight; a relative word can. Omitted = next month keeps old clients and the existing e2e valid. |
| a′  | Keep `period.start > now → scheduled` (repeated-midnight hour on day 1).                                                                                                                                                                                                                                                                                                                                                                                                 | DOM:147-155 already pins it.                                                                                                                                                                                                              |
| b   | **Nullable `goal_monthly_results.target_value numeric(30, 10)`; NULL means "use the version's target".** Each change is logged in `goal_month_target_changes`.                                                                                                                                                                                                                                                                                                           | A version cannot be split mid-month, and updating a version's target would retarget its closed months. The row is frozen by trigger once closed, so it is the durable carrier.                                                            |
| b′  | The guard trigger enforces the lock (only while `open` and before `period_end` on the database clock) and the per-measure target rule. The command filters with the injected clock.                                                                                                                                                                                                                                                                                      | D6. The trigger already joins the row's version (db-constructs.sql:896-917), so the measure is at hand.                                                                                                                                   |
| c   | **"Also from next month" is part of the same transaction as the month change.** The use case decides the following outcome before any write; the repository writes rows, log and (when needed) the new version together.                                                                                                                                                                                                                                                 | Two transactions left a log claiming something that then failed.                                                                                                                                                                          |
| c′  | The log stores the outcome, not the tick: `following_outcome` in `applied`, `replaced_scheduled_change`, `kept_scheduled_change`, `not_applied`, `not_requested`, plus `following_reason` and `following_version_id`.                                                                                                                                                                                                                                                    | The log is shown and exported; it must be true.                                                                                                                                                                                           |
| d   | **A rowless head is edited by superseding it.** The superseded version and its assignments are closed as an empty window `[from, from)`. The new start is recomputed, never copied: never started → `firstFullMonthlyPeriodAtOrAfter(head.effectiveFrom, currentTimezone)`; pending head → `firstFullMonthlyPeriodAtOrAfter(max(head.effectiveFrom, earliestRevisionStart(results, now)), currentTimezone)`. Name and description are edited in place with an audit row. | Keeps history, reuses the `currentVersion` compare-and-set, stays right after a time-zone change, and an empty window can never violate the effective checks or hold a subject.                                                           |
| d′  | **A never-started goal cannot change its start month by editing.** End it and create it again; its empty window frees the subject at once.                                                                                                                                                                                                                                                                                                                               | This removes the "scheduled but already started" activation path the review found. D3 lists target, name and subjects only.                                                                                                               |
| d″  | **Commands catch up first.** `revise`, `changeAssignments` and `changeMonthTarget` call the existing `appendDueResults` for an active Program and re-read.                                                                                                                                                                                                                                                                                                               | Found while checking: `appendDueResults` reads only the head (UC:563-585), so a revision made after a month begins but before the hourly job opens its row drops that month today. The rowless-head test needs this closed.               |
| e   | **Reason becomes an optional note in zod** (`max(500)`). Versions keep NOT NULL `change_reason` and default to code strings (`revised`, `subjects_changed`, `target_changed`), as `created` and `revised` already do. `goal_programs.status_reason` is written NULL when no note is given.                                                                                                                                                                               | No migration. Code strings already appear in the export today. `status_reason` is rendered on the goal page (`G/$goalId.tsx:199-203`), so a default there would surface.                                                                  |
| f   | **Bulk save = one goal per filled row, sequential, each its own transaction, per-row outcome.** The start month is resolved once for the whole save.                                                                                                                                                                                                                                                                                                                     | D4; precedent `GoalAssignmentChangeResult.outcomes`.                                                                                                                                                                                      |
| g   | **A refactor-only PR first.** UC is 1,345 lines and REPO 1,058; both sit at their baselines.                                                                                                                                                                                                                                                                                                                                                                             | One added line fails the file-length gate.                                                                                                                                                                                                |
| h   | **Honesty rests on evaluation reading the effective month target**, and on every surface that shows a target also showing "set on" and "changed on, started at N". The two Goal notices gain one marker read from the database at delivery time.                                                                                                                                                                                                                         | The feed consumer already looks facts up at delivery (`monthly-result-notification-facts.lookup.ts:22-107`), so no outbox event changes.                                                                                                  |
| i   | **"Subject is held" uses one rule everywhere:** an assignment holds its subject from `:from` when `effective_to IS NULL OR (effective_to > :from AND effective_to > effective_from)`.                                                                                                                                                                                                                                                                                    | The current predicate (REPO:643-646) counts empty windows, which the exclusion constraint does not.                                                                                                                                       |

Ending a started goal still holds its subject until the open month ends (REPO:440-446). A same-month replacement is refused with `subject_has_goal`; the route for "wrong number this month" is D2.

## Working rules for every slice

- **One linear stack:** PR 1 → 2 → 3 → 4 → 5 → 6, each rebased onto the previous once it lands. No parallel worktrees for these slices.
- **Integration tests:** from Slice 3a on, set `TEST_DATABASE_URL=postgresql://test:test@localhost:5432/test_rk_goals_b`. Without it the run drops the scratch database other sessions share (`src/shared/testing/test-db-setup.ts:322,346-354`). New repository suites use `holdTransaction` (`src/shared/db/testing/held-transaction.ts`), because result rows cannot be deleted.
- **Per-PR gates:** Fallow audit, file-length ratchet (lower entries, never raise), changed-code, `pnpm test:unit` including the `*-sources` tests under `src/components/forms` and `src/components/ui`, and for UI slices a production build plus `pnpm check:bundles` on the rebased head.
- **Bundle:** the budget is 310,300 B and the last recorded measurement left about 584 B. Take the lower value on stacked rebases. Any raise needs main and branch measurements in the dated note.
- **Deploy order is fixed by the pipeline:** web (migrations run in its predeploy), then worker (`scripts/ops/deploy-ci-images.ts:20-36`). Every slice has a window with new web and old worker, never the reverse.

## Slice 0 — split the two baseline files (no behaviour change)

**Files (new, under `src/contexts/reporting/application/use-cases/`):**

- `goal-program-shared.ts` (leaf, imports no sibling): `GoalProgramError`, `assignmentFor`, `metricSubject`, `openResultFor`, `dueMonthlyPeriods`, `openResultsForPeriods`, `resolveGoalDefinition`, `isMetricSourceInactive`, `earliestRevisionStart`.
- `goal-program-maintenance.ts`: `activateScheduledProgram`, `appendDueResults`, `maintainProgram`, `reconcileResult`, `reconcileClosedResult`, `maintain`, and `GoalProgramMaintenanceError` (defined here, because `maintain` throws it and UC composes this module).
- `goal-program-assignment-changes.ts`: `changeAssignments`.
- UC keeps `create`, `get`, `list`, `revise`, `changeStatus`, composes `createGoalProgramService`, and re-exports both error classes so existing imports and tests stay unmodified.

**Files (new, under `src/contexts/reporting/infrastructure/repositories/`):**

- `goal-program.rows.ts` (leaf): `mapProgram`, `mapVersion`, `mapAssignment`, `mapResult`, `mapResultRevision`, the `*Values` builders, `hasPostgresErrorCode`, `GoalProgramRevisionConflict`. Both repository modules import it; neither imports the other's helpers.
- `goal-monthly-result.repository.ts`: result reads and writes (REPO:700-1058), composed behind the same port.
- In REPO, extract the body of `revise` into `reviseInTx(tx, input)` with no behaviour change. Slices 2 and 3b reuse it.

**Other edits:** move the `.fallowrc.json:84-87` `ignoreExports` entry to `goal-program-maintenance.ts`. Import the shared `metricSubject` in PROG. Update the two `hydrateBundles` / `listDueResults` entries in `src/shared/architecture/tenant-predicate-exemptions.ts:50-62` if their file changes.

**Tests first:** one composition test that runtime-imports the composed service and asserts the same method set. The changed-code gate counts modules imported by a directly tested module, so one is enough. UCT and RT pass unmodified.

**Gates:** file length (both entries drop), Fallow (duplicates, `circular-dependencies` is an error), tenant-predicate canary, changed-code. Run the Fallow audit on this branch before stacking on it.

**Deploy:** nothing to watch.

## Slice 1 — D1: start this month

**Domain**

- PR-RANGE: export `localDayOfMonth(date, timezone)` (wraps the private `wallClockAt`). The month key is `dayKeyInTimezone(date, timezone).slice(0, 7)`.
- DOM: `GOAL_CURRENT_MONTH_CUTOFF_DAY = 20`.
- DOM: `goalStartOptions(now, timezone)` → `{ current: { monthKey, period }, next: { monthKey, period } }`.
- DOM: `defaultGoalStartMonth(now, timezone)` (local day ≤ 20 → current).
- DOM: `resolveGoalStart(now, timezone, startMonth?)` → a period, or `start_month_changed` when the key is neither option. Omitted → `firstFullMonthlyPeriodAtOrAfter(now, timezone)`.
- Re-export the three helpers from DTO. Routes may import application, not domain (`.fallowrc.json:539-546`).

**Use case, repository, server**

- Split `create` into authorise + resolve + `createGoalCore(deps, input, actor, { now, period })`. Slice 4 reuses the core.
- Status stays `sourceInactive || period.start > now ? 'scheduled' : 'active'`. For a scheduled next-month start, `statusReason` stays `awaiting_first_full_month`.
- Before insert, call `findAssignmentConflicts` with `excludeProgramId` optional and the predicate from decision i. It returns `{ subject, programId, effectiveTo }`; the existing caller (UC:979) keeps reading the subject. A conflict throws `subject_has_goal`.
- `REPO.create` catches 23P01 and reports the same conflict. SRV maps `subject_has_goal` and `start_month_changed` to 409.
- New pure helper `subjectHolds(bundles, metric, from)` in application (same rule as decision i). On `subject_has_goal` the form derives "which goal, until when" from the cached goal list, so no new error transport is needed.
- New pure helper `goalTargetProvenance(bundle, version)` → `{ setAt, setBy, countsFrom }`. It walks back through versions while measure and target are unchanged and takes the oldest of that run. `countsFrom` is the first month with a result, else the first version's start.
- PROG: `setAt` and `setBy` come from `goalTargetProvenance`. Ignore empty assignments (`effectiveTo > effectiveFrom`) at PROG:123-131.
- New read `getGoalProgramProgress({ propertyId, programId })` (`goal.read`): month to date per current subject of one goal, reusing `progressOf`. It returns nothing when the goal has more than 25 current subjects. New `goalKeys.programProgress` member and ledger entry.
- New read `previewGoalMonth({ propertyId, metric, subject })` (`goal.create`): one governed read for the current month, used only by the single-goal form.
- Notices: the facts lookup adds `setDuringMonth` (`version.created_at > result.period_start`). The feed payload gains optional `goalMarker: 'set_in_month' | 'target_changed'`. Both goal templates and the Recent Activity row (`activity-outbox-consumers.ts:494-508`) add one clause: "The goal was set on Oct 20."

**UI**

- `G/new.tsx`: the route loader (isomorphic, no new server function) computes `goalStartOptions` and the default once. A `RadioGroup` in `<fieldset><legend>` (precedent `portal-new-start-from-field.tsx:39-64`) submits the month key. On `start_month_changed` the form reloads the options and says so.
- `G/new.tsx`, one subject and the current month chosen: "So far this month: 412".
- `G/$goalId.tsx:192-195`: replace "Effective from" with "Counts from {countsFrom} · set on {setAt}". Scheduled: "Starts on {date}". Replace the `awaiting_first_full_month` label at :274 with "Starts on {date}"; do not remove it, or the raw code shows. Replace the copy at :215-216.
- `G/$goalId.tsx` month rows: the running month shows "412 so far". A month whose version was created after the month began shows "Set on Oct 20".
- `G/index.tsx`, `portal-group-goal-view.ts`, `goal-results-matrix.ts:229-235` and `goal-results-matrix.tsx:129-144`: add "set on" from `targetProvenance`; the matrix keeps "Effective {date}".
- Dates use `formatMonthDay`, and `formatDate` (with the year) when the date is not in the current year.

**Tests first**

- DOM unit: `defaults to this month on local day 20 and to next month on day 21`; `uses the Property time zone, not UTC, for the day`; `a month key that is neither the current nor the next local month is refused`; `this month on a repeated-midnight first hour stays scheduled`.
- UCT: `create for the current month on 15 Mar is active with an open March row`; `create without a start month keeps the next-month schedule`; `the current month with an inactive source is scheduled and opens March on activation`; `create refuses a subject that already has a live goal for the metric`; `a form opened on the last day and submitted after midnight is refused, not moved`; `a quarantined source refuses creation with metric_unavailable`.
- RT (integration): `a goal cancelled before its start does not block a this-month goal for the same subject and metric`; `a same-month replacement after ending a started goal returns a conflict, not a 500`.
- Application unit: `set on survives a subjects-only change`; `counts from is the first month with a result`.
- Feed unit: `the goal-met notice says when a goal was set during its month`.
- e2e: new journey `a Portal goal set mid-month shows this month's count`, subject kind Portal, with a Portal created per attempt (as `softDeleteFixturePortals('e2e-rotating-')` does at spec :94-98). Every existing `createGoalProgram` call (spec :686-700, :883-895, :949, :965) passes next month's key explicitly. No e2e asserts the default selection.
- Update `portal-group-goal-view.test.ts` and `portal-group-page.stories.tsx:156-159`.

**Docs:** amend `docs/adr/0046-notification-policy.md:421-424` (the Goal notices may carry one marker). CONTEXT invariant 2 gets the "starts in the current local month or the next one" sentence.

**Gates:** storybook copy assertions, product-state ledger (two new keys), bundle (measure).

**Deploy:** no schema. The old worker handles an active goal with an open row (today's day-1 shape) and ignores the unknown payload field.

**Risks**

- Readiness now reads real month-to-date facts, so a quarantined source refuses creation with `metric_unavailable`. Map it to plain copy.
- The metric definition version must cover the month start. Add a UCT case; if it does not, refuse the current month with copy that offers next month.

## Slice 2 — D3: optional note, edit before start, rename

**DTO, use case, repository**

- `goalProgramReasonSchema` becomes `z.string().trim().max(500).optional()`. Remove `invalid_reason` from the union (UC:112), the SRV switch (:68) and UCT:875.
- `changeStatus`: no note → `status_reason` NULL and no `reason` in the audit details.
- `revise` and `changeAssignments`: no note → `'revised'` / `'subjects_changed'` in `change_reason`.
- Catch-up step (decision d″) at the top of `revise` and `changeAssignments`.
- Remove the guards at UC:795-797 and UC:915-917. Classify the head as never started, pending or in force, and compute the start per decision d.
- `revise` pre-checks `findAssignmentConflicts` (excluding its own Program) and throws `subject_has_goal`. A 23P01 stays the `revision_conflict` backstop.
- `reviseInTx` takes `supersedeRowlessHead: boolean`. When true it asserts, after the Program row lock, that no monthly row references the expected version (else conflict). It then closes that version and its assignments with `effective_to = effective_from`.
- `revise` accepts an optional `expectedVersion`; the dialog starts sending it.
- New sibling `goal-program-details.ts` with `rename` (`goal.update`): one tenant-scoped UPDATE of `name`, `description`, `updated_at`, plus audit row `goal.program.renamed`.
- `changeStatus` catches `GoalProgramRevisionConflict` (REPO:426, 474) so it surfaces as 409.
- Version lists in the UI filter empty windows.

**UI**

- `GoalChangeReasonField` (`goal-program-fields.tsx:58`): `<FormTextarea optional label="Note" />`. The "(optional)" suffix fails `form-actions-sources.test.ts:101-116`; the shared `optional` marker exists (`form-text-field.tsx:36`, `form-textarea.tsx:41`).
- Revision dialog description: "Applies from {date}." Assignments dialog: "Changes apply from {date}." The date comes from a shared pure `nextRevisionStart(bundle, now, timezone)` in application, the same function the use case calls.
- Receipt: "Change saved. Applies from {date} ({timezone})."
- Never-started goal page: one line, "To change the start month, end this goal and set it again."
- "Edit name" on the goal page.
- `statusReasonLabel`: known system codes map to sentences; user notes render verbatim; nothing renders when NULL.
- Map error codes to sentences in the `use-action-mutation` callers, so users no longer read "revision_conflict".

**Tests first**

- UCT: rewrite :893-947 as `revising a goal that has not started replaces the pending version and keeps its start month`; `a second pending change supersedes the first`; `a scheduled goal whose start has passed is still edited as never started`; `revise right after a month begins opens that month first and starts the revision next month`; `revise without a note stores the default reason`; `a status change without a note stores no status reason`; `rename changes name only and leaves the version untouched`; `a supersede after a time-zone change starts at a real local month start`.
- RT: `superseding a rowless head leaves an empty version window and no overlap`; `a superseded assignment does not block another goal for that subject`; `activation after a supersede activates the new head`; `a stale activation after a supersede changes nothing` (REPO.activate compares `currentVersion`, :673-675); `maintenance activates a program whose history holds an empty version`.
- PROG: `the card shows the superseding target, not the empty one`.
- Stories and pinned copy to update:
  - `goal-program-revision-dialog.stories.tsx:101,105,126,148,166`
  - `goal-program-assignments-dialog.stories.tsx` (:15 comment, :96)
  - `goal-program-assignments-dialog.tsx:27,96`
  - `goal-assignment-outcomes.test.ts:1`
  - `goal-revision-start.test.ts:19`
  - `src/components/ui/dialog.stories.tsx:164`
  - `goal-program.repository.test.ts`

**Docs:** CONTEXT invariant 2 (replace and empty-window sentences), comment at `C/goals/goal-revision-start.ts:8-10`.

**Deploy:** no schema. Window checked: an old worker reads the head for activation and append (UC:499-585) and reconciles only rows past their period end, so empty versions and a new head are safe.

## Slice 3a — D2 expand: storage and readers (no command yet)

**Migration `drizzle/0054_goal_month_target.sql`.** Hand-written and hand-appended: no `drizzle-kit generate`, never `pnpm db:baseline`. Journal entry `idx 54`, `tag 0054_goal_month_target`, `when 1793500000000`. The journal runs ahead of the wall clock (entry 53 is `1793400000000`), and drizzle skips an entry whose `when` is not above the last applied one. On every rebase, `idx`, `tag` and `when` must all be strictly above main's last entry.

```sql
-- Purely additive. Old web and worker code never reads or writes these.
ALTER TABLE "goal_monthly_results" ADD COLUMN "target_value" numeric(30, 10);
--> statement-breakpoint
ALTER TABLE "goal_monthly_results" ADD CONSTRAINT "goal_monthly_results_target_value_check"
  CHECK ("goal_monthly_results"."target_value" IS NULL OR "goal_monthly_results"."target_value" > 0);
--> statement-breakpoint
CREATE TABLE "goal_month_target_changes" (
  "id" uuid PRIMARY KEY NOT NULL,
  "organization_id" varchar(255) NOT NULL,
  "property_id" uuid NOT NULL,
  "program_id" uuid NOT NULL,
  "monthly_result_id" uuid NOT NULL,
  "change_id" uuid NOT NULL,                       -- one command, one id, N rows
  "previous_target_value" numeric(30, 10) NOT NULL,
  "new_target_value" numeric(30, 10) NOT NULL,
  "following_outcome" varchar(32) NOT NULL,
  "following_reason" varchar(40),
  "following_version_id" uuid,
  "note" text,
  "created_by" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "goal_month_target_changes_outcome_check" CHECK ("goal_month_target_changes"."following_outcome"
    IN ('applied', 'replaced_scheduled_change', 'kept_scheduled_change', 'not_applied', 'not_requested')),
  CONSTRAINT "goal_month_target_changes_note_check" CHECK ("goal_month_target_changes"."note" IS NULL
    OR char_length(btrim("goal_month_target_changes"."note")) BETWEEN 1 AND 500),
  CONSTRAINT "goal_month_target_changes_value_check" CHECK ("goal_month_target_changes"."new_target_value" > 0
    AND "goal_month_target_changes"."new_target_value" <> "goal_month_target_changes"."previous_target_value")
);
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_result_fk"
  FOREIGN KEY ("organization_id","property_id","monthly_result_id")
  REFERENCES "public"."goal_monthly_results"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_program_fk"
  FOREIGN KEY ("organization_id","property_id","program_id")
  REFERENCES "public"."goal_programs"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "goal_month_target_changes" ADD CONSTRAINT "goal_month_target_changes_following_version_fk"
  FOREIGN KEY ("organization_id","property_id","following_version_id")
  REFERENCES "public"."goal_program_versions"("organization_id","property_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "goal_month_target_changes_program_idx"
  ON "goal_month_target_changes" USING btree ("organization_id","property_id","program_id","created_at");
--> statement-breakpoint
-- CREATE OR REPLACE guard_goal_monthly_result_v1 with three additions:
--  1. DECLARE version_metric varchar(40); add version."metric_key" to the existing SELECT ... INTO.
--  2. After the closed-row check:
--       IF TG_OP = 'UPDATE' AND NEW."target_value" IS DISTINCT FROM OLD."target_value"
--          AND (OLD."status" <> 'open' OR clock_timestamp() >= OLD."period_end") THEN
--         RAISE EXCEPTION 'goal monthly result target is locked once its period ends' USING ERRCODE = '55000';
--       END IF;
--  3. After the version lookup:
--       IF NEW."target_value" IS NOT NULL AND NOT (
--         (version_metric IN ('qualified_scans','portal_rating_count')
--            AND NEW."target_value" > 0 AND NEW."target_value" = trunc(NEW."target_value"))
--         OR (version_metric = 'portal_rating_average'
--            AND NEW."target_value" BETWEEN 1 AND 5 AND NEW."target_value" * 10 = trunc(NEW."target_value" * 10))
--       ) THEN RAISE EXCEPTION 'goal monthly result target breaks its measure rule' USING ERRCODE = '23514'; END IF;
```

Restate the same function in `src/shared/db/db-constructs.sql` and copy that file to `drizzle/0001_db_constructs.sql` by file copy. No guard trigger on the log table: it would need a `PURGE_GUARDS` bypass, and the log records a pre-close value, not closed evidence.

**Code**

- `goal.schema.ts`: the column and all numeric log columns as `{ precision: 30, scale: 10, mode: 'number' }`; the table; exports.
- Port type `GoalMonthlyResult.targetValue: number | null`; `mapResult`; `resultValues` inserts NULL; test fakes.
- New pure `effectiveMonthTarget(result, version)` in application. `reconcileResult` (UC:1151-1155) and `reconcileClosedResult` (UC:1228-1232) evaluate with it.
- Both behind-pace adapters use `coalesce(result.target_value, version.target_value)` (`attention-signals.adapter.ts:73`, `fleet-overview-projection.adapter.ts:519-520`).
- Export adapter: add the column to `MONTHLY_RESULT_COLUMNS` and its SELECT; add a `monthTargetChanges` collection.
- Lifecycle adapter: `goal_month_target_changes` goes first in `GOAL_PURGE_TABLES` (before `goal_result_revisions`), and into `countTenantRows`.
- `src/shared/governance/data-fate-authority.ts:229-236`: add `goalMonthTargetChanges` as `recoverable_archive`. This row is what puts the table under the tenant-predicate canary.

**Tests first**

- New `src/shared/db/schema/goal-month-target-migration-parity.test.ts` (shape of `portal-media-migration-parity.test.ts`): pins the tag, `entry.when > previous.when`, and that 0054 and `db-constructs.sql` both contain the lock clause.
- UCT: `a month with its own target is judged against it, not the version's`; `a row with its own target closes against it`; `a closed-month correction keeps using the month's own target`; `a month without its own target uses the version's`.
- RT (integration, private database, held transaction): `the guard refuses a target change after the period end` (an open row for a past month); `the guard refuses a target change on a reconciling row`; `a closed row's target cannot change`; `the guard refuses 400.5 scans and an average of 7`; `the guard accepts a change on the real current month`.
- `goal-governance-constraints.test.ts`: FK and CHECK cases for the new table.
- Export and lifecycle adapter tests: new column and collection; purge order.

**Gates:** verify on the private scratch database with the CI sequence (`db:migrate`, `db:migrate-deploy`, `check:schema-drift`); db-constructs parity (`src/shared/db/CONTEXT.md:27,54-57`); tenant-predicate canary; file length.

**Deploy:** web (migration in predeploy), then worker. Old code is unaffected: Drizzle emits explicit column lists from its own model, and `updateResult` (REPO:856-870) never writes `target_value`, so the new guard clause cannot fire for it.

**Risk:** the function in `0001` names a column that 0054 adds. PL/pgSQL binds at execution and no migration between them writes `goal_monthly_results`; the from-scratch migration test confirms it. Fallback: keep the function change in 0054 and `db-constructs.sql` only, if the repo's parity check allows.

**As built, after review.** The migration differs from the sketch above in five ways; the file and its parity test are the authority.

- **Statement order.** The log table and its Program reference come first, then the version key and reference, and only then the column on `goal_monthly_results`. The file runs in one transaction and goal writes lock Programs, versions, then months, so the migration takes its locks in that order.
- **A log row's month and following version belong to its Program.** Both foreign keys include `program_id` (`organization_id, property_id, program_id, id`). `goal_monthly_results` and `goal_program_versions` each gain the unique index `…_target_change_fk_key` those references need. The Program foreign key stays.
- **One row per month per command:** `UNIQUE (change_id, monthly_result_id)`.
- **The lock also covers INSERT.** A new row may bring a target only while it is `open` and its period has not ended. So `target_value IS NOT NULL` always means "set while the month ran". A test fixture that needs an ended or closed month with its own target seeds it with `seedLockedMonthTarget` (`src/contexts/reporting/infrastructure/testing/goal-month-target-seed.ts`).
- **Export.** `target_value` is the last column of `goal/results.csv`, after the change-log columns, so every column the file already had keeps its position. The payload version stays `goal-organization-export/v1`: the change only adds.

## Slice 3b — D2 command, log and UI

Merge only after 3a runs on **both** web and worker. Hold PR 5 out of auto-merge until `pnpm ops deploy-ci-images --sha <3a>` has reported both healthy.

**Shared pure planner (application):** `monthTargetPlan(bundle, now, propertyTimezone)` → `{ runningRows, inForceVersion, effectiveTarget, startTarget, changeCount, pendingHead, followingStart, skipsMonth, canApplyFollowing, followingBlockedReason }`. The dialog and the use case both call it, so what is shown is what is written.

**Use case (new sibling `goal-month-target.ts`):** `changeMonthTarget({ propertyId, programId, targetValue, expectedTarget, expectedVersion, applyToFollowing, note? })`, gated on `goal.update`.

1. Load the bundle. `ended` → `invalid_transition`. Run the catch-up step. Active and paused goals are allowed.
2. No running month → `no_open_month` (this is the answer for a scheduled goal).
3. Validate the target against the in-force version's measure (the running rows' `programVersionId`, not `bundle.version`).
4. `expectedVersion !== program.currentVersion`, or effective target ≠ `expectedTarget` → `revision_conflict`. Exception: the month already equals the request, which is a retry.
5. Decide the following outcome before any write:
   - not asked → `not_requested`;
   - the head that will govern next month already has the same measure, subjects and target → `applied`, no version written;
   - no pending head → prepare a new version (same measure, same current subjects, new target, reason `target_changed`) starting at `followingStart`;
   - pending head with the same measure → supersede it with the new target, keeping its subjects → `replaced_scheduled_change`;
   - pending head with another measure → `kept_scheduled_change`;
   - a subject is no longer valid, or the source is unavailable → `not_applied` with `following_reason` (`subject_unavailable`, `metric_unavailable`). No subject is dropped silently.
6. One repository transaction (`goal-month-target.repository.ts`):
   - compare-and-set on the Program row (`current_version = expected`; same lock order as maintenance and revise);
   - `SELECT … FOR UPDATE` the rows with `status = 'open' AND period_start <= :at AND period_end > :at` (injected clock, as `getDueResult` does at REPO:806-822);
   - re-check the effective target;
   - UPDATE `target_value`; insert one log row per result with a shared `change_id` and the decided outcome;
   - run `reviseInTx` when a version is written;
   - insert audit row `goal.month_target.changed`.
     A guard refusal (55000 or 23514 from that UPDATE) maps to `month_locked`. Any failure rolls everything back.
7. Return `{ month: { previous, next } | 'unchanged', following: { outcome, reason?, startsAt? } }`. A repeated save writes nothing.

`targetChanges` are read by a new tenant-scoped function `listTargetChanges(db, organizationId, propertyId, programIds)`, called from `get` and `list` only. It filters on all three columns and stays out of `hydrateBundles`, which is exempt from the canary by symbol.

**Read and UI**

- PROG: `targetValue` becomes the effective month target; add `monthTarget: { changedAt, changedBy, startTarget, changeCount } | null`. It is null when the effective target equals the target the month started with.
- Marker everywhere: "Changed by Marco on Oct 31 (2 changes), started at 400". `startTarget` is the first log row's previous value.
- Group card (`portal-group-goal-view.ts:66-75`): the "Changed by" line replaces "Set by" for a changed month.
- `G/$goalId.tsx`: the Program card shows "This month" and "From {next month}" separately. Each month row shows its effective target and the marker.
- `G/$goalId.tsx`: add a "Target changes" `Timeline` fed from two sources, each with who, when, old, new and note: month changes, and version changes whose target differs from the previous version. A version entry is hidden when it is some log row's `following_version_id`. The route loads `membersQuery` for names (as the Group page does, `groups/$groupId.tsx:117-118`), with "a former member" as fallback.
- `G/index.tsx:173-177`: "target 300 this month · changed Oct 20, started at 400".
- `goal-results-matrix.ts:217,233`: row target and marker line.
- New `C/goals/goal-month-target-dialog.tsx` on `GoalProgramFormDialog`, with `FormNumberField` (step 0.1 for averages) and `<FormTextarea optional label="Note" />`. It shows "412 so far this month" when the goal has 25 or fewer subjects.
- Checkbox label carries the real date: "Also use this target from Nov 1". Default on. Default off with a question when a scheduled change exists ("November is already set to 500. Replace it with 300?"). Default off with a warning when a month would be skipped ("November would have no goal result"). Disabled with the reason when following cannot apply.
- Revision dialog description: "Applies from {date}. To change this month, use Change this month's target."
- Notices: the facts lookup adds `targetChangedInMonth` (row `target_value IS NOT NULL`); `goalMarker = 'target_changed'` wins over `set_in_month`; clause "The target was changed during the month."

**Tests first**

- UCT:
  - `changes the running month's target and logs who, when, old and new`
  - `refuses after the period end`
  - `refuses a stale expected target`
  - `refuses a stale expected version`
  - `applies to following months through a new version from next month, in one write`
  - `a failed following step leaves the month unchanged`
  - `a scheduled change with the same measure is replaced and logged as replaced`
  - `a scheduled change with another measure is kept and logged as kept`
  - `an archived Portal subject gives not_applied and the month still changes`
  - `a paused goal's running month can be changed`
  - `an ended goal is refused`
  - `a scheduled goal has no open month`
  - `changing a multi-subject goal updates every running row under one change id`
  - `a repeated save writes no new version and no log row`
  - `two changes in one month report the starting target and a count of two`
  - `a change back to the starting target shows no marker`
- RT: transaction atomicity; `a guard refusal is reported as month_locked`; cross-tenant denial; `a log row of another organisation with the same program id is not returned by get or list`.
- PROG, matrix, list and Group-card view tests: effective target, marker, `a changed month names the person who changed it`.
- Feed unit: `the goal-met notice says the target was changed during the month`.
- e2e: `changing this month's target shows the old value and applies next month`, on a Portal created per attempt; extend the cross-tenant block at spec :871-978.
- Stories with play tests for the dialog (three checkbox states) and the Timeline.

**Docs:** CONTEXT glossary line 24, invariant 2 and the new invariant; new ADR 0066; ADR 0046 note.

**Gates:** ledger, `max-lines` 300 for components, feedback ownership (no toast beside the banner), form drift guard, bundle (measure).

## Slice 4 — D4: set goals for several portals

**Server:** new sibling `goal-bulk-create.ts`: `createGoalsForSubjects({ propertyId, metric, startMonth, items: [{ subject, targetValue }] })`.

- At most 50 items; no duplicates; subjects limited to `portal` and `portal_group`.
- Authorise `goal.create` once. Resolve the start period once with one `now`; `start_month_changed` refuses the whole save.
- Per item, call `createGoalCore` with that period and a generated name `{subject name} · {measure label}` (trimmed to 200). Before each row, check `now < period.end`; otherwise that row and the rest report `start_month_changed`.
- Returns `outcomes: [{ subject, code: 'created' | 'subject_has_goal' | 'invalid_target' | 'invalid_subject' | 'metric_unavailable' | 'start_month_changed' | 'failed', programId? }]`.

**UI**

- No new route. `G/new.tsx` gains a validated search param `mode=several` and `LinkTabs` "One goal · Several portals". The table is a `lazy()` feature component `C/goals/goal-bulk-table.tsx`, so only the server-function stub reaches first paint. If the route rules make this awkward, fall back to `G/bulk.tsx` and record the measured budget raise.
- Entry point: a secondary action "Set goals for several portals" on `G/index.tsx:134-140`. With fewer than two Portals or Groups the tab says "This property has one portal. Set its goal on the One goal tab."
- `DataTable`, one `FormNumberField` per row (label visually hidden from `md` up through the shared frame, never a hand-built `FieldLabel` + `Input` + `FieldError`). Measure select and start choice above the table. Rows sorted by name. Archived Portals filtered out.
- Pre-read with `listGoalPrograms` and `subjectHolds`, so a goal ended this month still shows its subject as occupied. Occupied rows are read-only with the goal's target and one of two messages (see copy). Add `programId` and `targetValue` (the target of the version the holding assignment belongs to) to `GoalSubjectHold` here, with a test; Slice 1 left them out because nothing read them.
- After save: per-row badges, a polite live region announces the result, focus moves to the first failed row, failed rows stay editable.

**Tests first**

- UCT: `creates one goal per filled row`; `a row whose subject already has a goal is reported and the others are saved`; `refuses more than 50 rows`; `refuses a Property subject`; `a repeated submit creates nothing new`; `every row gets the same start month`; `rows after the month ends are reported, not created`.
- Component: `a subject held by an ended goal is shown as occupied until its month ends`; `the average measure shows the 1 to 5 message`.
- e2e: `set goals for three portals, one already has a goal`, with Portals created per attempt.
- Story play tests with axe.

**Gates:** `ui-pattern/route-page-state` (states live in the feature component), `data-table-sources.test.ts`, form drift guard, ledger, bundle (measure).

**Deploy:** web only. One readiness query per row, sequential, capped at 50.

## Deploy and rollback

| PR  | Order                   | Safe while the worker is one slice behind because               |
| --- | ----------------------- | --------------------------------------------------------------- |
| 1   | web, worker             | no behaviour change                                             |
| 2   | web, worker             | an active goal with an open row is today's day-1 shape          |
| 3   | web, worker             | activation and append read the head; empty windows hold no rows |
| 4   | web (migration), worker | nobody writes `target_value` yet                                |
| 5   | web, worker             | requires PR 4 on both services first                            |
| 6   | web                     | no worker change                                                |

- **Worker floor:** the PR 4 commit. Before any worker rollback, run `SELECT count(*) FROM goal_monthly_results WHERE target_value IS NOT NULL AND status <> 'closed'`. If it is not zero, do not go below the floor. An older worker would close that month against the version target, and a closed row cannot be corrected in place.
- **Web below PR 4** with overrides present shows the version target but writes nothing wrong.
- If a deploy stops after web and before worker, finish the worker step before using "Change this month's target".
- ADR 0066 records that images older than PR 4 are unsafe once an override exists.

## Docs to amend (in the slice that changes the rule)

- `src/contexts/reporting/CONTEXT.md:24` → "**Goal Program**: versioned monthly target over an approved metric and subject set. A month still running can carry its own target; once its period ends that target is locked."
- `CONTEXT.md:83-88`, invariant 2 → "Goal evaluation uses half-open property-local monthly periods and approved Goal metrics. A goal starts in the current local month or the next one, chosen at creation; the metric counts the whole month either way. A month is judged against its own target when it has one, otherwise its version's. A month's target may change only while the month is open and before its period ends; every change is logged with who, when, old and new value. A revision starts at the first local month that begins at or after the end of every month still open or reconciling… (rest unchanged). A version with no monthly result may be replaced; the replaced version keeps an empty window."
- New invariant: "A version's target is never updated in place."
- New ADR `docs/adr/0066-goal-months-carry-their-own-target.md`, with a README entry.
- `docs/adr/0046-notification-policy.md:421-424`: the two Goal notices may also carry one marker (set during the month, or target changed during the month).
- `docs/BETA.md`: checked line 54; it states measures and scopes only, none of R1–R4. No change.
- Comment at `C/goals/goal-revision-start.ts:8-10`; plan file `docs/plan/goals-flexible-months.md`.

## Pull-request split

1. `refactor(reporting): split goal program commands and result repository` (S0)
2. `feat(goals): start a goal in the current month` (S1)
3. `feat(goals): optional note, edit before start, rename` (S2)
4. `feat(goals): month target storage and readers` (S3a, migration)
5. `feat(goals): change this month's target` (S3b; after PR 4 is on web and worker; not auto-merged before that)
6. `feat(goals): set goals for several portals` (S4)

Strictly linear.

## Proposed copy

- Start legend: "When does this goal start?" Options: "This month — counts everything since Oct 1" / "Next month — starts Nov 1".
- Stale month: "The month has changed. Check the start and save again."
- Goal page: "Counts from Oct 1 · set on Oct 11". Scheduled: "Starts on Nov 1". Month row: "Set on Oct 20", "412 so far".
- Month target: "Change this month's target"; field "Target for October"; checkbox "Also use this target from Nov 1"; field "Note"; button "Save target" / "Saving…"; receipt "Target saved".
- Marker: "Changed by Marco on Oct 20, started at 400".
- Locked: "October has ended. Its target can't be changed."
- Not open yet: "This month's result isn't open yet. Try again in a few minutes."
- Kept change: "November already has its own change scheduled, so only October changed."
- Not applied: "October changed. November was not changed because {a portal in this goal is archived / the measure is not available}."
- Conflict, goal ending: "{Portal} has a goal for this measure that ends Oct 31. Start the new goal next month, or change this month's target."
- Conflict, live goal: "{Portal} is part of {goal name}. Remove it from that goal's subjects first."
- Bulk: title "Set goals for several portals"; description "One number per portal. Each becomes its own goal."; row states "Goal saved", "Already has a goal", "Not saved, try again", "Measure not available", plus the DTO's per-measure target messages; button "Save goals".
- `G/new.tsx:125` → "Months follow {property}'s time zone."

## Amended during implementation

Each amends the slice named; the code is the reference.

### Slice 1 (screens)

1. **The start helpers have their own domain module**, `src/contexts/reporting/domain/goal-start.ts`, and the subject type and its identity have `domain/goal-subject.ts` (DOM re-exports both names). DOM is part of the first-paint bundle because the command DTO imports it, and a module is never split across chunks. With the helpers in DOM, using them in the new-goal form put them and the PR-RANGE calendar code into first paint: +877 B in the DTO chunk, measured. DTO re-exports `goalStartOptions` and `defaultGoalStartMonth` only; nothing outside the use case reads `resolveGoalStart`.
2. **The loader does not compute the options.** `G/new.tsx` reads the instant its route last loaded from the router (`match.updatedAt`: the server render sends it and a loader run renews it) and works the two months out from it in the page, so the server and the browser still offer the same ones. Computing them in the loader measured +1,999 B of first paint against 21 B of headroom, and returning `Date.now()` from the loader still cost 24 B more than reading the match. On `start_month_changed` the page invalidates its own route, which renews the instant.
3. **The start month is not a form field.** The page keeps the person's pick beside the form and submits it while it is still offered, otherwise the default (`offeredStartMonth` in `C/goals/goal-start-view.ts`). There is no form-side schema for it: both keys come from the page and the command checks them.
4. **"Starts on" follows the date, not the status.** The goal page reads "Starts on {date} · set on {date}" while the first month is still ahead and "Counts from {date} · set on {date}" from its first instant, so a goal waiting for its metric source in a month that has begun does not say it starts in the past. A goal ended before its first month reads "Never started · set on {date}". The empty results card reads "Results start on {date}." or "Results start when the metric source is ready."
5. **The conflict copy stops before "or change this month's target"** until Slice 3b builds that command: "{Portal} has a goal for this measure that ends Oct 31. Start the new goal next month." Before the Property's goals have been read it says "A subject you chose already has a goal for this measure."
6. **`metric_unavailable`** reads "This measure can’t be read for this month right now. Start the goal next month, or try again later." when the goal was to start this month, otherwise "This measure can’t be read right now. Try again later."
7. **One formatter for the year rule:** `formatShortDate(value, zone, now)` in `src/lib/format.ts` prints the year when the day is not in the current year of the Property's calendar.
8. **Group card note:** "Set by {name} on {date} · the month ends …"; without a name, "Set on {date} · …".
9. **Bundle:** a fresh production build of the screens measured 310,285 B against 310,279 B before them, of 310,300 B (entry 49,506 B). The pages now import two server-function stubs (+6 B). The rest is noise: the entry lists every chunk by its hashed name, so a change to a lazy chunk alone moves the total by about 10 B (the commit before the last measured 310,294 B with the same first-paint code). The budget was not raised. After the review fixes below (items 10 and 11, lazy chunks only) a fresh build measured 310,298 B (entry 49,519 B): every other first-paint chunk is byte-for-byte the same size, and the 13 B are the entry's list of hashed chunk names again. That leaves 2 B. Two things would free room: `goalKeys.staff` has no reader, and the goal command DTO (1,148 B) is in first paint only because the server-function stubs keep a side-effect import of it after their validators are stripped. After the rebase onto main with Slice 3a (7955627ad) the budget was raised to 310,600 B: fresh production builds measured main at 310,134 B and this slice at 310,298 B (+164 B), and 2 B of room would let a renamed chunk fail CI by chance. The 2026-10-11 note in `scripts/check-bundle-budget.mjs` has the figures per chunk.
10. **A changed target does not read "Starts on".** Found in review: after a Revise that changes the target, the head has no month yet, so a goal that was counting read "Starts on Nov 1 · set on Oct 12" under an Active badge. "Starts on" is now only for a goal that has opened no month. A goal that has opened one and whose target waits for the next month reads "Target applies from {date} · set on {date}", and "Counts from {date} · set on {date}" from that month's first instant. If the goal ended first, the month never opens and the line reads "Target never applied · set on {date}", before and after the planned date. `goalStartLine` takes the months the goal has opened and decides from them, not from the clock alone. Slice 3b replaces this line with separate "This month" and "From {next month}" lines.
11. **A live holder's conflict copy names next month when the goal was to start this month:** "{Portal} is part of {goal name}. Remove it from that goal's subjects, then start the new goal next month." A subject change takes effect at the next full month, so removing the subject cannot free the month that is running. For a goal that starts next month the sentence still ends "…subjects first."

### Slice 1 (server), as built

1. `createGoalCore` and `createGoal` live in `goal-program-create.ts`, beside UC, so Slice 4's sibling can import the core without a cycle. `REPO.create` answers `'created' | 'subject_has_goal'`.
2. The notices say "The goal was set during the month.": the lookup fact is a boolean and the payload field an enum, so no date reaches the template. The Recent Activity row carries the marker as `detail: 'eligible:set_in_month'`, on a met month only.
3. The month key is `dayKeyInTimezone(...)` with its separator replaced: that function returns `yyyy_MM_dd`.
4. The read behind `previewGoalMonth` is `readGoalMonthPreview` in `goal-month-preview.ts`.
5. `GoalSubjectHold` carries `subject`, `programName` and `heldUntil` only, which is all the single-goal form reads. Slice 4 adds `programId` and the holding version's `targetValue` together with the bulk rows that show them.
6. The notice templates already have a sentence for `goalMarker: 'target_changed'` ("The target was changed during the month."), because the payload enum admits the value in this slice and the template table covers the whole enum. Nothing raises it until Slice 3b; the only producer writes `set_in_month`.

### Slice 2 (screens)

1. **The month-start rule left DOM.** `firstFullMonthlyPeriodAtOrAfter` now lives in `domain/goal-start.ts` (DOM re-exports the name, so its other importers are unchanged), and `application/goal-revision-start.ts` imports it from there. With it in DOM, the dialogs' call to `nextRevisionStart` put it and the PR-RANGE calendar code into first paint: +751 B in the DTO chunk, measured.
2. **The dialogs read the clock when they open**, not the instant the page was opened, so a page left open over the end of a month still names the right month. The receipt prints the start the command answered, which can differ from the line above it (a timezone move, or a month that opened in between).
3. **Dates follow the Slice 1 year rule** (`formatShortDate`): "Applies from Nov 1.", "Changes apply from Nov 1.", "Change saved. Applies from Nov 1 (Europe/Sofia).", with the year when it is not the current one. The outcomes block of the subjects dialog prints the same receipt (review fix 4 below).
4. **Refusals are worded in one module**, `C/goals/goal-refusal.ts`: one sentence per `GoalProgramError` code (the table is typed by the code union, so a new code fails the build until it has one). `withGoalRefusals(fn)` wraps the server function a `use-action-mutation` caller hands over; the mutation's error keeps its name, code and status and takes the sentence as its message, so the banner, the confirmation and the toast print it through the rule they already share. Mapping at render time was not possible: `DialogErrorBanner` tells a fresh error from a stale one by identity. The new-goal form keeps its two longer answers (which goal holds a subject; next month is still open) and uses the table for the rest.
5. **`statusReasonLabel`** has a sentence for the three codes the system writes: `awaiting_first_full_month`, `metric_source_not_active` and `organization_closure_fence` ("Paused while the organization is being closed"). A reason shaped like a code with no sentence still prints as words. Anything else prints as written, except the three strings the page used to send ("Goal paused", "Goal active", "Ended by manager") on goals changed before this slice, which print nothing (review fix 3 below). The page now sends no reason with a status change.
6. **"Edit name" opens "Edit name and description"**: the name and the optional description, "Save changes", toast "Goal details saved". Saving what the goal already says sends nothing. It sits with the other actions, so an ended goal does not offer it (the command refuses one too).
7. **The start-month line shows to people who can change the goal** (`goal.update`); a reader without that permission cannot end or set a goal.
8. **A note is sent only when one was written.** Both dialogs omit `reason` for a blank field.
9. **"Version lists in the UI filter empty windows" needed no change.** No screen lists a goal's versions: the goal page, the goals list, the matrix and the group card read the head version or look a version up by a month's result, and a replaced version has no month. The first list is the Timeline of Slice 3b, which must leave out a version whose window is empty (`effectiveTo <= effectiveFrom`).
10. **Bundle:** fresh production builds on the finished Slice 1 screens (`20b450444`), before the Slice 2 screens and with them, measured 310,300 B and 310,284 B, of 310,300 B. The entry chunk measured 49,514 B before and 49,495 B with them; the `use-action-mutation` chunk is +4 B, because it now also exports the error class the refusal module builds; the DTO chunk is unchanged at 1,153 B. On the earlier Slice 1 head (`c5ab02a32`) the same two builds measured 310,276 B and 310,286 B. The budget was not raised.

### Slice 2 (server), as built

1. `nextRevisionStart(bundle, now, timezone)` answers `{ head, period }` and lives in `application/goal-revision-start.ts`; `head` is `never_started`, `pending` or `in_force`. Revise passes the Property's zone. A change of subjects passes the head version's zone, because that command copies the version.
2. The catch-up step is `loadCaughtUpProgram` in `goal-program-maintenance.ts`: it opens an active goal's due months and reads the goal again when any month was due.
3. The command schemas take an optional note; the two form schemas keep a string that may be empty, which is what a text field holds.
4. A status change whose goal changed under it answers `revision_conflict`: the repository returns null for it and the use case maps that.
5. Rename refuses an ended goal (`invalid_transition`), writes nothing when nothing changed, and is served from `server/goal-program-details.ts`, a module only the goal page imports; the request plumbing both server modules share is `server/goal-program-request.server.ts`. Inside `server/goal-programs.ts` the rename stub cost 45 B of first paint.
6. `goalTargetProvenance.countsFrom` skips a version replaced before it began, and `assertSubjectsAreFree` is the one place create and revise refuse a held subject.

### Slice 2 (review fixes)

1. **A revision before the start states again what the goal waits for.** `status_reason` was written at creation only, so a change of measure before the start left the old one on the page ("Waiting for the metric source" on a ready measure, or "Starts on Nov 1" on one that was not). `revise` now hands the repository `scheduledStatusReason` when the head is never started (`metric_source_not_active` when the source is not active, else `awaiting_first_full_month`, the rule creation uses). `reviseInTx` sets it in the update that moves the head, only while `status = 'scheduled'`. A change of subjects passes none: the source is a property of the measure, which that command keeps.
2. **Ending a goal that never started always leaves the empty window.** Decision d′ said the subject is free at once; that held only while the start was ahead. A goal still scheduled after its planned start (source not active, or the first hour of the month) closed at the command time and kept `[start, ended at)`, so "end this goal and set it again" was refused for the running month. `endingBoundary` in REPO closes a Program that is scheduled and has no month at its own `effective_from`. A started Program closes as before.
3. **The three former default status reasons print nothing.** `statusReasonLabel` answers null for "Goal paused", "Goal active" and "Ended by manager". The stored values are not rewritten.
4. **The subjects dialog prints the revision receipt.** Its outcomes block said "Scheduled from Oct 1, 2026 (Europe/Sofia)." under a title line that already said "Changes apply from Oct 1.". It now prints `goalRevisionReceipt`, so both dialogs use one sentence and the year rule. `goalRevisionStartDate` had no reader left and is gone. The buttons "Review and schedule" and "Schedule revision" and the toast "Assignment changes reviewed" are unchanged: see "Open after the Slice 2 review".
5. **Rename is a compare-and-set.** `REPO.rename` takes the name and description the command read and updates only while the Program still has both; otherwise the command answers `revision_conflict`. The audit row's `previousName` is therefore exact, and it gains `descriptionChanged` (the text is still not stored). The dialog leaves an unchanged description out of the request, so the goal keeps the one it has now.
6. **"Version: N" counts plans that were in force.** `goalVersionNumber` (`C/goals/goal-version-number.ts`) leaves out a version whose window ends where it starts and always counts the plan shown. The Slice 3b Timeline replaces the line.
7. **The lock order is tested with both writers running.** RT races `activate` against a superseding `revise`, and `appendResults` against a supersede of a pending head, twenty Programs each; every race must end with exactly one winner and no month under an emptied window.
8. **Bundle:** a fresh production build with the review fixes measured 310,298 B of 310,300 B (entry 49,509 B), against 310,284 B (entry 49,495 B) for the Slice 2 screens. The 14 B are all in the entry chunk, which lists every chunk by its hashed name; the rest of the closure sums to the same 260,789 B, and the fixes touch lazy chunks only. The budget was not raised. That leaves 2 B, so the next UI slice has to free room first (Slice 1 screens, item 9, names two places).

**Open after the Slice 2 review** (owner decisions, not built):

- A save from a rename dialog that was opened before another manager renamed the goal still overwrites that name: the compare-and-set covers the moment between the command's read and its write, not the time the dialog was open. Refusing it needs the dialog to send the name it opened on, which is a new field in `renameGoalProgramSchema`; DTO is part of first paint, where 2 B are left.
- The wording of "Review and schedule", "Schedule revision" and the toast "Assignment changes reviewed", now that the receipt says "Change saved".
- A scheduled goal whose start has passed reads "Starts on {date}" in its status note until the hourly job activates it. This was already so in the first hour of a goal's first month. It also stays so for as long as the metric source cannot be read at that hour: the job leaves such a goal scheduled and writes no reason, so a source that stopped being active after the goal was set (or last revised) is not named on the page. The reason is decided when the goal is created and when it is revised before its start, nowhere else.

## Out of scope, noted

- The "behind pace" signal cannot fire: open rows are inserted as `updating` and nothing produces an open and eligible row. Only its target expression is touched.
- Resume after a pause back-fills missed months against the version target. Unchanged.
- Changing the start month of a never-started goal by editing (decision d′).

## Changes after review

**Data integrity**

1. Conflict pre-check counts empty windows — applied: decision i, one predicate and one `subjectHolds` helper, integration tests in S1 and S2.
2. `changeMonthTarget` is two transactions — applied: one transaction through `reviseInTx`; the outcome is decided before the write and stored.
3. Bare `numeric` fails schema drift — applied: `numeric(30, 10)` in SQL and model, migration in the generated shape.
4. Re-picking the start of a never-started goal — applied by removing the feature (decision d′); "never started" is now `scheduled` with no results, and a superseded head closes as an empty window, so the check violation cannot occur.
5. "This month / next month" resolved per call — applied: `startMonth: 'YYYY-MM'`, resolved once in bulk, and the following start taken from the running month's end.
6. Supersede copies an instant under a new time zone — applied: the start is recomputed (decision d).
7. Thin database safeguards and unmapped guard refusals — applied: measure rule in the guard, refusals mapped to `month_locked`, Program FK on the log. A separate SQLSTATE is not added, because the mapped statement changes only `target_value`, so any 55000 or 23514 from it is unambiguous.
8. "Safe retry" writes a version each time — applied: compare with the head that will govern next month; a repeat writes nothing.
9. Default status reason surfaces — applied: `status_reason` NULL without a note.
10. "Tenant canary does not exist" — rejected as stated: it exists at `src/shared/architecture/tenant-predicate-canary.test.ts`, driven by the data-fate table, and `hydrateBundles` is on its exemption list. The fix is applied anyway: the new read is its own tenant-filtered function with a cross-organisation test.

**Product honesty**

1. Following step can fail after the month commits; no status rule — applied: status rule stated, preconditions decided first, single transaction, `not_applied` with a reason.
2. Log stores the tick — applied: `following_outcome`, `following_reason`, `following_version_id`. A following-only log row is not needed, because the Timeline also lists version target changes.
3. Notices carry no marker — applied: `goalMarker` from the facts lookup, in S1 and S3b, with the ADR 0046 amendment.
4. Group card credits the wrong person — applied: `changedBy` in `monthTarget`; `membersQuery` on the goal page.
5. Markers missing from matrix, month rows and list — applied on all three.
6. Per-Portal goals set blind — applied: "so far" on the goal page, in the month-target dialog and in the single-goal form. Not in bulk rows (see question 9).
7. Default-on following can skip a month or overwrite a scheduled change — applied: real date in the label, default off with a question or warning, `expectedVersion` guard.
8. Bulk entry point, messages, shared-goal and archived cases — applied.
9. Marker hides stepwise lowering — applied: starting target plus change count, no marker after a revert.
10. "Set on" re-stamped by subject changes — applied: `goalTargetProvenance`.
11. Notes shown nowhere; "never surfaces" claim wrong — applied: Timeline fed from both sources, claim corrected.
12. Leftover raw status code, loose month check, Revise sentence — applied. One merged "Change target" dialog is not built (see question 10).

**Delivery**

1. Journal clock and re-baseline — applied: hand-append rules, `when 1793500000000`, parity test, CI sequence on a private database.
2. No rollback floor — applied: "Deploy and rollback" section, PR 5 held from auto-merge, UCT close-against-own-target case.
3. Shared scratch database — applied: private `TEST_DATABASE_URL`, held transactions, injected clock in the command.
4. e2e journeys not re-runnable — applied: a Portal per attempt, explicit start month everywhere, no default-selection assertion.
5. "(optional)" suffix and hand-built field — applied: `optional` marker, `FormNumberField`, sources tests in the gates.
6. Bundle headroom — applied: measurement per UI PR, no new route for bulk, lazy table.
7. Wrong dependency statement — applied: one linear stack.
8. Repository split cycle and Fallow entry — applied: `goal-program.rows.ts`, error class defined in the maintenance module, entry moved, one composition test.
9. Route importing domain — applied: helpers re-exported from DTO.
10. Unlisted pinned copy; dead `invalid_reason` — applied: files listed (three more found: `dialog.stories.tsx:164`, `goal-assignment-outcomes.test.ts:1`, the repository test), code removed.
11. Default status reason shown — applied (same as data integrity 9).
12. Deploy-order wording — applied: real order and the checked window per slice.

**Found while checking, added:** a revision made after a month begins but before the hourly job opens its row drops that month today (decision d″, catch-up step in S2).

## Open questions, with the default taken

1. **Day 20 inclusive and fixed for everyone?** Default: yes, one constant.
2. **Change the start month of a goal that has not started?** Default: no; end it and set it again (the subject is free at once).
3. **Ended goal this month, replacement wanted this month?** Default: refuse with the conflict copy; no silent move to next month.
4. **May an ended goal's still-running month be retargeted?** Default: no; paused goals may.
5. **Any limit on lowering a target late in the month?** Default: none; the log, the marker and the notice clause are the control.
6. **Notify other managers when a target changes?** Default: no new notice; the goal-met and goal-missed notices carry the marker.
7. **Archived Portal inside a multi-subject goal when "also from next month" is ticked?** Default: this month changes, next month does not, and the message says why.
8. **Bulk rows that already have a goal: read-only or editable?** Default: read-only with a link.
9. **Month-to-date figure per row in the bulk table?** Default: no (up to 50 reads); the goal page shows it after saving.
10. **One "Change target" dialog instead of Revise plus Change this month's target?** Default: keep two, with the reworded Revise sentence.
11. **"11 Oct" or "Oct 11"?** Default: "Oct 11" (repo formatter), with the year when it is not the current year.
12. **Who sees notes?** Default: everyone with `goal.read`, in the Timeline.
13. **Auto-generated names for bulk goals?** Default: "{Portal} · {measure}", editable through rename.
14. **Bulk as a tab of New goal or its own route?** Default: a tab (`?mode=several`); own route only if the route rules force it, with a recorded budget raise.
