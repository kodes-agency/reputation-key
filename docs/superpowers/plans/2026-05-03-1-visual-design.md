# Session 1: Visual Design System Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sea-green nature theme with the "Warm Precision" design system: warm charcoal darks, amber/gold accent, new typography (Satoshi, Plus Jakarta Sans, JetBrains Mono), flat surfaces, no gradients or glass.

**Architecture:** Complete rewrite of `styles.css`. Dark becomes the default (no class needed). Light mode activates via `.light` class. All nature-themed variables, decorative backgrounds, island shells, and gradient textures are removed. shadcn-compatible token aliases map to the new palette.

**Tech Stack:** Tailwind CSS v4, CSS custom properties (OKLCH), Google Fonts

**Reference:** DESIGN.md (color palette, typography, spacing, radius, elevation, motion, components), PRODUCT.md (brand personality: precise, warm, confident)

---

## File Structure

### Files to modify

| File                                  | What changes                                                                |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `src/styles.css`                      | Complete rewrite — new tokens, fonts, remove all decorative CSS             |
| `src/components/layout/AppTopBar.tsx` | Theme toggle: switch from `.dark` class to `.light` class (dark is default) |

No new files. No route changes. App remains fully functional, just looks different.

---

### Task 1: Replace styles.css with new design tokens

**Files:**

- Modify: `src/styles.css` (complete rewrite)

- [ ] **Step 1: Read current styles.css to understand what exists**

Run: `cat src/styles.css | wc -l`
Note the line count for reference. The current file has nature-themed variables (`--sea-ink`, `--lagoon`, `--palm`, etc.), decorative body backgrounds with radial gradients, glass card classes (`.island-shell`), and Fraunces/Manrope font imports.

- [ ] **Step 2: Replace entire styles.css**

Write the complete replacement. The new file:

