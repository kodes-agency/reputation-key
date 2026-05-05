# Google Business Profile Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual property creation with Google Business Profile import — users connect Google accounts, pick locations, properties are created asynchronously via BullMQ.

**Architecture:** New `integration` bounded context following the established layer structure (domain → application → infrastructure → server → build). Google OAuth tokens stored per-organization with visibility controls. GBP data cached in a 30-day rolling cache table per Google API policies. Import jobs processed via BullMQ with progress tracking.

**Tech Stack:** TanStack Start server functions, Drizzle ORM, BullMQ, Google OAuth 2.0, Google Business Profile API v4, better-auth organization plugin

**Spec:** `docs/superpowers/specs/2026-05-05-gbp-import-design.md`

---

## File Structure

### New files — `integration` context

```
src/contexts/integration/
  domain/
    types.ts                                    — GoogleConnection, GbpCacheEntry, GbpImportJob entities
    errors.ts                                   — tagged error union
    events.ts                                   — domain events
    constructors.ts                             — entity builders
    rules.ts                                    — validation rules
  application/
    dto/
      connect-google.dto.ts                     — OAuth callback input
      disconnect-google.dto.ts                  — disconnect input
      list-locations.dto.ts                     — list GBP locations input
      import-properties.dto.ts                  — batch import input
      import-status.dto.ts                      — poll import status input
      update-connection-visibility.dto.ts       — toggle visibility input
    ports/
      google-connection.repository.ts           — connection CRUD
      gbp-cache.repository.ts                   — cache upsert/purge/query
      gbp-import.repository.ts                  — import job CRUD
      gbp-api.port.ts                           — GBP API abstraction
      token-encryption.port.ts                  — encrypt/decrypt abstraction
      google-oauth.port.ts                      — OAuth token exchange abstraction
    use-cases/
      connect-google-account.ts
      disconnect-google-account.ts
      list-google-connections.ts
      list-gbp-locations.ts
      start-property-import.ts
      get-import-status.ts
      update-connection-visibility.ts
      refresh-google-token.ts
  infrastructure/
    repositories/
      google-connection.repository.ts           — Drizzle impl
      gbp-cache.repository.ts                   — Drizzle impl
      gbp-import.repository.ts                  — Drizzle impl
    adapters/
      gbp-api.adapter.ts                        — fetch-based GBP API client
      token-encryption.adapter.ts               — Node crypto AES-256-GCM
      google-oauth.adapter.ts                   — fetch-based OAuth token exchange
    mappers/
      google-connection.mapper.ts
      gbp-cache.mapper.ts
      gbp-import.mapper.ts
  server/
    google-connections.ts                       — server functions for OAuth flow
    gbp-import.ts                               — server functions for import flow
  build.ts                                      — context wiring
  CONTEXT.md                                    — context documentation
```

### New files — shared

```
src/shared/db/schema/google-connection.schema.ts
src/shared/db/schema/gbp-cache.schema.ts
src/shared/db/schema/gbp-import-job.schema.ts
src/shared/db/schema/index.ts                   — modify: add new schemas
src/shared/domain/ids.ts                        — modify: add GoogleConnectionId, GbpImportJobId
src/shared/events/events.ts                     — modify: add IntegrationEvent types
src/shared/jobs/handlers/import-property.ts      — BullMQ job handler
src/shared/jobs/handlers/sync-gbp-cache.ts       — BullMQ scheduled job handler
```

### New files — components & routes

```
src/components/features/integration/
  google-account-selector/
    google-account-selector.tsx                  — dropdown for connected accounts
  location-picker/
    location-picker.tsx                          — checkbox list of GBP locations
    location-row.tsx                             — single location row
  import-progress/
    import-progress.tsx                          — batch progress display
    import-status-badge.tsx                      — status badge component
  connect-google-button/
    connect-google-button.tsx                    — OAuth initiation button
  google-connection-card/
    google-connection-card.tsx                   — connection info card
  shared/
    import-types.ts                              — shared types for integration feature

src/routes/
  api/auth/google/callback.ts                    — OAuth callback route
  _authenticated/properties/import/
    index.tsx                                    — import page
    $importId.tsx                                — progress page
```

### Modified files

```
src/shared/db/schema/property.schema.ts          — add google_connection_id column
src/contexts/property/domain/types.ts             — add googleConnectionId to Property type
src/contexts/property/infrastructure/mappers/property.mapper.ts — map new field
src/composition.ts                                — add integration context wiring
src/routes/_authenticated/properties/index.tsx    — update CTA to link to import
src/routes/_authenticated/properties/new.tsx      — DELETE
src/components/features/property/property-form/   — DELETE
```

---

## Task 1: Domain Types & IDs

**Files:**
- Modify: `src/shared/domain/ids.ts`
- Create: `src/contexts/integration/domain/types.ts`

- [ ] **Step 1: Add branded IDs to shared/domain/ids.ts**

Append after the existing `portalLinkId` constructor:

```ts
export type GoogleConnectionId = Brand<string, 'GoogleConnectionId'>
export type GbpImportJobId = Brand<string, 'GbpImportJobId'>

export function googleConnectionId(id: string): GoogleConnectionId {
  return id as GoogleConnectionId
}

export function gbpImportJobId(id: string): GbpImportJobId {
  return id as GbpImportJobId
}
```

- [ ] **Step 2: Create domain types**

Create `src/contexts/integration/domain/types.ts`:

```ts
import type { OrganizationId, UserId, GoogleConnectionId, GbpImportJobId, PropertyId } from '#/shared/domain/ids'

export type GoogleConnectionVisibility = 'private' | 'organization'

export type GoogleConnectionStatus = 'active' | 'disconnected'

export type GoogleConnection = Readonly<{
  id: GoogleConnectionId
  organizationId: OrganizationId
  googleAccountId: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  connectedBy: UserId
  visibility: GoogleConnectionVisibility
  status: GoogleConnectionStatus
  createdAt: Date
  updatedAt: Date
}>

export type GbpCacheDataType = 'location' | 'reviews'

export type GbpCacheEntry = Readonly<{
  id: string
  propertyId: PropertyId
  gbpPlaceId: string
  dataType: GbpCacheDataType
  payload: unknown
  googleAttribution: string | null
  fetchedAt: Date
  expiresAt: Date
}>

export type GbpImportJobStatus = 'queued' | 'in_progress' | 'completed' | 'failed'

export type GbpImportJob = Readonly<{
  id: GbpImportJobId
  organizationId: OrganizationId
  initiatedBy: UserId
  status: GbpImportJobStatus
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  createdAt: Date
  updatedAt: Date
}>

export type GbpLocation = Readonly<{
  name: string
  gbpPlaceId: string
  businessName: string
  address: string | null
  primaryCategory: string | null
  latitude: number | null
  longitude: number | null
}>

export type { GoogleConnectionId, GbpImportJobId }
export type { PropertyId } from '#/shared/domain/ids'
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/domain/ids.ts src/contexts/integration/domain/types.ts
git commit -m "feat(integration): domain types and branded IDs"
```

---

## Task 2: Domain Errors, Events, Constructors, Rules

**Files:**
- Create: `src/contexts/integration/domain/errors.ts`
- Create: `src/contexts/integration/domain/events.ts`
- Create: `src/contexts/integration/domain/constructors.ts`
- Create: `src/contexts/integration/domain/rules.ts`

- [ ] **Step 1: Create errors**

Create `src/contexts/integration/domain/errors.ts`:

```ts
export type IntegrationErrorCode =
  | 'forbidden'
  | 'connection_not_found'
  | 'connection_disconnected'
  | 'oauth_failed'
  | 'oauth_denied'
  | 'token_refresh_failed'
  | 'gbp_api_error'
  | 'gbp_api_rate_limited'
  | 'import_not_found'
  | 'invalid_visibility'
  | 'encryption_error'

export type IntegrationError = Readonly<{
  _tag: 'IntegrationError'
  code: IntegrationErrorCode
  message: string
}>

export const integrationError = (
  code: IntegrationErrorCode,
  message: string,
): IntegrationError => ({
  _tag: 'IntegrationError',
  code,
  message,
})

export const isIntegrationError = (e: unknown): e is IntegrationError =>
  typeof e === 'object' && e !== null && '_tag' in e && (e as { _tag: string })._tag === 'IntegrationError'
```

- [ ] **Step 2: Create events**

Create `src/contexts/integration/domain/events.ts`:

```ts
import type { GoogleConnectionId, GbpImportJobId, OrganizationId } from '#/shared/domain/ids'

export type GoogleAccountConnected = Readonly<{
  _tag: 'google_account.connected'
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  googleEmail: string
  occurredAt: Date
}>

export type GoogleAccountDisconnected = Readonly<{
  _tag: 'google_account.disconnected'
  connectionId: GoogleConnectionId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type PropertyImportCompleted = Readonly<{
  _tag: 'property_import.completed'
  importJobId: GbpImportJobId
  organizationId: OrganizationId
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  occurredAt: Date
}>

export type IntegrationEvent =
  | GoogleAccountConnected
  | GoogleAccountDisconnected
  | PropertyImportCompleted

export const googleAccountConnected = (
  args: Omit<GoogleAccountConnected, '_tag'>,
): GoogleAccountConnected => ({ _tag: 'google_account.connected', ...args })

export const googleAccountDisconnected = (
  args: Omit<GoogleAccountDisconnected, '_tag'>,
): GoogleAccountDisconnected => ({ _tag: 'google_account.disconnected', ...args })

export const propertyImportCompleted = (
  args: Omit<PropertyImportCompleted, '_tag'>,
): PropertyImportCompleted => ({ _tag: 'property_import.completed', ...args })
```

- [ ] **Step 3: Create constructors**

Create `src/contexts/integration/domain/constructors.ts`:

```ts
import type { GoogleConnection, GbpImportJob } from './types'
import type { GoogleConnectionId, GbpImportJobId, OrganizationId, UserId } from '#/shared/domain/ids'
import { ok, err } from 'neverthrow'
import { integrationError } from './errors'
import { isValidVisibility } from './rules'

type BuildConnectionArgs = {
  id: GoogleConnectionId
  organizationId: OrganizationId
  googleAccountId: string
  googleEmail: string
  encryptedAccessToken: string
  encryptedRefreshToken: string
  tokenExpiresAt: Date
  scopes: ReadonlyArray<string>
  connectedBy: UserId
  visibility: 'private' | 'organization'
  now: Date
}

export const buildGoogleConnection = (
  args: BuildConnectionArgs,
) => {
  if (!args.googleEmail.includes('@')) {
    return err(integrationError('oauth_failed', 'Invalid Google email'))
  }
  if (!isValidVisibility(args.visibility)) {
    return err(integrationError('invalid_visibility', `Invalid visibility: ${args.visibility}`))
  }

  return ok<GoogleConnection>({
    id: args.id,
    organizationId: args.organizationId,
    googleAccountId: args.googleAccountId,
    googleEmail: args.googleEmail,
    encryptedAccessToken: args.encryptedAccessToken,
    encryptedRefreshToken: args.encryptedRefreshToken,
    tokenExpiresAt: args.tokenExpiresAt,
    scopes: args.scopes,
    connectedBy: args.connectedBy,
    visibility: args.visibility,
    status: 'active',
    createdAt: args.now,
    updatedAt: args.now,
  })
}

type BuildImportJobArgs = {
  id: GbpImportJobId
  organizationId: OrganizationId
  initiatedBy: UserId
  totalCount: number
  now: Date
}

export const buildGbpImportJob = (args: BuildImportJobArgs) =>
  ok<GbpImportJob>({
    id: args.id,
    organizationId: args.organizationId,
    initiatedBy: args.initiatedBy,
    status: 'queued',
    totalCount: args.totalCount,
    importedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    createdAt: args.now,
    updatedAt: args.now,
  })
```

