# Integration Context

## Bounded context

Manages Google OAuth connections, token lifecycle, GBP API infrastructure, and Pub/Sub subscription management. Connection management only — review syncing and property import live in their own contexts (`review` and `property`).

## Glossary

- **GoogleConnection** — Authenticated OAuth connection to a Google account. Stores encrypted access/refresh tokens, `connectedBy` user, `visibility` (`private` | `organization`), and `status` (`active` | `disconnected`).
- **GbpLocation** — A Google Business Profile location fetched via GBP API. Belongs to a GoogleConnection. Has `gbpPlaceId`, `locationName`, `address`.
- **GbpCacheEntry** — Cached GBP data per property. Currently stores location data only (`dataType: 'location'`).
- **GbpImportJob** — A batch import of GBP locations. Tracks `importedCount`, `skippedCount`, `failedCount`. Status: `'queued'` → `'in_progress'` → `'completed'` \| `'completed_with_skips'` \| `'completed_with_failures'` \| `'failed'`.
- **PropertyImport** — Creates a `Property` entity from a successfully imported GBP location. Links the new property back to the originating GoogleConnection.
- **Token Encryption** — Access/refresh tokens are encrypted at rest using AES-256 via `TokenEncryptionPort`.
- **OAuth Callback** — Google OAuth flow redirects to `BETTER_AUTH_URL/api/auth/google/callback` after user consent.

## Relationships

- An **Organization** can have multiple **Google Connections** (different accounts)
- Each **Google Connection** belongs to a single **Organization** and has a `connectedBy` user
- A **Google Connection** has many **GBP Locations** (fetched via GBP API)
- **GBP Cache** entries are stored per Property and data type (locations only)
- An **Import Job** is created for a specific **Google Connection** and processes a batch of **GBP Locations** (lives in `property` context)
- Successful **Import Job** items create **Properties** linked to the originating **Google Connection**
- **Import Job** tracks three counters: `importedCount`, `skippedCount`, `failedCount`
- **Pub/Sub Subscription** is created per Google account on first property import, removed on last property deletion or disconnect

## Invariants

- A connection must be `active` to start an import or list locations
- Duplicate GBP place IDs within the same organization are skipped during import
- Token refresh happens automatically with a 5-minute expiry buffer — the `refreshGoogleToken` use case is called before any GBP API interaction
- Access tokens are encrypted at rest; never stored in plaintext
- Each organization may have multiple Google connections, but each connection belongs to exactly one org

## Events produced

- **`integration.google_account.connected`** — connectionId, organizationId, googleEmail, occurredAt. Emitted when a Google account is connected.
- **`integration.google_account.disconnected`** — connectionId, organizationId, occurredAt. Emitted when a Google account is disconnected.
- **`integration.property_import.completed`** — importJobId, organizationId, totalCount, importedCount, skippedCount, failedCount, occurredAt. Emitted when an import job finishes. _(Defined in events.ts but not yet emitted — deferred)_
- **`integration.google_connection.visibility_changed`** — connectionId, organizationId, visibility, occurredAt. Emitted when connection visibility is updated.

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
    constants.ts       application-level constants
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
    event-handlers/    (empty — no consumers)
  server/              google-connections.ts, gbp-import.ts, error-helpers.ts,
                       google-auth-url.ts
  build.ts             composition root
```

## Use cases

- **`connectGoogleAccount`** — OAuth code exchange, encrypt tokens, store connection. Emits `integration.google_account.connected`.
- **`disconnectGoogleAccount`** — Revoke tokens, clear caches, set connection status to `'disconnected'`. Emits `integration.google_account.disconnected`. (FK nulling does NOT happen on disconnect — only on delete.)
- **`listGoogleConnections`** — List connections for an org.
- **`updateConnectionVisibility`** — Toggle private/organization visibility. Emits `integration.google_connection.visibility_changed`.
- **`refreshGoogleToken`** — Auto-refresh expired tokens with 5-minute buffer.
- **`listGbpLocations`** — Fetch GBP locations for a connection (with token refresh).
- **`startPropertyImport`** — Create import job, enqueue bulk import tasks. Emits `integration.property_import.completed`.
- **`getImportStatus`** — Query import job progress (imported/skipped/failed counts).
- **`importProperty`** — Process single GBP location into a property. Handles duplicate conflicts.
- **`handleGbpNotification`** — Process Google Pub/Sub push notifications for real-time review updates.

## Public API

Exported from `application/public-api.ts`:

- Types: `GoogleConnectionDto`, `GoogleConnectionStatus`, `GoogleConnectionVisibility`, `GbpLocation`, `GbpImportJob`, `GbpImportJobStatus`

## Server functions

- **`google-connections.ts`** — Server functions for Google connection CRUD (connect, disconnect, list, update visibility, list locations, start import, get import status).
- **`gbp-import.ts`** — Server functions for GBP import operations.

## Permissions

- `integration.manage` — Connect, disconnect, and manage Google connections.
- `property.create` — Start property imports from GBP locations. The code in `gbp-import.ts` checks `can(ctx.role, 'property.create')`.

## Background jobs

- **import-property** — Processes a single GBP location into a property. Created by `startPropertyImport` use case.
