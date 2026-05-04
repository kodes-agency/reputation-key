# Design

## Theme

Dark-first product surface. Warm charcoal bases with a single amber/gold accent used sparingly. Flat surfaces with precise borders. No glass, no gradients, no decorative textures. Hierarchy through type scale, weight contrast, and spacing rhythm alone.

Light mode inverts cleanly — warm off-whites with the same amber accent, charcoal text, identical structure.

## Color Palette

### Strategy: Restrained with one accent

Amber/gold accent at <10% of surface area. Everything else is warm neutrals with deliberate contrast steps.

### Dark (default)

| Token                 | OKLCH                  | Hex fallback | Role                                  |
| --------------------- | ---------------------- | ------------ | ------------------------------------- |
| `--background`        | `oklch(0.13 0.005 70)` | `#1c1a17`    | Page background                       |
| `--surface`           | `oklch(0.18 0.006 70)` | `#262420`    | Cards, panels, modals                 |
| `--surface-elevated`  | `oklch(0.22 0.007 70)` | `#312e29`    | Hovered cards, dropdowns              |
| `--border`            | `oklch(0.28 0.008 70)` | `#3d3a34`    | Subtle borders                        |
| `--border-strong`     | `oklch(0.38 0.010 70)` | `#56534b`    | Focused borders, dividers             |
| `--text-primary`      | `oklch(0.93 0.005 70)` | `#edebe7`    | Body text, headings                   |
| `--text-secondary`    | `oklch(0.70 0.010 70)` | `#a9a59c`    | Labels, captions, muted               |
| `--text-tertiary`     | `oklch(0.50 0.010 70)` | `#716e66`    | Placeholders, disabled                |
| `--accent`            | `oklch(0.78 0.14 75)`  | `#dba440`    | Primary actions, links, active states |
| `--accent-hover`      | `oklch(0.82 0.15 75)`  | `#e5b85a`    | Hover on accent elements              |
| `--accent-muted`      | `oklch(0.22 0.03 75)`  | `#33291a`    | Accent backgrounds (badges, chips)    |
| `--accent-foreground` | `oklch(0.13 0.005 70)` | `#1c1a17`    | Text on accent backgrounds            |
| `--destructive`       | `oklch(0.65 0.22 25)`  | `#c4463a`    | Errors, delete actions                |
| `--destructive-muted` | `oklch(0.22 0.04 25)`  | `#351a18`    | Error backgrounds                     |
| `--success`           | `oklch(0.72 0.15 155)` | `#3da06e`    | Confirmations, positive metrics       |
| `--success-muted`     | `oklch(0.22 0.03 155)` | `#1a3328`    | Success backgrounds                   |

### Light

| Token                 | OKLCH                  | Hex fallback | Role                                    |
| --------------------- | ---------------------- | ------------ | --------------------------------------- |
| `--background`        | `oklch(0.98 0.003 70)` | `#f8f7f4`    | Page background                         |
| `--surface`           | `oklch(1.0 0.003 70)`  | `#fefdfb`    | Cards, panels                           |
| `--surface-elevated`  | `oklch(1.0 0.004 70)`  | `#fffdf9`    | Hovered cards                           |
| `--border`            | `oklch(0.90 0.005 70)` | `#e2dfd9`    | Subtle borders                          |
| `--border-strong`     | `oklch(0.78 0.006 70)` | `#c4c0b8`    | Focused borders                         |
| `--text-primary`      | `oklch(0.18 0.006 70)` | `#232019`    | Body text, headings                     |
| `--text-secondary`    | `oklch(0.48 0.010 70)` | `#716e66`    | Labels, captions                        |
| `--text-tertiary`     | `oklch(0.70 0.010 70)` | `#a9a59c`    | Placeholders                            |
| `--accent`            | `oklch(0.68 0.14 75)`  | `#b88a28`    | Primary actions (darkened for light bg) |
| `--accent-hover`      | `oklch(0.62 0.15 75)`  | `#9d7520`    | Hover on accent                         |
| `--accent-muted`      | `oklch(0.94 0.03 75)`  | `#f3e8ce`    | Accent backgrounds                      |
| `--accent-foreground` | `oklch(0.22 0.06 75)`  | `#3d3012`    | Text on accent backgrounds              |
| `--destructive`       | `oklch(0.58 0.22 25)`  | `#a93a30`    | Errors                                  |
| `--destructive-muted` | `oklch(0.95 0.03 25)`  | `#f5e0de`    | Error backgrounds                       |
| `--success`           | `oklch(0.55 0.15 155)` | `#2d7d54`    | Confirmations                           |
| `--success-muted`     | `oklch(0.95 0.03 155)` | `#dbf0e4`    | Success backgrounds                     |

### Chart palette

Five colors for data visualization, ordered by priority:

| Token       | OKLCH                  | Role                   |
| ----------- | ---------------------- | ---------------------- |
| `--chart-1` | `oklch(0.72 0.14 75)`  | Amber (primary metric) |
| `--chart-2` | `oklch(0.65 0.12 200)` | Cool slate-blue        |
| `--chart-3` | `oklch(0.60 0.10 330)` | Muted rose             |
| `--chart-4` | `oklch(0.68 0.10 155)` | Sage green             |
| `--chart-5` | `oklch(0.62 0.08 280)` | Mauve                  |

## Typography

### Font stack

- **Primary**: `'Satoshi', 'Inter', system-ui, -apple-system, sans-serif` — clean geometric sans with character at display sizes, excellent legibility at body sizes
- **Display (optional)**: `'Plus Jakarta Sans'` for hero headings when more personality is needed
- **Mono**: `'JetBrains Mono', 'Fira Code', ui-monospace, monospace` — for metrics, codes, table data

