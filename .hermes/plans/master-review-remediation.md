# Master Review Remediation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix all remaining issues from the 2026-05-18 master code review (48 findings total, 11+4 action items remaining).

**Architecture:** Hexagonal / ports-and-adapters. Factory functions. Tagged errors. Branded IDs. Clock injection at build level only (repos use `new Date()` consistently — NOT a violation).

**Tech Stack:** TypeScript, Drizzle ORM, TanStack Router/Start, Vitest, BullMQ

---

## Batch 1 — Must Fix (P1 Convention + Test Gaps)

These are the highest-value items: one genuine convention fix and two test gaps that protect critical security fixes.

### Task 1: Consolidate URL validation into shared domain function

**Objective:** Eliminate 3 duplicate URL validators by extracting a single `isValidExternalUrl` into portal domain rules, and align `update-link.ts` to use https-only validation.

**Files:**

- Modify: `src/contexts/portal/domain/rules.ts` — add `isValidExternalUrl`
- Modify: `src/contexts/portal/application/use-cases/create-link.ts` — remove private validator, import from rules
- Modify: `src/contexts/portal/application/use-cases/update-link.ts` — replace `validateUrl` with `isValidExternalUrl` for URL fields
- Modify: `src/routes/api/public/click/$linkId.ts` — remove private validator, import from rules

**Step 1: Add `isValidExternalUrl` to `rules.ts`**

In `src/contexts/portal/domain/rules.ts`, after the existing `validateUrl` function (around line 112), add:

```ts
export const isValidExternalUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}
```

**Step 2: Update `create-link.ts`**

In `src/contexts/portal/application/use-cases/create-link.ts`:

- Remove the private `isValidExternalUrl` function (lines 13-20)
- Add import: `import { isValidExternalUrl } from '../../domain/rules'`
- Line 50 stays the same: `if (!isValidExternalUrl(input.url))` — now uses the imported version

**Step 3: Update `update-link.ts`**

In `src/contexts/portal/application/use-cases/update-link.ts`:

- Add import: `import { isValidExternalUrl } from '../../domain/rules'`
- Around line 54, for URL updates, replace `validateUrl(input.url)` with:
  ```ts
  if (!isValidExternalUrl(input.url)) {
    throw portalError('invalid_url', 'Link URL must use https:// scheme')
  }
  ```
- Keep `validateUrl` import if still used for other non-external URL fields

**Step 4: Update `$linkId.ts`**

In `src/routes/api/public/click/$linkId.ts`:

- Remove the private `isValidRedirectUrl` function (lines 5-12)
- Add import: `import { isValidExternalUrl } from '#/contexts/portal/domain/rules'`
- Line 26: rename `isValidRedirectUrl` → `isValidExternalUrl`

**Step 5: Run tests**

```bash
cd /Users/bozhidardenev/conductor/workspaces/reputation-key/managua && pnpm vitest run src/contexts/portal
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(portal): consolidate URL validation into shared domain rules

- Extract isValidExternalUrl to portal/domain/rules.ts
- Remove 2 duplicate private validators from create-link and click route
- Align update-link to use https-only validation (defense in depth)"
```

---

### Task 2: Add URL validation edge-case tests

**Objective:** Test `isValidExternalUrl` against edge cases (javascript:, data:, protocol-relative, http:, encoded).

**Files:**

- Create: `src/contexts/portal/domain/__tests__/rules.test.ts` (or add to existing test file if one exists)

**Step 1: Write tests**

```ts
import { describe, it, expect } from 'vitest'
import { isValidExternalUrl, validateUrl } from '../rules'

describe('isValidExternalUrl', () => {
  it('accepts valid https URLs', () => {
    expect(isValidExternalUrl('https://example.com')).toBe(true)
    expect(isValidExternalUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('rejects http URLs', () => {
    expect(isValidExternalUrl('http://example.com')).toBe(false)
  })

  it('rejects javascript: scheme', () => {
    expect(isValidExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data: scheme', () => {
    expect(isValidExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    expect(isValidExternalUrl('//evil.com')).toBe(false)
  })

  it('rejects malformed URLs', () => {
    expect(isValidExternalUrl('')).toBe(false)
    expect(isValidExternalUrl('not-a-url')).toBe(false)
  })

  it('rejects mailto: scheme', () => {
    expect(isValidExternalUrl('mailto:admin@example.com')).toBe(false)
  })
})
```

**Step 2: Run tests**

```bash
pnpm vitest run src/contexts/portal/domain/__tests__/rules.test.ts
```

**Step 3: Commit**

