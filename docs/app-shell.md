# App Shell Architecture

## Overview

The authenticated app uses a **sidebar + top bar + content area** layout, property-centric navigation, and a clean, minimal design inspired by Linear.

## Layout Structure

```
┌─────────────────────────────────────────────────────┐
│  SidebarProvider                                     │
│  ┌──────────┬──────────────────────────────────────┐│
│  │ Sidebar  │ SidebarInset                          ││
│  │          │ ┌──────────────────────────────────┐ ││
│  │ Logo     │ │ AppTopBar                         │ ││
│  │ ──────── │ │ [☰] [Property ▼]     [👤 Menu]  │ ││
│  │ Overview │ └──────────────────────────────────┘ ││
│  │ Staff    │ ┌──────────────────────────────────┐ ││
│  │ Teams    │ │ main (Outlet)                     │ ││
│  │ Portals  │ │                                   │ ││
│  │ Reviews  │ │  Page content renders here        │ ││
│  │ Metrics  │ │                                   │ ││
│  │ Members  │ │                                   │ ││
│  │ ──────── │ │                                   │ ││
│  │ Settings │ │                                   │ ││
│  │  ├ Prop  │ │                                   │ ││
│  │  └ Org   │ │                                   │ ││
│  │          │ │                                   │ ││
│  │ ┌──────┐ │ │                                   │ ││
│  │ │OrgSwi│ │ │                                   │ ││
│  │ └──────┘ │ │                                   │ ││
│  └──────────┴──────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## File Map

### Layout Components

| File                                      | Purpose                                                   |
| ----------------------------------------- | --------------------------------------------------------- |
| `src/components/layout/AppSidebar.tsx`    | Main sidebar with nav items, settings group, org switcher |
| `src/components/layout/AppTopBar.tsx`     | Top bar with property switcher and user menu              |
| `src/components/hooks/use-property-id.ts` | Shared hook extracting current propertyId from URL        |

### Route Layout

| File                                                   | Role                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------ |
| `src/routes/__root.tsx`                                | Conditional: shows Header/Footer for public, raw children for auth |
| `src/routes/_authenticated.tsx`                        | Auth gate + SidebarProvider + loads org/property data              |
| `src/routes/_authenticated/dashboard.tsx`              | Redirects to first property overview (or shows empty state)        |
| `src/routes/_authenticated/properties/$propertyId.tsx` | Property layout — loads property data, renders Outlet              |

### Sidebar Navigation Routes

All sidebar items are scoped to a property. Routes under `src/routes/_authenticated/properties/$propertyId/`:

| Sidebar Item          | Route File                  | Status             |
| --------------------- | --------------------------- | ------------------ |
| Overview              | `index.tsx`                 | Active             |
| Staff                 | `staff/index.tsx`           | Active             |
| Teams                 | `teams/index.tsx`           | Active             |
| Portals               | `portals/index.tsx`         | Active             |
| Reviews               | `reviews.tsx`               | Stub (Coming soon) |
| Metrics               | `metrics.tsx`               | Stub (Coming soon) |
| Members               | `members.tsx`               | Stub               |
| Property Settings     | `settings/property.tsx`     | Stub               |
| Organization Settings | `settings/organization.tsx` | Stub (role-gated)  |

## Navigation Flow

1. **User logs in** → redirected to `/dashboard`
2. **Dashboard** → loads properties → redirects to `/properties/{firstId}` (overview)
3. **Sidebar** shows all sections for the current property
4. **Property switcher** (top bar) changes the active property
5. **Org switcher** (sidebar footer) changes the active organization

## Key Design Decisions

- **Property-first**: Every nav item is scoped to a property. The property ID lives in the URL for bookmarkability.
- **Sidebar collapse**: Persists via cookie (`sidebar_state`). Keyboard shortcut: `Cmd/Ctrl + B`.
- **Mobile**: Sidebar becomes a sheet overlay on small screens. Triggered by hamburger in top bar.
- **Role gating**: "Organization Settings" only appears for `PropertyManager` and `AccountAdmin` roles.
- **Coming soon items**: Reviews and Metrics render as disabled with "Soon" badge.
- **Theme toggle**: Integrated into user dropdown in top bar (cycles light → dark → auto).

## How to Add a New Page

1. Create route file at `src/routes/_authenticated/properties/$propertyId/{section}.tsx`
2. In `AppSidebar.tsx`, add to the `navItems` array:
   ```ts
   {
     key: 'section',
     label: 'Section Name',
     icon: IconFromLucide,
     to: '/properties/$propertyId/section' as const,
   }
   ```
3. The route tree auto-regenerates on next dev server start.

## Components Used

- `shadcn/ui` sidebar (new-york style, `collapsible="icon"`)
- `shadcn/ui` dropdown-menu (property switcher, org switcher, user menu)
- `shadcn/ui` collapsible (settings section)
- `shadcn/ui` sheet (mobile sidebar)
- `lucide-react` icons
- Tailwind CSS v4 with custom `--lagoon`, `--lagoon-deep` CSS variables for active states