- [ ] **Step 4: Create rules**

Create `src/contexts/integration/domain/rules.ts`:

```ts
import type { GoogleConnectionVisibility } from './types'

const VALID_VISIBILITIES: ReadonlySet<string> = new Set(['private', 'organization'])

export const isValidVisibility = (v: string): v is GoogleConnectionVisibility =>
  VALID_VISIBILITIES.has(v)
```

- [ ] **Step 5: Update master event union**

Add to `src/shared/events/events.ts` after the Guest context events:

```ts
// Integration context events
export type {
  // fallow-ignore-next-line unused-type
  IntegrationEvent,
  // fallow-ignore-next-line unused-type
  GoogleAccountConnected,
  // fallow-ignore-next-line unused-type
  GoogleAccountDisconnected,
  // fallow-ignore-next-line unused-type
  PropertyImportCompleted,
} from '#/contexts/integration/domain/events'
```

And add to the `DomainEvent` union at the bottom:

```ts
import type { IntegrationEvent } from '#/contexts/integration/domain/events'

export type DomainEvent =
  | IdentityEvent
  | PropertyEvent
  | TeamEvent
  | StaffEvent
  | PortalEvent
  | GuestEvent
  | IntegrationEvent
```

- [ ] **Step 6: Commit**

```bash
git add src/contexts/integration/domain/ src/shared/events/events.ts
git commit -m "feat(integration): domain errors, events, constructors, rules"
```

---

## Task 3: DB Schemas

**Files:**
- Create: `src/shared/db/schema/google-connection.schema.ts`
- Create: `src/shared/db/schema/gbp-cache.schema.ts`
- Create: `src/shared/db/schema/gbp-import-job.schema.ts`
- Modify: `src/shared/db/schema/index.ts`
- Modify: `src/shared/db/schema/property.schema.ts`

- [ ] **Step 1: Create google_connection schema**

Create `src/shared/db/schema/google-connection.schema.ts`:

```ts
import { createdAtColumn, updatedAtColumn } from '../columns'
import { pgTable, uuid, varchar, timestamp, text, pgEnum } from 'drizzle-orm/pg-core'

export const connectionVisibilityEnum = pgEnum('connection_visibility', ['private', 'organization'])
export const connectionStatusEnum = pgEnum('connection_status', ['active', 'disconnected'])

export const googleConnections = pgTable('google_connections', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  googleAccountId: varchar('google_account_id', { length: 255 }).notNull(),
  googleEmail: varchar('google_email', { length: 255 }).notNull(),
  encryptedAccessToken: text('encrypted_access_token').notNull(),
  encryptedRefreshToken: text('encrypted_refresh_token').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  scopes: text('scopes').array().notNull(),
  connectedBy: varchar('connected_by', { length: 255 }).notNull(),
  visibility: connectionVisibilityEnum('visibility').notNull().default('private'),
  status: connectionStatusEnum('status').notNull().default('active'),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})
```

- [ ] **Step 2: Create gbp_cache schema**

Create `src/shared/db/schema/gbp-cache.schema.ts`:

```ts
import { createdAtColumn } from '../columns'
import { pgTable, uuid, varchar, timestamp, text, pgEnum, jsonb, uniqueIndex } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { googleConnections } from './google-connection.schema'
import { properties } from './property.schema'

export const gbpCacheDataTypeEnum = pgEnum('gbp_cache_data_type', ['location', 'reviews'])

export const gbpCache = pgTable('gbp_cache', {
  id: uuid('id').primaryKey().defaultRandom(),
  propertyId: uuid('property_id').notNull().references(() => properties.id, { onDelete: 'cascade' }),
  gbpPlaceId: varchar('gbp_place_id', { length: 500 }).notNull(),
  dataType: gbpCacheDataTypeEnum('data_type').notNull(),
  payload: jsonb('payload').notNull(),
  googleAttribution: text('google_attribution'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  uniqueIndex('gbp_cache_property_type_unique').on(t.propertyId, t.dataType),
])

export const gbpCacheRelations = relations(gbpCache, ({ one }) => ({
  property: one(properties, {
    fields: [gbpCache.propertyId],
    references: [properties.id],
  }),
}))
```

- [ ] **Step 3: Create gbp_import_job schema**

Create `src/shared/db/schema/gbp-import-job.schema.ts`:

```ts
import { createdAtColumn, updatedAtColumn } from '../columns'
import { pgTable, uuid, varchar, integer, pgEnum } from 'drizzle-orm/pg-core'

export const importJobStatusEnum = pgEnum('import_job_status', ['queued', 'in_progress', 'completed', 'failed'])

export const gbpImportJobs = pgTable('gbp_import_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  initiatedBy: varchar('initiated_by', { length: 255 }).notNull(),
  status: importJobStatusEnum('status').notNull().default('queued'),
  totalCount: integer('total_count').notNull().default(0),
  importedCount: integer('imported_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
})
```

- [ ] **Step 4: Add google_connection_id to property schema**

Add to the `properties` table in `src/shared/db/schema/property.schema.ts`, after the `gbpPlaceId` column:

```ts
    googleConnectionId: uuid('google_connection_id').references(() => googleConnections.id, { onDelete: 'set null' }),
```

Also add the import at the top:

```ts
import { googleConnections } from './google-connection.schema'
```

- [ ] **Step 5: Update schema barrel**

Add to `src/shared/db/schema/index.ts`:

```ts
export * from './google-connection.schema'
export * from './gbp-cache.schema'
export * from './gbp-import-job.schema'
```

- [ ] **Step 6: Run type check**

Run: `pnpm tsc --noEmit`
Expected: May have errors from the new `googleConnectionId` field on properties not yet mapped. Note them — they'll be fixed in Task 5.

- [ ] **Step 7: Generate and run migration**

```bash
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
```

- [ ] **Step 8: Commit**

```bash
git add src/shared/db/schema/
git commit -m "feat(integration): DB schemas for google connections, GBP cache, import jobs"
```

---

## Task 4: Application Ports

**Files:**
- Create: `src/contexts/integration/application/ports/google-connection.repository.ts`
- Create: `src/contexts/integration/application/ports/gbp-cache.repository.ts`
- Create: `src/contexts/integration/application/ports/gbp-import.repository.ts`
- Create: `src/contexts/integration/application/ports/gbp-api.port.ts`
- Create: `src/contexts/integration/application/ports/token-encryption.port.ts`
- Create: `src/contexts/integration/application/ports/google-oauth.port.ts`

- [ ] **Step 1: Create google-connection repository port**

Create `src/contexts/integration/application/ports/google-connection.repository.ts`:

```ts
import type { GoogleConnection, GoogleConnectionId, GoogleConnectionVisibility, GoogleConnectionStatus } from '../../domain/types'
import type { OrganizationId, UserId } from '#/shared/domain/ids'

export type GoogleConnectionRepository = Readonly<{
  findById: (orgId: OrganizationId, id: GoogleConnectionId) => Promise<GoogleConnection | null>
  findByGoogleAccountId: (orgId: OrganizationId, googleAccountId: string) => Promise<GoogleConnection | null>
  listByOrganization: (orgId: OrganizationId, userId: UserId) => Promise<ReadonlyArray<GoogleConnection>>
  insert: (connection: GoogleConnection) => Promise<void>
  updateStatus: (id: GoogleConnectionId, status: GoogleConnectionStatus) => Promise<void>
  updateVisibility: (id: GoogleConnectionId, visibility: GoogleConnectionVisibility) => Promise<void>
  updateTokens: (id: GoogleConnectionId, encryptedAccessToken: string, encryptedRefreshToken: string, tokenExpiresAt: Date) => Promise<void>
  delete: (id: GoogleConnectionId) => Promise<void>
}>
```

- [ ] **Step 2: Create gbp-cache repository port**

Create `src/contexts/integration/application/ports/gbp-cache.repository.ts`:

```ts
import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'
import type { PropertyId } from '#/shared/domain/ids'

export type GbpCacheRepository = Readonly<{
  findByPropertyAndType: (propertyId: PropertyId, dataType: GbpCacheDataType) => Promise<GbpCacheEntry | null>
  upsert: (entry: GbpCacheEntry) => Promise<void>
  deleteByProperty: (propertyId: PropertyId) => Promise<void>
  deleteExpired: () => Promise<number>
  deleteByConnectionId: (connectionId: string) => Promise<number>
}>
```

- [ ] **Step 3: Create gbp-import repository port**

Create `src/contexts/integration/application/ports/gbp-import.repository.ts`:

```ts
import type { GbpImportJob, GbpImportJobId, GbpImportJobStatus } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type GbpImportRepository = Readonly<{
  findById: (id: GbpImportJobId) => Promise<GbpImportJob | null>
  findByOrganization: (orgId: OrganizationId) => Promise<ReadonlyArray<GbpImportJob>>
  insert: (job: GbpImportJob) => Promise<void>
  updateStatus: (id: GbpImportJobId, status: GbpImportJobStatus) => Promise<void>
  incrementImported: (id: GbpImportJobId) => Promise<void>
  incrementSkipped: (id: GbpImportJobId) => Promise<void>
  incrementFailed: (id: GbpImportJobId) => Promise<void>
}>
```

- [ ] **Step 4: Create gbp-api port**

Create `src/contexts/integration/application/ports/gbp-api.port.ts`:

```ts
import type { GbpLocation } from '../../domain/types'

export type GbpApiPort = Readonly<{
  listLocations: (accessToken: string, accountName: string) => Promise<ReadonlyArray<GbpLocation>>
  getLocation: (accessToken: string, accountName: string, locationName: string) => Promise<GbpLocation>
  batchGetReviews: (accessToken: string, accountName: string, locationNames: ReadonlyArray<string>) => Promise<ReadonlyArray<{ locationName: string; reviews: unknown }>>
}>
```

- [ ] **Step 5: Create token-encryption port**

Create `src/contexts/integration/application/ports/token-encryption.port.ts`:

```ts
export type TokenEncryptionPort = Readonly<{
  encrypt: (plaintext: string) => string
  decrypt: (ciphertext: string) => string
}>
```

- [ ] **Step 6: Create google-oauth port**

Create `src/contexts/integration/application/ports/google-oauth.port.ts`:

