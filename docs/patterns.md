# Patterns

Canonical examples for each file type in the codebase. When AI is writing a new file, point it at the matching example here.

All examples use the `portal` context as the subject (with exceptions in sections 22–23 that use `identity` to demonstrate thin-delegation patterns, and form examples that use portal forms). Once `contexts/identity/` exists and `contexts/portal/` exists, those become the canonical live references. This document is the starting point.

Companion docs:

- `conventions.md` — the rules
- `architecture.md` — the rationale

---

## Choosing the right pattern

Before reaching for an example, decide which pattern actually fits your operation:

**Has business rules, validation, events, state transitions, or cross-entity coordination?**
→ Full use case (example #9). Server function calls use case. Use case orchestrates domain + repos + events.

**Has only an authorization check, then delegates to a port or third-party API?**
→ Thin use case (example #22). Server function still calls the use case, but the use case is a one-liner. Keep it because future logic will land here.

**Pure delegation to a third-party library, no auth check, no event, no transformation?**
→ Server function calls the port (or third-party API) directly (example #23). No use case at all.

**Writing a form?**
→ Forms follow a fixed pattern: the route defines the mutation, the form component receives it as a prop. See example #24 (form component) and the "Submission pattern" section in `architecture.md`.

The default for anything non-trivial is the full use case. The thin and direct patterns are explicit exceptions for operations that genuinely don't need orchestration.

---

## Table of contents

1. [Domain types](#1-domain-types)
2. [Domain rules](#2-domain-rules)
3. [Domain constructors (smart constructors)](#3-domain-constructors-smart-constructors)
4. [Domain events](#4-domain-events)
5. [Domain errors](#5-domain-errors)
6. [Application port (repository interface)](#6-application-port-repository-interface)
7. [Application port (external service interface)](#7-application-port-external-service-interface)
8. [Application DTO](#8-application-dto)
9. [Use case (full pattern)](#9-use-case-full-pattern)
10. [Drizzle schema](#10-drizzle-schema)
11. [Row ↔ domain mapper](#11-row--domain-mapper)
12. [Repository implementation](#12-repository-implementation)
13. [External service adapter](#13-external-service-adapter)
14. [BullMQ job handler](#14-bullmq-job-handler)
15. [Event handler (cross-context subscriber)](#15-event-handler-cross-context-subscriber)
16. [Server function (authenticated)](#16-server-function-authenticated)
17. [Server function (public)](#17-server-function-public)
18. [In-memory port fake (for tests)](#18-in-memory-port-fake-for-tests)
19. [Domain test](#19-domain-test)
20. [Use case test](#20-use-case-test)
21. [Repository integration test](#21-repository-integration-test)
22. [Thin use case (auth check + delegation)](#22-thin-use-case-auth-check--delegation)
    22b. [Anonymous use case (member registration)](#22b-anonymous-use-case-member-registration--no-auth-no-org)
23. [Server function calling a port directly (pure delegation)](#23-server-function-calling-a-port-directly-pure-delegation)
24. [Form component (TanStack Form + shadcn)](#24-form-component-tanstack-form--shadcn)
25. [Shared form building block (SubmitButton)](#25-shared-form-building-block-submitbutton)
26. [Shared form building block (FormErrorBanner)](#26-shared-form-building-block-formerrorbanner)
27. [Update use case (partial validation)](#27-update-use-case-partial-validation)
28. [Soft-delete use case (minimal deps)](#28-soft-delete-use-case-minimal-deps)
29. [Form schema rules — when forms differ from DTOs](#29-form-schema-rules--when-forms-differ-from-dtos)

---

## 1. Domain types

**Location:** `src/contexts/portal/domain/types.ts`
**Purpose:** Define the shape of entities as the business thinks about them. No framework imports, no DB concerns.

```ts
import type { Brand } from '@/shared/domain/brand'
import type { OrganizationId } from '@/shared/domain/ids'
import type { PropertyId } from '@/contexts/property/domain/types'

export type PortalId = Brand<string, 'PortalId'>
export type CategoryId = Brand<string, 'CategoryId'>
export type LinkId = Brand<string, 'LinkId'>

export type EntityType = 'property' | 'team' | 'staff'

export type PortalTheme = Readonly<{
  primaryColor: string
  accentColor: string
  backgroundColor: string
  customHeading?: string
  customSubheading?: string
}>

export type SmartRouting = Readonly<{
  enabled: boolean
  threshold: 1 | 2 | 3 | 4
}>

export type Portal = Readonly<{
  id: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  slug: string
  entityType: EntityType
  entityId: string
  heroImageKey: string | null
  theme: PortalTheme
  smartRouting: SmartRouting
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>
```

**Key points:**

- `readonly` on every field
- Branded IDs so `PropertyId` can't be passed where `PortalId` is expected
- `Readonly<{...}>` for object types, `ReadonlyArray<T>` for arrays
- No methods, no classes — types are data only
- String literal unions instead of `enum`

---

## 2. Domain rules

**Location:** `src/contexts/portal/domain/rules.ts`
**Purpose:** Pure business rules. No async, no I/O, no throws. Validation returns `Result`.

```ts
import { ok, err, Result } from '@/shared/domain/result'
import type { PortalTheme, SmartRouting } from './types'
import type { PortalError } from './errors'
import type { Role } from '@/shared/domain/auth-context'
import { portalError } from './errors'

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

export const DEFAULT_THEME: PortalTheme = {
  primaryColor: '#111111',
  accentColor: '#ff3b30',
  backgroundColor: '#ffffff',
}

export const DEFAULT_SMART_ROUTING: SmartRouting = {
  enabled: true,
  threshold: 3,
}

export const normalizeSlug = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)

export const validateSlug = (slug: string): Result<string, PortalError> =>
  SLUG_PATTERN.test(slug)
    ? ok(slug)
    : err(portalError('invalid_slug', 'slug must be URL-friendly and 2-64 chars'))

const isValidHexColor = (v: string): boolean => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)

export const validateTheme = (theme: PortalTheme): Result<PortalTheme, PortalError> => {
  if (!isValidHexColor(theme.primaryColor)) {
    return err(portalError('invalid_theme', 'primaryColor must be a hex color'))
  }
  if (!isValidHexColor(theme.accentColor)) {
    return err(portalError('invalid_theme', 'accentColor must be a hex color'))
  }
  if (!isValidHexColor(theme.backgroundColor)) {
    return err(portalError('invalid_theme', 'backgroundColor must be a hex color'))
  }
  return ok(theme)
}

// Authorization is handled by better-auth's access control system.
// Server functions use auth.api.hasPermission() to check specific resource+action combos.
// The permission statement and default roles are defined in shared/auth/permissions.ts.
// Domain rules that remain here are pure business rules (validation, computation)
// that don't depend on role-based authorization.

export const shouldShowFeedbackPrompt = (
  rating: 1 | 2 | 3 | 4 | 5,
  sr: SmartRouting,
): boolean => sr.enabled && rating <= sr.threshold
```

**Key points:**

- All functions are pure
- Fallible functions return `Result<T, PortalError>`; infallible ones return the plain type
- Authorization is a pure predicate

---

## 3. Domain constructors (smart constructors)

**Location:** `src/contexts/portal/domain/constructors.ts`
**Purpose:** Build domain entities from raw input, composing all validations, returning a `Result`.

```ts
import { Result } from '@/shared/domain/result'
import type { Portal, PortalId, EntityType, PortalTheme, SmartRouting } from './types'
import type { PortalError } from './errors'
import type { OrganizationId } from '@/shared/domain/ids'
import type { PropertyId } from '@/contexts/property/domain/types'
import {
  normalizeSlug,
  validateSlug,
  validateTheme,
  DEFAULT_THEME,
  DEFAULT_SMART_ROUTING,
} from './rules'

export type BuildPortalInput = Readonly<{
  id: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  name: string
  providedSlug?: string
  entityType: EntityType
  entityId: string
  theme?: Partial<PortalTheme>
  smartRouting?: Partial<SmartRouting>
  now: Date
}>

export const buildPortal = (input: BuildPortalInput): Result<Portal, PortalError> => {
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const theme = validateTheme({ ...DEFAULT_THEME, ...input.theme })

  return Result.combine([slug, theme]).map(
    ([validSlug, validTheme]): Portal => ({
      id: input.id,
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      name: input.name,
      slug: validSlug,
      entityType: input.entityType,
      entityId: input.entityId,
      heroImageKey: null,
      theme: validTheme,
      smartRouting: { ...DEFAULT_SMART_ROUTING, ...input.smartRouting },
      createdAt: input.now,
      updatedAt: input.now,
      deletedAt: null,
    }),
  )
}
```

**Key points:**

- Smart constructor is pure — ID and time are inputs
- Uses `Result.combine` to validate multiple fields
- Returns `Result<Portal, PortalError>` — can't construct an invalid Portal

---

## 4. Domain events

**Location:** `src/contexts/portal/domain/events.ts`
**Purpose:** Tagged discriminated unions representing facts that happened.

```ts
import type { PortalId } from './types'
import type { OrganizationId } from '@/shared/domain/ids'
import type { PropertyId } from '@/contexts/property/domain/types'

export type PortalCreated = Readonly<{
  _tag: 'portal.created'
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  occurredAt: Date
}>

export type PortalScanned = Readonly<{
  _tag: 'portal.scanned'
  portalId: PortalId
  organizationId: OrganizationId
  propertyId: PropertyId
  source: 'qr' | 'nfc' | 'direct'
  sessionId: string
  occurredAt: Date
}>

export type PortalEvent = PortalCreated | PortalScanned

export const portalCreated = (args: Omit<PortalCreated, '_tag'>): PortalCreated => ({
  _tag: 'portal.created',
  ...args,
})

export const portalScanned = (args: Omit<PortalScanned, '_tag'>): PortalScanned => ({
  _tag: 'portal.scanned',
  ...args,
})
```

**Key points:**

- Event names are past tense facts
- `_tag` matches the event name, enforced by the smart constructor

---

## 5. Domain errors

**Location:** `src/contexts/portal/domain/errors.ts`
**Purpose:** Tagged error types.

```ts
export type PortalErrorCode =
  | 'forbidden'
  | 'property_not_found'
  | 'portal_not_found'
  | 'slug_taken'
  | 'invalid_slug'
  | 'invalid_theme'
  | 'invalid_smart_routing'

export type PortalError = Readonly<{
  _tag: 'PortalError'
  code: PortalErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const portalError = (
  code: PortalErrorCode,
  message: string,
  context?: Record<string, unknown>,
): PortalError => ({
  _tag: 'PortalError',
  code,
  message,
  context,
})

export const isPortalError = (e: unknown): e is PortalError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PortalError'
```

**Key points:**

- Plain objects, not classes
- Two levels of discrimination: `_tag` (error type) and `code` (specific reason)
- `isPortalError` type guard for catching

---

## 6. Application port (repository interface)

**Location:** `src/contexts/portal/application/ports/portal.repository.ts`

```ts
import type { Portal, PortalId } from '@/contexts/portal/domain/types'
import type { OrganizationId } from '@/shared/domain/ids'
import type { PropertyId } from '@/contexts/property/domain/types'

export type PortalRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PortalId) => Promise<Portal | null>
  listByProperty: (
    orgId: OrganizationId,
    propertyId: PropertyId,
  ) => Promise<ReadonlyArray<Portal>>
  slugExists: (
    orgId: OrganizationId,
    slug: string,
    excludeId?: PortalId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, portal: Portal) => Promise<void>
  update: (orgId: OrganizationId, id: PortalId, patch: Partial<Portal>) => Promise<void>
  softDelete: (orgId: OrganizationId, id: PortalId) => Promise<void>
}>
```

**Key points:**

- Every method takes `organizationId` as the first parameter
- Return types are domain types, never row shapes
- `type` alias, not `interface`

---

## 7. Application port (external service interface)

**Location:** `src/contexts/portal/application/ports/portal-storage.port.ts`

```ts
import type { PortalId } from '@/contexts/portal/domain/types'
import type { OrganizationId } from '@/shared/domain/ids'

export type PresignedUpload = Readonly<{
  uploadUrl: string
  objectKey: string
  expiresAt: Date
}>

export type PortalStorage = Readonly<{
  getPresignedUploadUrl: (params: {
    orgId: OrganizationId
    portalId: PortalId
    contentType: string
    maxBytes: number
  }) => Promise<PresignedUpload>
  getPublicUrl: (objectKey: string) => string
  deleteObject: (objectKey: string) => Promise<void>
}>
```

---

## 8. Application DTO

**Location:** `src/contexts/portal/application/dto/create-portal.dto.ts`
**Purpose:** Zod schema for HTTP input, also reused as the form schema.

```ts
import { z } from 'zod'

export const CreatePortalInputSchema = z.object({
  propertyId: z.string().uuid(),
  name: z.string().min(1).max(100),
  slug: z.string().min(2).max(64).optional(),
  entityType: z.enum(['property', 'team', 'staff']),
  entityId: z.string().uuid(),
  theme: z
    .object({
      primaryColor: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
      accentColor: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
      backgroundColor: z.string().regex(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i),
    })
    .partial()
    .optional(),
  smartRouting: z
    .object({
      enabled: z.boolean(),
      threshold: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
    })
    .partial()
    .optional(),
})

export type CreatePortalInput = z.infer<typeof CreatePortalInputSchema>
```

**Key points:**

- Schema and inferred TypeScript type both exported
- Used by the server function AND by the form component
- Validates structural things (types, formats) — business rules live in use cases/domain
- One DTO per major input or output shape

---

## 9. Use case (full pattern)

**Location:** `src/contexts/portal/application/use-cases/create-portal.ts`

```ts
import type { PortalRepository } from '@/contexts/portal/application/ports/portal.repository'
import type { PropertyRepository } from '@/contexts/property/application/ports/property.repository'
import type { EventBus } from '@/shared/events/event-bus'
import type { Portal, PortalId } from '@/contexts/portal/domain/types'
import type { AuthContext } from '@/shared/domain/auth-context'
import type { CreatePortalInput } from '@/contexts/portal/application/dto/create-portal.dto'
import type { PropertyId } from '@/contexts/property/domain/types'

// Authorization is checked via auth.api.hasPermission() in the server function.
// The use case receives the AuthContext but defers permission checks to
// the better-auth access control system. Domain rules here are pure business
// validation only.
import { buildPortal } from '@/contexts/portal/domain/constructors'
import { portalError } from '@/contexts/portal/domain/errors'
import { portalCreated } from '@/contexts/portal/domain/events'

export type CreatePortalDeps = Readonly<{
  portalRepo: PortalRepository
  propertyRepo: PropertyRepository
  events: EventBus
  idGen: () => PortalId
  clock: () => Date
}>

export const createPortal =
  (deps: CreatePortalDeps) =>
  async (input: CreatePortalInput, ctx: AuthContext): Promise<Portal> => {
    // 1. Authorize
    // Authorization is now handled by better-auth's access control system.
    // The server function calls auth.api.hasPermission() before invoking the use case.
    // Domain-level checks remain for pure business rules (not role-based auth).

    // 2. Validate referenced entities
    const property = await deps.propertyRepo.findById(
      ctx.organizationId,
      input.propertyId as PropertyId,
    )
    if (!property) {
      throw portalError(
        'property_not_found',
        'property does not exist in this organization',
      )
    }

    // 3. Check uniqueness
    const candidateSlug = input.slug ?? input.name
    if (await deps.portalRepo.slugExists(ctx.organizationId, candidateSlug)) {
      throw portalError('slug_taken', 'slug already in use in this organization')
    }

    // 4. Build domain object
    const portalResult = buildPortal({
      id: deps.idGen(),
      organizationId: ctx.organizationId,
      propertyId: input.propertyId as PropertyId,
      name: input.name,
      providedSlug: input.slug,
      entityType: input.entityType,
      entityId: input.entityId,
      theme: input.theme,
      smartRouting: input.smartRouting,
      now: deps.clock(),
    })

    if (portalResult.isErr()) {
      throw portalResult.error
    }

    const portal = portalResult.value

    // 5. Persist
    await deps.portalRepo.insert(ctx.organizationId, portal)

    // 6. Emit event
    deps.events.emit(
      portalCreated({
        portalId: portal.id,
        organizationId: portal.organizationId,
        propertyId: portal.propertyId,
        occurredAt: portal.createdAt,
      }),
    )

    // 7. Return
    return portal
  }

export type CreatePortal = ReturnType<typeof createPortal>
```

**Key points:**

- Factory function: `(deps) => async (input, ctx) => Promise<T>`
- Dependencies are explicit — no globals, no imports for DB clients
- `idGen` and `clock` are injected so tests can control them deterministically
- Throws tagged errors
- 7-step pattern — use only the steps that apply (see #22 for a thin example)

---

## 10. Drizzle schema

**Location:** `src/shared/db/schema/portal.schema.ts`

```ts
import { sql } from 'drizzle-orm'
import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core'
import { organization } from './identity.schema'
import { properties } from './property.schema'

export const portals = pgTable(
  'portals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Note: better-auth owns the `organization` table and uses varchar IDs,
    // so most tables reference it with varchar, not uuid + FK.
    // The pattern below is aspirational for non-better-auth parent tables.
    organizationId: uuid('organization_id')
      .notNull()
      // .references(() => organization.id, { onDelete: 'cascade' })
      // Uncomment if/when Drizzle FK references to better-auth tables are feasible.
      // Currently, better-auth tables use camelCase columns that differ from
      // Drizzle's generated schema, so FK references don't work cross-schema.
    propertyId: uuid('property_id')
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    entityType: varchar('entity_type', { length: 20 }).notNull(),
    entityId: uuid('entity_id').notNull(),
    heroImageKey: varchar('hero_image_key', { length: 500 }),
    theme: jsonb('theme').notNull(),
    smartRoutingEnabled: boolean('smart_routing_enabled').notNull().default(true),
    smartRoutingThreshold: integer('smart_routing_threshold').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('portals_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgPropertyIdx: index('portals_org_property_idx').on(t.organizationId, t.propertyId),
  }),
)
```

**Key points:**

- Every table has `id`, `organization_id`, `created_at`, `updated_at`; soft-deletable tables add `deleted_at`
- Partial unique index on `(organization_id, slug) WHERE deleted_at IS NULL`
- snake_case columns, camelCase field names — Drizzle handles mapping
- Exception: better-auth tables use camelCase columns

---

## 11. Row ↔ domain mapper

**Location:** `src/contexts/portal/infrastructure/mappers/portal.mapper.ts`

```ts
import type { portals } from '@/shared/db/schema/portal.schema'
import type { Portal, PortalId, EntityType } from '@/contexts/portal/domain/types'
import type { OrganizationId } from '@/shared/domain/ids'
import type { PropertyId } from '@/contexts/property/domain/types'

type PortalRow = typeof portals.$inferSelect
type PortalInsertRow = typeof portals.$inferInsert

export const portalFromRow = (row: PortalRow): Portal => ({
  id: row.id as PortalId,
  organizationId: row.organizationId as OrganizationId,
  propertyId: row.propertyId as PropertyId,
  name: row.name,
  slug: row.slug,
  entityType: row.entityType as EntityType,
  entityId: row.entityId,
  heroImageKey: row.heroImageKey,
  theme: row.theme as Portal['theme'],
  smartRouting: {
    enabled: row.smartRoutingEnabled,
    threshold: row.smartRoutingThreshold as 1 | 2 | 3 | 4,
  },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const portalToRow = (portal: Portal): PortalInsertRow => ({
  id: portal.id,
  organizationId: portal.organizationId,
  propertyId: portal.propertyId,
  name: portal.name,
  slug: portal.slug,
  entityType: portal.entityType,
  entityId: portal.entityId,
  heroImageKey: portal.heroImageKey,
  theme: portal.theme,
  smartRoutingEnabled: portal.smartRouting.enabled,
  smartRoutingThreshold: portal.smartRouting.threshold,
  createdAt: portal.createdAt,
  updatedAt: portal.updatedAt,
  deletedAt: portal.deletedAt,
})
```

**Key points:**

- Pure functions, no I/O
- The only place in the codebase where both row and domain shapes are known at once
- `$inferSelect` and `$inferInsert` give accurate row types from Drizzle

---

## 12. Repository implementation

**Location:** `src/contexts/portal/infrastructure/repositories/portal.repository.ts`

```ts
import { and, eq, isNull, not } from 'drizzle-orm'
import type { Database } from '@/shared/db/client'
import { portals } from '@/shared/db/schema/portal.schema'
import type { PortalRepository } from '@/contexts/portal/application/ports/portal.repository'
import { portalFromRow, portalToRow } from '../mappers/portal.mapper'

export const createPortalRepository = (db: Database): PortalRepository => ({
  findById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(portals)
      .where(
        and(
          eq(portals.organizationId, orgId),
          eq(portals.id, id),
          isNull(portals.deletedAt),
        ),
      )
      .limit(1)
    return rows[0] ? portalFromRow(rows[0]) : null
  },

  listByProperty: async (orgId, propertyId) => {
    const rows = await db
      .select()
      .from(portals)
      .where(
        and(
          eq(portals.organizationId, orgId),
          eq(portals.propertyId, propertyId),
          isNull(portals.deletedAt),
        ),
      )
    return rows.map(portalFromRow)
  },

  slugExists: async (orgId, slug, excludeId) => {
    const conditions = [
      eq(portals.organizationId, orgId),
      eq(portals.slug, slug),
      isNull(portals.deletedAt),
    ]
    if (excludeId) {
      conditions.push(not(eq(portals.id, excludeId)))
    }

    const rows = await db
      .select({ id: portals.id })
      .from(portals)
      .where(and(...conditions))
      .limit(1)
    return rows.length > 0
  },

  insert: async (_orgId, portal) => {
    await db.insert(portals).values(portalToRow(portal))
  },

  update: async (orgId, id, patch) => {
    throw new Error('not shown in example')
  },

  softDelete: async (orgId, id) => {
    await db
      .update(portals)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(portals.organizationId, orgId),
          eq(portals.id, id),
          isNull(portals.deletedAt),
        ),
      )
  },
})
```

**Key points:**

- Factory function returning a record of functions
- Every query filters by `organizationId AND deleted_at IS NULL`
- Returns domain types via mapper

---

## 13. External service adapter

**Location:** `src/contexts/portal/infrastructure/storage/r2-portal-storage.ts`

```ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import type { PortalStorage } from '@/contexts/portal/application/ports/portal-storage.port'

export type R2Config = Readonly<{
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
}>

export const createR2PortalStorage = (config: R2Config): PortalStorage => {
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })

  return {
    getPresignedUploadUrl: async ({ orgId, portalId, contentType, maxBytes }) => {
      const extension = contentType.split('/')[1] ?? 'bin'
      const hash = randomUUID()
      const objectKey = `org-${orgId}/portal-${portalId}/hero-${hash}.${extension}`

      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: maxBytes,
      })

      const uploadUrl = await getSignedUrl(client, command, { expiresIn: 300 })

      return {
        uploadUrl,
        objectKey,
        expiresAt: new Date(Date.now() + 300_000),
      }
    },

    getPublicUrl: (objectKey) => `${config.publicBaseUrl}/${objectKey}`,

    deleteObject: async (objectKey) => {
      await client.send(
        new DeleteObjectCommand({
          Bucket: config.bucket,
          Key: objectKey,
        }),
      )
    },
  }
}
```

---

## 14. BullMQ job handler

**Location:** `src/contexts/portal/infrastructure/jobs/process-hero-image.job.ts`

```ts
import type { Job } from 'bullmq'
import sharp from 'sharp'
import type { Logger } from '@/shared/observability/logger'

export type ProcessHeroImageJobData = Readonly<{
  organizationId: string
  portalId: string
  objectKey: string
}>

export type ProcessHeroImageDeps = Readonly<{
  logger: Logger
  fetchObjectBytes: (objectKey: string) => Promise<Buffer>
  uploadObjectBytes: (
    objectKey: string,
    bytes: Buffer,
    contentType: string,
  ) => Promise<void>
}>

export const JOB_NAME = 'process-hero-image' as const

export const createProcessHeroImageHandler =
  (deps: ProcessHeroImageDeps) =>
  async (job: Job<ProcessHeroImageJobData>): Promise<void> => {
    const { objectKey } = job.data
    deps.logger.info({ jobId: job.id, objectKey }, 'processing hero image')

    const originalBytes = await deps.fetchObjectBytes(objectKey)

    const webpKey = objectKey.replace(/\.\w+$/, '.webp')
    const thumbKey = objectKey.replace(/\.\w+$/, '-thumb.webp')

    const webp = await sharp(originalBytes)
      .resize(1200, 630, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer()

    const thumb = await sharp(originalBytes)
      .resize(300, 157, { fit: 'cover' })
      .webp({ quality: 75 })
      .toBuffer()

    await deps.uploadObjectBytes(webpKey, webp, 'image/webp')
    await deps.uploadObjectBytes(thumbKey, thumb, 'image/webp')

    deps.logger.info({ jobId: job.id, webpKey, thumbKey }, 'hero image processed')
  }
```

**Key points:**

- Factory function returning a BullMQ-compatible handler
- `JOB_NAME` exported as a `const` literal
- Idempotent: running twice produces the same output files

---

## 15. Event handler (cross-context subscriber)

**Location:** `src/contexts/metric/infrastructure/event-handlers/portal-scanned.handler.ts`
**Purpose:** Lives in the **receiving** context (`metric`), not the emitting context (`portal`).

```ts
import type { PortalScanned } from '@/contexts/portal/domain/events'
import type { MetricReadingRepository } from '@/contexts/metric/application/ports/metric-reading.repository'
import type { Logger } from '@/shared/observability/logger'
import { buildMetricReading } from '@/contexts/metric/domain/constructors'

export type HandlePortalScannedDeps = Readonly<{
  metricRepo: MetricReadingRepository
  idGen: () => string
  logger: Logger
}>

export const handlePortalScanned =
  (deps: HandlePortalScannedDeps) =>
  async (event: PortalScanned): Promise<void> => {
    const readingResult = buildMetricReading({
      id: deps.idGen(),
      organizationId: event.organizationId,
      metricKey: 'portal.scan_count',
      entityType: 'portal',
      entityId: event.portalId,
      value: 1,
      dimensions: { source: event.source },
      recordedAt: event.occurredAt,
    })

    if (readingResult.isErr()) {
      deps.logger.error(
        { error: readingResult.error, event },
        'invalid metric reading from portal.scanned',
      )
      return
    }

    try {
      await deps.metricRepo.insert(event.organizationId, readingResult.value)
    } catch (err) {
      // Handlers log via the shared logger, never throw — one bad event
      // shouldn't bring down the bus
      deps.logger.error({ err, event }, 'failed to record portal.scanned metric')
    }
  }
```

**Key points:**

- Lives in `contexts/metric/`, not `contexts/portal/`
- Imports the event type from the portal context; never imports use cases or repositories
- Failures are logged via the shared logger, not `console`
- Registered in `bootstrap.ts` with `eventBus.on('portal.scanned', handlePortalScanned(deps))`

---

## 16. Server function (authenticated)

**Location:** `src/contexts/portal/server/portals.ts`

```ts
import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { CreatePortalInputSchema } from '@/contexts/portal/application/dto/create-portal.dto'
import type { PortalError } from '@/contexts/portal/domain/errors'
import { isPortalError } from '@/contexts/portal/domain/errors'
import { headersFromContext } from '@/shared/auth/headers'
import { resolveTenantContext } from '@/shared/auth/middleware'
import { getAuth } from '@/shared/auth/auth'
import { getContainer } from '@/composition'

const portalErrorStatus = (code: PortalError['code']): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', 'portal_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_theme', 'invalid_smart_routing', () => 400)
    .exhaustive()

export const createPortal = createServerFn({ method: 'POST' })
  .inputValidator(CreatePortalInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)
    // Permission check via better-auth access control
    await getAuth().api.hasPermission({
      headers,
      body: { permissions: { property: ['create'] } },
    })

    const { useCases } = getContainer()
    try {
      const portal = await useCases.createPortal(data, ctx)
      return { portal }
    } catch (e) {
      if (isPortalError(e)) {
        const status = portalErrorStatus(e.code)
        const error = new Error(e.message)
        error.name = 'PortalError'
        ;(error as unknown as Record<string, unknown>).code = e.code
        ;(error as unknown as Record<string, unknown>).status = status
        throw error
      }
      throw e
    }
  })
```

**Key points:**

- Thin: resolve auth → validate input → call use case → translate errors → return
- Auth/tenant resolution is explicit at the top of the handler: `headersFromContext()` → `resolveTenantContext()` → optional permission check via `getAuth().api.hasPermission()`
- `resolveTenantContext` extracts the session from request headers, resolves the active organization, and returns a typed `AuthContext`
- Permission checks use `getAuth().api.hasPermission()` with the access control statement defined in `shared/auth/permissions.ts`. This replaces the old `roleGuard()` function and the hand-rolled `canXxx()` functions.
- `.inputValidator()` uses the DTO schema from the application layer
- `handler` calls the use case from `getContainer().useCases`
- `ts-pattern` with `.exhaustive()` ensures new error codes force a compiler error
- Non-context errors re-thrown; TanStack Start's error boundary handles them
- **Throws Error objects (not Response)** — TanStack Start serializes Errors via seroval and re-throws them on the client, so mutations fail and `mutation.error` is populated

---

## 17. Server function (public)

**Location:** `src/contexts/portal/server/public-portals.ts`

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getContainer } from '@/composition'

const GetPublicPortalInputSchema = z.object({
  orgSlug: z.string().min(1).max(64),
  portalSlug: z.string().min(1).max(64),
})

export const getPublicPortal = createServerFn({ method: 'GET' })
  .inputValidator(GetPublicPortalInputSchema)
  .handler(async ({ data }) => {
    const { useCases, storage } = getContainer()
    const portal = await useCases.getPortalBySlug(data)

    if (!portal) {
      const error = new Error('Portal not found')
      error.name = 'PortalError'
      ;(error as unknown as Record<string, unknown>).code = 'not_found'
      ;(error as unknown as Record<string, unknown>).status = 404
      throw error
    }

    return {
      portal: {
        name: portal.name,
        theme: portal.theme,
        heroImageUrl: portal.heroImageKey
          ? storage.getPublicUrl(portal.heroImageKey)
          : null,
        smartRouting: portal.smartRouting,
        categories: portal.categories.map((c) => ({
          title: c.title,
          links: c.links.map((l) => ({
            label: l.label,
            url: l.url,
            icon: l.icon,
            isReviewPlatform: l.isReviewPlatform,
          })),
        })),
      },
    }
  })
```

**Key points:**

- Lives in a separate file from authenticated server functions — trust boundary visible
- No auth resolution — public functions do not call `resolveTenantContext` or `hasPermission`
- Public routes resolve `organizationId` from the URL slug via use case logic
- Response is shaped for the public (no internal fields, CDN URLs resolved)

---

## 18. In-memory port fake (for tests)

**Location:** `src/shared/testing/in-memory-portal-repo.ts`

```ts
import type { PortalRepository } from '@/contexts/portal/application/ports/portal.repository'
import type { Portal } from '@/contexts/portal/domain/types'
import type { OrganizationId } from '@/shared/domain/ids'

export type InMemoryPortalRepo = PortalRepository &
  Readonly<{
    seed: (portals: ReadonlyArray<Portal>) => void
    all: () => ReadonlyArray<Portal>
  }>

export const createInMemoryPortalRepo = (): InMemoryPortalRepo => {
  const store = new Map<string, Portal>()

  const isSameTenant = (orgId: OrganizationId, portal: Portal) =>
    portal.organizationId === orgId && portal.deletedAt === null

  return {
    findById: async (orgId, id) => {
      const portal = store.get(id)
      return portal && isSameTenant(orgId, portal) ? portal : null
    },

    listByProperty: async (orgId, propertyId) =>
      [...store.values()].filter(
        (p) => isSameTenant(orgId, p) && p.propertyId === propertyId,
      ),

    slugExists: async (orgId, slug, excludeId) =>
      [...store.values()].some(
        (p) =>
          isSameTenant(orgId, p) &&
          p.slug === slug &&
          (excludeId === undefined || p.id !== excludeId),
      ),

    insert: async (_orgId, portal) => {
      store.set(portal.id, portal)
    },

    update: async (orgId, id, patch) => {
      const existing = store.get(id)
      if (!existing || !isSameTenant(orgId, existing)) return
      store.set(id, { ...existing, ...patch, updatedAt: new Date() })
    },

    softDelete: async (orgId, id) => {
      const existing = store.get(id)
      if (!existing || !isSameTenant(orgId, existing)) return
      store.set(id, { ...existing, deletedAt: new Date() })
    },

    seed: (portals) => {
      for (const p of portals) store.set(p.id, p)
    },

    all: () => [...store.values()],
  }
}
```

**Key points:**

- Implements the port interface exactly
- Tenant isolation respected
- Extra test-only methods (`seed`, `all`) typed separately

---

## 19. Domain test

**Location:** `src/contexts/portal/domain/rules.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  validateSlug,
  validateTheme,
  canManagePortals, // NOTE: this function has been removed. Authorization is now
  // handled by better-auth's access control system.
  // Domain tests that tested role-based permissions have been moved
  // to integration tests using auth.api.hasPermission().
  shouldShowFeedbackPrompt,
} from './rules'

describe('normalizeSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(normalizeSlug('Hello World')).toBe('hello-world')
  })

  it('strips special characters', () => {
    expect(normalizeSlug("O'Brien's Pub!")).toBe('obriens-pub')
  })

  it('caps at 64 characters', () => {
    expect(normalizeSlug('a'.repeat(100)).length).toBe(64)
  })
})

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    const result = validateSlug('main-lobby')
    expect(result.isOk()).toBe(true)
  })

  it('rejects slugs with uppercase', () => {
    const result = validateSlug('Invalid')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_slug')
  })
})

// NOTE: canManagePortals tests removed. Role-based authorization is now handled by
// better-auth's access control system (see shared/auth/permissions.ts).
// Permission checks are tested via integration tests using auth.api.hasPermission().
// Domain tests here cover ONLY pure business rules (validation, computation).

describe('shouldShowFeedbackPrompt (compliance rule)', () => {
  const cases = [
    { rating: 1 as const, enabled: true, threshold: 3 as const, expected: true },
    { rating: 3 as const, enabled: true, threshold: 3 as const, expected: true },
    { rating: 4 as const, enabled: true, threshold: 3 as const, expected: false },
    { rating: 5 as const, enabled: true, threshold: 3 as const, expected: false },
    { rating: 1 as const, enabled: false, threshold: 3 as const, expected: false },
  ]

  it.each(cases)(
    'rating=$rating enabled=$enabled threshold=$threshold → $expected',
    ({ rating, enabled, threshold, expected }) => {
      expect(shouldShowFeedbackPrompt(rating, { enabled, threshold })).toBe(expected)
    },
  )
})
```

**Key points:**

- No `beforeEach`, no mocks
- Parameterized tests (`it.each`) for compliance rules
- Runs in milliseconds

---

## 20. Use case test

**Location:** `src/contexts/portal/application/use-cases/create-portal.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { createPortal } from './create-portal'
import { createInMemoryPortalRepo } from '@/shared/testing/in-memory-portal-repo'
import { createInMemoryPropertyRepo } from '@/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '@/shared/testing/capturing-event-bus'
import { buildTestAuthContext, buildTestProperty } from '@/shared/testing/fixtures'
import { isPortalError } from '@/contexts/portal/domain/errors'
import type { PortalId } from '@/contexts/portal/domain/types'

const FIXED_ID = 'portal-00000000-0000-0000-0000-000000000001' as PortalId
const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const portalRepo = createInMemoryPortalRepo()
  const propertyRepo = createInMemoryPropertyRepo()
  const events = createCapturingEventBus()

  const deps = {
    portalRepo,
    propertyRepo,
    events,
    idGen: () => FIXED_ID,
    clock: () => FIXED_TIME,
  }

  const useCase = createPortal(deps)
  return { useCase, portalRepo, propertyRepo, events }
}

describe('createPortal', () => {
  it('creates a portal with defaults when optional fields are omitted', async () => {
    const { useCase, propertyRepo, portalRepo } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    const portal = await useCase(
      {
        propertyId: property.id,
        name: 'Main Lobby',
        entityType: 'property',
        entityId: property.id,
      },
      ctx,
    )

    expect(portal.slug).toBe('main-lobby')
    expect(portalRepo.all()).toHaveLength(1)
  })

  it('rejects users who cannot manage portals', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase(
        {
          propertyId: 'any-property',
          name: 'Main Lobby',
          entityType: 'property',
          entityId: 'any-property',
        },
        ctx,
      ),
    ).rejects.toSatisfy((e) => isPortalError(e) && e.code === 'forbidden')
  })

  it('emits portal.created event on success', async () => {
    const { useCase, propertyRepo, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })
    const property = buildTestProperty({ organizationId: ctx.organizationId })
    propertyRepo.seed([property])

    await useCase(
      {
        propertyId: property.id,
        name: 'Main Lobby',
        entityType: 'property',
        entityId: property.id,
      },
      ctx,
    )

    const emitted = events.capturedEvents()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]._tag).toBe('portal.created')
  })
})
```

**Key points:**

- `setup()` helper builds fresh in-memory repos for each test
- `idGen` and `clock` are fixed for determinism
- No database, no HTTP, no framework

---

## 21. Repository integration test

**Location:** `src/contexts/portal/infrastructure/repositories/portal.repository.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPortalRepository } from './portal.repository'
import { setupTestDatabase, teardownTestDatabase, type TestDb } from '@/shared/testing/db'
import { buildTestPortal } from '@/shared/testing/fixtures'
import type { OrganizationId } from '@/shared/domain/ids'

const ORG_A = 'org-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' as OrganizationId
const ORG_B = 'org-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' as OrganizationId

describe('portalRepository (integration)', () => {
  let testDb: TestDb

  beforeAll(async () => {
    testDb = await setupTestDatabase()
  })

  afterAll(async () => {
    await teardownTestDatabase(testDb)
  })

  beforeEach(async () => {
    await testDb.truncateAll()
    await testDb.seedOrganizations([ORG_A, ORG_B])
  })

  describe('tenant isolation', () => {
    it('does not return portals from other organizations', async () => {
      const repo = createPortalRepository(testDb.db)
      const portalA = buildTestPortal({ organizationId: ORG_A })
      const portalB = buildTestPortal({ organizationId: ORG_B })

      await repo.insert(ORG_A, portalA)
      await repo.insert(ORG_B, portalB)

      const fromA = await repo.findById(ORG_A, portalA.id)
      expect(fromA?.id).toBe(portalA.id)

      const crossTenant = await repo.findById(ORG_A, portalB.id)
      expect(crossTenant).toBeNull()
    })

    it('slugExists does not leak across tenants', async () => {
      const repo = createPortalRepository(testDb.db)
      const portalA = buildTestPortal({
        organizationId: ORG_A,
        slug: 'main-lobby',
      })

      await repo.insert(ORG_A, portalA)

      expect(await repo.slugExists(ORG_B, 'main-lobby')).toBe(false)
      expect(await repo.slugExists(ORG_A, 'main-lobby')).toBe(true)
    })
  })

  describe('softDelete', () => {
    it('allows a new portal with the same slug after soft-delete', async () => {
      const repo = createPortalRepository(testDb.db)
      const original = buildTestPortal({
        organizationId: ORG_A,
        slug: 'main-lobby',
      })

      await repo.insert(ORG_A, original)
      await repo.softDelete(ORG_A, original.id)

      const replacement = buildTestPortal({
        organizationId: ORG_A,
        slug: 'main-lobby',
      })
      await expect(repo.insert(ORG_A, replacement)).resolves.not.toThrow()
    })
  })
})
```

**Key points:**

- Uses a real Postgres (Neon branch or Docker) via `setupTestDatabase`
- Tenant isolation test is non-negotiable
- Tests real DB behaviors: unique constraints, cascading deletes, soft-delete semantics

---

## 22. Thin use case (auth check + delegation)

**Location:** `src/contexts/identity/application/use-cases/remove-member.ts`
**Purpose:** Use case whose only job is an authorization check followed by delegation. Common in wrapper contexts (identity, etc.) where the third-party library owns the domain.

```ts
import type { IdentityPort } from '@/contexts/identity/application/ports/identity.port'
import type { AuthContext } from '@/shared/domain/auth-context'
// Authorization is checked via auth.api.hasPermission() in the server function.
// The identity context's thin use cases no longer import permission functions
// from domain/permissions.ts (that file has been removed).
import { identityError } from '@/contexts/identity/domain/errors'

export type RemoveMemberDeps = Readonly<{
  identity: IdentityPort
}>

export type RemoveMemberInput = Readonly<{
  memberId: string
}>

export const removeMember =
  (deps: RemoveMemberDeps) =>
  async (input: RemoveMemberInput, ctx: AuthContext): Promise<void> => {
    // Step 1: Authorize
    // Authorization is now handled by better-auth's access control system.
    // The server function checks auth.api.hasPermission() before calling this use case.

    // Step 5: Persist (via the port — better-auth handles the actual DB work)
    await deps.identity.removeMember(ctx.organizationId, input.memberId)
  }

export type RemoveMember = ReturnType<typeof removeMember>
```

**Key points:**

- Same factory shape as a full use case
- Uses only steps (1) and (5) of the 7-step pattern — no validation, no construction, no event
- The use case still exists because (a) the auth check is real domain logic and (b) future requirements will land here naturally
- Don't add fake steps for symmetry
- This pattern is common in wrapper contexts; `portal`, `review`, etc. will mostly use the full pattern from #9

---

## 22b. Anonymous use case (member registration — no auth, no org)

**Location:** `src/contexts/identity/application/use-cases/register-user.ts`
**Purpose:** Registers a user account without creating an organization. Used by invited staff/managers joining an existing org via `/join`. This is the "join" path — distinct from `registerUserAndOrg` (section 22) which is the "signup" path.

```ts
import type { IdentityPort } from '@/contexts/identity/application/ports/identity.port'
import { identityError } from '@/contexts/identity/domain/errors'

export type RegisterUserInput = Readonly<{
  name: string
  email: string
  password: string
}>

export type RegisterUserDeps = Readonly<{
  identity: IdentityPort
}>

export const registerUser =
  (deps: RegisterUserDeps) =>
  async (input: RegisterUserInput): Promise<string> => {
    try {
      const userId = await deps.identity.signUp(input.name, input.email, input.password)
      return userId
    } catch (e) {
      throw identityError(
        'registration_failed',
        e instanceof Error ? e.message : 'Registration failed',
      )
    }
  }
```

**Key points:**

- **No `AuthContext` parameter** — this is an anonymous/public use case. The user doesn't exist yet.
- **No org creation** — the user joins an existing org by accepting an invitation after registration.
- **No event emission** — there's no domain event for "user registered without org." The interesting event (`member.added`) fires when the invitation is accepted.
- The server function is thin delegation: validate input → call use case → return user ID.
- The route (`/join?redirect=...`) redirects back to `/accept-invitation?id=...` after success.

**When to use this pattern:** Any registration flow where the user is joining an existing organization (invited by an admin). Contrast with `registerUserAndOrg` which is for the first person at a company creating a new org.

---

## 23. Server function calling a port directly (pure delegation)

**Location:** `src/contexts/identity/server/auth.ts`
**Purpose:** Server function for an operation with no business logic of its own — pure delegation to a third-party API. No use case at all.

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getAuth } from '@/shared/auth/auth'

const SignInInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export const signInUser = createServerFn({ method: 'POST' })
  .inputValidator(SignInInputSchema)
  .handler(async ({ data }) => {
    // Note: no getContainer() here — this is a direct-delegation operation.
    // Authenticated server functions (see #16) go through getContainer().useCases.*;
    // this one calls the better-auth API directly because there's no domain logic
    // to orchestrate. Both patterns are documented and intentional.
    try {
      await getAuth().api.signInEmail({
        body: { email: data.email, password: data.password },
      })
    } catch {
      const error = new Error('Invalid email or password')
      error.name = 'AuthError'
      ;(error as unknown as Record<string, unknown>).code = 'invalid_credentials'
      ;(error as unknown as Record<string, unknown>).status = 401
      throw error
    }
  })
```

**Key points:**

- **No `getContainer()` call** — this is the explicit difference from #16. The server function is calling a third-party API directly because there is no use case to orchestrate.
- No use case — there's no business logic to orchestrate
- No port wrapper — better-auth's API surface IS the port for sign-in
- The server function still has real responsibilities: input validation (Zod), error translation
- Use this pattern only when ALL of the following are true:
  - No authorization beyond "user is anonymous" or "user is authenticated"
  - No domain rules that need to run before the operation
  - No event to emit afterward
  - No transformation of the result beyond what the third-party returns
- If any of those become false later, refactor to a use case
- **Still throws Error on error** — never returns `{ success: false, error }`. TanStack Start serializes Errors for the client. The consistency of error handling across all server functions matters.

---

## 24. Form component (TanStack Form + shadcn)

**Location:** `src/components/features/portal/CreatePortalForm.tsx`
**Purpose:** Feature-specific form component. Uses shadcn's Field primitives wired with TanStack Form and the DTO's Zod schema. **Receives the mutation as a prop** — never imports server functions directly.

```tsx
import { useForm } from '@tanstack/react-form'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { FieldGroup } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { SubmitButton } from '@/components/forms/SubmitButton'
import { FormErrorBanner } from '@/components/forms/FormErrorBanner'
import { CreatePortalInputSchema } from '@/contexts/portal/application/dto/create-portal.dto'
import type { UseMutationResult } from '@tanstack/react-query'
import type { PropertyId } from '@/contexts/property/domain/types'

type CreatePortalMutation = UseMutationResult<
  unknown, // response
  unknown, // error
  {
    data: {
      propertyId: string
      name: string
      slug?: string
      entityType: string
      entityId: string
    }
  }, // variables
  unknown // context
>

type Props = Readonly<{
  propertyId: PropertyId
  mutation: CreatePortalMutation
}>

export function CreatePortalForm({ propertyId, mutation }: Props) {
  const form = useForm({
    defaultValues: {
      propertyId,
      name: '',
      slug: undefined as string | undefined,
      entityType: 'property' as const,
      entityId: propertyId,
    },
    validators: {
      onSubmit: CreatePortalInputSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync({ data: value })
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="space-y-6"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="name">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="Main Lobby"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="slug">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Slug (optional)</FieldLabel>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value ?? ''}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value || undefined)}
                  aria-invalid={isInvalid}
                  placeholder="main-lobby"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Create portal
      </SubmitButton>
    </form>
  )
}
```

**Key points:**

- **Receives `mutation` as a prop** — the route defines `useMutation({ mutationFn: createPortal })` and passes it. Components never import server functions (dependency rules).
- Uses shadcn's `Field`, `FieldLabel`, `FieldError`, `FieldGroup` primitives for consistent visual structure
- Uses TanStack Form's `useForm`, `form.Field`, `form.handleSubmit` for state management
- The Zod schema (`CreatePortalInputSchema`) is imported from the DTO and passed to `validators.onSubmit` — TanStack Form v1 handles Zod schemas natively, no adapter required. Single source of truth. Validation runs on submit to avoid showing errors before the user has finished filling in the form.
- The `isInvalid` check (`isTouched && !isValid`) gates error display so errors only show after the user has interacted with the field
- `FormErrorBanner` displays top-level mutation errors
- `SubmitButton` reads both the mutation state (for loading/disabled) and the form state (for validation)
- One form component per feature; lives in `components/features/<ctx>/`

**Route wiring example:**

```tsx
// routes/.../create-portal.tsx
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { createPortal } from '@/contexts/portal/server/portals'
import { CreatePortalForm } from '@/components/features/portal/CreatePortalForm'

function CreatePortalPage() {
  const navigate = useNavigate()
  const mutation = useMutation({
    mutationFn: (input: CreatePortalInput) => createPortal({ data: input }),
    onSuccess: () => navigate({ to: '/dashboard/portals' }),
  })

  return <CreatePortalForm propertyId={propertyId} mutation={mutation} />
}
```

---

## 25. Shared form building block (SubmitButton)

**Location:** `src/components/forms/SubmitButton.tsx`
**Purpose:** Submit button that integrates mutation state and form validation state. Used in every form in the app.

```tsx
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { UseMutationResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Minimal type for the form shape we need — avoids heavy FormApi generics
type FormLike = Readonly<{
  state: Readonly<{
    canSubmit: boolean
    isSubmitting: boolean
  }>
}>

type Props = Readonly<{
  mutation: UseMutationResult<unknown, unknown, unknown, unknown>
  form?: FormLike
  children: ReactNode
  variant?: 'default' | 'destructive' | 'secondary'
}>

export function SubmitButton({ mutation, form, children, variant = 'default' }: Props) {
  const isPending = mutation.isPending
  const isInvalid = form ? !form.state.canSubmit || form.state.isSubmitting : false

  return (
    <Button
      type="submit"
      variant={variant}
      disabled={isPending || isInvalid}
      aria-busy={isPending}
    >
      {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
      {children}
    </Button>
  )
}
```

**Key points:**

- Reads mutation state for loading/disabled
- Optionally reads form state for validation-based disabling
- Wraps shadcn's `Button` — doesn't reimplement styling
- Shows a spinner during submission
- Accessible (`aria-busy`)

---

## 26. Shared form building block (FormErrorBanner)

**Location:** `src/components/forms/FormErrorBanner.tsx`
**Purpose:** Displays top-level mutation errors in a consistent way. Translates tagged error responses to user-friendly messages.

```tsx
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { AlertCircle } from 'lucide-react'

type Props = Readonly<{
  error: unknown
}>

const extractErrorMessage = (error: unknown): string => {
  if (!error) return ''
  if (error instanceof Response) return 'Something went wrong. Please try again.'
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return 'An unexpected error occurred.'
}

export function FormErrorBanner({ error }: Props) {
  if (!error) return null

  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Unable to complete this action</AlertTitle>
      <AlertDescription>{extractErrorMessage(error)}</AlertDescription>
    </Alert>
  )
}
```

**Key points:**

- Renders nothing when there's no error (form stays clean)
- Uses shadcn's `Alert` primitive for consistent styling
- Centralizes error-to-message translation
- Extend `extractErrorMessage` to parse server response JSON and map `error.code` to friendly messages per context as needed

---

## 27. Update use case (partial validation)

**Location:** `src/contexts/property/application/use-cases/update-property.ts`
**Purpose:** Shows how update use cases validate changed fields individually instead of reconstructing the full entity through the smart constructor. This is the correct pattern for partial updates.

### Why updates differ from creates

**Create** uses the smart constructor (`buildProperty`) which validates all fields at once. This works because every field is being set.

**Update** receives a partial patch — only the fields the user wants to change. Running all validations would reject unchanged fields that happen to be invalid in the patch (e.g., an existing slug that the user isn't changing). Instead, the update use case:

1. Loads the existing entity (step 2)
2. Validates only the fields present in the patch using domain rules directly (step 4)
3. Merges validated changes with existing values
4. Persists the merged result (step 5)

```ts
// update-property.ts — field-level validation for partial updates

// 3. Check uniqueness if slug is changing
const newSlug = input.slug ?? existing.slug
if (input.slug && input.slug !== existing.slug) {
  const slugResult = validateSlug(input.slug)
  if (slugResult.isErr()) throw slugResult.error
  // ... uniqueness check
}

// 4. Validate individual fields if provided
const newName = input.name ?? existing.name
if (input.name) {
  const nameResult = validatePropertyName(input.name)
  if (nameResult.isErr()) throw nameResult.error
}

const newTimezone = input.timezone ?? existing.timezone
if (input.timezone) {
  const tzResult = validateTimezone(input.timezone)
  if (tzResult.isErr()) throw tzResult.error
}
```

**Key points:**

- Domain rules (`validatePropertyName`, `validateSlug`, `validateTimezone`) are the same functions used by the smart constructor — no rule duplication
- The difference is _how_ they're called: constructor runs all of them; update runs only the ones that changed
- Fall-through values (`input.name ?? existing.name`) ensure unchanged fields are preserved
- The smart constructor remains the authority for full-entity validation (create, bulk import, etc.)
- This is not a shortcut — it's the correct pattern when the entity already exists and only some fields change

### When to use which

| Operation                              | Validation approach                                   |
| -------------------------------------- | ----------------------------------------------------- |
| Create new entity                      | Smart constructor (`buildXxx`) — validates all fields |
| Update existing entity (partial)       | Individual domain rules on changed fields             |
| Replace entire entity (full overwrite) | Smart constructor — you're rebuilding it              |

---

## 28. Soft-delete use case (minimal deps)

**Location:** `src/contexts/property/application/use-cases/soft-delete-property.ts`
**Purpose:** Shows a use case with minimal dependencies — only what's needed. No `idGen` because no new entity is created. Still includes `clock` for deterministic timestamps.

```ts
export type SoftDeletePropertyDeps = Readonly<{
  propertyRepo: PropertyRepository
  events: EventBus
  clock: () => Date
}>
```

**Key points:**

- No `idGen` — soft-delete doesn't create a new entity
- **Always include `clock`** when emitting events — `new Date()` is forbidden in use cases. The event's `occurredAt` must use `deps.clock()` so tests can assert deterministic timestamps.
- Steps used: (1) authorize, (2) validate entity exists, (5) persist, (6) emit event
- Steps skipped: (3) uniqueness check (not applicable), (4) build domain object (not creating)

### The `clock` rule for all use cases

Every use case that creates a timestamp (for an event, for an `updatedAt` field, for anything) must receive `clock` as a dependency. The only `new Date()` calls in the codebase belong in:

- `composition.ts` (the production clock factory: `clock: () => new Date()`)
- Repository implementations (e.g., `softDelete` sets `deletedAt` via `new Date()` — this is acceptable because repos are integration-tested, not unit-tested)
- Test setup (fixed clocks: `clock: () => FIXED_TIME`)

---

## 29. Form schema rules — derive from DTOs

### The rule

**Form schemas are derived from DTO schemas.** Import the DTO schema from `application/dto/`, then use Zod's `.required()`, `.extend()`, `.omit()`, or `.refine()` to adjust for form-specific concerns. Never re-declare a validation rule that already exists in the DTO.

The DTO is the single source of truth for validation rules (lengths, formats, patterns). The form schema is a _derived view_ that adjusts _shape_ (all strings, extra fields, no optional wrappers) but inherits _rules_ from the DTO.

### Why derive instead of duplicate

Forms and DTOs have legitimately different shapes:

1. **All fields are strings.** HTML inputs produce strings. The DTO may have `optional` fields; the form keeps them as required strings with empty defaults.
2. **Extra fields.** Password confirmation, terms acceptance, or UX-only fields that get stripped before submission.
3. **Server-only fields.** The DTO may include `propertyId` or other fields the server sets — the form omits them.

But the _validation rules_ (name max length, slug pattern, required fields) must be the same. Deriving the form schema from the DTO means they can't drift apart.

### Pattern 1: `.required()` — when form fields are all required strings

Use when the DTO has `.optional()` fields but the form needs empty-string defaults:

```ts
import { createPropertyInputSchema } from '#/contexts/property/application/dto/create-property.dto'

const createFormSchema = createPropertyInputSchema
  .required() // removes optional wrappers → all fields present
  .extend({
    slug: z.string().max(64, 'Slug must be at most 64 characters'),
    gbpPlaceId: z.string().max(500, 'GBP Place ID must be at most 500 characters'),
  })
```

`.required()` removes `.optional()` wrappers. `.extend()` overrides fields where the form needs a different shape (e.g., slug is optional on the server but a plain string in the form, with empty-ok semantics). Rules for `name` and `timezone` are inherited directly from the DTO — no duplication.

### Pattern 2: `.extend()` + `.refine()` — when the form has extra fields

Use when the form has fields that don't exist in the DTO (password confirmation):

```ts
import { registerUserInputSchema } from '#/contexts/identity/application/dto/invitation.dto'

const registerFormSchema = registerUserInputSchema
  .extend({
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
```

All DTO rules for `name`, `email`, `password`, `organizationName` are inherited. The form adds one field and one cross-field rule.

### Pattern 3: `.omit()` + `.required()` — when the form edits a subset

Use for edit forms where the DTO has server-only fields:

```ts
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'

const editFormSchema = updatePropertyInputSchema
  .omit({ propertyId: true }) // server sets this, not the form
  .required() // all fields present for editing
  .extend({
    slug: z
      .string()
      .min(1, 'Slug is required')
      .max(64, 'Slug must be at most 64 characters'),
    gbpPlaceId: z.string().max(500, 'GBP Place ID must be at most 500 characters'),
  })
```

### Pattern 4: Use DTO directly — when shapes match

When the form shape matches the DTO shape exactly (all required strings, no extra fields), use the DTO schema directly:

```ts
import { signInInputSchema } from '#/contexts/identity/application/dto/invitation.dto'

const form = useForm({
  validators: { onSubmit: signInInputSchema },
  // ...
})
```

### Where the real rules live

```
Domain rules (domain/rules.ts)     → canonical business validation (Result-returning)
DTO schemas (application/dto/)      → structural validation for server input (Zod) — SOURCE OF TRUTH for lengths/formats
Form schemas (components/features/) → derived from DTO, adjusted for form shape
```

Change a rule in the DTO → every derived form schema automatically picks it up. If you need to change a rule, change it in the DTO (and the domain rules if applicable). The form schemas inherit.

### Anti-patterns

- ❌ Re-declaring a `z.string().min().max()` rule in a form schema that already exists in the DTO — derive instead
- ❌ Importing from `domain/rules.ts` in a form component — dependency rules forbid it
- ❌ Duplicating _business logic_ (slug regex patterns, timezone lists) in form schemas — inherit from DTO
- ❌ Skipping form validation entirely — early feedback is a UX requirement
- ❌ Using the DTO schema directly when the form shape genuinely differs — causes type errors from `undefined` vs empty string

---

## How to use this document

When AI is creating a new file:

1. **Identify the operation shape** using the "Choosing the right pattern" section at the top.
2. **Identify which example matches the file type.**
3. **Read the example and the "key points" section.**
4. **Adapt the pattern to the new context/entity.**
5. **Keep deviations minimal — consistency across the codebase matters more than local cleverness.**

When this document doesn't cover your case:

1. **Check existing code first** — `contexts/identity/` and `contexts/property/` are the canonical live references.
2. **Check `architecture.md`** for the rationale.
3. **Check `conventions.md`** for the rules, especially "When to skip layers" and the forms section.
4. **If still unclear, decide deliberately and add a new example to this document** before writing the code.
