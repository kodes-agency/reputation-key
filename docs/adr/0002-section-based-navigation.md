# ADR 0002 — Section-Based Navigation with Role-Distinct Sidebars

**Status:** Proposed
**Date:** 2026-05-03
**Context:** Navigation Architecture, UI Layout

## Decision

Replace the property-centric sidebar navigation with section-based navigation. Property becomes a scope filter (switcher at top), not a navigation anchor. Staff users get a completely different sidebar from managers/admins.

## Context

The initial navigation was property-anchored: a property selector in the sidebar header, with all nav items (Overview, Staff, Teams, Portals, Members, Settings) scoped to that property. This worked for the MVP but breaks down as features accumulate:

- Upcoming features (Goals, Leaderboards, AI Insights) don't naturally nest under a property
- Staff, Teams, and Members are overlapping concepts that confuse users
- Staff users (the largest user group) see a management interface irrelevant to them
- Settings (profile, security, billing, agent config) is orthogonal to properties
- The org-level `/staff` page and property-level `/properties/$id/staff` page create duplicate navigation

The business context:

- Two client types: single-property (majority) and multi-property
- In multi-property orgs, most managers are scoped to ONE property
- Cross-property management is rare (dedicated person for all properties)
- Staff are mobile-first, checking progress between tasks
- Almost all data (reviews, portals, goals, leaderboards) is property-scoped

## Alternatives Considered

### A. Property-anchored navigation (current)

Keep property as the anchor. Add upcoming features as sub-items under the property.

- **Pros:** Simpler routing. Matches current code structure. Clear scope boundary.
- **Cons:** Doesn't scale to 7+ sidebar items. Staff sidebar would be a gutted manager sidebar. Settings doesn't belong under a property. AI Insights and Leaderboards are awkward as property sub-pages.

### B. Section-based navigation with property switcher (chosen)

Top-level sidebar sections: Dashboard, Reviews, People, Portals (later: Goals, Leaderboard, AI Insights). Property switcher at top acts as scope filter. Staff get a distinct sidebar.

- **Pros:** Scales to many features. Staff get a purpose-built experience. Settings gets its own space. Each section is self-contained. Matches how Linear, Resend, Vercel structure their navigation.
- **Cons:** Requires route restructuring. Property switcher must be prominent. Slightly more complex routing (each section needs to read current property scope).

### C. Hybrid — property sections with cross-property top-level items

Property-scoped items under a property selector, plus top-level items for org-wide features (Settings, Leaderboard, AI).

- **Pros:** Preserves property scoping where it matters.
- **Cons:** Two different navigation models in one sidebar. Confusing mental model — "is this under my property or org-wide?" Staff sidebar still problematic.

## Decisions Made

1. **Section-based navigation** — sidebar items are functional sections, not property sub-pages
2. **Property switcher as scope filter** — selects which property's data flows through sections
3. **No cross-property mode** — dashboard shows per-property summaries; cross-property analytics is a future feature
4. **People section absorbs Staff/Members/Teams** — tabbed view: Directory (org), Staff (property), Teams (property)
5. **Settings as separate route** — `/settings` with its own sidebar, not a collapsible in main sidebar
6. **Distinct staff sidebar** — Home, Progress, Leaderboard, Team (conditional). Staff don't see Reviews, Portals, People management
7. **Progress combines stats + goals** — staff page answering "where I am and where I'm going"
8. **Team is conditional** — Team sidebar item only appears when staff member is assigned to a team
9. **Flat sidebar now, section headers later** — add headers (Overview, Manage, Performance) only when sidebar reaches 7+ items
10. **Layout width per-page** — lists `max-w-4xl`, forms `max-w-2xl`, data pages full-width with `px-8`. No width in layout wrapper.

## Route Structure

### Manager/Admin

```
/dashboard                    — property overview (summary strip, recent reviews, goals, team)
/reviews                      — review inbox (property-scoped)
/people                       — tabbed: Directory | Staff | Teams
/portals                      — portal list
/settings                     — separate layout with its own sidebar
/settings/profile
/settings/security
/settings/preferences
/settings/organization
/settings/properties/$id
```

Later additions:

```
/goals                        — property goals, team goals, individual goals
/leaderboard                  — rankings by scope and time window
/insights                     — AI sentiment trends, themes, suggested actions
```

### Staff

```
/home                         — personal summary (badges, goal progress, team rank)
/progress                     — stats + goals combined
/leaderboard                  — rankings
/team                         — team view (conditional — only if assigned to a team)
/settings                     — shared settings layout
```

## Consequences

### Positive

- Each user role sees a purpose-built navigation, not a filtered version of someone else's
- New features slot into the sidebar naturally (Goals, Leaderboard, AI Insights)
- People section eliminates the confusing Staff/Members/Teams split
- Settings has room to grow (billing, agent personalization) without crowding the main sidebar
- Staff mobile experience is focused: 3-4 items, all personal, no management noise

### Negative

- Route restructuring required (current property-centric routes change)
- Staff sidebar needs its own layout component (not just conditional rendering)
- Property switcher must be prominent and obvious (otherwise users lose scope awareness)
- Dashboard page needs to be built from scratch (currently just a redirect)

### Risks

- If property-scoping is wrong for a future feature (e.g., org-wide leaderboards), the section model needs rethinking
- Staff sidebar may need more items over time, requiring the same category-header treatment as manager sidebar