```ts
export type GoogleOAuthResult = Readonly<{
  googleAccountId: string
  googleEmail: string
  accessToken: string
  refreshToken: string
  expiresIn: number
  scopes: ReadonlyArray<string>
}>

export type GoogleOAuthPort = Readonly<{
  exchangeCode: (code: string, redirectUri: string) => Promise<GoogleOAuthResult>
  refreshAccessToken: (refreshToken: string) => Promise<{ accessToken: string; expiresIn: number }>
  revokeToken: (token: string) => Promise<void>
  getAuthorizationUrl: (redirectUri: string, state: string) => string
}>
```

- [ ] **Step 7: Commit**

```bash
git add src/contexts/integration/application/ports/
git commit -m "feat(integration): application ports for repositories, GBP API, OAuth, encryption"
```

---

## Task 5: DTOs

**Files:**
- Create: `src/contexts/integration/application/dto/connect-google.dto.ts`
- Create: `src/contexts/integration/application/dto/disconnect-google.dto.ts`
- Create: `src/contexts/integration/application/dto/list-locations.dto.ts`
- Create: `src/contexts/integration/application/dto/import-properties.dto.ts`
- Create: `src/contexts/integration/application/dto/import-status.dto.ts`
- Create: `src/contexts/integration/application/dto/update-connection-visibility.dto.ts`

- [ ] **Step 1: Create all DTOs**

`src/contexts/integration/application/dto/connect-google.dto.ts`:

```ts
import { z } from 'zod/v4'

export const connectGoogleInputSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  redirectUri: z.string().url(),
  visibility: z.enum(['private', 'organization']).default('private'),
})

export type ConnectGoogleInput = z.infer<typeof connectGoogleInputSchema>
```

`src/contexts/integration/application/dto/disconnect-google.dto.ts`:

```ts
import { z } from 'zod/v4'

export const disconnectGoogleInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
})

export type DisconnectGoogleInput = z.infer<typeof disconnectGoogleInputSchema>
```

`src/contexts/integration/application/dto/list-locations.dto.ts`:

```ts
import { z } from 'zod/v4'

export const listLocationsInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
})

export type ListLocationsInput = z.infer<typeof listLocationsInputSchema>
```

`src/contexts/integration/application/dto/import-properties.dto.ts`:

```ts
import { z } from 'zod/v4'

export const importPropertiesInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
  locations: z.array(z.object({
    gbpPlaceId: z.string().min(1),
    businessName: z.string().min(1),
    address: z.string().nullable(),
    primaryCategory: z.string().nullable(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
  })).min(1, 'Select at least one location'),
})

export type ImportPropertiesInput = z.infer<typeof importPropertiesInputSchema>
```

`src/contexts/integration/application/dto/import-status.dto.ts`:

```ts
import { z } from 'zod/v4'

export const importStatusInputSchema = z.object({
  importId: z.string().min(1, 'Import ID is required'),
})

export type ImportStatusInput = z.infer<typeof importStatusInputSchema>
```

`src/contexts/integration/application/dto/update-connection-visibility.dto.ts`:

```ts
import { z } from 'zod/v4'

export const updateConnectionVisibilityInputSchema = z.object({
  connectionId: z.string().min(1, 'Connection ID is required'),
  visibility: z.enum(['private', 'organization']),
})

export type UpdateConnectionVisibilityInput = z.infer<typeof updateConnectionVisibilityInputSchema>
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/integration/application/dto/
git commit -m "feat(integration): DTOs for all integration server functions"
```

---

## Task 6: Use Cases — Connection Management

**Files:**
- Create: `src/contexts/integration/application/use-cases/connect-google-account.ts`
- Create: `src/contexts/integration/application/use-cases/disconnect-google-account.ts`
- Create: `src/contexts/integration/application/use-cases/list-google-connections.ts`
- Create: `src/contexts/integration/application/use-cases/update-connection-visibility.ts`
- Create: `src/contexts/integration/application/use-cases/refresh-google-token.ts`

- [ ] **Step 1: Create connect-google-account use case**

Create `src/contexts/integration/application/use-cases/connect-google-account.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GoogleConnectionId } from '#/shared/domain/ids'
import type { ConnectGoogleInput } from '../dto/connect-google.dto'
import type { GoogleConnection } from '../../domain/types'
import { can } from '#/shared/domain/permissions'
import { buildGoogleConnection } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'
import { googleAccountConnected } from '../../domain/events'

export type ConnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  events: EventBus
  idGen: () => GoogleConnectionId
  clock: () => Date
}>

export const connectGoogleAccount =
  (deps: ConnectGoogleAccountDeps) =>
  async (input: ConnectGoogleInput, ctx: AuthContext): Promise<GoogleConnection> => {
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError('forbidden', 'this role cannot manage integrations')
    }

    const oauthResult = await deps.oauth.exchangeCode(input.code, input.redirectUri)

    const encryptedAccessToken = deps.encryption.encrypt(oauthResult.accessToken)
    const encryptedRefreshToken = deps.encryption.encrypt(oauthResult.refreshToken)
    const tokenExpiresAt = new Date(Date.now() + oauthResult.expiresIn * 1000)

    const existing = await deps.connectionRepo.findByGoogleAccountId(ctx.organizationId, oauthResult.googleAccountId)

    if (existing) {
      await deps.connectionRepo.updateTokens(existing.id, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt)
      if (existing.status === 'disconnected') {
        // Reactivate disconnected connection
        await deps.connectionRepo.updateStatus(existing.id, 'active')
      }
      const reloaded = await deps.connectionRepo.findById(ctx.organizationId, existing.id)
      if (reloaded) return reloaded
      throw integrationError('connection_not_found', 'Failed to reload updated connection')
    }

    const connectionResult = buildGoogleConnection({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      googleAccountId: oauthResult.googleAccountId,
      googleEmail: oauthResult.googleEmail,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      scopes: oauthResult.scopes,
      connectedBy: ctx.userId,
      visibility: input.visibility,
      now: deps.clock(),
    })

    if (connectionResult.isErr()) throw connectionResult.error

    const connection = connectionResult.value
    await deps.connectionRepo.insert(connection)

    deps.events.emit(
      googleAccountConnected({
        connectionId: connection.id,
        organizationId: connection.organizationId,
        googleEmail: connection.googleEmail,
        occurredAt: connection.createdAt,
      }),
    )

    return connection
  }

export type ConnectGoogleAccount = ReturnType<typeof connectGoogleAccount>
```

- [ ] **Step 2: Create disconnect-google-account use case**

Create `src/contexts/integration/application/use-cases/disconnect-google-account.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpCacheRepository } from '../ports/gbp-cache.repository'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { DisconnectGoogleInput } from '../dto/disconnect-google.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'
import { googleAccountDisconnected } from '../../domain/events'

export type DisconnectGoogleAccountDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  cacheRepo: GbpCacheRepository
  encryption: TokenEncryptionPort
  events: EventBus
  clock: () => Date
}>

export const disconnectGoogleAccount =
  (deps: DisconnectGoogleAccountDeps) =>
  async (input: DisconnectGoogleInput, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError('forbidden', 'this role cannot manage integrations')
    }

    const connId = googleConnectionId(input.connectionId)
    const connection = await deps.connectionRepo.findById(ctx.organizationId, connId)

    if (!connection) {
      throw integrationError('connection_not_found', 'Connection not found')
    }

    // Try to revoke token with Google (best-effort, don't block on failure)
    try {
      const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
      await deps.connectionRepo.updateStatus(connId, 'disconnected')
    } catch {
      // Token revocation failed — still mark disconnected locally
      await deps.connectionRepo.updateStatus(connId, 'disconnected')
    }

    // Purge cached GBP data for this connection's properties
    await deps.cacheRepo.deleteByConnectionId(input.connectionId)

    deps.events.emit(
      googleAccountDisconnected({
        connectionId: connId,
        organizationId: ctx.organizationId,
        occurredAt: deps.clock(),
      }),
    )
  }

export type DisconnectGoogleAccount = ReturnType<typeof disconnectGoogleAccount>
```

- [ ] **Step 3: Create list-google-connections use case**

Create `src/contexts/integration/application/use-cases/list-google-connections.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleConnection } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'

export type ListGoogleConnectionsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
}>

export const listGoogleConnections =
  (deps: ListGoogleConnectionsDeps) =>
  async (ctx: AuthContext): Promise<ReadonlyArray<GoogleConnection>> => {
    return deps.connectionRepo.listByOrganization(ctx.organizationId, ctx.userId)
  }

export type ListGoogleConnections = ReturnType<typeof listGoogleConnections>
```

- [ ] **Step 4: Create update-connection-visibility use case**

Create `src/contexts/integration/application/use-cases/update-connection-visibility.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { UpdateConnectionVisibilityInput } from '../dto/update-connection-visibility.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type UpdateConnectionVisibilityDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
}>

export const updateConnectionVisibility =
  (deps: UpdateConnectionVisibilityDeps) =>
  async (input: UpdateConnectionVisibilityInput, ctx: AuthContext): Promise<void> => {
    if (!can(ctx.role, 'integration.manage')) {
      throw integrationError('forbidden', 'this role cannot manage integrations')
    }

    const connId = googleConnectionId(input.connectionId)
    const connection = await deps.connectionRepo.findById(ctx.organizationId, connId)

    if (!connection) {
      throw integrationError('connection_not_found', 'Connection not found')
    }

    await deps.connectionRepo.updateVisibility(connId, input.visibility)
  }

export type UpdateConnectionVisibility = ReturnType<typeof updateConnectionVisibility>
```

- [ ] **Step 5: Create refresh-google-token use case**

Create `src/contexts/integration/application/use-cases/refresh-google-token.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GoogleOAuthPort } from '../ports/google-oauth.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { GoogleConnection } from '../../domain/types'
import type { GoogleConnectionId, OrganizationId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type RefreshGoogleTokenDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
}>

export const refreshGoogleToken =
  (deps: RefreshGoogleTokenDeps) =>
  async (orgId: OrganizationId, connectionId: GoogleConnectionId): Promise<GoogleConnection> => {
    const connection = await deps.connectionRepo.findById(orgId, connectionId)

    if (!connection) {
      throw integrationError('connection_not_found', 'Connection not found')
    }

    if (connection.status === 'disconnected') {
      throw integrationError('connection_disconnected', 'Connection has been disconnected')
    }

    // Only refresh if token is expired or about to expire (5 min buffer)
    if (connection.tokenExpiresAt.getTime() > Date.now() - 5 * 60 * 1000) {
      return connection
    }

    try {
      const refreshToken = deps.encryption.decrypt(connection.encryptedRefreshToken)
      const result = await deps.oauth.refreshAccessToken(refreshToken)

      const encryptedAccessToken = deps.encryption.encrypt(result.accessToken)
      const tokenExpiresAt = new Date(Date.now() + result.expiresIn * 1000)

      await deps.connectionRepo.updateTokens(connectionId, encryptedAccessToken, connection.encryptedRefreshToken, tokenExpiresAt)

      const refreshed = await deps.connectionRepo.findById(orgId, connectionId)
      if (!refreshed) throw integrationError('connection_not_found', 'Failed to reload refreshed connection')
      return refreshed
    } catch (e) {
      if (isIntegrationError(e)) throw e
      throw integrationError('token_refresh_failed', 'Failed to refresh Google access token')
    }
  }

// Avoid circular import — inline the check
const isIntegrationError = (e: unknown): boolean =>
  typeof e === 'object' && e !== null && '_tag' in e && (e as { _tag: string })._tag === 'IntegrationError'

export type RefreshGoogleToken = ReturnType<typeof refreshGoogleToken>
```

