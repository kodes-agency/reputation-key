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
9. **Rebased onto main with Slice 1 (#770) and Slice 3a (#769).** The replay had no conflict and this slice's code needed no change. It writes no month target: the three places that open a month (create, activate, append) go through `resultValues`, which 3a made write a null `target_value`, and neither the supersede nor the catch-up step adds a write to a month. A replaced version still takes no month: the guard's window check also runs for the one new row 3a admits with a target, an open month that is still running. `goal-month-target-guard.test.ts` pins that with the real `revise` (`a version replaced before it began takes no month, with or without a target`). A fresh production build measured 310,298 B of main's 310,600 B (entry 49,509 B), the same figures as item 8, so 302 B are left and not the 2 B that item 8 and the first open point below name. For Slice 3b: a log row's `following_version_id` can name a version that a later Revise replaces before its month. The row still says `applied`, so the Timeline has to read that version's empty window.

**Open after the Slice 2 review** (owner decisions, not built):

- A save from a rename dialog that was opened before another manager renamed the goal still overwrites that name: the compare-and-set covers the moment between the command's read and its write, not the time the dialog was open. Refusing it needs the dialog to send the name it opened on, which is a new field in `renameGoalProgramSchema`; DTO is part of first paint, where 2 B are left.
- The wording of "Review and schedule", "Schedule revision" and the toast "Assignment changes reviewed", now that the receipt says "Change saved".
- A scheduled goal whose start has passed reads "Starts on {date}" in its status note until the hourly job activates it. This was already so in the first hour of a goal's first month. It also stays so for as long as the metric source cannot be read at that hour: the job leaves such a goal scheduled and writes no reason, so a source that stopped being active after the goal was set (or last revised) is not named on the page. The reason is decided when the goal is created and when it is revised before its start, nowhere else.

### Slice 4 (server), as built

1. **Three modules that load with the table.** The command is `use-cases/goal-bulk-create.ts` (`createGoalsForSubjects`), its transport schema is `dto/goal-bulk-create.dto.ts` (`createGoalsForSubjectsSchema`) and its server function is `server/goal-bulk-create.ts` (`createGoalsForSubjects`, traced as `goal.createGoalsForSubjects`). The schema and the function are not added to DTO and SRV: SRV's stubs are in the first-paint closure and keep a side-effect import of DTO (Slice 1 screens, item 9), so both would have ridden first paint. A server module that only the lazy table imports is not shared by two chunks, so the `app-server-fns` group leaves it in the table's chunk. Fresh production builds of the Slice 1 head (97ba7d1d1) and of the server part measured 310,298 B and 310,304 B of 310,600 B: every first-paint chunk but the entry is the same size, and the entry's 6 B are its list of hashed chunk names. Nothing in the browser imports the new function yet, so the screens measure again.
2. **The request plumbing is the module Slice 2 made**, `server/goal-program-request.server.ts`: `withGoalPrograms` with the request policy and the status table. This slice adds the several-goals command to the `programs` it hands a handler and changes nothing else in it. The first build of this slice, on the Slice 1 head, had extracted the same code as `server/goal-request.ts`; the rebase onto Slice 2 dropped that module. A slice that edits `goalProgramStatus` or `withGoalPrograms` edits them in `goal-program-request.server.ts`.
3. **Subject names are read on the server.** The command has its own port, `GoalSubjectNameReader.getSubjectName`, implemented by the subject reader adapter. A Portal's name comes from `getPortalInfo`; a group's from a new `PortalGroupPublicApi.getGroupInfo(orgId, groupId)`, because no group read by id returned a name. A subject that is unknown, archived or another Property's has no name, and its row reads `invalid_subject`.
4. **The measure label has one home**, `application/goal-metric-label.ts`, which `C/goals/goal-metric-label.ts` re-exports: the command cannot import a component.
5. **`startMonth` is required** for this save. A save refused as a whole reuses existing codes: no rows or a Property row is `invalid_subject` (400), more than 50 rows `assignment_limit_exceeded` (400), a subject in two rows `duplicate_subject` (400), a month no longer offered `start_month_changed` (409). The schema bounds the rows as well (1 to 50, Portal or group); only the command refuses a repeated subject.
6. **Two clock readings, two jobs.** One resolves the month and is the instant every goal of the save is written with (`createdAt`, and active or scheduled). A fresh reading before each row is compared with the period's end: from the first row at or past it, that row and the rest read `start_month_changed` and nothing more is read.
7. **`failed`** is a fault on that row, or a refusal that is not about the row (the Property gone mid-save). It is logged with the measure and the kind of subject and no identifier, and the other rows are still saved.
8. **The generated name keeps the measure.** When the subject's name and the measure pass 200 characters, the subject's name is cut.
9. **No query key and no ledger entry.** The save is a mutation, and goal writes invalidate `goalKeys.all`.
10. **`GoalSubjectHold` carries `programId` and `targetValue` again.** The goal named is the one that holds the subject longest. The target is that goal's at the start asked about: of the assignment in force then, or the one the goal begins on when it has not begun by then (review fix 7 below). Once Slice 3b lets a running month carry its own target, a row for goals that start this month must read that month's effective target; until then it shows the version's.

### Slice 4 (screens), as built

1. **One route, two views, as planned.** `G/new.tsx` reads `mode=several` through `G/-goal-new-search.ts` (a mode it does not know opens the single goal form) and draws `GoalNewTabs` (`LinkTabs` "One goal · Several portals", the subject a link chose kept across both) over `OneGoalForm` or `SeveralGoals`. The table is `lazy(() => import('#/components/goals/goal-bulk-table'))`; the `G/bulk.tsx` fallback was not needed. The page's `h1` stays "New goal" in both views. The plan's title and description for the table are the heading and the line of its card, and the header's own sentence about one goal is not drawn on the Several portals view.
2. **The pieces.** `goal-bulk-view.ts` is what the rows show, `goal-bulk-save.ts` what a save sends and leaves, and `goal-bulk-entries.ts` what is kept between saves: the numbers by measure and the reports by measure and month (all three without markup, with unit tests). `goal-bulk-rows.tsx` is the `DataTable`, `goal-bulk-table.tsx` the lazy component with its state and its save, and `goal-bulk-pending.tsx` the skeleton the page shows while the chunk loads and the table shows while the goals are read, so the two waits look like one.
3. **The number's label is always read and never drawn; a caption shows the words while the rows stack.** The plan asked for a label hidden from `md` up. Two things stand against it. `DataTable` becomes a table at a container width (`4xl`), not at a viewport width, so between the two a stacked row would have had neither a header nor a label. And a label that hides from a width cannot sit in the shared frame: `Field` gives its children `[&>*]:w-full`, which comes later in the built stylesheet than `@4xl:sr-only` at the same specificity, so the hidden label would be as wide as the table and scroll it sideways (the frame only undoes that for the plain `sr-only` class). So the label is `sr-only` ("Monthly target for {name}", which also tells the rows apart for a screen reader), and each target cell prints "Monthly target" above its content below `4xl` (`@4xl:hidden`), which a row that already has a goal needs as well, since its target is plain text.
4. **Plain state, the shared field.** The table keeps its numbers in component state and hands each row's `FormNumberField` the small field shape that component asks for; it is not a TanStack Form, because a row's verdict comes from two places (the measure's rule before sending, the command's outcome after) and both are one report per row. `FormNumberField` gained `step`, an optional `max` and `labelClassName`; the per-measure messages come from `goalTargetFault` in DTO, which the single goal form's schema now reads too. The form is `noValidate`, so "Use a rating target from 1 to 5" is said by the row and not by the browser.
5. **The goals are read by the view, inside its Suspense boundary.** `listGoalPrograms` runs through `useQuery` in `SeveralGoals` (the Goals page's key, so it is usually cached), not in the loader, whose code is first paint. The boundary is around the whole view: the read then starts once the chunk is here, and its answer cannot reach a boundary that is still hydrating. No row is drawn before the goals are known. A read that fails with nothing to show is a `RegionError` with Try again; a later one that fails (the one after a save) leaves the table and what was typed in place.
6. **A report per row, kept per measure and month; a number, kept per measure.** "Goal saved", "Already has a goal", "Measure not available", "No longer available" (`invalid_subject`) and "Not saved, try again" (`failed`, `start_month_changed`) are the pill; a wrong number is said under its field instead. Reports are kept under the measure and the month they were saved for, so changing either shows that table's own state. A number belongs to its measure and not to the month: another measure starts with empty rows and the first one's numbers come back with it, while the other start month shows the same numbers (review fix 2). A fault leaves when its number changes; any other reason stays until the next save, which also clears it for a row it was not sent.
7. **After a save.** No toast: the rows say it, a `role="status"` paragraph that is always in the page says the whole result ("2 goals saved. 1 not saved."), and the focus goes to the first row, in table order, that got no goal (its field, or the link to the goal that holds it). With no such row it stays with the row the person saved from, on the link to the goal that row now has, and when what had the focus is gone it goes to "Back to goals" (review fix 3). A saved row shows the number it was saved with and links to its goal; the save waits for the goals to be read again, so the link normally reads the goal's name, and "View goal" until then. Saving again sends only the rows still open. A save refused as a whole is the banner above the button, as a sentence; `start_month_changed` says the single form's sentence and reads the two months again.
8. **Copy added.** The start legend is "When do these goals start?" (the field takes its question as a prop). Column "Portal or group"; "Enter a target for at least one portal."; "Set goals for up to 50 portals at a time."; "The goals couldn’t be loaded."; with too few rows "This property has one portal" (or "one portal group", or "no portals yet") over "Set its goal on the One goal tab."
9. **Entry point.** An outline button link before "New goal" in the Goals header, for a reader who may create goals.
10. **Tests.** The two component tests the plan names are in `goal-bulk-table.test.ts`, which renders the real table to markup as a first request would; what needs a browser (the save, the pills, the live region, the focus, the measure select) is played in `goal-bulk-table.stories.tsx`, with axe. The e2e journey creates three Portals per attempt, chooses next month, and ends every goal it made.
11. **Bundle.** Fresh production builds on the Slice 1 head: the server part measured 310,304 B and the screens 310,370 B of 310,600 B (+66 B). On the head rebased onto Slice 2, with the review fixes, a fresh production build measures 310,376 B of 310,600 B (77 js + 1 css), so the budget is not raised; main with Slice 2 was last recorded at 310,298 B and was not built again here. The entry is 49,565 B (the search schema), the goal command DTO 1,177 B (`goalTargetFault`), and the stylesheet is the same 27,463 B: every class the table uses was already in it. The table, its rows, its rules and the bulk DTO are one lazy chunk that only this view requests, 3,664 B as first built and 4,430 B with the review fixes; the server-function stub rides the New goal chunk, not first paint.
12. **Rebased onto Slice 2 (#773).** Slice 2 moved `goalRefusalCode` and the refusal sentences to `C/goals/goal-refusal.ts` and made the request plumbing its own module. The table imports the code from there and prints a sentence for a save refused as a whole (`goalBulkRefusal`, review fix 1); `GOAL_MONTH_CHANGED` is gone, and `goalHeldSentence` is the exported form of that slice's `heldSentence`. This slice's own extraction of the plumbing, `server/goal-request.ts`, was dropped in the replay (server note 2).

### Slice 4 (review fixes)

1. **A save refused as a whole says a sentence.** The command sends its code as the message, so the banner printed "not_found". `goalBulkRefusal` takes the sentence from `goal-refusal.ts` and says two in the table's own words, because the goal sentences would not fit: "This property can’t be found." (`not_found`) and "Set goals for up to 50 portals at a time." (`assignment_limit_exceeded`).
2. **A number stays with the measure it was typed for.** The numbers were kept by subject only, so 12 private ratings typed for the Bar were waiting in the Bar's row under Qualified scans and were sent with the next save there. They are kept per measure now, a row gives its number up once its goal is created, and a wrong-number message leaves with its number in every month of the measure.
3. **The focus never falls to the page.** Saving with Enter from a row that got its goal left the focus on a field that was gone. It now goes to that row's goal link. When the Save button itself is gone (every row has its goal), it goes to "Back to goals".
4. **Nothing to save, no button.** When no row takes a number the Save button gives way to "Every portal and group has a goal for this measure." (or "Nothing is left to set for this measure." when a row is closed without a goal) and a "Back to goals" link (`BackLink`). After a save that left no row without its goal the same link is beside the button.
5. **Rows that cannot be retried, and rows that were not sent.** A row answered `invalid_subject` (its Portal was archived or left the Property while the table was open) closes: no field, never sent again. A save clears what was held against a row it was not sent (a number cleared after "Not saved, try again"); a created goal and a closed row stay as they are.
6. **A save lost on the way reads the goals again.** Each row is its own transaction, so a request that fails after some rows were written (anything but a 4xx refusal) may have left goals behind. The table asks the page to read the goals again (`goalsRead.readAgain`, the same call as Try again), so those rows are drawn as taken before the person saves a second time.
7. **An occupied row shows the target in force at the start asked about.** A goal revised to 550 from November showed 550 on the row for goals that start in October, while October is still counted against the target before it. `subjectHolds` now takes the target from the assignment in force at the start, and from the one the goal begins on when it has not begun by then; the goal named is still the one that holds longest.
8. **The measure and the start wait for a save.** Both are disabled while the save runs, so its answer cannot land under another table. The number fields stay live on purpose: disabling the field the person pressed Enter in would drop the focus, and a number edited meanwhile does no harm (a saved row shows the number that was sent, a refused row keeps the edit).
9. **A Portal Group's number says that it is a group's.** "Monthly target for First floor (portal group)": a group and a Portal may share a name and then sort next to each other.
10. **Text a number field cannot read is a fault, not an empty row.** A number field reports no value for "4,5" where the browser wants "4.5", so the row looked empty and was skipped without a word. At a save the table asks each field (`validity.badInput`) and says "Enter a valid monthly target" on such a row before anything is sent.
11. **Tests.** The unit tests cover the kept state (`goal-bulk-entries.test.ts`), the sentences and the 4xx rule (`goal-bulk-save.test.ts`), the closed row and the line that replaces the button (`goal-bulk-view.test.ts`, `goal-bulk-table.test.ts`) and the hold's target (`goal-subject-holds.test.ts`). Six new plays cover what needs a browser: Enter and the focus, a number staying with its measure, the two refusals, the fields waiting for a save, and the table with nothing left to save. Run against the table as reviewed, eight plays fail.

**Open after the Slice 4 review** (owner decisions, not built):

- A row that is simply taken prints the sentence written for a refused save ("Lobby QR is part of Lobby ratings. Remove it from that goal’s subjects, then start the new goal next month."), and for a goal this table made the name repeats ("Bar QR is part of Bar QR · Private ratings."). This is the copy this plan gives occupied rows; a quieter line for a row nobody tried to save is a copy decision.
- The select says "Metric" and "Private rating count"; the pill says "Measure not available" and the generated name "Bar QR · Private ratings". `GoalMetricField` and `goalMetricLabel` are both older than this slice and shared with the single form, the Revise dialog and their e2e journeys, so one word and one spelling is a change across those screens.
- Numbers typed into the table are lost when a goal link or the One goal tab is followed. No create form in the app guards against leaving; the one guard there is (`portal-unsaved-changes-prompt.tsx`) is bound to the Portal editor's autosave.
- The e2e journey for this slice has not been run: the build rules for the slice forbid running the e2e suite locally, so its first run is CI's.

### Slice 3b (server), as built

1. **The command names its month.** `changeMonthTarget` also takes `month`, the running month as `YYYY-MM` on the calendar the month was cut in (the plan's `monthKey`). Without it a form opened on the last day of October and saved after midnight changed November: the catch-up step opens November first, and November's target equals the one the form showed whenever October had none of its own, so `expectedTarget` and `expectedVersion` both pass. A month that has ended answers `month_locked`, also for a paused goal whose next month never opened; `no_open_month` is for a month that has not opened.
2. **"A repeated save writes nothing" is the only exception to the conflict.** When the month already has the target and nothing would be written for the months after, the command answers `unchanged` whatever the form expected. When the month already has the target but the months after still need a version (the tick was added on a second save), a form with a stale version or target is refused, so a retry cannot replace a scheduled change the form never showed. A form that is current writes only the version, through the ordinary `revise`, and logs no month. Replaced by review fixes 1 to 3: what counts as a stale form, where the note goes, and a write that lost a race.
3. **A month put back on its version's target stores NULL again.** The change is logged like any other. `target_value IS NOT NULL` then means the month is judged against a target other than the one it started with, which is what the notice fact reads and when the marker shows.
4. **Order inside the transaction:** Program row (compare-and-set on the head, and not ended), the following version through `reviseInTx`, then the months, the log and the audit row. The log's `following_version_id` is a foreign key checked at once, so the version is written before the log; it also keeps the order Programs, versions, months that the 3a migration takes its locks in. `reviseInTx` is handed to the new repository module by the one that composes it, so the two modules do not import each other.
5. **`following_version_id` is set only when this change wrote the version.** When the months after already had the target, the outcome is `applied` with no version id: the version there was written by an earlier revision, which the Timeline lists on its own.
6. **`monthTargetPlan` answers null when no month is running.** It also returns `monthKey` and `period` (the running month). `followingBlockedReason` has one value, `scheduled_change_has_other_measure`; a subject or a measure that is no longer usable needs a read and is decided by the command (`not_applied`). `skipsMonth` compares calendar months: the following start is more than one month after the running one. A move west leaves a gap of hours and skips nothing.
7. **`targetChanges` is optional on the bundle.** `get` and `list` set it (an empty list for a goal with no change); the maintenance read does not carry it. A reader who sees only some subjects gets only the changes of those months. `monthTargetMarker(bundle, result, version)` in `application/goal-month-target-marker.ts` is the marker for any month; `GoalProgress.monthTarget` and each matrix row's `monthTarget` are that marker.
8. **Server function and schema have modules of their own:** `server/goal-month-target.ts` (`changeGoalMonthTarget`) and `application/dto/goal-month-target.dto.ts`, so neither is in first paint. The dialog's form schema is not written yet. `goal-refusal.ts` has a sentence for both new codes ("This month has ended. Its target can’t be changed." and the plan's "not open yet" line); the dialog can say the month's name itself, as the new-goal form does for its two longer answers.
9. **No query key was added.** The change is a goal write and invalidates `goalKeys.all`; the detail and the list carry the log and both month-to-date reads return the month's target. The ledger's `goalKeys` policy says so.
10. **The Recent Activity row carries the marker too**, as `detail: 'eligible:target_changed'`, with the same precedence over `set_in_month` (`feed/infrastructure/goal-month-marker.ts`).
11. **Left for the screens:** the Program card ("This month" and "From {next month}"), the goals list line, the Group card's "Changed by" line (the card already shows the month's target), the matrix marker line, the Timeline, the dialog with its stories, the reworded Revise sentence, and the e2e journey. The month rows of the goal page already print the month's own target. Slice 1 (screens) item 5 can now end its conflict sentence with "or change this month's target".

### Slice 3b (screens)

1. **The dialog works on what it showed.** When it opens it reads the clock, plans the running month with `monthTargetPlan` and keeps that plan and the goal's version. The save sends that month, target and version, so the command's guard means "what the form showed" even when the page behind the dialog has read the goal again meanwhile (a refetch on focus). Every opening mounts a form of its own. Opened on a goal with no running month (a page left open over the end of the month it showed) it says so and offers only Close. The page offers the button while its own read has a running month and the goal has not ended.
2. **The checkbox is a `ConsentCheckbox`** (the one framed yes of `C/CONTEXT.md`), and what the plan lists as question, warning and reason is its description, so the control's accessible description carries it. Its label names the first day in the Property's own zone. The question takes the number in the field ("November is already set to 500. Replace it with 300?") and is only the first sentence while the field holds no number or the same one. The warning is "November would have no goal result." The unavailable box reads "November already has its own change scheduled, so only October will change."; that sentence is typed by `followingBlockedReason`, so a new reason has none until one is written. An unavailable box sends `applyToFollowing: false` (changed by review fix 7).
3. **The receipt is the success.** The dialog stays open on it, Cancel becomes Close and Save is disabled; there is no toast. "Target saved." when only the month was to change, "Target saved. It also applies from Nov 1.", "Target saved. It replaces the change that was scheduled from Nov 1.", and the plan's two sentences for a kept change and for months after that were not changed, as a warning notice. "a portal in this goal is archived" is said only when every subject of the goal is a Portal; otherwise "a subject of this goal is no longer available", because the command gives one reason for a Portal, a group and a Property. A save that found the month already on the target says "October already had this target." and then the sentence about the months after. The wording is `C/goals/goal-month-target-receipt.ts`. Review fixes 8 and 9 add what the months after stay at and what the dialog does once the receipt is up.
4. **Refusals.** Every code has its sentence in `goal-refusal.ts`. `withGoalRefusals(fn, own)` takes a caller's own sentence for the codes it can say more about; the dialog names the month: "October has ended. Its target can't be changed."
5. **The month so far.** A goal with one subject shows "412 so far this month" as the help line of the field. A goal with several shows one line per subject ("Lobby: 412 so far this month"). It is the read the page already makes, so it shows for an active goal with 25 or fewer subjects and never for a paused one.
6. **`FormNumberField` gained `step`, and its `max` is optional**, because a monthly count has no upper bound. The browser holds the field to its range and step first, as it does for the Revise dialog's input; the schema names an empty field ("Enter a valid monthly target"). The form schema is `changeGoalMonthTargetFormSchema(metric)` in the command's DTO module: the measure is the running month's, not a field. It takes the target rule's wording from the Program form, so `addTargetIssue` is exported from DTO (+4 B of first paint).
7. **One wording for the marker**, `C/goals/goal-target-marker.ts`: "Changed by Marco on Oct 20, started at 400", with "(2 changes)" after the day once the target changed more than once, and "Changed on Oct 20, started at 400" without a name. It is on the Program card, the month rows, the results matrix (a line under "Effective … · set on …") and the Group card. On a month row it takes the place of "Set on Oct 20", and on the Group card of "Set by", the same precedence the notices use. The goals list uses the short form "changed Oct 20, started at 400".
8. **Names.** `goalPersonNames` names a member, calls someone the directory was read without "a former member", and names nobody while the directory has not been read (still loading, failed, or not this reader's to see); the sentence is then said without a person ("October's target was changed from 400 to 300"). Nobody is called a former member because a list is loading. Both goal routes read `membersQuery` with `useQuery` in the page, as the Group page does, not in the loader, which is first-paint code. The Group card keeps its own resolver: no name, no "by".
9. **Program card** (`C/goals/goal-program-card.tsx`). While a month runs it shows "This month: 300" with the marker under it and "From Nov 1: 300", always both, so the page says the same thing before and after a change. A change that waits for its month adds "set on Oct 20" to the second line, and each line names its measure when the waiting change has another one. A goal that has ended shows no second line. While no month runs the card shows one "Target" line as before. The line under them ("Counts from Oct 1 · set on Sep 20") is about the target the running month started with; Slice 1's "Target applies from …" wording remains only for a goal with no running month. The "Version: N" line and `goal-version-number.ts` are gone: the Timeline replaces them (Slice 2 review, item 6).
10. **Goals list.** The row shows this month's target while a month runs. It used to print the head version's, which after a Revise is next month's. "target 300 this month · changed Oct 20, started at 400", then "· 400 from Nov 1" when the months after differ (with the measure's name when it is another one). "this month" is added only when the line also says something about a change or about the months after. "set on" is left out for a changed month, whose marker says when. Review fix 10 moves the day beside the target when the row also names the months after.
11. **Target changes.** One line per command for the month log (a goal with several subjects logs a row per subject under one change id). A version is a line when its measure or target differs from the plan in force before it; a change of measure reads "changed the measure to Private rating average, with a target of 4.5". A version with an empty window is not a line and is not what the next change is read against, so a plan replaced before it began drops out and the change after it reads from the plan that was in force. The version a month change wrote is told on that change's line ("Also applies from Nov 1.") and hidden as a line of its own; when that version has an empty window the line reads "Was also set from Nov 1, but that never took effect." A version's `change_reason` is printed as the note unless it is one of the four default codes. An empty Timeline says "This goal's target has not been changed." Review fix 6 reads the versions in runs, so a change of subjects between them no longer changes who is credited or whether the months after are said to apply.
12. **The Revise sentence is added only while a month is running**: "Applies from Nov 1. To change this month, use Change this month's target." A goal that has not started, or a page whose month has ended, keeps "Applies from Dec 1."
13. **The conflict clause is offered only when the goal that holds the subject goes on.** The plan's copy adds "or change this month's target" to "…has a goal for this measure that ends Oct 31. Start the new goal next month". Most often that goal has ended, and `changeMonthTarget` refuses an ended goal (`invalid_transition`, step 1 and open question 4), so the advice could not be followed. `GoalSubjectHold` now carries `goalEnded`; the clause is added for a subject taken out of a goal that is still live, whose running month can be changed.
14. **e2e.** The journey creates its goal through the command with the running month named (`currentGoalStartMonth`), on a Portal of its own per attempt, and ends the goal in `finally`. It was not run here; it was read against the helpers the Slice 1 journey uses.
15. **Bundle.** Fresh production builds of the server head (`5d96d1f93`) and of the screens (`873141031`): 310,307 B → 310,427 B (77 js + 1 css both), of 310,600 B; the entry chunk 49,518 B → 49,636 B. The budget was not raised, and 173 B are left. The growth is the entry's list of chunk names, not code: four more shared lazy chunks, about 24 B each (the marker, which the Group page now shares with the goal pages; the calendar code of `goal-start`, which the goals list now reaches through the planner; a regrouped chunk of the goal page and the new-goal form; and the `circle-plus` icon, split from `timeline` now that the goal page draws a Timeline), plus 4 B for the exported target rule. An earlier build of the same first-paint code measured 310,404 B (entry 49,613 B): hashed chunk names alone move the total by 10 to 25 B. The dialog, the Timeline, the Program card and every view module are in lazy chunks, and the stylesheet is byte for byte the same size (27,463 B), because no new utility class is spelled.

**Open after the Slice 3b screens** (owner decisions, not built):

- The header of a goal's page now holds up to six actions (Edit name, Manage assignments, Change this month's target, Revise, Pause, End goal). They wrap; a menu for the less used ones is a design decision.
- "From Nov 1" is shown for a paused goal too. A paused goal opens no month until it is resumed. Since review fix 11 the day is said with "if resumed"; whether a paused goal should show a day at all is still open.
- The Group card names nobody when the directory cannot (its own rule since Slice 1), while a goal's page says "a former member".

### Slice 3b (review fixes)

Three reviews of the slice (code, data, honesty). Each item is pinned by a test beside the module it names.

1. **A note is never dropped.** A save that only sets the months after (the month already has the target) writes its version through the ordinary `revise` and logs no month, so no log row could carry the note. The version was written with `target_changed` and the note was stored nowhere. That version now takes the note as its `change_reason`, where a revision's note is, and the Timeline prints it. When the month changes, the note stays in the log and the version keeps `target_changed`. The dialog offers Save only once the form asks for a change: another number, or a tick that would write a version (`goalMonthTargetAsksForChange`, the dialog's side of the command's `followingIntent`). The subjects dialog already works this way. A note therefore cannot be sent on its own.
2. **What the form showed guards what it would write over** (replaces server item 2). The version guards every write. The month's target guards the month, and only while the month would change. So a repeat of a save whose months after were `not_applied` answers `unchanged` with the same outcome, and a save on a month someone else already set to the same target goes on to the months after. Both were refused with `revision_conflict` before. A form opened on an older version is still refused, which is what keeps a scheduled change it never showed from being replaced.
3. **A write that lost a race is read once more.** When the repository answers `revision_conflict`, the command reads the goal again and answers what the same save sent again would get: `unchanged` when the month now has the target (two identical saves at the same moment), otherwise the conflict. The second reading never writes a month.
4. **The command takes `expectedFollowingMonth`**, the plan's new `followingMonthKey`: the Property-local month, `YYYY-MM`, whose first day the checkbox names. A version that would start with another month is refused with `revision_conflict` before any write, so a Property that changed time zone after the dialog opened cannot skip a month the dialog never warned about. It is a month key and not an instant, like `month` and `startMonth`: a browser and a server whose time-zone data differ by an hour still agree on it, so the guard cannot refuse every save in such a zone. It is compared only when a version would be written.
5. **A count target is a safe integer.** `validateGoalTarget` is the one rule of create, revise and this command. A count such as 1e21 passed it and failed in the database as a numeric overflow (22003), which no command maps. The rule now refuses a count a JavaScript number cannot hold exactly, which is far inside `numeric(30, 10)`. No reason code was added: the answer is the existing `count_target_not_positive_integer`, so the first-paint DTO gains no message.
6. **Target changes are read in runs of versions** (amends screens item 11). A change of subjects writes a version with the target of the one before it, and one that lands on a plan still waiting for its month replaces that plan. Read version by version, the Timeline credited the subjects change with the target change, printed its note as the target's, and said of a month change "that never took effect" while the months after ran on its target. Consecutive versions with one measure and target are now one run. Who, when and note come from its first version; it applies from its first version with a month; it is compared with the last plan in force before it; and it has no line of its own when a month change wrote any of it. "Never took effect" is said only when no version of the run has a month.
7. **An unavailable box still asks** (replaces the last sentence of screens item 2). It sends `applyToFollowing: true`, so the command answers `kept_scheduled_change`, and the log, the Timeline and the receipt say the scheduled change was kept. That outcome could not be reached from the product before.
8. **The receipt says where the months after stay.** "Target saved. November stays at 300." when they were not asked for and are on another target than the month now has. That is a box left unticked, which is the default once a change is scheduled, including the change an earlier save of the same month wrote.
9. **The dialog ends on its receipt.** The three fields are disabled, the box's description is gone (its question was about a save still to come), and the focus moves to the receipt, so it is read and Close is the next stop.
10. **The goals list dates the target beside it** (amends screens item 10). "target 400 this month, set on Sep 20 · 500 from Nov 1". At the end of the row "set on" read as the day the 500 was set. A row that says nothing about the months after keeps "set on" at its end.
11. **A paused goal's months after are conditional.** The Program card says "From Nov 1, if resumed", the list "400 from Nov 1 if resumed", and the box's description ends "This goal is paused. No month opens until it is resumed." Resuming opens the months that were missed, so the day is still the day the target counts from.
12. **Bundle.** A fresh production build of the review fixes (`0c04bc81d`) measured 310,418 B of 310,600 B (77 js + 1 css), entry 49,619 B, against 310,427 B and 49,636 B for the screens. The budget was not raised; 182 B are left. The only first-paint code touched is the count rule.

**Open after the Slice 3b review** (owner decisions, not built):

- A second change in the same month finds the box unticked, because the version the first change wrote now waits like any scheduled change. Keeping it ticked for the month's own carry-forward is a change to the plan's rule ("default off with a question when a scheduled change exists"). The receipt says where the months after stay.
- The receipt and the Timeline of a paused goal say "from Nov 1" without the condition the card, the list and the box now carry.
- The count bound is the technical one (9,007,199,254,740,991). A product cap with a sentence of its own needs a new reason code, and its message would be in first paint.
- The e2e journey has still not been run. Review fix 4 added `expectedFollowingMonth` to the direct call in its cross-tenant block; the journey through the dialog needed no change.

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