```bash
git add -A && git commit -m "test(portal): add edge-case tests for isValidExternalUrl"
```

---

### Task 3: Add cross-tenant isolation test for GBP cache repository

**Objective:** Verify Org A cannot read Org B's GBP cache entries — following the existing pattern from `portal-link.repository.test.ts`.

**Files:**

- Modify: `src/contexts/integration/infrastructure/repositories/__tests__/gbp-cache.repository.test.ts`

**Step 1: Add multi-org setup**

Follow the `portal-link.repository.test.ts` pattern. Add a second org (`ORG_B`) alongside existing `ORG_A`:

- Add `ORG_B` constant and seed it in `beforeEach`
- Seed a property under ORG_B
- Add `truncateAll` that clears gbp_cache + properties for both orgs

**Step 2: Write isolation tests**

```ts
describe('tenant isolation', () => {
  it('findByPropertyAndType returns null for different org', async () => {
    // Seed cache for ORG_B's property
    await repo.upsert(cacheEntryForOrgB)

    // Try to read with ORG_A context
    const result = await repo.findByPropertyAndType(ORG_A_ID, PROPERTY_B_ID, 'reviews')

    expect(result).toBeNull()
  })

  it('deleteByProperty does not delete other org cache entries', async () => {
    // Seed cache for both orgs
    await repo.upsert(cacheEntryForOrgA)
    await repo.upsert(cacheEntryForOrgB)

    // Delete ORG_A's cache
    await repo.deleteByProperty(PROPERTY_A_ID, ORG_A_ID)

    // ORG_B's cache should still exist
    const result = await repo.findByPropertyAndType(ORG_B_ID, PROPERTY_B_ID, 'reviews')
    expect(result).not.toBeNull()
  })
})
```

**Step 3: Run tests**

```bash
pnpm vitest run src/contexts/integration/infrastructure/repositories/__tests__/gbp-cache.repository.test.ts
```

**Step 4: Commit**

```bash
git add -A && git commit -m "test(integration): add cross-tenant isolation tests for GBP cache repo"
```

---

## Batch 2 — Should Fix (Route Quality)

### Task 4: Add `notFound()` to authenticated portal and team loaders

**Objective:** Replace raw `Error` throws and missing checks with TanStack Router's `notFound()` for proper 404 handling.

**Files:**

- Modify: `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/teams/$teamId.tsx`

**Step 1: Fix `$portalId.tsx`**

Add import (line 1):

```ts
import { createFileRoute, notFound } from '@tanstack/react-router'
```

In the loader (after line 21), add null check:

```ts
if (!portal) throw notFound()
```

**Step 2: Fix `$teamId.tsx`**

Add import (line 1):

```ts
import { createFileRoute, notFound } from '@tanstack/react-router'
```

Line 35 — replace:

```ts
// Before:
if (!team) throw new Error('Team not found')
// After:
if (!team) throw notFound()
```

**Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

**Step 4: Commit**

```bash
git add -A && git commit -m "fix(routes): use notFound() instead of raw Error in portal/team loaders"
```

---

## Batch 3 — Nice to Have (Cleanup)

### Task 5: Extract `createLinkResolverPort` to separate file

**Objective:** Bring `portal-link.repository.ts` under 150 LOC by moving the link resolver port implementation to its own file.

**Files:**

- Create: `src/contexts/portal/infrastructure/repositories/link-resolver.repository.ts`
- Modify: `src/contexts/portal/infrastructure/repositories/portal-link.repository.ts` — remove lines 193-223
- Modify: `src/contexts/guest/build.ts` — update import if it imports `createLinkResolverPort` from the old file

**Step 1: Create `link-resolver.repository.ts`**

Move `createLinkResolverPort` (currently lines 193-223) into the new file. Required imports:

```ts
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { portalLinks, portals } from '#/shared/db/schema/portal.schema'
import type { LinkResolverPort } from '../../application/ports/link-resolver.port'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  PortalLinkId,
} from '../../domain/types'
import { trace } from '#/shared/observability/trace'
```

**Step 2: Remove from `portal-link.repository.ts`**

Delete lines 193-223 and the `LinkResolverPort` import if no longer needed in that file.

**Step 3: Update imports**

Search for any file importing `createLinkResolverPort` and update the path:

```bash
grep -r 'createLinkResolverPort' src/ --include='*.ts'
```

**Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor(portal): extract link-resolver port to own file

