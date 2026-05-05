# Google Business Profile Import

## Overview

Replace manual property creation with Google Business Profile (GBP) import as the primary (and only) way to add properties. Users connect Google accounts, browse their GBP locations, select which to import, and properties are created asynchronously via a BullMQ queue.

## Constraints

Based on the Google Business Profile API policies:

- **30-day max cache** on all GBP data (location details, reviews). No permanent storage of raw API responses.
- **No manipulation or aggregation** of cached data.
- **Google attribution must be displayed** exactly as provided wherever cached data is shown.
- **No read-only OAuth scope** — `business.manage` is the only scope (full read/write).
- **7-day disassociation SLA** — must support quick account unlinking for end-clients.
- **Third-party agency policies apply** — transparency, client notification within 48 hours of changes.

Source: [Business Profile API Policies](https://developers.google.com/my-business/content/policies)

## Section 1: OAuth & Token Storage

### Flow

User clicks "Add property" → redirected to Google OAuth consent screen → authorizes with `business.manage` scope → Google returns access + refresh tokens → tokens stored in `google_connections` table.

### Schema: `google_connections`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| organization_id | varchar(255) | FK to org |
| google_account_id | varchar(255) | Google user ID — identifies the account |
| google_email | varchar(255) | Display email for the selector |
| access_token | text | Encrypted at rest |
| refresh_token | text | Encrypted at rest |
| token_expires_at | timestamp | |
| scopes | varchar[] | Granted scopes |
| connected_by | varchar(255) | User ID who created the connection |
| visibility | enum: 'private', 'organization' | Default: 'private' |
| status | enum: 'active', 'disconnected' | Default: 'active' |
| created_at | timestamp | |
| updated_at | timestamp | |

### Rules

- **Per-organization, not per-user.** The connection belongs to the org.
- **`private` visibility** — only `connected_by` user can see and use this connection.
- **`organization` visibility** — any member with `property.create` permission can see and use it.
- Only the connection owner or org owner/admin can toggle visibility or disconnect.
- Refresh tokens used for persistence. A utility function refreshes access tokens before API calls.
- Token encryption at rest using an application-level encryption key from env vars.
- Disconnecting revokes the token with Google and sets status to `disconnected` rather than deleting the row. This preserves the association history and allows the UI to show "reconnect" instead of "connect" for previously-linked accounts. The row can be hard-deleted after a retention period if desired.

### Unlinking

A `disconnectGoogleAccount` server function:
1. Revokes tokens with Google's token revocation endpoint.
2. Purges all `gbp_cache` rows for properties linked to this connection.
3. Sets `status` to `disconnected` on the connection row (does not delete — preserves history).
4. Properties retain their `google_connection_id` reference. UI shows "disconnected" state for these.

## Section 2: Import Flow

### Step-by-step

1. User clicks "Add property" → lands on `/properties/import`.
2. If org has no Google connections → single CTA: "Connect Google Account" (starts OAuth).
3. If org has connections → account selector dropdown at top showing connected Google emails.
4. User selects an account → we call GBP API `accounts/{account}/locations` to fetch all locations.
5. Locations render as a checkbox list. Each row: business name, address, category. Header has "Select all" toggle.
6. User selects locations → clicks "Import N properties".
7. Server side: for each selected location:
   - Check if `gbpPlaceId` already exists in the org → if yes, queue as skipped.
   - Create property with `name` (from GBP), `timezone` (derived from GBP coordinates via `getTimezoneIdForLatLng` or similar utility), `gbpPlaceId`.
   - Link property to the Google connection via `google_connection_id`.
8. Each import is a BullMQ job. Progress tracked as queued/in-progress/done/skipped.

### Property schema changes

Add to `properties` table:

| Column | Type | Notes |
|--------|------|-------|
| google_connection_id | varchar(255) | FK to google_connections.id, nullable |

This links each imported property to the Google connection that can manage its reviews.

### Import batch tracking: `gbp_import_jobs`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| organization_id | varchar(255) | |
| initiated_by | varchar(255) | User ID |
| status | enum: 'queued', 'in_progress', 'completed', 'failed' | |
| total_count | int | |
| imported_count | int | |
| skipped_count | int | |
| failed_count | int | |
| created_at | timestamp | |
| updated_at | timestamp | |

Individual item progress is tracked via BullMQ job state. The import page polls a server function that returns the batch status.

## Section 3: GBP Cache & Sync

### Schema: `gbp_cache`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid, PK | |
| property_id | uuid | FK to properties.id |
| gbp_place_id | varchar(500) | |
| data_type | enum: 'location', 'reviews' | Separated for independent sync cadences |
| payload | jsonb | Raw GBP API response, stored as-is |
| google_attribution | text | Attribution string from Google, displayed as-is |
| fetched_at | timestamp | |
| expires_at | timestamp | fetched_at + 30 days |

Unique constraint on `(property_id, data_type)`.

### Why separate data_type

Location data changes infrequently. Reviews change daily. Separating them allows:
- **Reviews** — daily sync (high-frequency need for review management).
- **Location** — weekly sync or on-demand (saves quota on stable data).

### Batch endpoint strategy

GBP API provides batch endpoints:
- `batchGet` — up to 50 locations per request.
- `batchGetReviews` — up to 50 locations per request.

At 300 QPM default quota, syncing hundreds of properties is feasible with batching.

### Sync job (BullMQ, scheduled)

- **Daily:** sync reviews for all properties with a valid `google_connection_id`. Batch by connection (group locations under the same Google account for efficient batching).
- **Weekly:** sync location data for all properties.
- For each property: refresh connection token if needed, fetch from GBP API, upsert cache row with new `fetched_at` and `expires_at`.
- If Google connection revoked/disconnected → mark property, show "Connection lost — reconnect" in UI.

### Compliance

- No data older than 30 days in the table. Scheduled purge job deletes rows past `expires_at`.
- No derived or aggregated data stored — raw API responses only.
- Attribution preserved and rendered in UI wherever cached data is shown.
- Disconnected properties have their cache purged immediately.

## Section 4: Routes & UI

### Routes

| Route | Purpose |
|-------|---------|
| `/properties/import` | Main import page — account selector, location picker, import trigger |
| `/properties/import/$importId` | Import progress — queued/in-progress/done/skipped status per location |
| `/properties` (existing) | Properties list — "Import from Google" CTA |

### Import page (`/properties/import`)

- No connections → single CTA: "Connect Google Account".
- Has connections → account selector dropdown at top (Google email, visibility indicator).
- Below dropdown: checkbox list of GBP locations for selected account.
- "Select all" toggle in list header.
- "Import N properties" button (disabled until at least 1 selected).
- "Connect another account" option to add more Google accounts.

### Progress page (`/properties/import/$importId`)

- Batch summary: "3 of 10 imported, 1 skipped, 0 failed".
- Per-location status list: business name + status badge (queued / in progress / done / skipped).
- Auto-refreshes via polling while jobs are active.
- Done state: summary + "Go to properties" CTA.
- Partial failure: "Retry failed" button.

### Properties list page changes

- "Add property" button → navigates to `/properties/import`.
- Remove `/properties/new` route and manual creation form components.
- Connection health indicator — banner if a Google connection token is revoked.

### Future (not this scope)

- Settings page: "Google Connections" section to manage visibility, disconnect accounts.

## Section 5: Error Handling

### OAuth failures

| Scenario | Response |
|----------|----------|
| User denies consent | Redirect to import page with "Google authorization was cancelled" |
| Token refresh fails (revoked) | Mark connection `disconnected`, show reconnect banner, purge affected cache |
| OAuth scope insufficient | Prompt re-auth with correct scope |

### Import failures

| Scenario | Response |
|----------|----------|
| No locations in GBP account | Empty state: "No locations found for this account" |
| Rate limit hit during import | BullMQ retry with exponential backoff, max 3 attempts |
| Individual location fails | Mark `failed`, don't block other imports |
| Network error mid-batch | Resume from last successful location |

### Duplicate handling

- Same `gbpPlaceId` in org → skipped with "Already exists" status.
- Same `gbpPlaceId` in different org → not a concern (different tenant).

### Connection edge cases

| Scenario | Response |
|----------|----------|
| Private connection, non-owner tries to use | Not visible in dropdown at all |
| Connection owner leaves org | Orphaned — org owner/admin can take ownership or disconnect |

### Cache staleness

- Cache expired, sync not yet run → show data with "Last synced X hours ago", trigger priority background refresh.
- Cache expired, connection disconnected → show "Connection lost" state, no data.

## Property schema summary (all changes)

```
properties
├── (existing columns unchanged)
├── google_connection_id (varchar, FK → google_connections.id, nullable)
```

## New tables summary

1. `google_connections` — OAuth tokens and account metadata per org
2. `gbp_cache` — 30-day rolling cache of GBP location and review data per property
3. `gbp_import_jobs` — batch import progress tracking
