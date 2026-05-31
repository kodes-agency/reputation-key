---
target: src/components/inbox
total_score: 23
p0_count: 0
p1_count: 2
timestamp: 2026-05-30T14-05-25Z
slug: src-components-inbox
---

# Critique: Inbox (src/components/inbox)

## Design Health Score

| #         | Heuristic                      | Score     | Key Issue                                                        |
| --------- | ------------------------------ | --------- | ---------------------------------------------------------------- |
| 1         | Visibility of System Status    | 3         | Silent auto-mark-read; no mutation confirmation toasts           |
| 2         | Match System / Real World      | 3         | Workflow terms assume domain knowledge; hardcoded star color     |
| 3         | User Control and Freedom       | 2         | No undo for bulk actions; no filter reset; click loses scroll    |
| 4         | Consistency and Standards      | 3         | fill-yellow-400 not a token; duplicate row-click + button        |
| 5         | Error Prevention               | 2         | Bulk changes irreversible; reply draft lost; min>max unvalidated |
| 6         | Recognition Rather Than Recall | 2         | Icon-only button; no property search; rating hint missing        |
| 7         | Flexibility and Efficiency     | 2         | No keyboard nav; no mark all read; no filter presets             |
| 8         | Aesthetic and Minimalist       | 3         | Red badge for "new"; border-heavy vs tonal layering              |
| 9         | Error Recovery                 | 2         | No bulk-error feedback; silent invalid filter combos             |
| 10        | Help and Documentation         | 1         | No tooltips, inline help, or doc links                           |
| **Total** |                                | **23/40** | **Acceptable**                                                   |

## Anti-Patterns Verdict

**LLM**: Not AI slop. Standard email-split layout, consistent shadcn components, no gradient/glass/hero-metric violations. Two tells: hardcoded fill-yellow-400 and destructive badge for informational "new" count.

**Detector**: Clean — 0 findings. Expected for shadcn-based markup.

**Browser**: Skipped (no dev server running).

## Overall Impression

Solid v1 — functional, restrained, correctly architected. Reads as "engineer-built" rather than "designed." The biggest opportunity: turn it from a generic email client clone into a Linear-quality inbox built for reputation management.

## What's Working

1. **Split-layout architecture** — Correct pattern, clean component decomposition, mobile sheet fallback.
2. **State coverage** — Loading, empty, error, pending all handled.
3. **URL-driven state** — Filters and selection in search params; survives refresh.

## Priority Issues

### [P1] Silent auto-mark-read destroys trust

Status changes silently when opening detail. No confirmation. Manager can't track what was actually read vs opened.

**Fix**: Toast on auto-mark, or don't auto-mark — require explicit action.

**Suggested**: `$impeccable clarify inbox auto-mark-read`

### [P1] High cognitive load from filter overload

7 filter controls visible simultaneously. Working memory limit is 4. 6 of 8 cognitive load items fail.

**Fix**: Progressive disclosure — show only status filter; tuck rest behind "More filters."

**Suggested**: `$impeccable distill inbox filters`

### [P2] No keyboard navigation

Zero shortcuts. Managers triaging 50+ reviews/day must click every item.

**Fix**: j/k navigation, Enter to open, e to archive, Esc to close.

**Suggested**: `$impeccable bolder inbox shortcuts`

### [P2] Yellow star rating ignores design system

fill-yellow-400 hardcoded — not in palette, jarring against violet-graphite dark bg.

**Fix**: Use Spectral Violet or chart token for stars.

**Suggested**: `$impeccable colorize inbox rating stars`

### [P3] Icon-only Actions button has no accessible label

No aria-label. Fails WCAG SC 3.3.2. Consider removing duplicate affordance entirely.

**Fix**: Add aria-label or remove column.

**Suggested**: `$impeccable adapt inbox accessibility`

## Persona Red Flags

- **Alex**: No keyboard shortcuts, no "mark all read," load-more friction.
- **Jordan**: 7 filter controls on first load, unexplained workflow terms, rating hints missing.
- **Sam**: Unlabeled icon button, no th scope attributes, no aria-selected on rows, silent status changes.

## Minor Observations

- Destructive badge for "new" reads as error. Use Spectral Violet.
- max-w-[160px] truncation fails on mobile (no hover for title).
- 480px detail panel is tight on 1024px screens.
- bg-muted/30 opacity overlay may double-render since --muted is a full color.

## Questions to Consider

1. Does the inbox need 7 columns?
2. What if the detail panel showed the next item at the bottom?
3. Would a command palette be more Linear-like than the filter bar?
4. What if "new" used a purple left-border instead of a red badge?
