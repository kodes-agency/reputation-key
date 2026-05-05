# Integration Context

Manages third-party integrations, primarily Google Business Profile (GBP) connections, OAuth flows, location synchronization, and bulk property imports.

## Language

**Google Connection**:
An authenticated OAuth connection to a Google account that owns one or more GBP locations. Stores encrypted tokens.
_Avoid_: Auth, integration, account (too generic)

**GBP Location**:
A specific business location from Google Business Profile, identified by a `placeId` (e.g., `accounts/123/locations/456`).
_Avoid_: Place, business, store

**GBP Cache**:
Cached data from GBP API (locations, reviews, insights) stored locally to reduce API calls and improve performance.
_Avoid_: Cache, data store, snapshot

**Import Job**:
A background job that processes a batch of GBP locations and creates corresponding properties in the system. Tracks progress (imported, skipped, failed counts).
_Avoid_: Batch, bulk import, sync job

**OAuth Token**:
Access and refresh tokens encrypted at rest using AES-256-GCM. Refreshed automatically when expired.
_Avoid_: Auth token, credential, secret

**Visibility**:
Connection visibility setting: `private` (only the creator sees it) or `organization` (all org members can use it for imports).
_Avoid_: Permission, access level, sharing

## Relationships

- An **Organization** can have multiple **Google Connections** (different accounts)
- Each **Google Connection** belongs to a single **Organization** and has a `connectedBy` user
- A **Google Connection** has many **GBP Locations** (fetched via GBP API)
- **GBP Cache** entries are stored per Property and data type (locations, reviews, insights)
- An **Import Job** is created for a specific **Google Connection** and processes a batch of **GBP Locations**
- Successful **Import Job** items create **Properties** linked to the originating **Google Connection**
- **Import Job** tracks three counters: `importedCount`, `skippedCount`, `failedCount`

## Domain Rules

- A connection must be `active` to start an import or list locations
- Duplicate GBP place IDs within the same organization are skipped during import
- Token refresh happens automatically when the access token is expired or close to expiry
- Cache entries expire after a configurable TTL and are refreshed on next access
- Only users with `property.create` permission can start an import
- Disconnecting a connection deletes all associated cache entries

## Example dialogue

> **Dev:** "What happens when a user connects their Google account?"
> **Domain expert:** "We redirect them to Google OAuth, exchange the code for tokens, encrypt them, and store a GoogleConnection with `active` status."
>
> **Dev:** "Can multiple users in the same org connect the same Google account?"
> **Domain expert:** "Yes, but each connection is separate. We track who connected it via `connectedBy` and visibility controls who can use it."
>
> **Dev:** "How do we handle token expiration?"
> **Domain expert:** "Automatically. When we detect an expired token, we use the refresh token to get new access/refresh tokens, encrypt them, and update the connection."
>
> **Dev:** "What if an import fails for some locations?"
> **Domain expert:** "We track each attempt: `importedCount` for successes, `skippedCount` for duplicates, `failedCount` for errors. The job completes regardless of partial failures."
>
> **Dev:** "Does the import create properties immediately?"
> **Domain expert:** "Yes, but asynchronously. The import job enqueues a BullMQ task that creates properties one by one, updating counters as it goes."

## Flagged ambiguities

- "Location" always refers to a GBP location (`accounts/*/locations/*`), not a physical address or property.
- "Import" refers to the GBP→Property sync flow, not file uploads or data migrations.
- "Connection" specifically means Google OAuth connection — other integrations would have their own connection types.
- "Queue" refers to BullMQ job queue for background processing, not a message broker.
