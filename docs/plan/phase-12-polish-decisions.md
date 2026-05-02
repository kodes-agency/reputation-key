# Phase 12 — UX Polish — Decision Log

**Date:** 2026-05-02
**Session:** Grilling session for 8 polish items — multi-org creation, org settings, timezone picker, guest URL structure, portal archival, QR code fix, URL overflow, property creation UX.

---

## Architecture Decisions

### A1. Organization Extended Fields via Better Auth

**Decision:** Extend the organization table using Better Auth's `schema.organization.additionalFields` (not Drizzle directly). New fields: contactEmail, billingCompanyName, billingAddress, billingCity, billingPostalCode, billingCountry.
**Reasoning:** The `organization` table is managed by Better Auth's organization plugin. Using their `additionalFields` API keeps migrations consistent with the auth layer and avoids schema drift. The project already uses this pattern for `invitation.additionalFields.propertyIds`.

### A2. Guest URL Restructured to Property-First

**Decision:** Change public portal URL from `/p/{orgSlug}/{portalSlug}` to `/p/{propertySlug}/{portalSlug}`. No backwards-compatible redirect.
**Reasoning:** Guests identify with the property (hotel name), not the parent organization. Shorter URLs are better for QR codes and sharing. Early-stage project — no production URLs to preserve. The `properties` table already has a `slug` field and portals have `propertyId`, so the lookup is straightforward via a JOIN.

### A3. Client-Side QR Generation

**Decision:** Generate QR codes client-side using the already-installed `qrcode` package (`toDataURL`), replacing the server-side API route for inline display. Keep the server route for PNG download only.
**Reasoning:** The current `<img src="/api/portals/$id/qr">` approach fails because TanStack Start server function routes don't register as standard HTTP GET endpoints. Client-side generation eliminates this entirely and is faster (no network round-trip). The `qrcode` package is already in dependencies.

---

## Domain Decisions

### D1. Multi-Organization Post-Registration

**Decision:** "Create Organization" action lives inside the sidebar org switcher dropdown, same pattern as the existing org list. Opens a dialog with name + slug fields. Auto-switches to new org on creation.
**Reasoning:** The org switcher is already the mental model for org management. Adding creation there keeps the workflow consolidated. Using Better Auth's `createOrganization` API ensures membership and role assignment happen correctly.

### D2. Organization Settings Scope

**Decision:** Editable fields on the org settings page: name, slug, logo (URL), contactEmail, billingCompanyName, billingAddress, billingCity, billingPostalCode, billingCountry. Slug changes show a warning about breaking guest URLs.
**Reasoning:** These cover the essentials for org identity and billing correspondence. Logo as URL input for now (file upload can be added when image upload is polished). Billing fields support B2B invoicing needs.

### D3. Portal Status — Two-State Toggle

**Decision:** Reuse the existing `isActive` boolean on portals as a two-state toggle: active / inactive. No new schema column. Inactive portals are dimmed in the admin list and show "unavailable" to guests. No "draft" status.
**Reasoning:** The boolean already exists. Two states are sufficient for the current use case (publish/unpublish). Draft adds complexity without clear demand. The `updatePortalInputSchema` already accepts `isActive` as an optional boolean.

---

## Implementation Decisions

### I1. Timezone Combobox with UTC Offsets