### Type scale

Fluid, based on viewport. Ratios ensure hierarchy through scale + weight contrast.

| Role       | Size (fluid)                              | Weight | Tracking         |
| ---------- | ----------------------------------------- | ------ | ---------------- |
| Display    | `clamp(2rem, 1.5rem + 2.5vw, 3.5rem)`     | 700    | -0.02em          |
| H1         | `clamp(1.5rem, 1.2rem + 1.5vw, 2.25rem)`  | 700    | -0.01em          |
| H2         | `clamp(1.25rem, 1.1rem + 0.75vw, 1.5rem)` | 600    | 0                |
| H3         | `1.125rem`                                | 600    | 0                |
| Body       | `0.9375rem` (15px)                        | 400    | 0                |
| Body large | `1.0625rem` (17px)                        | 400    | 0                |
| Caption    | `0.8125rem` (13px)                        | 500    | 0.01em           |
| Overline   | `0.75rem` (12px)                          | 600    | 0.06em uppercase |
| Mono/data  | `0.875rem` (14px)                         | 500    | 0                |

### Line height

- Headings: 1.15-1.25
- Body: 1.55
- Data/mono: 1.4

### Max line length

65-75ch for all body text.

## Spacing

Base unit: 4px. Spacing scale uses multiples that create rhythm, not uniformity.

| Token        | Value | Use                                 |
| ------------ | ----- | ----------------------------------- |
| `--space-1`  | 4px   | Tight gaps (icon + label)           |
| `--space-2`  | 8px   | Inline padding, compact lists       |
| `--space-3`  | 12px  | Form field gaps, small card padding |
| `--space-4`  | 16px  | Standard padding, list item spacing |
| `--space-5`  | 20px  | Section sub-spacing                 |
| `--space-6`  | 24px  | Card padding, medium gaps           |
| `--space-8`  | 32px  | Section padding                     |
| `--space-10` | 40px  | Between sections                    |
| `--space-12` | 48px  | Major section breaks                |
| `--space-16` | 64px  | Page-level breathing room           |

## Radius

Single radius scale. Small and consistent.

| Token           | Value  |
| --------------- | ------ |
| `--radius-sm`   | 4px    |
| `--radius-md`   | 6px    |
| `--radius-lg`   | 8px    |
| `--radius-xl`   | 12px   |
| `--radius-full` | 9999px |

## Elevation

No drop shadows. Elevation through background lightness steps:

1. `background` — page level
2. `surface` — cards, panels
3. `surface-elevated` — hover, dropdowns, popovers

Border opacity provides additional separation where needed.

## Components

### Surfaces

Cards use `--surface` background with `--border` border (1px). No box-shadow. Hover transitions to `--surface-elevated` with `--border-strong` border. Transition: `150ms ease-out` on background-color and border-color only.

### Buttons

- **Primary**: `--accent` background, `--accent-foreground` text. Hover: `--accent-hover`.
- **Secondary**: `--surface` background, `--text-primary` text, `--border` border. Hover: `--border-strong`.
- **Ghost**: Transparent background, `--text-secondary` text. Hover: `--surface` background.
- **Destructive**: `--destructive` background, white text.
- All buttons: `--radius-md`, `font-weight: 500`, `transition: 150ms ease-out`.

### Inputs

`--surface` background, `--border` border. Focus: `--border-strong` with `--ring` outline (2px offset 2px). Text: `--text-primary`. Placeholder: `--text-tertiary`.

### Badges/chips

`--accent-muted` background, `--accent-foreground` text, `--radius-full`. Destructive and success variants use their respective muted/foreground pairs.

### Sidebar

`--background` base (same as page, no distinction). Active item: `--accent-muted` background with `--accent` text and `font-weight: 600`. Inactive: `--text-secondary`. Hover: subtle `--surface` background.

### Tables

Header row: `--surface` background, `overline` typography style (`0.75rem 600 uppercase tracking-wide`). Body: `--text-primary`, `--border` row separators. Zebra striping via `--surface` on alternating rows.

### Empty states

Centered. `--text-secondary` illustration or icon, single line of body text, one primary action button. Generous vertical padding (`--space-12`+).

## Motion

- **Duration**: 150ms for micro-interactions (hover, focus, toggle), 200ms for layout transitions (expand, collapse)
- **Easing**: `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) for all transitions
- **No decorative animations** — motion only for state changes and spatial relationships
- **Respects `prefers-reduced-motion`** — all transitions become instant (0ms)

## Icons

Lucide icon set (already in use). Default size: 16px. Stroke width: 1.5px. Color inherits from text. No filled icon variants.

## Responsive breakpoints

| Breakpoint | Width  | Target                 |
| ---------- | ------ | ---------------------- |
| `sm`       | 640px  | Large phones landscape |
| `md`       | 768px  | Tablets                |
| `lg`       | 1024px | Small laptops          |
| `xl`       | 1280px | Desktop                |
| `2xl`      | 1536px | Wide desktop           |

Sidebar collapses to sheet below `lg`. Content max-width: 1280px, centered.

## What to remove from current codebase

- All nature-themed variables (`--sea-ink`, `--lagoon`, `--palm`, `--sand`, `--foam`, `--hero-a`, `--hero-b`, etc.)
- `.island-shell` class and its glass/gradient treatment
- `.feature-card` hover transforms
- Body `::before` / `::after` decorative gradient and grid textures
- `.rise-in` entrance animation
- `.display-title` Fraunces reference
- `.nav-link` underline gradient animation