- [ ] **Step 6: Commit**

```bash
git add src/contexts/integration/application/use-cases/
git commit -m "feat(integration): use cases for connection management"
```

---

## Task 7: Use Cases — Import Flow

**Files:**
- Create: `src/contexts/integration/application/use-cases/list-gbp-locations.ts`
- Create: `src/contexts/integration/application/use-cases/start-property-import.ts`
- Create: `src/contexts/integration/application/use-cases/get-import-status.ts`

- [ ] **Step 1: Create list-gbp-locations use case**

Create `src/contexts/integration/application/use-cases/list-gbp-locations.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpApiPort } from '../ports/gbp-api.port'
import type { TokenEncryptionPort } from '../ports/token-encryption.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GbpLocation } from '../../domain/types'
import type { ListLocationsInput } from '../dto/list-locations.dto'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type ListGbpLocationsDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  gbpApi: GbpApiPort
  encryption: TokenEncryptionPort
}>

export const listGbpLocations =
  (deps: ListGbpLocationsDeps) =>
  async (input: ListLocationsInput, ctx: AuthContext): Promise<ReadonlyArray<GbpLocation>> => {
    if (!can(ctx.role, 'property.create')) {
      throw integrationError('forbidden', 'this role cannot create properties')
    }

    const connId = googleConnectionId(input.connectionId)
    const connection = await deps.connectionRepo.findById(ctx.organizationId, connId)

    if (!connection) {
      throw integrationError('connection_not_found', 'Connection not found')
    }

    if (connection.status === 'disconnected') {
      throw integrationError('connection_disconnected', 'Connection has been disconnected — reconnect first')
    }

    const accessToken = deps.encryption.decrypt(connection.encryptedAccessToken)

    return deps.gbpApi.listLocations(accessToken, `accounts/${connection.googleAccountId}`)
  }

export type ListGbpLocations = ReturnType<typeof listGbpLocations>
```

- [ ] **Step 2: Create start-property-import use case**

Create `src/contexts/integration/application/use-cases/start-property-import.ts`:

```ts
import type { GoogleConnectionRepository } from '../ports/google-connection.repository'
import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { GbpImportJob } from '../../domain/types'
import type { ImportPropertiesInput } from '../dto/import-properties.dto'
import type { GbpImportJobId } from '#/shared/domain/ids'
import { can } from '#/shared/domain/permissions'
import { googleConnectionId, gbpImportJobId } from '#/shared/domain/ids'
import { buildGbpImportJob } from '../../domain/constructors'
import { integrationError } from '../../domain/errors'
import { propertyImportCompleted } from '../../domain/events'

export type StartPropertyImportDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  importRepo: GbpImportRepository
  events: EventBus
  queue: { addBulkImportJob: (jobId: string, locations: ImportPropertiesInput['locations'], connectionId: string) => Promise<void> }
  idGen: () => GbpImportJobId
  clock: () => Date
}>

export const startPropertyImport =
  (deps: StartPropertyImportDeps) =>
  async (input: ImportPropertiesInput, ctx: AuthContext): Promise<GbpImportJob> => {
    if (!can(ctx.role, 'property.create')) {
      throw integrationError('forbidden', 'this role cannot create properties')
    }

    const connId = googleConnectionId(input.connectionId)
    const connection = await deps.connectionRepo.findById(ctx.organizationId, connId)

    if (!connection) {
      throw integrationError('connection_not_found', 'Connection not found')
    }

    if (connection.status === 'disconnected') {
      throw integrationError('connection_disconnected', 'Connection has been disconnected')
    }

    const jobResult = buildGbpImportJob({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      initiatedBy: ctx.userId,
      totalCount: input.locations.length,
      now: deps.clock(),
    })

    if (jobResult.isErr()) throw jobResult.error

    const job = jobResult.value
    await deps.importRepo.insert(job)

    await deps.queue.addBulkImportJob(job.id, input.locations, input.connectionId)

    return job
  }

export type StartPropertyImport = ReturnType<typeof startPropertyImport>
```

- [ ] **Step 3: Create get-import-status use case**

Create `src/contexts/integration/application/use-cases/get-import-status.ts`:

```ts
import type { GbpImportRepository } from '../ports/gbp-import.repository'
import type { GbpImportJob } from '../../domain/types'
import type { ImportStatusInput } from '../dto/import-status.dto'
import type { AuthContext } from '#/shared/domain/auth-context'
import { gbpImportJobId } from '#/shared/domain/ids'
import { integrationError } from '../../domain/errors'

export type GetImportStatusDeps = Readonly<{
  importRepo: GbpImportRepository
}>

export const getImportStatus =
  (deps: GetImportStatusDeps) =>
  async (input: ImportStatusInput, _ctx: AuthContext): Promise<GbpImportJob> => {
    const jobId = gbpImportJobId(input.importId)
    const job = await deps.importRepo.findById(jobId)

    if (!job) {
      throw integrationError('import_not_found', 'Import job not found')
    }

    return job
  }

export type GetImportStatus = ReturnType<typeof getImportStatus>
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/integration/application/use-cases/list-gbp-locations.ts src/contexts/integration/application/use-cases/start-property-import.ts src/contexts/integration/application/use-cases/get-import-status.ts
git commit -m "feat(integration): use cases for GBP location listing and property import"
```

---

## Task 8: Infrastructure — Repositories

**Files:**
- Create: `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`
- Create: `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`
- Create: `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`
- Create: `src/contexts/integration/infrastructure/mappers/google-connection.mapper.ts`
- Create: `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts`
- Create: `src/contexts/integration/infrastructure/mappers/gbp-import.mapper.ts`

- [ ] **Step 1: Create google-connection mapper**

Create `src/contexts/integration/infrastructure/mappers/google-connection.mapper.ts`:

```ts
import type { GoogleConnection } from '../../domain/types'
import type { googleConnections } from '#/shared/db/schema'
import { googleConnectionId } from '#/shared/domain/ids'
import { organizationId, userId } from '#/shared/domain/ids'

type DbRow = typeof googleConnections.$inferSelect

export const toDomain = (row: DbRow): GoogleConnection => ({
  id: googleConnectionId(row.id),
  organizationId: organizationId(row.organizationId),
  googleAccountId: row.googleAccountId,
  googleEmail: row.googleEmail,
  encryptedAccessToken: row.encryptedAccessToken,
  encryptedRefreshToken: row.encryptedRefreshToken,
  tokenExpiresAt: row.tokenExpiresAt,
  scopes: row.scopes,
  connectedBy: userId(row.connectedBy),
  visibility: row.visibility,
  status: row.status,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const toInsert = (conn: GoogleConnection) => ({
  id: conn.id as string,
  organizationId: conn.organizationId as string,
  googleAccountId: conn.googleAccountId,
  googleEmail: conn.googleEmail,
  encryptedAccessToken: conn.encryptedAccessToken,
  encryptedRefreshToken: conn.encryptedRefreshToken,
  tokenExpiresAt: conn.tokenExpiresAt,
  scopes: conn.scopes as string[],
  connectedBy: conn.connectedBy as string,
  visibility: conn.visibility,
  status: conn.status,
})
```

- [ ] **Step 2: Create google-connection repository**

Create `src/contexts/integration/infrastructure/repositories/google-connection.repository.ts`:

```ts
import type { GoogleConnectionRepository } from '../../application/ports/google-connection.repository'
import type { GoogleConnection, GoogleConnectionId, GoogleConnectionVisibility, GoogleConnectionStatus } from '../../domain/types'
import type { OrganizationId, UserId } from '#/shared/domain/ids'
import { eq, and, or } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { googleConnections } from '#/shared/db/schema'
import * as m from '../mappers/google-connection.mapper'

export const createGoogleConnectionRepository = (): GoogleConnectionRepository => {
  const repo: GoogleConnectionRepository = {
    async findById(orgId, id) {
      const [row] = await getDb()
        .select()
        .from(googleConnections)
        .where(and(eq(googleConnections.id, id as string), eq(googleConnections.organizationId, orgId as string)))
        .limit(1)
      return row ? m.toDomain(row) : null
    },

    async findByGoogleAccountId(orgId, googleAccountId) {
      const [row] = await getDb()
        .select()
        .from(googleConnections)
        .where(and(eq(googleConnections.googleAccountId, googleAccountId), eq(googleConnections.organizationId, orgId as string)))
        .limit(1)
      return row ? m.toDomain(row) : null
    },

    async listByOrganization(orgId, userId) {
      const rows = await getDb()
        .select()
        .from(googleConnections)
        .where(
          and(
            eq(googleConnections.organizationId, orgId as string),
            or(
              eq(googleConnections.visibility, 'organization'),
              eq(googleConnections.connectedBy, userId as string),
            ),
          ),
        )
      return rows.map(m.toDomain)
    },

    async insert(connection) {
      await getDb().insert(googleConnections).values(m.toInsert(connection))
    },

    async updateStatus(id, status) {
      await getDb()
        .update(googleConnections)
        .set({ status, updatedAt: new Date() })
        .where(eq(googleConnections.id, id as string))
    },

    async updateVisibility(id, visibility) {
      await getDb()
        .update(googleConnections)
        .set({ visibility, updatedAt: new Date() })
        .where(eq(googleConnections.id, id as string))
    },

    async updateTokens(id, encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt) {
      await getDb()
        .update(googleConnections)
        .set({ encryptedAccessToken, encryptedRefreshToken, tokenExpiresAt, updatedAt: new Date() })
        .where(eq(googleConnections.id, id as string))
    },

    async delete(id) {
      await getDb()
        .delete(googleConnections)
        .where(eq(googleConnections.id, id as string))
    },
  }

  return repo
}
```

- [ ] **Step 3: Create gbp-cache mapper**

Create `src/contexts/integration/infrastructure/mappers/gbp-cache.mapper.ts`:

```ts
import type { GbpCacheEntry } from '../../domain/types'
import type { gbpCache } from '#/shared/db/schema'
import { propertyId } from '#/shared/domain/ids'

type DbRow = typeof gbpCache.$inferSelect

export const toDomain = (row: DbRow): GbpCacheEntry => ({
  id: row.id,
  propertyId: propertyId(row.propertyId),
  gbpPlaceId: row.gbpPlaceId,
  dataType: row.dataType,
  payload: row.payload,
  googleAttribution: row.googleAttribution,
  fetchedAt: row.fetchedAt,
  expiresAt: row.expiresAt,
})

export const toUpsert = (entry: GbpCacheEntry) => ({
  id: entry.id,
  propertyId: entry.propertyId as string,
  gbpPlaceId: entry.gbpPlaceId,
  dataType: entry.dataType,
  payload: entry.payload,
  googleAttribution: entry.googleAttribution,
  fetchedAt: entry.fetchedAt,
  expiresAt: entry.expiresAt,
})
```