**Decision:** Replace the current `TimezoneSelect` with a combobox (Popover + Command from shadcn). Each option displays as `+02:00  Europe/Sofia`. Search filters by both offset and timezone name. Form value stays as IANA string.
**Reasoning:** 55+ timezones are unsearchable in a flat select. The `cmdk` library (shadcn Command) provides instant type-ahead. UTC offset prefix makes selection by offset natural (users know their offset even if they don't know their IANA name).

### I2. QR Modal URL Display — Path Only

**Decision:** Show only the URL path (`/p/property/portal?source=qr`) without the origin. Truncate long paths with ellipsis. Tooltip on hover reveals the full URL. Copy button copies the full URL including origin.
**Reasoning:** The origin is redundant when viewing on the same site. Path-only display fits the modal width without overflow. Full URL is available via tooltip and clipboard — the two cases where it's actually needed.

### I3. Property Switcher Always Visible

**Decision:** Show the top bar property dropdown even when there's only 1 property. Add "Add Property" item at the bottom (same pattern as "Create Organization" in org switcher). Navigates to `/properties/new`.
**Reasoning:** Single-property orgs still need access to property creation. Hiding the switcher for single properties removes the discovery path. Consistent pattern across both switchers (org + property).

### I4. Property Switcher as Property Discovery

**Decision:** The "Add Property" item lives in the top bar property switcher dropdown, not in a separate page button. The properties index page (`/properties/`) still exists as a fallback but is no longer the primary creation entry point.
**Reasoning:** The switcher is always visible in the top bar. Adding creation there reduces navigation steps. Matches the org switcher pattern for consistency.

---

## UI Component Inventory

### New Components Required

| Component                    | Purpose                                                        |
| ---------------------------- | -------------------------------------------------------------- |
| `<OrganizationSettingsForm>` | Form editing org name, slug, logo, contact, billing fields     |
| `<TimezoneCombobox>`         | Searchable timezone picker with UTC offset labels              |
| `<CreateOrganizationDialog>` | Dialog for creating new org (name + slug), used in sidebar     |
| `<PortalUnavailable>`        | Guest-facing "portal unavailable" message for inactive portals |

### Modified Components

| Component              | Changes                                                      |
| ---------------------- | ------------------------------------------------------------ |
| `<QRCodeModal>`        | Client-side QR generation, path-only URL display, tooltip    |
| `<AppSidebar>`         | "Create Organization" item + dialog in org switcher dropdown |
| `<AppTopBar>`          | Always show property dropdown, "Add Property" item           |
| `<PortalDetailPage>`   | Active/inactive toggle using Switch, pass propertySlug       |
| `<ShareSection>`       | Change organizationSlug prop to propertySlug                 |
| `<CreatePropertyForm>` | Swap TimezoneSelect for TimezoneCombobox                     |

### shadcn Components to Install

| Component | Purpose                       |
| --------- | ----------------------------- |
| `command` | Timezone combobox search      |
| `switch`  | Portal active/inactive toggle |

---

## Implementation Phases

### Phase 1: Org Settings (Issue 2) — migration first

1. Extend Better Auth `additionalFields` in `src/shared/auth/auth.ts`
2. Run Better Auth migration
3. Update `AuthOrganizationResponse` type + `getActiveOrganization` return
4. Add `updateOrganization` server fn
5. Build `OrganizationSettingsForm` component
6. Replace org settings route placeholder

### Phase 2: UI Quick Wins (parallel)

- **Issue 3:** Timezone combobox — install command, create `TimezoneCombobox`, swap in form
- **Issue 6+7:** QR fix — client-side generation, path-only URL, tooltip
- **Issue 8:** Property switcher — always show dropdown, add "Add Property" item

### Phase 3: URL Change + Archival (sequential)

- **Issue 4:** Guest URL `/p/{propertySlug}/{portalSlug}` — rename route, update guest lookup, QR API, all portal components
- **Issue 5:** Portal archival — active/inactive toggle, guest check, dimmed list rows

### Phase 4: Create Organization (Issue 1)

- Add `createOrganization` server fn
- Update `AppSidebar` with "Create Organization" + dialog

---

## Files to Modify

| File                                                                         | Issues |
| ---------------------------------------------------------------------------- | ------ |
| `src/shared/auth/auth.ts`                                                    | 2      |
| `src/contexts/identity/server/organizations.ts`                              | 1, 2   |
| `src/routes/_authenticated/properties/$propertyId/settings/organization.tsx` | 2      |
| `src/components/features/property/CreatePropertyForm.tsx`                    | 3      |
| `src/components/features/portal/QRCodeModal.tsx`                             | 4, 6+7 |
| `src/components/features/portal/ShareSection.tsx`                            | 4      |
| `src/components/features/portal/PortalDetailPage.tsx`                        | 4, 5   |
| `src/components/layout/AppTopBar.tsx`                                        | 8      |
| `src/components/layout/AppSidebar.tsx`                                       | 1      |
| `src/contexts/guest/server/public.ts`                                        | 4, 5   |
| `src/contexts/guest/domain/errors.ts`                                        | 5      |
| `src/routes/p/$orgSlug/$portalSlug.tsx` → rename to `$propertySlug`          | 4      |
| `src/routes/api/portals/$id/qr.ts`                                           | 4      |
| `src/routes/_authenticated/properties/$propertyId/portals/$portalId.tsx`     | 4      |
| `src/routes/_authenticated/properties/$propertyId/portals/index.tsx`         | 4, 5   |

## Files to Create

| File                                                            | Issue |
| --------------------------------------------------------------- | ----- |
| `src/components/features/identity/OrganizationSettingsForm.tsx` | 2     |
| `src/components/features/identity/CreateOrganizationDialog.tsx` | 1     |
| `src/components/features/property/TimezoneCombobox.tsx`         | 3     |
| `src/components/guest/portal-unavailable.tsx`                   | 5     |

---

## Verification

1. Create a new organization from sidebar — confirm auto-switch and new org appears in list
2. Edit org name/slug/billing fields in settings — confirm persistence after page reload
3. Create property — verify timezone combobox search works, offset labels display
4. Open a guest portal via new URL `/p/{propertySlug}/{portalSlug}` — confirm renders
5. Toggle portal to inactive — confirm guest URL shows "unavailable" and portal is dimmed in list
6. Open QR dialog — confirm QR image renders, URL is truncated with tooltip, download works
7. With single property — confirm top bar dropdown shows with "Add Property" option
8. Add second property — confirm switcher works, "Add Property" still present

---

## Deferred Decisions

| Item                              | Reason                                                       |
| --------------------------------- | ------------------------------------------------------------ |
| Logo file upload in org settings  | URL input for now; file upload when image system is polished |
| Backwards-compatible URL redirect | Early stage, no production URLs to preserve                  |
| Draft portal status               | Two-state (active/inactive) sufficient for current needs     |
| Card-based portal list layout     | Table works; card toggle can be added later                  |
| Billing VAT/tax ID field          | Can be added when invoicing integration is implemented       |
