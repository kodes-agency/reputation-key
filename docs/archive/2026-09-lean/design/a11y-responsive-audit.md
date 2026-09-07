# B2.3/B2.4 — Accessibility and Responsive Audit

**Date:** 2026-07-14
**Scope:** Critical flows enabled in internal beta

## B2.3 — Automated a11y checks

### Current state: ✅ Blocking

- **`@storybook/addon-a11y`** installed and configured in `.storybook/main.ts`
- **`test: 'error'`** in `.storybook/preview.tsx` — `pnpm test-storybook` FAILS on axe violations
- **Color contrast** rule enabled (not disabled)
- **CI `storybook-test` job** runs the a11y-enforcing Playwright test-runner
- Structural rules (landmark, heading, region) appropriately disabled for isolated component stories
- Viewport presets: mobile (390px), tablet (820px), desktop (1440px)

### Known a11y items (component-specific)

| Issue                                                 | Status                                             | Component                |
| ----------------------------------------------------- | -------------------------------------------------- | ------------------------ |
| Upload dropzone uses `div` instead of semantic button | Deferred — upload capability is OFF in beta        | `image-upload-field`     |
| Dialog focus management                               | ✅ Handled by shadcn AlertDialog/Dialog primitives | All dialogs              |
| Status announcements                                  | ✅ Created with `aria-live` in setup-guide-states  | Setup guides             |
| Focus-visible rings                                   | ✅ shadcn tokens include `--ring` at 3:1 contrast  | All interactive elements |
| Skeleton loading announcements                        | ✅ `aria-busy="true"` + `sr-only` label            | LoadingState             |

### Required manual verification (before cohort expansion)

- [ ] VoiceOver/Safari: critical journey (login → inbox → reply → publish)
- [ ] Keyboard-only: tab through inbox, compose reply, confirm publish
- [ ] 200% text zoom: no truncated actions or overlapping elements
- [ ] 400% zoom/reflow: single-column layout at 320px effective width
- [ ] Reduced motion: all animations respect `prefers-reduced-motion`

## B2.4 — Responsive layout

### Critical flows to verify at 320px

| Flow                 | Desktop behavior             | Mobile target                             |
| -------------------- | ---------------------------- | ----------------------------------------- |
| Inbox list + detail  | Side-by-side master/detail   | Stacked: list → tap → detail              |
| Reply compose        | Full-width editor            | Full-width, software keyboard handling    |
| Property selector    | Dropdown with all properties | Search input with server-side results     |
| Confirmation dialogs | Centered modal               | Full-width bottom sheet or centered modal |
| Dashboard metrics    | 4-column grid                | Single column, scrollable                 |
| Connection status    | Inline badge                 | Full-width status card                    |

### Responsive patterns already in use

- Tailwind breakpoints: `sm:` (640px), `md:` (768px), `lg:` (1024px)
- Grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` (dashboard)
- Sidebar: collapsible via `SidebarProvider` (shadcn)
- Dialogs: `max-w-md` with padding (works on mobile)
- Tables: not used in critical flows (cards instead)

### CSS adjustments needed

1. **Inbox master/detail**: Add `hidden md:flex` to detail pane, show on route change for mobile
2. **Property selector**: Replace dropdown with searchable command palette at narrow widths
3. **Dashboard grid**: Already responsive via `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4`
4. **Touch targets**: Verify all buttons meet 44×44px minimum (shadcn defaults are adequate)

### Test matrix

| Viewport         | Width           | Tests needed                             |
| ---------------- | --------------- | ---------------------------------------- |
| Mobile portrait  | 390px           | Inbox, reply, publish, connection status |
| Mobile landscape | 844px           | Same as portrait                         |
| Tablet portrait  | 768px           | Full layout verification                 |
| Desktop          | 1440px          | Already tested (default)                 |
| 200% zoom        | 640px effective | Text legibility, no overflow             |
| 400% zoom        | 320px effective | Reflow to single column                  |
