# Integration Context

Manages Google OAuth connections, token lifecycle, GBP API infrastructure, and Pub/Sub subscription management. Connection management only — review syncing and property import live in their own contexts (`review` and `property`).

## Language

**Google Connection**:
An authenticated OAuth connection to a Google account that owns one or more GBP locations. Stores encrypted tokens.
_Avoid_: Auth, integration, account (too generic)

**GBP Location**:
A specific business location from Google Business Profile, identified by a `placeId` (e.g., `accounts/123/locations/456`).
_Avoid_: Place, business, store

**GBP Cache**:
Cached data from GBP API (locations only) stored locally to reduce API calls and improve performance. Reviews are normalized in the `reviews` table (review context).
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
- **GBP Cache** entries are stored per Property and data type (locations only)
- An **Import Job** is created for a specific **Google Connection** and processes a batch of **GBP Locations** (lives in `property` context)
- Successful **Import Job** items create **Properties** linked to the originating **Google Connection**
- **Import Job** tracks three counters: `importedCount`, `skippedCount`, `failedCount`
- **Pub/Sub Subscription** is created per Google account on first property import, removed on last property deletion or disconnect

## Domain Rules

- A connection must be `active` to start an import or list locations
- Duplicate GBP place IDs within the same organization are skipped during import
- Token refresh happens automatically with a 5-minute expiry buffer — the `refreshGoogleToken` use case is called before any GBP API interaction
- Cache entries expire after a configurable TTL and are refreshed on next access
- Only users with `property.create` permission can start an import
- Disconnecting a connection deletes all associated cache entries
- Import jobs track three terminal statuses: `completed`, `completed_with_skips` (some skipped or failed), and `failed` (all failed)

## Events produced

- **`google_account.connected`** — connectionId, organizationId, googleEmail, occurredAt. Emitted when a Google account is connected.
- **`google_account.disconnected`** — connectionId, organizationId, occurredAt. Emitted when a Google account is disconnected.
- **`property_import.completed`** — importJobId, organizationId, totalCount, importedCount, skippedCount, failedCount, occurredAt. Emitted when an import job finishes.
- **`google_connection.visibility_changed`** — connectionId, organizationId, visibility, occurredAt. Emitted when connection visibility is updated.

## Events consumed

None. Integration context does not subscribe to events from other contexts.

## Architecture layers

```
integration/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts, gbp-api-error.ts
  application/
    ports/             google-connection.repository.ts, gbp-cache.repository.ts,
                       gbp-import.repository.ts, gbp-api.port.ts, gbp-queue.port.ts,
                       google-oauth.port.ts, token-encryption.port.ts,
                       property-lookup.port.ts, property-query.port.ts,
                       property-fk-cleanup.port.ts, property-import-repo.port.ts,
                       property-event.port.ts
    dto/               connect-google.dto.ts, disconnect-google.dto.ts,
                       google-connection.dto.ts, import-properties.dto.ts,
                       import-status.dto.ts, list-locations.dto.ts,
                       update-connection-visibility.dto.ts
    use-cases/         connect-google-account.ts, disconnect-google-account.ts,
                       list-google-connections.ts, update-connection-visibility.ts,
                       refresh-google-token.ts, list-gbp-locations.ts,
                       start-property-import.ts, get-import-status.ts,
                       import-property.ts, handle-gbp-notification.ts
    public-api.ts      re-exports DTO types, domain types
  infrastructure/
    repositories/      google-connection.repository.ts, gbp-cache.repository.ts,
                       gbp-import.repository.ts, property-import.repository.ts
    adapters/          google-oauth.adapter.ts, token-encryption.adapter.ts,
                       gbp-api.adapter.ts, google-review-api.adapter.ts,
                       property-event.adapter.ts
    mappers/           google-connection.mapper.ts, gbp-cache.mapper.ts, gbp-import.mapper.ts
    handlers/          gbp-notification-handler.ts
    jobs/              import-property.job.ts
  server/              google-connections.ts, gbp-import.ts, shared.ts
  build.ts             composition root
```

## Use cases

- **`connectGoogleAccount`** — OAuth code exchange, encrypt tokens, store connection. Emits `google_account.connected`.
- **`disconnectGoogleAccount`** — Revoke tokens, clear caches, null out property FKs. Emits `google_account.disconnected`.
- **`listGoogleConnections`** — List connections for an org.
- **`updateConnectionVisibility`** — Toggle private/organization visibility. Emits `google_connection.visibility_changed`.
- **`refreshGoogleToken`** — Auto-refresh expired tokens with 5-minute buffer.
- **`listGbpLocations`** — Fetch GBP locations for a connection (with token refresh).
- **`startPropertyImport`** — Create import job, enqueue bulk import tasks. Emits `property_import.completed`.
- **`getImportStatus`** — Query import job progress (imported/skipped/failed counts).
- **`importProperty`** — Process single GBP location into a property. Handles duplicate conflicts.
- **`handleGbpNotification`** — Process Google Pub/Sub push notifications for real-time review updates.

## Public API

Exported from `application/public-api.ts`:

- Types: `GoogleConnectionDto`, `GoogleConnectionStatus`, `GoogleConnectionVisibility`, `GbpLocation`, `GbpImportJob`, `GbpImportJobStatus`

## Server functions

- **`google-connections.ts`** — Server functions for Google connection CRUD (connect, disconnect, list, update visibility, list locations, start import, get import status, handle webhook).
- **`gbp-import.ts`** — Server functions for GBP import operations.

## Permissions

- `integration.manage` — Connect, disconnect, and manage Google connections.
- `property.create` — Start property imports from GBP locations (cross-context permission from property).

## Background jobs

- **import-property** — Processes a single GBP location into a property. Created by `startPropertyImport` use case.

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
- "completed_with_skips" means the import finished but some locations were skipped (duplicates) or failed — it is NOT a failure state.