```css
@import url('https://fonts.googleapis.com/css2?family=Satoshi:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');
@import 'tailwindcss';
@plugin '@tailwindcss/typography';
@import 'tw-animate-css';
@custom-variant dark (&:is(.dark *));

:root {
  /* Surface tokens */
  --background: oklch(0.13 0.005 70);
  --surface: oklch(0.18 0.006 70);
  --surface-elevated: oklch(0.22 0.007 70);
  --border: oklch(0.28 0.008 70);
  --border-strong: oklch(0.38 0.01 70);

  /* Text tokens */
  --text-primary: oklch(0.93 0.005 70);
  --text-secondary: oklch(0.7 0.01 70);
  --text-tertiary: oklch(0.5 0.01 70);

  /* Accent tokens */
  --accent: oklch(0.78 0.14 75);
  --accent-hover: oklch(0.82 0.15 75);
  --accent-muted: oklch(0.22 0.03 75);
  --accent-foreground: oklch(0.13 0.005 70);

  /* Semantic tokens */
  --destructive: oklch(0.65 0.22 25);
  --destructive-muted: oklch(0.22 0.04 25);
  --success: oklch(0.72 0.15 155);
  --success-muted: oklch(0.22 0.03 155);
  --ring: oklch(0.44 0.017 70);
  --radius: 0.375rem;

  /* Chart palette */
  --chart-1: oklch(0.72 0.14 75);
  --chart-2: oklch(0.65 0.12 200);
  --chart-3: oklch(0.6 0.1 330);
  --chart-4: oklch(0.68 0.1 155);
  --chart-5: oklch(0.62 0.08 280);

  /* shadcn-compatible aliases */
  --foreground: oklch(0.93 0.005 70);
  --card: oklch(0.18 0.006 70);
  --card-foreground: oklch(0.93 0.005 70);
  --popover: oklch(0.18 0.006 70);
  --popover-foreground: oklch(0.93 0.005 70);
  --primary: oklch(0.78 0.14 75);
  --primary-foreground: oklch(0.13 0.005 70);
  --secondary: oklch(0.22 0.007 70);
  --secondary-foreground: oklch(0.93 0.005 70);
  --muted: oklch(0.22 0.007 70);
  --muted-foreground: oklch(0.7 0.01 70);
  --input: oklch(0.28 0.008 70);
  --sidebar: oklch(0.13 0.005 70);
  --sidebar-foreground: oklch(0.93 0.005 70);
  --sidebar-primary: oklch(0.78 0.14 75);
  --sidebar-primary-foreground: oklch(0.13 0.005 70);
  --sidebar-accent: oklch(0.22 0.03 75);
  --sidebar-accent-foreground: oklch(0.78 0.14 75);
  --sidebar-border: oklch(0.28 0.008 70);
  --sidebar-ring: oklch(0.44 0.017 70);
  --destructive-foreground: oklch(0.93 0.005 70);
}

.light {
  --background: oklch(0.98 0.003 70);
  --surface: oklch(1 0.003 70);
  --surface-elevated: oklch(1 0.004 70);
  --border: oklch(0.9 0.005 70);
  --border-strong: oklch(0.78 0.006 70);
  --text-primary: oklch(0.18 0.006 70);
  --text-secondary: oklch(0.48 0.01 70);
  --text-tertiary: oklch(0.7 0.01 70);
  --accent: oklch(0.68 0.14 75);
  --accent-hover: oklch(0.62 0.15 75);
  --accent-muted: oklch(0.94 0.03 75);
  --accent-foreground: oklch(0.22 0.06 75);
  --destructive: oklch(0.58 0.22 25);
  --destructive-muted: oklch(0.95 0.03 25);
  --success: oklch(0.55 0.15 155);
  --success-muted: oklch(0.95 0.03 155);
  --ring: oklch(0.78 0.006 70);
  --foreground: oklch(0.18 0.006 70);
  --card: oklch(1 0.003 70);
  --card-foreground: oklch(0.18 0.006 70);
  --popover: oklch(1 0.003 70);
  --popover-foreground: oklch(0.18 0.006 70);
  --primary: oklch(0.68 0.14 75);
  --primary-foreground: oklch(1 0.003 70);
  --secondary: oklch(0.96 0.003 70);
  --secondary-foreground: oklch(0.18 0.006 70);
  --muted: oklch(0.96 0.003 70);
  --muted-foreground: oklch(0.48 0.01 70);
  --input: oklch(0.9 0.005 70);
  --sidebar: oklch(0.98 0.003 70);
  --sidebar-foreground: oklch(0.18 0.006 70);
  --sidebar-primary: oklch(0.68 0.14 75);
  --sidebar-primary-foreground: oklch(1 0.003 70);
  --sidebar-accent: oklch(0.94 0.03 75);
  --sidebar-accent-foreground: oklch(0.68 0.14 75);
  --sidebar-border: oklch(0.9 0.005 70);
  --sidebar-ring: oklch(0.78 0.006 70);
  --destructive-foreground: oklch(0.58 0.22 25);
}

@theme inline {
  --font-sans: 'Satoshi', 'Inter', system-ui, -apple-system, sans-serif;
  --font-display: 'Plus Jakarta Sans', var(--font-sans);
  --font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent-muted);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
  --radius-xl: calc(var(--radius) + 6px);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

html,
body,
#app {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  background-color: var(--background);
  color: var(--foreground);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  color: var(--accent-hover);
}

code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

pre code {
  border: 0;
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  color: inherit;
}

.prose pre {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface);
  color: var(--foreground);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    background-color: var(--background);
    color: var(--foreground);
  }
}

/* Sidebar active state */
[data-slot='sidebar-menu-button'][data-active='true'] {
  background: var(--accent-muted);
  color: var(--accent);
  font-weight: 600;
}

[data-slot='sidebar-menu-sub-button'][data-active='true'] {
  background: var(--accent-muted);
  color: var(--accent);
  font-weight: 600;
}

.light [data-slot='sidebar-menu-button'][data-active='true'],
.light [data-slot='sidebar-menu-sub-button'][data-active='true'] {
  background: var(--accent-muted);
  color: var(--accent);
}
```

What was removed (do NOT re-add):

- Nature-themed variables: `--sea-ink`, `--lagoon`, `--palm`, `--sand`, `--foam`, `--hero-a`, `--hero-b`, `--kicker`, `--chip-bg`, `--header-bg`, `--link-bg-hover`, `--inset-glint`
- `.dark` class block (dark is now the default in `:root`)
- Body `::before` / `::after` decorative gradient and grid texture overlays
- `.island-shell` glass card class with backdrop-filter and gradient
- `.feature-card` hover transform class
- `.display-title` Fraunces serif reference
- `.island-kicker` uppercase kicker class
- `.nav-link` underline gradient animation
- `.rise-in` entrance animation keyframes
- `.site-footer` gradient background
- `.page-wrap` width container
- Fraunces and Manrope font imports

- [ ] **Step 3: Run build to verify**

Run: `pnpm build`
Expected: Build succeeds. All pages render. Colors are now warm charcoal (dark) with amber accents.

- [ ] **Step 4: Commit**

```bash
git add src/styles.css
git commit -m "feat: migrate design system to warm precision palette

Replace sea-green nature theme with warm charcoal + amber accent.
Dark default, light via .light class. New typography: Satoshi, Plus
Jakarta Sans, JetBrains Mono. Remove decorative gradients, glass
effects, island shells, grid textures, rise-in animations."
```