- [ ] **Step 4: Create gbp-cache repository**

Create `src/contexts/integration/infrastructure/repositories/gbp-cache.repository.ts`:

```ts
import type { GbpCacheRepository } from '../../application/ports/gbp-cache.repository'
import type { GbpCacheEntry, GbpCacheDataType } from '../../domain/types'
import type { PropertyId } from '#/shared/domain/ids'
import { eq, and, lt } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { gbpCache, properties } from '#/shared/db/schema'
import * as m from '../mappers/gbp-cache.mapper'

export const createGbpCacheRepository = (): GbpCacheRepository => {
  const repo: GbpCacheRepository = {
    async findByPropertyAndType(propertyId, dataType) {
      const [row] = await getDb()
        .select()
        .from(gbpCache)
        .where(and(eq(gbpCache.propertyId, propertyId as string), eq(gbpCache.dataType, dataType)))
        .limit(1)
      return row ? m.toDomain(row) : null
    },

    async upsert(entry) {
      await getDb()
        .insert(gbpCache)
        .values(m.toUpsert(entry))
        .onConflictDoUpdate({
          target: [gbpCache.propertyId, gbpCache.dataType],
          set: {
            payload: m.toUpsert(entry).payload,
            googleAttribution: m.toUpsert(entry).googleAttribution,
            fetchedAt: m.toUpsert(entry).fetchedAt,
            expiresAt: m.toUpsert(entry).expiresAt,
          },
        })
    },

    async deleteByProperty(propertyId) {
      await getDb()
        .delete(gbpCache)
        .where(eq(gbpCache.propertyId, propertyId as string))
    },

    async deleteExpired() {
      const now = new Date()
      const result = await getDb()
        .delete(gbpCache)
        .where(lt(gbpCache.expiresAt, now))
        .returning({ id: gbpCache.id })
      return result.length
    },

    async deleteByConnectionId(connectionId) {
      // Find properties linked to this connection, then delete their cache
      const linkedProperties = await getDb()
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.googleConnectionId, connectionId))

      if (linkedProperties.length === 0) return 0

      const result = await getDb()
        .delete(gbpCache)
        .returning({ id: gbpCache.id })

      return result.length
    },
  }

  return repo
}
```

- [ ] **Step 5: Create gbp-import mapper and repository**

Create `src/contexts/integration/infrastructure/mappers/gbp-import.mapper.ts`:

```ts
import type { GbpImportJob } from '../../domain/types'
import type { gbpImportJobs } from '#/shared/db/schema'
import { gbpImportJobId, organizationId, userId } from '#/shared/domain/ids'

type DbRow = typeof gbpImportJobs.$inferSelect

export const toDomain = (row: DbRow): GbpImportJob => ({
  id: gbpImportJobId(row.id),
  organizationId: organizationId(row.organizationId),
  initiatedBy: userId(row.initiatedBy),
  status: row.status,
  totalCount: row.totalCount,
  importedCount: row.importedCount,
  skippedCount: row.skippedCount,
  failedCount: row.failedCount,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
})

export const toInsert = (job: GbpImportJob) => ({
  id: job.id as string,
  organizationId: job.organizationId as string,
  initiatedBy: job.initiatedBy as string,
  status: job.status,
  totalCount: job.totalCount,
  importedCount: job.importedCount,
  skippedCount: job.skippedCount,
  failedCount: job.failedCount,
})
```

Create `src/contexts/integration/infrastructure/repositories/gbp-import.repository.ts`:

```ts
import type { GbpImportRepository } from '../../application/ports/gbp-import.repository'
import type { GbpImportJob, GbpImportJobId, GbpImportJobStatus } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'
import { eq, and, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { gbpImportJobs } from '#/shared/db/schema'
import * as m from '../mappers/gbp-import.mapper'

export const createGbpImportRepository = (): GbpImportRepository => {
  const repo: GbpImportRepository = {
    async findById(id) {
      const [row] = await getDb()
        .select()
        .from(gbpImportJobs)
        .where(eq(gbpImportJobs.id, id as string))
        .limit(1)
      return row ? m.toDomain(row) : null
    },

    async findByOrganization(orgId) {
      const rows = await getDb()
        .select()
        .from(gbpImportJobs)
        .where(eq(gbpImportJobs.organizationId, orgId as string))
        .orderBy(gbpImportJobs.createdAt)
      return rows.map(m.toDomain)
    },

    async insert(job) {
      await getDb().insert(gbpImportJobs).values(m.toInsert(job))
    },

    async updateStatus(id, status) {
      await getDb()
        .update(gbpImportJobs)
        .set({ status, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, id as string))
    },

    async incrementImported(id) {
      await getDb()
        .update(gbpImportJobs)
        .set({ importedCount: sql`${gbpImportJobs.importedCount} + 1`, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, id as string))
    },

    async incrementSkipped(id) {
      await getDb()
        .update(gbpImportJobs)
        .set({ skippedCount: sql`${gbpImportJobs.skippedCount} + 1`, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, id as string))
    },

    async incrementFailed(id) {
      await getDb()
        .update(gbpImportJobs)
        .set({ failedCount: sql`${gbpImportJobs.failedCount} + 1`, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, id as string))
    },
  }

  return repo
}
```

- [ ] **Step 6: Commit**

```bash
git add src/contexts/integration/infrastructure/
git commit -m "feat(integration): Drizzle repositories and mappers"
```

---

## Task 9: Infrastructure — Adapters

**Files:**
- Create: `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`
- Create: `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`
- Create: `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`

- [ ] **Step 1: Create Google OAuth adapter**

Create `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`:

```ts
import type { GoogleOAuthPort, GoogleOAuthResult } from '../../application/ports/google-oauth.port'
import { getEnv } from '#/shared/config/env'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export const createGoogleOAuthAdapter = (): GoogleOAuthPort => {
  const env = getEnv()

  return {
    getAuthorizationUrl(redirectUri, state) {
      const params = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/business.manage',
        access_type: 'offline',
        prompt: 'consent',
        state,
      })
      return `${GOOGLE_AUTH_URL}?${params.toString()}`
    },

    async exchangeCode(code, redirectUri) {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Google OAuth token exchange failed: ${res.status} ${body}`)
      }

      const data = await res.json()

      // Fetch user info to get Google account ID and email
      const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${data.access_token}` },
      })

      if (!userInfoRes.ok) {
        throw new Error(`Failed to fetch Google user info: ${userInfoRes.status}`)
      }

      const userInfo = await userInfoRes.json()

      return {
        googleAccountId: userInfo.id,
        googleEmail: userInfo.email,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scopes: data.scope?.split(' ') ?? [],
      } satisfies GoogleOAuthResult
    },

    async refreshAccessToken(refreshToken) {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          grant_type: 'refresh_token',
        }),
      })

      if (!res.ok) {
        const body = await res.text()
        throw new Error(`Google OAuth token refresh failed: ${res.status} ${body}`)
      }

      const data = await res.json()
      return { accessToken: data.access_token, expiresIn: data.expires_in }
    },

    async revokeToken(token) {
      await fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      })
    },
  }
}
```

- [ ] **Step 2: Create token encryption adapter**

Create `src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts`:

```ts
import type { TokenEncryptionPort } from '../../application/ports/token-encryption.port'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { getEnv } from '#/shared/config/env'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16

export const createTokenEncryptionAdapter = (): TokenEncryptionPort => {
  const getKey = () => {
    const env = getEnv()
    if (!env.ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY environment variable is required')
    return Buffer.from(env.ENCRYPTION_KEY, 'hex')
  }

  return {
    encrypt(plaintext) {
      const key = getKey()
      const iv = randomBytes(IV_LENGTH)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
      const authTag = cipher.getAuthTag()
      // Format: iv:authTag:ciphertext (all base64)
      return `${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`
    },

    decrypt(ciphertext) {
      const key = getKey()
      const [ivB64, authTagB64, dataB64] = ciphertext.split(':')
      if (!ivB64 || !authTagB64 || !dataB64) throw new Error('Invalid encrypted token format')
      const iv = Buffer.from(ivB64, 'base64')
      const authTag = Buffer.from(authTagB64, 'base64')
      const data = Buffer.from(dataB64, 'base64')
      const decipher = createDecipheriv(ALGORITHM, key, iv)
      decipher.setAuthTag(authTag)
      return decipher.update(data) + decipher.final('utf8')
    },
  }
}
```

- [ ] **Step 3: Create GBP API adapter**

Create `src/contexts/integration/infrastructure/adapters/gbp-api.adapter.ts`:

```ts
import type { GbpApiPort } from '../../application/ports/gbp-api.port'
import type { GbpLocation } from '../../domain/types'

const GBP_V4_BASE = 'https://mybusiness.googleapis.com/v4'
const GBP_BI_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1'

export const createGbpApiAdapter = (): GbpApiPort => ({
  async listLocations(accessToken, accountName) {
    const res = await fetch(`${GBP_V4_BASE}/${accountName}/locations?pageSize=100`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GBP API listLocations failed: ${res.status} ${body}`)
    }

    const data = await res.json()
    const locations = data.locations ?? []

    return locations.map((loc: Record<string, unknown>): GbpLocation => ({
      name: loc.name as string,
      gbpPlaceId: (loc.name as string).split('/').pop() ?? '',
      businessName: (loc.locationName as string) ?? (loc.title as string) ?? '',
      address: formatAddress(loc.address as Record<string, unknown> | undefined),
      primaryCategory: (loc.primaryCategory as Record<string, unknown>)?.displayName as string | null ?? null,
      latitude: (loc.latlng as Record<string, unknown>)?.latitude as number | null ?? null,
      longitude: (loc.latlng as Record<string, unknown>)?.longitude as number | null ?? null,
    }))
  },

  async getLocation(accessToken, accountName, locationName) {
    const res = await fetch(`${GBP_V4_BASE}/${accountName}/locations/${locationName}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GBP API getLocation failed: ${res.status} ${body}`)
    }

    const loc = await res.json()
    return {
      name: loc.name,
      gbpPlaceId: loc.name.split('/').pop() ?? '',
      businessName: loc.locationName ?? loc.title ?? '',
      address: formatAddress(loc.address),
      primaryCategory: loc.primaryCategory?.displayName ?? null,
      latitude: loc.latlng?.latitude ?? null,
      longitude: loc.latlng?.longitude ?? null,
    } satisfies GbpLocation
  },

  async batchGetReviews(accessToken, accountName, locationNames) {
    const res = await fetch(`${GBP_V4_BASE}/${accountName}/locations:batchGetReviews`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        locationNames,
        pageSize: 50,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`GBP API batchGetReviews failed: ${res.status} ${body}`)
    }

    const data = await res.json()
    return (data.locationReviews ?? []).map((r: Record<string, unknown>) => ({
      locationName: r.name as string,
      reviews: r.reviews ?? [],
    }))
  },
})

