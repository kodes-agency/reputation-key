---
target: src/components/inbox-v2
total_score: 27
p0_count: 0
p1_count: 2
timestamp: 2026-05-30T14-33-24Z
slug: src-components-inbox-v2
---

# Critique: Inbox v2 (src/components/inbox-v2)

## Design Health Score

| #         | Heuristic                         | v2 Score | v1     | Change |
| --------- | --------------------------------- | -------- | ------ | ------ |
| 1         | Visibility of System Status       | 3        | 3      | —      |
| 2         | Match System / Real World         | 3        | 3      | —      |
| 3         | User Control and Freedom          | 3        | 2      | +1     |
| 4         | Consistency and Standards         | 3        | 3      | —      |
| 5         | Error Prevention                  | 2        | 2      | —      |
| 6         | Recognition Rather Than Recall    | 3        | 2      | +1     |
| 7         | Flexibility and Efficiency of Use | 3        | 2      | +1     |
| 8         | Aesthetic and Minimalist Design   | 4        | 3      | +1     |
| 9         | Error Recovery                    | 2        | 2      | —      |
| 10        | Help and Documentation            | 1        | 1      | —      |
| **Total** | **27/40**                         | **23**   | **+4** |

## Anti-Patterns Verdict

No AI slop. Three-panel layout correctly executed. Purple left-border on new items is the single biggest visual win. One eyebrow (FOLDERS label) but it's a single deliberate element.

Detector: Clean (0 findings).

## Overall Impression

v2 is a real improvement. Three-panel layout + folder navigation solves the cognitive load problem. Score jumped 23→27. Would be 29+ if folder counts and keyboard-nav-while-nothing-selected were fixed.

## What's Working

1. **Folder panel as sidebar** — Settings-style sidebar swap is clean. Back button, purple active states, icon+label folders feel like Linear.
2. **Purple left-border on new items** — Replaces destructive red badge. Subtle, on-brand.
3. **Density toggle** — Comfortable (multi-line) and Compact (single-line) both useful.

## Priority Issues

### [P1] Folder counts are all zero

inboxCounts hardcoded to 0. Panel looks broken. Need getInboxFolderCounts() server function.

### [P1] Keyboard nav requires clicking first

j/k only work after mouse-clicking an item. Should select first item when nothing is selected.

### [P2] Density toggle doesn't show current state

Columns2 icon same in both modes. No visual feedback for sighted users.

### [P2] ExternalLink button on hover is redundant

Entire row is clickable AND there's a hover-reveal button. Dual affordance from v1, now animated.

### [P3] Compact mode has dead code and no new-item indicator

item.status === 'new' ? '' : '' does nothing. No visual indicator for new items in compact mode.

### [P3] Folder empty state is generic

"No inbox items" for every folder. Should say "No escalated items" etc.

## Minor Observations

- FOLDERS eyebrow: intentional pattern divergence from settings sidebar?
- opacity-0 group-hover:opacity-100 has no prefers-reduced-motion alternative
- border-l-2 + border-b L-joint on new items may look messy
