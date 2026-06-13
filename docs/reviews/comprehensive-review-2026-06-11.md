# Comprehensive Code Review Report — 2026-06-11

## Scope

Review target: `reputation-key` workspace as of 2026-06-11.

Inputs used:

- `CONTEXT.md`
- `docs/standards.md`
- `src/contexts/CONTEXT.md`
- `src/routes/CONTEXT.md`
- `src/components/CONTEXT.md`
- `docs/plan/plan.md`
- `docs/audit/layer-integrity-audit.md`
- `docs/audit/remaining-issues.md`
- `docs/reviews/baseline.md`
- `docs/reviews/findings.md`
- source tree under `src/`
- `package.json` scripts and dependency metadata

Review lenses:

- Layer boundary integrity: `routes -> server -> application -> domain -> infrastructure`.
- Public API discipline: external callers import from `application/public-api`, not domain internals.
- Use-case ownership: authorization and transaction semantics live in application use cases.
- Event naming and domain constructor conventions.
- Typed error propagation.
- Test coverage for application/domain behavior.
- Existing architectural backlog and known by-design exceptions.

## Actions Taken During Review

### Fixed: dashboard authorization ownership

Finding: `src/contexts/dashboard/application/use-cases/get-staff-dashboard-data.ts` received `AuthContext` but delegated `dashboard.read` authorization to the server function.

Decision: moved the permission check into the use case and removed the duplicate server-side check.

Changed files:

- `src/contexts/dashboard/application/use-cases/get-staff-dashboard-data.ts`
- `src/contexts/dashboard/server/staff-dashboard.ts`

Result: dashboard read authorization now follows the documented application-layer ownership pattern while preserving the server's error mapping.

### Fixed: notification domain constructor leaks and test drift

Findings fixed before the final verification pass:

- Notification constructors accepted fake branded IDs via `'' as unknown as ...`.
- `createNotification`, `createNotificationEmail`, and `createNotificationPreference` drifted from the repo's constructor convention of requiring an explicit domain ID.
- `insertNotification` wrapped a typed `NotificationError` in a generic `Error`.
- Constructor transition tests asserted impossible states.

Changed files:

- `src/contexts/notification/domain/constructors.ts`
- `src/contexts/notification/domain/constructors-email.ts`
- `src/contexts/notification/domain/constructors-preference.ts`
- `src/contexts/notification/application/use-cases/insert-notification.ts`
- `src/contexts/notification/domain/constructors.test.ts`
- `src/contexts/notification/application/use-cases/insert-notification.test.ts`

Result: notification constructors require real branded IDs; the insert use case owns ID generation; typed errors propagate without generic wrapping; tests assert real states.

## Remaining Findings

### F1 — Context docs are incomplete against required section checklist

Severity: LOW / MAINTAINABILITY

Evidence:

- `src/contexts/portal/CONTEXT.md` is missing `## Bounded context`.
- `src/contexts/notification/CONTEXT.md` is missing:
  - `## Bounded context`
  - `## Glossary`
  - `## Relationships`
  - `## Invariants`
  - `## Events produced`
  - `## Events consumed`
  - `## Architecture layers`
  - `## Use cases`
  - `## Public API`
  - `## Server functions`
  - `## Permissions`
- `src/contexts/goal/CONTEXT.md` is missing `## Bounded context` and still contains removed section `## Flagged ambiguities`.

Why it matters:

- Context docs are the onboarding and pattern contract for new work.
- Missing sections make future agents and humans more likely to drift from architecture.

Recommended fix:

- Backfill the missing sections with concise, source-of-truth content.
- Replace `## Flagged ambiguities` with the current review/ADR pattern.

### F2 — Missing use-case tests for focused domain/application behavior

Severity: LOW / TEST QUALITY

Evidence from static scan:

- `src/contexts/portal/application/use-cases/add-portal-to-group.test.ts`
- `src/contexts/portal/application/use-cases/soft-delete-portal-group.test.ts`
- `src/contexts/portal/application/use-cases/remove-portal-from-group.test.ts`
- `src/contexts/portal/application/use-cases/get-portal-group.test.ts`
- `src/contexts/activity/application/use-cases/insert-activity-log.test.ts`
- `src/contexts/integration/application/use-cases/index.test.ts`

Why it matters:

- These are not confirmed bugs, but the missing tests leave small logic paths unverified.
- Portal group membership use cases have clear invariants: duplicate membership, missing group, portal not in group, event emission.

Recommended fix:

- Add focused use-case tests for success, forbidden, not-found, already-grouped/not-in-group, and event emission paths.
- Add an activity log test for duplicate suppression and actor lookup fallback.