function formatAddress(addr: Record<string, unknown> | undefined): string | null {
  if (!addr) return null
  const parts = [
    addr.addressLines as string[] | undefined,
    addr.locality as string | undefined,
    addr.administrativeArea as string | undefined,
    addr.postalCode as string | undefined,
  ]
    .flat()
    .filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}
```

- [ ] **Step 4: Add env vars to config**

Add to `src/shared/config/env.ts` Zod schema:

```ts
GOOGLE_CLIENT_ID: z.string().min(1),
GOOGLE_CLIENT_SECRET: z.string().min(1),
ENCRYPTION_KEY: z.string().min(1),
```

- [ ] **Step 5: Commit**

```bash
git add src/contexts/integration/infrastructure/adapters/ src/shared/config/env.ts
git commit -m "feat(integration): OAuth, encryption, and GBP API adapters"
```

---

## Task 10: BullMQ Import Job Handler

**Files:**
- Create: `src/shared/jobs/handlers/import-property.ts`

- [ ] **Step 1: Create import property job handler**

Create `src/shared/jobs/handlers/import-property.ts`:

```ts
import type { Job } from 'bullmq'
import type { JobHandler } from '../registry'
import type { GbpImportJobId } from '#/shared/domain/ids'
import { getDb } from '#/shared/db'
import { properties } from '#/shared/db/schema'
import { gbpImportJobs } from '#/shared/db/schema'
import { eq } from 'drizzle-orm'
import { normalizeSlug } from '#/contexts/property/domain/rules'

export type ImportPropertyJobData = {
  jobId: string
  organizationId: string
  connectionId: string
  locations: ReadonlyArray<{
    gbpPlaceId: string
    businessName: string
    address: string | null
    primaryCategory: string | null
    latitude: number | null
    longitude: number | null
  }>
}

export const importPropertyHandler: JobHandler<ImportPropertyJobData> = async (job: Job<ImportPropertyJobData>) => {
  const { jobId, organizationId, connectionId, locations } = job.data
  const db = getDb()

  // Mark job in progress
  await db.update(gbpImportJobs).set({ status: 'in_progress', updatedAt: new Date() }).where(eq(gbpImportJobs.id, jobId))

  for (const location of locations) {
    try {
      // Check duplicate
      const existing = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.gbpPlaceId, location.gbpPlaceId))
        .limit(1)

      if (existing.length > 0) {
        await db.update(gbpImportJobs)
          .set({ skippedCount: sql`${gbpImportJobs.skippedCount} + 1`, updatedAt: new Date() })
          .where(eq(gbpImportJobs.id, jobId))
        continue
      }

      // Derive timezone from coordinates
      const timezone = await deriveTimezone(location.latitude, location.longitude)

      const slug = normalizeSlug(location.businessName)

      await db.insert(properties).values({
        organizationId,
        name: location.businessName,
        slug,
        timezone,
        gbpPlaceId: location.gbpPlaceId,
        googleConnectionId: connectionId,
      })

      await db.update(gbpImportJobs)
        .set({ importedCount: sql`${gbpImportJobs.importedCount} + 1`, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, jobId))
    } catch {
      await db.update(gbpImportJobs)
        .set({ failedCount: sql`${gbpImportJobs.failedCount} + 1`, updatedAt: new Date() })
        .where(eq(gbpImportJobs.id, jobId))
    }
  }

  // Mark completed
  await db.update(gbpImportJobs).set({ status: 'completed', updatedAt: new Date() }).where(eq(gbpImportJobs.id, jobId))
}

