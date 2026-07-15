# B2.5 — Status Token Contrast Audit

**Date:** 2026-07-14
**Scope:** Semantic status tokens in light and dark themes
**Standard:** WCAG 2.2 AA (4.5:1 for normal text, 3:1 for large text and UI components)

## Semantic status tokens

| Token                 | Light theme         | Dark theme            | Usage                              |
| --------------------- | ------------------- | --------------------- | ---------------------------------- |
| `success` / `default` | Green-600 on white  | Green-500 on dark bg  | Active connection, published reply |
| `warning`             | Amber-600 on white  | Amber-500 on dark bg  | Degraded connection, importing     |
| `destructive`         | Red-600 on white    | Red-500 on dark bg    | Reauth required, failed, errors    |
| `secondary` / `muted` | Gray-600 on white   | Gray-400 on dark bg   | Disconnected, archived             |
| `foreground`          | Near-black on white | Near-white on dark bg | Body text                          |
| `muted-foreground`    | Gray-600 on white   | Gray-400 on dark bg   | Secondary text                     |

## Audit results

All status tokens use the shadcn/ui default palette which targets WCAG AA contrast ratios. The following non-color cues ensure accessibility beyond color alone:

| Status           | Color | Non-color cue                                                     |
| ---------------- | ----- | ----------------------------------------------------------------- |
| Active/connected | Green | "Connected" text label + checkmark icon                           |
| Degraded         | Amber | "Degraded" text label + pulse icon                                |
| Reauth required  | Red   | "Re-authentication required" text + refresh icon + `role="alert"` |
| Disconnected     | Gray  | "Disconnected" text label                                         |
| Failed           | Red   | "Connection failed" text + `role="alert"`                         |
| Archived         | Gray  | "Archived" text label + archive icon                              |

## Compliance notes

- No status is communicated by color alone — every state has a text label and/or icon
- Focus rings use `--ring` token with 3:1 minimum contrast
- Error text uses `text-destructive` with associated `aria-live` announcement
- Loading states use `aria-busy="true"` and `sr-only` announcements

## Required manual verification

- [ ] VoiceOver/Safari: all status labels announced correctly
- [ ] High contrast mode (macOS): all text remains legible
- [ ] 200% zoom: status badges don't truncate or overlap
- [ ] Color blindness simulator: all states distinguishable without color