### F3 — Several component/hook files exceed the 150-line guideline

Severity: LOW / MAINTAINABILITY

Evidence:

- `src/components/inbox/use-inbox-detail.ts:151`
- `src/components/layout/inbox-sidebar.tsx:155`
- `src/components/features/portal/portal-detail/portal-detail-page.tsx:166`
- `src/components/features/portal/portal-analytics/portal-analytics-charts.tsx:156`
- `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx:168`
- `src/components/features/property/property-dashboard.tsx:159`
- `src/components/features/notification/notification-panel.tsx:151`

Why it matters:

- Slight guideline drift is not a correctness failure.
- It does increase review surface and makes future edits easier to miss.

Recommended fix:

- Extract presentation-only helpers where the file mixes data loading, state, and UI.
- Do not extract just to satisfy a line count; extract only when it improves readability or testability.

### F4 — Full format check is not clean

Severity: LOW / HYGIENE

Evidence:

- `pnpm format:check` fails on 150 pre-existing files.
- Extension breakdown:
  - Markdown: 73
  - TypeScript: 43
  - TSX: 25
  - JSON: 3
  - MJS: 2
  - YAML: 1
  - JS: 1
  - HTML: 1
  - CSS: 1
- Largest groups:
  - `src/contexts/`: 29
  - `src/components/`: 25
  - `.hermes/plans/`: 24
  - `docs/plans/`: 9
  - `.hermes/reviews/`: 6
  - `src/shared/`: 6

Changed files pass Prettier.

Recommended fix:

- Treat this as a separate formatting cleanup task.
- Do not mix bulk formatting with architectural fixes unless the team explicitly wants a noisy PR.

### F5 — Existing architecture backlog remains valid

Severity: HIGH / ARCHITECTURE, carried forward

Evidence: `docs/audit/remaining-issues.md` still lists decisions that need product or architecture input.

Highest-priority carried items:

- `F058` Webhook replay protection.
- `F059` Rate limiting design.
- `F066` Database migration strategy for generated indexes.
- `F060` Persistent event log / outbox pattern.
- `F061` Composition locking strategy for multi-instance deployments.
- `F062` Real-time notification architecture.
- `F068` CORS/security headers.
- `F069` Health check endpoint.
- `F070` Graceful shutdown.

These are not code-review failures from this pass. They are intentional architecture decisions that remain open.

## Static Scan Results After Fixes

Static scan covered 1041 TypeScript/TSX files under `src/`.

Clean checks:

- True cross-context non-public imports: 0.
- Application-layer non-public imports: 0.
- Component imports from `application/public-api` by value: 0.
- Route imports from `application/public-api` by value: 0.
- Use cases receiving `AuthContext` without `can(...)`: 0.
- Direct Drizzle/shared DB imports outside infrastructure/shared/testing: 0.
- Event tag static issues: 0.

Known false positives / intentional exceptions:

- `src/composition.ts` imports across contexts by design as the composition root.
- `src/shared/testing/*` imports across contexts by design for test fixtures.
- `canAct`, `canSave`, `canSubmit`, and similar component locals are UI enablement flags, not permission checks.
- Infrastructure may import shared DB directly.
- Existing generated file `src/routeTree.gen.ts` still carries baseline `as any` noise.

## Verification

Passed commands:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm vitest run src/contexts/notification/domain/constructors.test.ts src/contexts/notification/application/use-cases/insert-notification.test.ts`
- Changed-file Prettier check for all modified code/docs/review artifacts.

Observed results:

- Targeted notification tests: 32 passed.
- Full test suite: 217 files / 1931 tests passed.
- Typecheck: clean.
- Lint: clean; filename check passed.
- Static scan: no remaining true boundary violations found by the refined checks above.

Known failing command:

- `pnpm format:check` fails because of 150 unrelated pre-existing formatting violations.
- Modified files pass Prettier.

## Review Artifacts

Created:

- `docs/reviews/consecutive-clean-review-plan.md`
- `docs/reviews/consecutive-clean-review-pass-0.md`
- `docs/reviews/consecutive-clean-review-pass-1.md`
- `docs/reviews/consecutive-clean-review-pass-2.md`
- `docs/reviews/consecutive-clean-review-pass-3.md`
- `docs/reviews/comprehensive-review-2026-06-11.md`

## Bottom Line

The codebase is materially cleaner than the prior review baseline: typecheck, lint, full tests, and refined boundary scans are clean after the notification and dashboard fixes.

Remaining work is mostly documentation, test coverage, formatting hygiene, and explicit architecture decisions — not active boundary or type/lint failures.
