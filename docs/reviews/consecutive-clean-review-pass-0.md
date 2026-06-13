# Consecutive Clean Review — Pass 0 Findings and Fixes

**Date:** 2026-06-11
**Scope:** First comprehensive review continuation pass over `src/` and `e2e/`, using the rubric in `docs/reviews/consecutive-clean-review-plan.md`.

## Review method

- Read current architecture/context sources: `CONTEXT.md`, `docs/standards.md`, `docs/plan/plan.md`, prior review findings, and remaining issue docs.
- Ran LSP/type diagnostics before fixes: workspace TypeScript diagnostics were clean.
- Ran static scans for:
  - Cross-context application imports bypassing `application/public-api`.
  - Infrastructure direct imports from other contexts' domain/application layers.
  - Domain imports outside `shared` and the current context's domain layer.
  - `throw new Error(...)`, `as any`, `as unknown as`, TODO/FIXME/HACK, `console.*`, `eslint-disable`, `node:assert`, and `crypto.randomUUID` candidates.
- Reviewed notification constructor/use-case tests and implementation after scan findings.

## Actionable findings fixed

### F0 — Notification constructors leaked sentinel IDs

**Evidence:** Notification domain constructors created objects with empty string casts to branded ID types:

- `src/contexts/notification/domain/constructors.ts`
- `src/contexts/notification/domain/constructors-email.ts`
- `src/contexts/notification/domain/constructors-preference.ts`

**Why it mattered:** Branded ID types should be constructed by shared ID factories, not invented as `'' as unknown as ...`. This weakens domain invariants and makes accidental invalid IDs easier.

**Fix:** Constructor inputs now require real IDs. `insertNotification` supplies generated IDs from deps and passes them into constructors.

### F1 — Notification constructor input shape drifted from domain convention

**Evidence:** Other domain constructors in this codebase, such as `src/contexts/goal/domain/constructors.ts`, require IDs in their primary constructor input.

**Why it mattered:** The temporary `CreateNotificationWithIdInput` alias made notification constructors look different from the existing domain pattern.

**Fix:** `CreateNotificationInput` now includes `id: NotificationId`; `InsertNotificationInput` is `Omit<CreateNotificationInput, 'id'>`.

### F2 — Use case wrapped domain error in `Error`

**Evidence:** `insertNotification` previously did `throw new Error(result.error.message)` after construction failure.

**Why it mattered:** Wrapping a `NotificationError` in a generic `Error` loses typed error identity and violates the existing Result/error propagation style.

**Fix:** `insertNotification` now throws `result.error` directly.

### F3 — Constructor transition tests asserted impossible states

**Evidence:** After constructor ID fixes, `constructors.test.ts` exposed two bad test cases:

- "already read" object had `readAt` but still `status: 'unread'`.
- "dismissed" object omitted `status: 'dismissed'`.

**Fix:** Updated tests to set `status: 'read'` and `status: 'dismissed'` respectively.

## Non-actionable/static-noise findings

- Existing `throw new Error(...)` remains in tests and infrastructure adapters; not all are domain violations.
- Existing `as any` / `as unknown as` remains mostly in tests and shadcn/shared compatibility surfaces.
- Existing TODOs remain in team public API, goal creation, and goal job scheduling; these are broader product/architecture follow-ups, not introduced by this pass.
- Existing `node:assert` in portal/goal domain events and `console.error` in shared auth predate this pass.

## Verification after fixes

- `pnpm vitest run src/contexts/notification/domain/constructors.test.ts src/contexts/notification/application/use-cases/insert-notification.test.ts` — 32 passed.
- `pnpm typecheck` — clean.
- `pnpm lint` — clean.
- `pnpm test` — 217 files / 1931 tests passed.

## Exit decision

Pass 0 found actionable issues and fixed them. The next three review passes must be clean before this loop exits.