portal-link.repository.ts now under 150 LOC."
```

---

### Task 6: Extract `CopyButton` to shared UI component

**Objective:** Move inline `CopyButton` from portals index route to a reusable shared component.

**Files:**

- Create: `src/components/ui/copy-button.tsx`
- Modify: `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`

**Step 1: Create `src/components/ui/copy-button.tsx`**

Extract the component (currently lines 30-50 in `portals/index.tsx`):

```tsx
import { Copy, Check } from 'lucide-react'
import { useState, useCallback } from 'react'

interface CopyButtonProps {
  text: string
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    const url = `${window.location.origin}/p/${text}`
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="..." // preserve existing classes
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </button>
  )
}
```

**Step 2: Update `portals/index.tsx`**

- Remove inline `CopyButton` function (lines 30-50)
- Add import: `import { CopyButton } from '#/components/ui/copy-button'`

**Step 3: Typecheck**

```bash
pnpm tsc --noEmit
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor(ui): extract CopyButton to shared component"
```

---

### Task 7: Split `people.tsx` into tab sub-components

**Objective:** Bring `people.tsx` from 281 LOC under control by extracting each tab into its own component file.

**Files:**

- Create: `src/components/features/property/people/staff-tab.tsx` (lines 128-160 content)
- Create: `src/components/features/property/people/teams-tab.tsx` (lines 162-243 content)
- Create: `src/components/features/property/people/directory-tab.tsx` (lines 246-277 content)
- Modify: `src/routes/_authenticated/properties/$propertyId/people.tsx`

**Step 1: Create `staff-tab.tsx`**

Extract the `TabsContent value="staff"` block. Pass necessary props (mutations, data) from parent.

**Step 2: Create `teams-tab.tsx`**

Extract the `TabsContent value="teams"` block (largest section — ~80 LOC).

**Step 3: Create `directory-tab.tsx`**

Extract the `TabsContent value="directory"` block.

**Step 4: Update `people.tsx`**

Replace inline tab content with imported sub-components:

```tsx
import { StaffTab } from '#/components/features/property/people/staff-tab'
import { TeamsTab } from '#/components/features/property/people/teams-tab'
import { DirectoryTab } from '#/components/features/property/people/directory-tab'

// In JSX:
<TabsContent value="staff"><StaffTab {...staffProps} /></TabsContent>
<TabsContent value="teams"><TeamsTab {...teamsProps} /></TabsContent>
<TabsContent value="directory"><DirectoryTab {...directoryProps} /></TabsContent>
```

**Step 5: Typecheck**

```bash
pnpm tsc --noEmit
```

**Step 6: Commit**

```bash
git add -A && git commit -m "refactor(routes): split people.tsx into StaffTab, TeamsTab, DirectoryTab"
```

---

## Execution Order

```
Batch 1 (sequential — test dependencies):
  Task 1: Consolidate URL validation  →  Task 2: URL validation tests
  Task 3: GBP cache isolation tests (independent)

Batch 2 (parallel after Batch 1):
  Task 4: notFound() in loaders

Batch 3 (parallel after Batch 2):
  Task 5: Extract link-resolver repo
  Task 6: Extract CopyButton
  Task 7: Split people.tsx tabs

Final: pnpm tsc --noEmit && pnpm vitest run
```

## Verification

After all tasks:

```bash
# Type check
pnpm tsc --noEmit

# Run all tests
pnpm vitest run

# Verify no regressions in portal/integration contexts
pnpm vitest run src/contexts/portal src/contexts/integration src/contexts/guest
```

## Items Intentionally Left As-Is

| Item                                     | Reason                                                                                                             |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| P1-01 `new Date()` in gbp-cache repo     | All repos use `new Date()` — clock injection is at build/use-case level, not repo level. Convention is consistent. |
| P2-03 `ensureActiveOrg` picks first      | Reasonable UX default, users can switch orgs via `setActiveOrganization`                                           |
| P2-06 Module-scope `initPermissionTable` | Well-justified auto-init, pure data, lazy-init would be more error-prone                                           |
| P2-07 New Redis per queue/worker         | BullMQ requirement — blocking ops need dedicated connections                                                       |
| P2-08 `signInUser` swallows errors       | Security feature — prevents user enumeration attack                                                                |
| P2-10 3 DB round-trips in refresh        | Background job, infrequent, clarity > optimization                                                                 |
| P2-01 bare `process.env` in auth-cli     | CLI tool, runs before bootstrap where `getEnv()` is unavailable                                                    |
| P2-04 SQL interpolation in tests         | Test-only code, WARNING present, hardcoded arrays only                                                             |
| P2-12 `deleteAllExpired` no tenant       | System-level cron, ephemeral cache data, name is explicit                                                          |
| All P3 items marked ACCEPTABLE           | See audit report for individual justifications                                                                     |