---

### Task 2: Update theme toggle to use `.light` class

**Files:**

- Modify: `src/components/layout/AppTopBar.tsx`

The current `useThemeMode` hook toggles `.dark` class. Since dark is now the default (no class), we need to toggle `.light` class instead.

- [ ] **Step 1: Read the current AppTopBar.tsx to find useThemeMode**

Read `src/components/layout/AppTopBar.tsx`. Find the `useThemeMode` function with its `applyMode` inner function and the initial `useEffect`.

- [ ] **Step 2: Update the applyMode function**

In the `applyMode` function, replace the logic that sets/removes `data-theme` and `dark` class. New logic:

```typescript
function applyMode(next: ThemeMode) {
  const resolved =
    next === 'auto'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : next

  if (resolved === 'light') {
    document.documentElement.classList.add('light')
  } else {
    document.documentElement.classList.remove('light')
  }

  document.documentElement.style.colorScheme = resolved
  window.localStorage.setItem('theme', next)
  setMode(next)
}
```

- [ ] **Step 3: Update the initial useEffect**

Replace the initial `useEffect` in `useThemeMode` that runs on mount. New logic:

```typescript
useEffect(() => {
  const stored = window.localStorage.getItem('theme')
  if (stored === 'light' || stored === 'dark' || stored === 'auto') {
    setMode(stored)
  }
  const resolved =
    stored === 'light'
      ? 'light'
      : stored === 'dark'
        ? 'dark'
        : window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light'
          : 'dark'

  if (resolved === 'light') {
    document.documentElement.classList.add('light')
  } else {
    document.documentElement.classList.remove('light')
  }
  document.documentElement.style.colorScheme = resolved
}, [])
```

- [ ] **Step 4: Verify theme toggle works**

Run: `pnpm dev`
Test: Click the theme toggle in the top bar user menu. Dark mode shows warm charcoal. Light mode shows warm off-white. Amber accent visible in both. Toggle cycles: dark -> light -> auto (follows system).

- [ ] **Step 5: Commit**

```bash
git add src/components/layout/AppTopBar.tsx
git commit -m "fix: theme toggle uses .light class for light mode

Dark is now the default (no class). Light mode activates via .light
class on html element. Toggle cycles dark -> light -> auto."
```

---

### Task 3: Verify all pages render correctly with new design

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: Build succeeds with zero errors.

- [ ] **Step 2: Run existing tests**

Run: `pnpm test`
Expected: All tests pass. Design changes don't affect server-side logic.

- [ ] **Step 3: Visual check - start dev server**

Run: `pnpm dev`

Check each page:

1. Login page — dark background, amber links, Satoshi font
2. Dashboard/property list — cards have flat borders (no glass), amber accents on hover
3. Sidebar — flat dark background, amber active state, no gradient decorations
4. Settings page — form inputs have warm borders, amber focus rings
5. Theme toggle — switches between dark charcoal and warm off-white
6. Public portal page (`/p/*`) — unaffected (uses its own theme system)

Expected: All pages functional. No leftover sea-green colors. No glass effects. No gradient backgrounds. Amber accent on buttons and links.

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: adjust component styles for new design tokens"
```

---

## Self-Review

### Spec coverage (DESIGN.md)

| DESIGN.md section                                       | Task                           |
| ------------------------------------------------------- | ------------------------------ |
| Color Palette (dark + light OKLCH tokens)               | Task 1                         |
| Typography (Satoshi, Plus Jakarta Sans, JetBrains Mono) | Task 1                         |
| Spacing (4px base unit, used via Tailwind)              | Task 1 (no custom CSS needed)  |
| Radius (6px default, scale via Tailwind)                | Task 1                         |
| Elevation (background lightness steps, no shadows)      | Task 1                         |
| Motion (150ms, ease-out-expo)                           | Task 1 (via Tailwind defaults) |
| Components (surfaces, buttons, sidebar)                 | Task 1 (sidebar active state)  |
| "What to remove" checklist                              | Task 1 (all items removed)     |
| Dark default, light secondary                           | Task 2 (theme toggle)          |

### Placeholder scan

No TBD, TODO, or placeholder patterns. All CSS and code is complete.

### Gaps

- Some components may use hardcoded color values (e.g., `#246f76` in link hover). These should be caught during the visual check in Task 3 and fixed inline.
- The `@custom-variant dark` line remains for backward compatibility with any existing `.dark` class usage in components, even though we no longer toggle it. It can be removed later.
