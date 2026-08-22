# Review Findings Remediation Plan

> **For Hermes:** Execute phase by phase. Gate each phase with `tsc --noEmit && pnpm lint && pnpm test`.
> **Source:** `review/master-findings-2026-05-30.md` — 10-segment codebase audit of 869 TS/TSX files.

**Goal:** Close all remaining findings: 1 dependency gap, 8 untested use cases, 2 doc exceptions, 2 deferred structural refactors.

**Architecture:** Three phases — hygiene (15 min), test coverage (60 min), documentation (10 min). Composition/worker split deferred to Phase 22.

---

## Phase A — Hygiene (quick, low-risk)

### Task A1: Add `pino-pretty` to devDependencies

**Objective:** Fix `depcheck` "missing dependency" warning. Logger imports `pino-pretty` but it was never declared.

**Files:**

- Modify: `package.json`

**Step 1: Add dependency**

```bash
pnpm add -D pino-pretty
```

**Step 2: Verify**

```bash
npx depcheck --ignores='@types/*,eslint*,prettier*,vitest*,typescript,tsup,*rolldown*' | grep pino-pretty
# Expected: (no output — no longer flagged as missing)
```

**Gate:** `tsc --noEmit` (3 pre-existing), `pnpm lint` (clean), `pnpm test` (green).

---

## Phase B — Test Coverage (8 use cases)

### Background

8 use cases have no colocated `.test.ts` file. Each follows the established dependency-injection pattern: `(deps) => async (input, ctx?) => Promise<T>`. Test using in-memory port fakes from `shared/testing/`.

**Testing pattern (from existing use case tests):**

```typescript
import { describe, it, expect } from 'vitest'
import { useCaseFn } from './use-case'
import { createInMemoryFooRepo } from '#/shared/testing/in-memory-foo-repo'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'

const ORG = organizationId('org-test')
const PROP = propertyId('00000000-0000-4000-8000-000000000001')

describe('useCaseName', () => {
  it('happy path', async () => {
    /* ... */
  })
  it('error path', async () => {
    /* ... */
  })
})
```

**Gate per task:** `pnpm vitest run <test-file>` — all pass.

---

### Task B1: Test `get-public-portal`

**Objective:** Test the guest public-portal use case with in-memory port fakes.

**Files:**

- Create: `src/contexts/guest/application/use-cases/get-public-portal.test.ts`

**What to test:**

1. Happy path: resolves org from slug, returns portal + org name
2. Error path: portal not found → `PublicPortalError('not_found')`

**Dependencies:** `PublicPortalLookupPort`, `PortalContextResolverPort` — both have port interfaces in `guest/application/ports/`. Create inline fakes returning test data.

**Gate:** `pnpm vitest run src/contexts/guest/application/use-cases/get-public-portal.test.ts`

---

### Task B2: Test `resolve-link-and-track`

**Objective:** Test link resolution + click tracking for guest portal links.

**Files:**

- Create: `src/contexts/guest/application/use-cases/resolve-link-and-track.test.ts`

**What to test:**

1. Happy path: resolves link, records click event, emits event
2. Error path: link not found → error
3. Verify event emission via `CapturingEventBus`

**Gate:** `pnpm vitest run src/contexts/guest/application/use-cases/resolve-link-and-track.test.ts`

---

### Task B3: Test `resolve-portal-context`

**Objective:** Test portal context resolution (org → property → portal lookup chain).

**Files:**

- Create: `src/contexts/guest/application/use-cases/resolve-portal-context.test.ts`

**What to test:**

1. Happy path: resolves full chain org → property → portal
2. Error path: any link in chain missing → not_found

**Gate:** `pnpm vitest run src/contexts/guest/application/use-cases/resolve-portal-context.test.ts`

---

### Task B4: Test `create-portal-group`

**Objective:** Test portal group creation with permission check.

**Files:**

- Create: `src/contexts/portal/application/use-cases/create-portal-group.test.ts`

**What to test:**

1. Happy path: creates group, returns PortalGroup, emits event
2. Permission denied: Staff role → forbidden
3. Duplicate name: group name taken → conflict error
4. Verify event emission

**Deps:** `inMemoryPortalGroupRepo` — create inline or extend `in-memory-portal-repo.ts`.

**Gate:** `pnpm vitest run src/contexts/portal/application/use-cases/create-portal-group.test.ts`