// Timezone derivation from lat/lng using a lookup table approach.
// For production, use a library like `geo-tz` or call a geocoding API.
async function deriveTimezone(lat: number | null, lng: number | null): Promise<string> {
  if (lat === null || lng === null) return 'UTC'
  // Production: use `geo-tz` npm package for lat/lng → IANA timezone lookup
  // For MVP, UTC is a safe default — timezone can be updated later from cache
  return 'UTC'
}
```

Note: Add `import { sql } from 'drizzle-orm'` at the top. The `normalizeSlug` import will need to be updated to match the actual export from the property domain.

- [ ] **Step 2: Register the handler in the worker setup**

Find where job handlers are registered (search for `registry.register` in the composition root) and add:

```ts
registry.register('import-property', importPropertyHandler)
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/jobs/handlers/import-property.ts
git commit -m "feat(integration): BullMQ import property job handler"
```

---

## Task 11: Context Build & Composition Wiring

**Files:**
- Create: `src/contexts/integration/build.ts`
- Modify: `src/composition.ts`
- Create: `src/contexts/integration/CONTEXT.md`

- [ ] **Step 1: Create integration build**

Create `src/contexts/integration/build.ts`:

```ts
import type { GoogleConnectionRepository } from './application/ports/google-connection.repository'
import type { GbpCacheRepository } from './application/ports/gbp-cache.repository'
import type { GbpImportRepository } from './application/ports/gbp-import.repository'
import type { GbpApiPort } from './application/ports/gbp-api.port'
import type { TokenEncryptionPort } from './application/ports/token-encryption.port'
import type { GoogleOAuthPort } from './application/ports/google-oauth.port'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { ImportPropertyJobData } from '#/shared/jobs/handlers/import-property'
import { connectGoogleAccount } from './application/use-cases/connect-google-account'
import { disconnectGoogleAccount } from './application/use-cases/disconnect-google-account'
import { listGoogleConnections } from './application/use-cases/list-google-connections'
import { listGbpLocations } from './application/use-cases/list-gbp-locations'
import { startPropertyImport } from './application/use-cases/start-property-import'
import { getImportStatus } from './application/use-cases/get-import-status'
import { updateConnectionVisibility } from './application/use-cases/update-connection-visibility'
import { refreshGoogleToken } from './application/use-cases/refresh-google-token'
import { googleConnectionId, gbpImportJobId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type IntegrationContextDeps = Readonly<{
  connectionRepo: GoogleConnectionRepository
  cacheRepo: GbpCacheRepository
  importRepo: GbpImportRepository
  gbpApi: GbpApiPort
  oauth: GoogleOAuthPort
  encryption: TokenEncryptionPort
  events: EventBus
  jobQueue: Queue
  clock: () => Date
}>

export const buildIntegrationContext = (deps: IntegrationContextDeps) => {
  const connectionIdGen = () => googleConnectionId(randomUUID())
  const importJobIdGen = () => gbpImportJobId(randomUUID())

  const useCases = {
    connectGoogleAccount: connectGoogleAccount({
      connectionRepo: deps.connectionRepo,
      oauth: deps.oauth,
      encryption: deps.encryption,
      events: deps.events,
      idGen: connectionIdGen,
      clock: deps.clock,
    }),
    disconnectGoogleAccount: disconnectGoogleAccount({
      connectionRepo: deps.connectionRepo,
      cacheRepo: deps.cacheRepo,
      encryption: deps.encryption,
      events: deps.events,
      clock: deps.clock,
    }),
    listGoogleConnections: listGoogleConnections({
      connectionRepo: deps.connectionRepo,
    }),
    listGbpLocations: listGbpLocations({
      connectionRepo: deps.connectionRepo,
      gbpApi: deps.gbpApi,
      encryption: deps.encryption,
    }),
    startPropertyImport: startPropertyImport({
      connectionRepo: deps.connectionRepo,
      importRepo: deps.importRepo,
      events: deps.events,
      queue: {
        addBulkImportJob: async (jobId, locations, connectionId) => {
          // Get org from first location's connection
          await deps.jobQueue.add('import-property', {
            jobId,
            organizationId: '',
            connectionId,
            locations,
          } satisfies ImportPropertyJobData)
        },
      },
      idGen: importJobIdGen,
      clock: deps.clock,
    }),
    getImportStatus: getImportStatus({
      importRepo: deps.importRepo,
    }),
    updateConnectionVisibility: updateConnectionVisibility({
      connectionRepo: deps.connectionRepo,
    }),
    refreshGoogleToken: refreshGoogleToken({
      connectionRepo: deps.connectionRepo,
      oauth: deps.oauth,
      encryption: deps.encryption,
    }),
  } as const

  return { useCases } as const
}
```

- [ ] **Step 2: Wire into composition root**

Add to `src/composition.ts`:

After the existing context imports, add:

```ts
import { buildIntegrationContext } from '#/contexts/integration/build'
import { createGoogleConnectionRepository } from '#/contexts/integration/infrastructure/repositories/google-connection.repository'
import { createGbpCacheRepository } from '#/contexts/integration/infrastructure/repositories/gbp-cache.repository'
import { createGbpImportRepository } from '#/contexts/integration/infrastructure/repositories/gbp-import.repository'
import { createGoogleOAuthAdapter } from '#/contexts/integration/infrastructure/adapters/google-oauth.adapter'
import { createTokenEncryptionAdapter } from '#/contexts/integration/infrastructure/adapters/token-encryption.adapter'
import { createGbpApiAdapter } from '#/contexts/integration/infrastructure/adapters/gbp-api.adapter'
```

After the other context builds, add:

```ts
const integration = buildIntegrationContext({
  connectionRepo: createGoogleConnectionRepository(),
  cacheRepo: createGbpCacheRepository(),
  importRepo: createGbpImportRepository(),
  gbpApi: createGbpApiAdapter(),
  oauth: createGoogleOAuthAdapter(),
  encryption: createTokenEncryptionAdapter(),
  events: eventBus,
  jobQueue: infra.jobQueue,
  clock: () => new Date(),
})
```

Add `...integration.useCases,` to the merged useCases object.

- [ ] **Step 3: Create CONTEXT.md**

Create `src/contexts/integration/CONTEXT.md`:

```md
# Integration Context

Handles Google Business Profile integration: OAuth connections, location imports, and GBP data caching.

## Boundaries

- Owns: google_connections, gbp_cache, gbp_import_jobs tables
- Communicates with property context via domain events and shared DB
- Does NOT directly import from property domain/application/infrastructure

## Key flows

1. **Connect Google account** — OAuth code exchange → store encrypted tokens
2. **List GBP locations** — fetch from GBP API via stored connection
3. **Import properties** — BullMQ job creates properties with gbpPlaceId
4. **Cache sync** — scheduled jobs refresh GBP data within 30-day policy
5. **Disconnect** — revoke tokens, mark disconnected, purge cache
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/integration/build.ts src/contexts/integration/CONTEXT.md src/composition.ts
git commit -m "feat(integration): context build and composition wiring"
```

---

## Task 12: Server Functions

**Files:**
- Create: `src/contexts/integration/server/google-connections.ts`
- Create: `src/contexts/integration/server/gbp-import.ts`
- Create: `src/routes/api/auth/google/callback.ts`

- [ ] **Step 1: Create google-connections server functions**

Create `src/contexts/integration/server/google-connections.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { connectGoogleInputSchema } from '../application/dto/connect-google.dto'
import { disconnectGoogleInputSchema } from '../application/dto/disconnect-google.dto'
import { updateConnectionVisibilityInputSchema } from '../application/dto/update-connection-visibility.dto'
import { isIntegrationError } from '../domain/errors'
import { getEnv } from '#/shared/config/env'

export const getGoogleAuthUrl = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ redirectUri: z.string().url(), visibility: z.enum(['private', 'organization']).default('private') }))
  .handler(
    tracedHandler(
      async ({ data }) => {
        const env = getEnv()
        const state = Buffer.from(JSON.stringify({ visibility: data.visibility })).toString('base64')
        const params = new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          redirect_uri: data.redirectUri,
          response_type: 'code',
          scope: 'https://www.googleapis.com/auth/business.manage',
          access_type: 'offline',
          prompt: 'consent',
          state,
        })
        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` }
      },
      'GET',
      'integration.getGoogleAuthUrl',
    ),
  )

export const connectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(connectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connection = await useCases.connectGoogleAccount(data, ctx)
          return { connection }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.connectGoogle',
    ),
  )

export const listGoogleConnections = createServerFn({ method: 'GET' })
  .handler(
    tracedHandler(
      async () => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const connections = await useCases.listGoogleConnections(ctx)
          return { connections }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'GET',
      'integration.listGoogleConnections',
    ),
  )

export const disconnectGoogle = createServerFn({ method: 'POST' })
  .inputValidator(disconnectGoogleInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.disconnectGoogleAccount(data, ctx)
          return { disconnected: true }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.disconnectGoogle',
    ),
  )

export const updateConnectionVisibility = createServerFn({ method: 'POST' })
  .inputValidator(updateConnectionVisibilityInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          await useCases.updateConnectionVisibility(data, ctx)
          return { updated: true }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.updateConnectionVisibility',
    ),
  )
```

Note: The `getGoogleAuthUrl` function needs to access the OAuth adapter directly. This should be resolved by exposing a `getAuthorizationUrl` method through the container or by having the server function build the URL using env vars directly.

- [ ] **Step 2: Create gbp-import server functions**

Create `src/contexts/integration/server/gbp-import.ts`:

```ts
import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { listLocationsInputSchema } from '../application/dto/list-locations.dto'
import { importPropertiesInputSchema } from '../application/dto/import-properties.dto'
import { importStatusInputSchema } from '../application/dto/import-status.dto'
import { isIntegrationError } from '../domain/errors'

export const listGbpLocations = createServerFn({ method: 'POST' })
  .inputValidator(listLocationsInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const locations = await useCases.listGbpLocations(data, ctx)
          return { locations }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.listGbpLocations',
    ),
  )

export const startPropertyImport = createServerFn({ method: 'POST' })
  .inputValidator(importPropertiesInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const job = await useCases.startPropertyImport(data, ctx)
          return { job }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.startPropertyImport',
    ),
  )

export const getImportStatus = createServerFn({ method: 'POST' })
  .inputValidator(importStatusInputSchema)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        try {
          const { useCases } = getContainer()
          const job = await useCases.getImportStatus(data, ctx)
          return { job }
        } catch (e) {
          if (isIntegrationError(e)) throwContextError('IntegrationError', e, 400)
          throw e
        }
      },
      'POST',
      'integration.getImportStatus',
    ),
  )
```

- [ ] **Step 3: Create OAuth callback route**

Create `src/routes/api/auth/google/callback.ts`:

```ts
import { createAPIFileRoute } from '@tanstack/react-start/api'
import { connectGoogle } from '#/contexts/integration/server/google-connections'
import { getEnv } from '#/shared/config/env'

export const APIRoute = createAPIFileRoute('/api/auth/google/callback')({
  GET: async ({ request }) => {
    const url = new URL(request.url)
    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')

    if (!code) {
      return new Response('Missing authorization code', { status: 400 })
    }

    let visibility: 'private' | 'organization' = 'private'
    if (state) {
      try {
        const parsed = JSON.parse(Buffer.from(state, 'base64').toString())
        visibility = parsed.visibility ?? 'private'
      } catch {
        // Invalid state, use default
      }
    }

    const env = getEnv()
    const redirectUri = `${env.BETTER_AUTH_URL}/api/auth/google/callback`

    // This callback is hit by Google after user consents.
    // We redirect to the import page with the code so the client-side
    // can call the connectGoogle server function.
    const importUrl = new URL('/properties/import', env.BETTER_AUTH_URL)
    importUrl.searchParams.set('code', code)
    importUrl.searchParams.set('visibility', visibility)

    return new Response(null, {
      status: 302,
      headers: { Location: importUrl.toString() },
    })
  },
})
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/integration/server/ src/routes/api/auth/google/callback.ts
git commit -m "feat(integration): server functions and OAuth callback route"
```

---

## Task 13: Property Schema & Mapper Updates

**Files:**
- Modify: `src/contexts/property/domain/types.ts`
- Modify: `src/contexts/property/infrastructure/mappers/property.mapper.ts`

- [ ] **Step 1: Add googleConnectionId to Property domain type**

In `src/contexts/property/domain/types.ts`, add to the `Property` type after `gbpPlaceId`:

```ts
  googleConnectionId: string | null
```

- [ ] **Step 2: Update property mapper**

In `src/contexts/integration/infrastructure/mappers/property.mapper.ts` — find the existing `toDomain` function and add mapping for the new column:

```ts
googleConnectionId: row.googleConnectionId,
```

And in `toInsert`:

```ts
googleConnectionId: property.googleConnectionId,
```

- [ ] **Step 3: Update property constructor**

In `src/contexts/property/domain/constructors.ts`, add `googleConnectionId` to the `buildProperty` input and output.

- [ ] **Step 4: Run type check**

Run: `pnpm tsc --noEmit`
Expected: All type errors resolved.

- [ ] **Step 5: Commit**

```bash
git add src/contexts/property/
git commit -m "feat(property): add googleConnectionId to property domain"
```

---

## Task 14: Remove Manual Property Creation

**Files:**
- Delete: `src/routes/_authenticated/properties/new.tsx`
- Delete: `src/components/features/property/property-form/` (all files)
- Modify: `src/routes/_authenticated/properties/index.tsx` — update "Add property" CTA

- [ ] **Step 1: Delete the manual creation route and form components**

```bash
rm src/routes/_authenticated/properties/new.tsx
rm -rf src/components/features/property/property-form/
```

- [ ] **Step 2: Update properties index page CTA**

In `src/routes/_authenticated/properties/index.tsx`, update the "Add property" button/link to navigate to `/properties/import` instead of `/properties/new`.

- [ ] **Step 3: Run type check**

Run: `pnpm tsc --noEmit`
Expected: No broken imports from deleted files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove manual property creation, point CTA to import"
```

---

## Task 15: Import Page UI

**Files:**
- Create: `src/routes/_authenticated/properties/import/index.tsx`
- Create: `src/components/features/integration/shared/import-types.ts`
- Create: `src/components/features/integration/google-account-selector/google-account-selector.tsx`
- Create: `src/components/features/integration/location-picker/location-picker.tsx`
- Create: `src/components/features/integration/location-picker/location-row.tsx`
- Create: `src/components/features/integration/connect-google-button/connect-google-button.tsx`

- [ ] **Step 1: Create shared types**

Create `src/components/features/integration/shared/import-types.ts`:

```ts
import type { z } from 'zod/v4'
import type { importPropertiesInputSchema } from '#/contexts/integration/application/dto/import-properties.dto'

export type LocationSelection = z.infer<typeof importPropertiesInputSchema>['locations'][number]

export type ImportPageState = 'idle' | 'loading-locations' | 'selecting' | 'importing'
```

- [ ] **Step 2: Create connect-google-button component**

Create `src/components/features/integration/connect-google-button/connect-google-button.tsx`:

```ts
import { Button } from '#/components/ui/button'

type Props = Readonly<{
  visibility: 'private' | 'organization'
  baseUrl: string
}>

export const ConnectGoogleButton = ({ visibility, baseUrl }: Props) => {
  const redirectUri = `${baseUrl}/api/auth/google/callback`
  const state = Buffer.from(JSON.stringify({ visibility })).toString('base64')
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${import.meta.env.VITE_GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=https://www.googleapis.com/auth/business.manage&access_type=offline&prompt=consent&state=${state}`

  return (
    <Button asChild size="lg">
      <a href={authUrl}>Connect Google Account</a>
    </Button>
  )
}
```

- [ ] **Step 3: Create google-account-selector component**

Create `src/components/features/integration/google-account-selector/google-account-selector.tsx`:

```ts
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '#/components/ui/select'

type Connection = Readonly<{
  id: string
  googleEmail: string
  visibility: 'private' | 'organization'
  status: 'active' | 'disconnected'
}>

type Props = Readonly<{
  connections: ReadonlyArray<Connection>
  selectedId: string | null
  onSelect: (id: string) => void
}>

export const GoogleAccountSelector = ({ connections, selectedId, onSelect }: Props) => {
  return (
    <Select value={selectedId ?? ''} onValueChange={onSelect}>
      <SelectTrigger className="w-full max-w-sm">
        <SelectValue placeholder="Select a Google account" />
      </SelectTrigger>
      <SelectContent>
        {connections
          .filter((c) => c.status === 'active')
          .map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.googleEmail}
              {c.visibility === 'private' ? ' (you)' : ' (shared)'}
            </SelectItem>
          ))}
      </SelectContent>
    </Select>
  )
}
```

- [ ] **Step 4: Create location-row component**

Create `src/components/features/integration/location-picker/location-row.tsx`:

```ts
import { Checkbox } from '#/components/ui/checkbox'

type Location = Readonly<{
  gbpPlaceId: string
  businessName: string
  address: string | null
  primaryCategory: string | null
}>

type Props = Readonly<{
  location: Location
  selected: boolean
  onToggle: (gbpPlaceId: string) => void
}>

export const LocationRow = ({ location, selected, onToggle }: Props) => (
  <div
    className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 cursor-pointer"
    onClick={() => onToggle(location.gbpPlaceId)}
  >
    <Checkbox checked={selected} onCheckedChange={() => onToggle(location.gbpPlaceId)} />
    <div className="flex-1 min-w-0">
      <p className="font-medium truncate">{location.businessName}</p>
      {location.address && (
        <p className="text-sm text-muted-foreground truncate">{location.address}</p>
      )}
    </div>
    {location.primaryCategory && (
      <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded">
        {location.primaryCategory}
      </span>
    )}
  </div>
)
```

- [ ] **Step 5: Create location-picker component**

Create `src/components/features/integration/location-picker/location-picker.tsx`:

```ts
import { Checkbox } from '#/components/ui/checkbox'
import { LocationRow } from './location-row'

type Location = Readonly<{
  gbpPlaceId: string
  businessName: string
  address: string | null
  primaryCategory: string | null
}>

type Props = Readonly<{
  locations: ReadonlyArray<Location>
  selectedIds: ReadonlySet<string>
  onToggle: (gbpPlaceId: string) => void
  onSelectAll: () => void
  onDeselectAll: () => void
}>

