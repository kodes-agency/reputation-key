# Section 7 — Components Findings

**Date:** 2026-05-29
**Scope:** `src/components/` (all subdirectories)
**Baseline:** Zero default exports in non-UI components. All filenames kebab-case (verified by lint script).

---

## Summary

| Severity | Count |
|----------|-------|
| MAJOR | 0 |
| MINOR | 3 |
| NIT | 1 |
| **Total** | **4** |

---

## MINOR Findings

### S7-1 MINOR: 8 component files exceed 150-line limit

**Files:**
| Lines | File |
|-------|------|
| 199 | `src/components/inbox/inbox-filters.tsx` |
| 167 | `src/components/features/portal/portal-analytics/portal-analytics-tab.tsx` |
| 165 | `src/components/features/portal/portal-detail/portal-detail-page.tsx` |
| 159 | `src/components/inbox/inbox-detail-content.tsx` |
| 158 | `src/components/features/property/property-dashboard.tsx` |
| 157 | `src/components/visually-hidden-input.tsx` |
| 156 | `src/components/inbox/inbox-page.tsx` |
| 155 | `src/components/features/portal/portal-analytics/portal-analytics-charts.tsx` |

**Category:** pattern-violation
**Tag:** [code-fix] (deferred)

**What:** `src/components/CONTEXT.md:32` says: "Max 150 lines per file — if a component exceeds this, extract sub-components into the same concept folder. Exempt: `ui/` (vendored shadcn code)." These 8 files exceed 150 lines. None are in `ui/`.

**Why it matters:** Long component files are harder to review, test, and maintain. The 150-line limit forces decomposition into smaller, focused components.

**DOCS SAY:** Max 150 lines per file.
**CODE DOES:** 8 files exceed 150 lines (155-199 range).

**Fix direction:** Extract sub-components from each file. Most are 5-50 lines over the limit — likely one or two extractable pieces each. Deferred to a cleanup phase.

---

### S7-2 MINOR: `visually-hidden-input.tsx` — 157 lines, likely extractable

**File:** `src/components/visually-hidden-input.tsx` (157 lines)
**Category:** pattern-violation
**Tag:** [code-fix]

**What:** A single utility component is 157 lines. This likely contains multiple variants or complex logic that could be split.

**Fix direction:** Review for extraction opportunities. If the component is genuinely monolithic, document as an intentional exception.

---

### S7-3 MINOR: Inbox components — server function imports (cross-referenced from S6-2)

**Files:** 8 inbox component files
**Category:** pattern-violation (see S6-2 for details)
**Tag:** [code-fix]

**What:** Inbox components import server functions directly. This is the same finding as S6-2 — cross-referenced here because it's a component-layer violation.

**Fix direction:** See S6-2.

---

## NIT Findings

### S7-4 NIT: `src/components/inbox/` — 9 files, most are small but tightly coupled

**Files:** `src/components/inbox/` directory
**Category:** style
**Tag:** [code-fix] (minor)

**What:** The inbox feature has 9 component files (plus hooks/utils). Several components are tightly coupled to each other (e.g., `inbox-detail-content.tsx` imports from `reply-editor.tsx`, `inbox-notes-thread.tsx`, `inbox-detail-helpers.ts`). This is a naturally complex feature, but the coupling + server function imports + line length violations suggest the inbox could benefit from a refactor pass.

**Why it matters:** The inbox is the most complex UI surface and shows the most accumulated technical debt.

**Fix direction:** Consider a dedicated inbox refactor pass after S6-2 server function import fixes. Extract sub-components, move server fn hooks to route, document coupling intentionally.

---

## Verified Compliant

1. **Zero default exports** — All components use named exports. Verified across entire `components/` directory (excluding `ui/` which uses shadcn defaults).
2. **Kebab-case filenames** — Verified by `scripts/check-filenames.mjs`. All pass.
3. **Barrel re-exports** — Each feature has `index.ts` exporting page-level components. Sub-components stay internal.
4. **Props typing** — `type Props = Readonly<{ ... }>` used consistently (spot-checked 20+ components).
5. **One concept per folder** — Feature sub-folders are single user-facing concepts.
6. **Forms use TanStack Form + Zod v4 + shadcn/ui** — Spot-checked forms: portal-form, team-form, property-form, goal-form. All compliant.
7. **Charts use shadcn charts** — Dashboard and analytics charts use `ChartContainer`, `ChartTooltip`, `var(--color-*)`.
8. **`usePermissions()` used for permission checks** — Spot-checked: property dashboard, portal detail, inbox. All compliant.