---

### Task B5: Test `update-portal-group`

**Objective:** Test portal group name/description update.

**Files:**

- Create: `src/contexts/portal/application/use-cases/update-portal-group.test.ts`

**What to test:**

1. Happy path: updates name, returns updated group
2. Permission denied: Staff → forbidden
3. Not found: nonexistent group → not_found

**Gate:** `pnpm vitest run src/contexts/portal/application/use-cases/update-portal-group.test.ts`

---

### Task B6: Test `delete-portal-group`

**Objective:** Test portal group deletion with event emission.

**Files:**

- Create: `src/contexts/portal/application/use-cases/delete-portal-group.test.ts`

**What to test:**

1. Happy path: deletes group, emits `portal_group.deleted` event
2. Permission denied: Staff → forbidden
3. Not found: nonexistent group → not_found

**Gate:** `pnpm vitest run src/contexts/portal/application/use-cases/delete-portal-group.test.ts`

---

### Task B7: Test `list-portal-groups`

**Objective:** Test portal group listing for a property.

**Files:**

- Create: `src/contexts/portal/application/use-cases/list-portal-groups.test.ts`

**What to test:**

1. Happy path: returns groups for property
2. Permission denied: Guest → forbidden
3. Empty list: property with no groups

**Gate:** `pnpm vitest run src/contexts/portal/application/use-cases/list-portal-groups.test.ts`

---

### Task B8: Test `list-portal-links`

**Objective:** Test portal link listing (existing use case, no test).

**Files:**

- Create: `src/contexts/portal/application/use-cases/list-portal-links.test.ts`

**What to test:**

1. Happy path: returns links for portal
2. Permission denied: Staff → forbidden
3. Empty list: portal with no links

**Gate:** `pnpm vitest run src/contexts/portal/application/use-cases/list-portal-links.test.ts`

---

### Phase B Gate

```bash
pnpm test
# Expected: 182+ test files, 1707+ tests, all green
```

---

## Phase C — Documentation Exceptions

### Task C1: Document `class Error` exception in CONTEXT.md

**Objective:** `src/contexts/CONTEXT.md` says "No class" but `shared/` has two legitimate Error subclasses. Document the exception.

**File:** Modify `src/contexts/CONTEXT.md`

**Step 1: Add exception note to "Functional style" section**

Find the section starting with `## Functional style` (line 116). After "No class, no this, no enum." add:

```markdown
- **Exception:** `class ... extends Error` for runtime `instanceof` checks and
  seroval-compatible error serialization. See `shared/auth/server-errors.ts`
  (`ServerFunctionError`) and `shared/domain/assert.ts` (`UnreachableError`).
```

**Gate:** `pnpm lint` (clean).

---

### Task C2: Document `tailwindcss` depcheck false positive

**Objective:** Record that `tailwindcss` shows as unused in depcheck but is consumed via PostCSS config.

**File:** Modify `src/shared/CONTEXT.md` — add to the "Rules" section or create a `docs/dev-notes/depcheck-false-positives.md`.

**Template:**

```markdown
# Depcheck False Positives

| Dependency            | Reason                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| `tailwindcss`         | Consumed via PostCSS config (`postcss.config.mjs`), not by source imports. Known depcheck limitation. |
| `@rolldown/binding-*` | Required by Vite/Rolldown build. Depcheck cannot detect platform-native binary usage.                 |
```

**Gate:** `pnpm lint` (clean).

---

## Phase D — Deferred (Phase 22)

| Finding | Description                                                 | Effort  | Phase    |
| ------- | ----------------------------------------------------------- | ------- | -------- |
| S10-1   | `composition.ts` — split into per-context wiring            | ~60 min | Phase 22 |
| S10-2   | `worker/index.ts` — split into per-context job registration | ~45 min | Phase 22 |

**Deferred because:** These are structural refactors that touch every context's wiring. Doing them in isolation risks merge conflicts with active feature branches. Schedule for Phase 22 (production hardening) when feature churn is lower.

---

## Execution Order

```
Phase A (15 min) → Phase B (60 min) → Phase C (10 min)
                                         ↓
                                    Phase D (Phase 22)
```

**Total immediate effort:** ~85 minutes across 10 tasks.

**Gate after every task:** commit with `type: description` convention.