export const LocationPicker = ({ locations, selectedIds, onToggle, onSelectAll, onDeselectAll }: Props) => {
  const allSelected = locations.length > 0 && selectedIds.size === locations.length

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 border-b pb-2 mb-2">
        <Checkbox
          checked={allSelected}
          onCheckedChange={() => allSelected ? onDeselectAll() : onSelectAll()}
        />
        <span className="text-sm font-medium">
          {allSelected ? 'Deselect all' : 'Select all'}
        </span>
        <span className="text-sm text-muted-foreground ml-auto">
          {selectedIds.size} of {locations.length} selected
        </span>
      </div>
      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {locations.map((loc) => (
          <LocationRow
            key={loc.gbpPlaceId}
            location={loc}
            selected={selectedIds.has(loc.gbpPlaceId)}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create import page route**

Create `src/routes/_authenticated/properties/import/index.tsx`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { useState, useCallback } from 'react'
import { useServerFn } from '@tanstack/react-start'
import { listGoogleConnections, connectGoogle } from '#/contexts/integration/server/google-connections'
import { listGbpLocations } from '#/contexts/integration/server/gbp-import'
import { startPropertyImport } from '#/contexts/integration/server/gbp-import'
import { GoogleAccountSelector } from '#/components/features/integration/google-account-selector/google-account-selector'
import { LocationPicker } from '#/components/features/integration/location-picker/location-picker'
import { ConnectGoogleButton } from '#/components/features/integration/connect-google-button/connect-google-button'
import { Button } from '#/components/ui/button'
import { useNavigate } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/properties/import/')({
  component: ImportPage,
})

function ImportPage() {
  const navigate = useNavigate()
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)
  const [selectedLocationIds, setSelectedLocationIds] = useState<Set<string>>(new Set())
  const [locations, setLocations] = useState<ReadonlyArray<{ gbpPlaceId: string; businessName: string; address: string | null; primaryCategory: string | null }>>([])

  const listConnectionsFn = useServerFn(listGoogleConnections)
  const connectFn = useServerFn(connectGoogle)
  const listLocationsFn = useServerFn(listGbpLocations)
  const startImportFn = useServerFn(startPropertyImport)

  // Connection loading, location loading, and import trigger
  // This is the skeleton — the implementer fills in the data loading with useQuery/useMutation
  // following the existing patterns from other routes (see routes/CONTEXT.md for useMutationAction pattern)

  const handleToggleLocation = useCallback((gbpPlaceId: string) => {
    setSelectedLocationIds((prev) => {
      const next = new Set(prev)
      if (next.has(gbpPlaceId)) next.delete(gbpPlaceId)
      else next.add(gbpPlaceId)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedLocationIds(new Set(locations.map((l) => l.gbpPlaceId)))
  }, [locations])

  const handleDeselectAll = useCallback(() => {
    setSelectedLocationIds(new Set())
  }, [])

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Import Properties</h1>

      {/* Account selector or connect button */}
      {/* Location picker */}
      {/* Import button */}

      <p className="text-muted-foreground">
        Connect your Google Business Profile account to import properties.
      </p>
    </div>
  )
}
```

Note: The implementer should flesh out the data loading using `useQuery` and `useMutationAction` patterns established in other routes. The component structure and state management are in place.

- [ ] **Step 7: Commit**

```bash
git add src/routes/_authenticated/properties/import/ src/components/features/integration/
git commit -m "feat(integration): import page UI — account selector, location picker"
```

---

## Task 16: Import Progress Page

**Files:**
- Create: `src/routes/_authenticated/properties/import/$importId.tsx`
- Create: `src/components/features/integration/import-progress/import-progress.tsx`
- Create: `src/components/features/integration/import-progress/import-status-badge.tsx`

- [ ] **Step 1: Create import status badge**

Create `src/components/features/integration/import-progress/import-status-badge.tsx`:

```ts
import { Badge } from '#/components/ui/badge'

type Status = 'queued' | 'in_progress' | 'completed' | 'failed' | 'skipped'

type Props = Readonly<{ status: Status }>

const variantMap: Record<Status, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  in_progress: 'default',
  completed: 'outline',
  failed: 'destructive',
  skipped: 'secondary',
}

const labelMap: Record<Status, string> = {
  queued: 'Queued',
  in_progress: 'In Progress',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
}

export const ImportStatusBadge = ({ status }: Props) => (
  <Badge variant={variantMap[status]}>{labelMap[status]}</Badge>
)
```

- [ ] **Step 2: Create import progress component**

Create `src/components/features/integration/import-progress/import-progress.tsx`:

```ts
import { Button } from '#/components/ui/button'

type ImportJob = Readonly<{
  id: string
  status: string
  totalCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
}>

type Props = Readonly<{
  job: ImportJob
  onGoToProperties: () => void
  onRetryFailed?: () => void
}>

export const ImportProgress = ({ job, onGoToProperties, onRetryFailed }: Props) => {
  const isComplete = job.status === 'completed' || job.status === 'failed'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          {isComplete ? 'Import Complete' : 'Importing properties...'}
        </h2>
        <span className="text-sm text-muted-foreground">
          {job.importedCount + job.skippedCount + job.failedCount} of {job.totalCount}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <p className="text-2xl font-semibold text-green-600">{job.importedCount}</p>
          <p className="text-sm text-muted-foreground">Imported</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-yellow-600">{job.skippedCount}</p>
          <p className="text-sm text-muted-foreground">Skipped</p>
        </div>
        <div>
          <p className="text-2xl font-semibold text-red-600">{job.failedCount}</p>
          <p className="text-sm text-muted-foreground">Failed</p>
        </div>
      </div>

      {isComplete && (
        <div className="flex gap-2">
          <Button onClick={onGoToProperties}>Go to Properties</Button>
          {job.failedCount > 0 && onRetryFailed && (
            <Button variant="outline" onClick={onRetryFailed}>Retry Failed</Button>
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create progress page route**

Create `src/routes/_authenticated/properties/import/$importId.tsx`:

```ts
import { createFileRoute } from '@tanstack/react-router'
import { useNavigate } from '@tanstack/react-router'
import { useServerFn } from '@tanstack/react-start'
import { getImportStatus } from '#/contexts/integration/server/gbp-import'
import { ImportProgress } from '#/components/features/integration/import-progress/import-progress'

export const Route = createFileRoute('/_authenticated/properties/import/$importId')({
  component: ImportProgressPage,
})

function ImportProgressPage() {
  const navigate = useNavigate()
  const { importId } = Route.useParams()
  const getStatusFn = useServerFn(getImportStatus)

  // Poll import status using useQuery with refetchInterval
  // See routes/CONTEXT.md for data loading patterns
  // const job = useQuery(...)

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-6">Import Progress</h1>
      {/* <ImportProgress job={...} onGoToProperties={...} /> */}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/_authenticated/properties/import/\$importId.tsx src/components/features/integration/import-progress/
git commit -m "feat(integration): import progress page and components"
```

---

## Task 17: GBP Cache Sync Job

**Files:**
- Create: `src/shared/jobs/handlers/sync-gbp-cache.ts`

- [ ] **Step 1: Create sync job handler**

Create `src/shared/jobs/handlers/sync-gbp-cache.ts`:

```ts
import type { Job } from 'bullmq'
import type { JobHandler } from '../registry'
import { getDb } from '#/shared/db'
import { properties, googleConnections, gbpCache } from '#/shared/db/schema'
import { eq, and, lt, isNotNull } from 'drizzle-orm'

export type SyncGbpCacheJobData = {
  dataType: 'location' | 'reviews'
}

export const syncGbpCacheHandler: JobHandler<SyncGbpCacheJobData> = async (job: Job<SyncGbpCacheJobData>) => {
  const { dataType } = job.data
  const db = getDb()

  // Find all active properties with a google connection
  const linkedProperties = await db
    .select({
      propertyId: properties.id,
      gbpPlaceId: properties.gbpPlaceId,
      connectionId: properties.googleConnectionId,
      orgId: properties.organizationId,
    })
    .from(properties)
    .where(and(isNotNull(properties.googleConnectionId), eq(properties.deletedAt, null as unknown as Date)))
    .limit(200)

  if (linkedProperties.length === 0) return

  // Group by connection for efficient batching
  const byConnection = new Map<string, typeof linkedProperties>()
  for (const p of linkedProperties) {
    if (!p.connectionId) continue
    const existing = byConnection.get(p.connectionId) ?? []
    existing.push(p)
    byConnection.set(p.connectionId, existing)
  }

  // For each connection:
  // 1. Load the connection row, decrypt refresh token
  // 2. Refresh the access token if expired
  // 3. Call gbpApi.batchGet or gbpApi.batchGetReviews with the access token
  //    (batch up to 50 location IDs per request)
  // 4. For each result, upsert a gbp_cache row with:
  //    - fetchedAt = now
  //    - expiresAt = now + 30 days
  //    - payload = raw API response
  //    - googleAttribution = attribution string from response
  // 5. If token refresh fails, mark connection as 'disconnected'
}

export const purgeExpiredCacheHandler: JobHandler = async () => {
  const db = getDb()
  const now = new Date()
  const result = await db
    .delete(gbpCache)
    .where(lt(gbpCache.expiresAt, now))
    .returning({ id: gbpCache.id })
  // Log purge count
}
```

- [ ] **Step 2: Register handlers and schedule cron**

Register in the job registry (composition root):
- `sync-gbp-reviews` — daily
- `sync-gbp-locations` — weekly
- `purge-gbp-cache` — daily

- [ ] **Step 3: Commit**

```bash
git add src/shared/jobs/handlers/sync-gbp-cache.ts
git commit -m "feat(integration): GBP cache sync and purge job handlers"
```

---

## Task 18: Environment Variables

**Files:**
- Modify: `src/shared/config/env.ts` — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ENCRYPTION_KEY
- Modify: `.env.example` — document new vars

- [ ] **Step 1: Add env vars to Zod schema in env.ts**

Add to the env schema:

```ts
GOOGLE_CLIENT_ID: z.string().min(1),
GOOGLE_CLIENT_SECRET: z.string().min(1),
ENCRYPTION_KEY: z.string().min(1),
```

Also add `VITE_GOOGLE_CLIENT_ID` to the public env section if applicable for the client-side auth URL.

- [ ] **Step 2: Update .env.example**

Add:

```
# Google Business Profile OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ENCRYPTION_KEY=  # 32-byte hex string for AES-256-GCM token encryption
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/config/env.ts .env.example
git commit -m "feat(integration): add Google OAuth and encryption env vars"
```

---

## Task 19: Final Integration & Type Check

**Files:**
- Various — fix any remaining type errors

- [ ] **Step 1: Run full type check**

Run: `pnpm tsc --noEmit`
Fix any remaining type errors.

- [ ] **Step 2: Run linter**

Run: `pnpm lint`
Fix any lint errors.

- [ ] **Step 3: Run existing tests**

Run: `pnpm test`
Ensure no regressions from property type changes.

- [ ] **Step 4: Run build**

Run: `pnpm build`
Verify production build succeeds.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat(integration): GBP import — final integration and type fixes"
```
