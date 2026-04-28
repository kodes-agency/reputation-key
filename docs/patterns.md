# Patterns

**Status:** Living reference.
**Audience:** Developers (human and AI) writing new files.
**Purpose:** Canonical code examples for every file type in the codebase. Use when creating or modifying files to maintain structural consistency.

Canonical examples for each file type in the codebase. When AI is writing a new file, point it at the matching example here.

All examples use real implemented contexts (`property`, `identity`, `team`, `staff`). Sections 1-5 and 10-12 use the **property** context (most complete thick context). Sections 6-9, 13-15, and 19-21 use the **identity** context (invite-member, remove-member, update-member-role patterns). Sections 22-24 demonstrate thin-delegation and anonymous use cases via the **identity** context. Form examples use **identity** and **property** forms. The **team** and **staff** contexts follow the same layered patterns illustrated below; they are not called out in dedicated sections but their live source files in `src/contexts/` are fully implemented and should be consulted alongside these examples. The live source files in `src/contexts/` are the canonical references; this document provides annotated versions for onboarding.

Companion docs:

- `conventions.md` — the rules and rationale (single source of truth for what and why)

---

## Choosing the right pattern

Before reaching for an example, decide which pattern actually fits your operation:

**Has business rules, validation, events, state transitions, or cross-entity coordination?**
→ Full use case (example #9). Server function calls use case. Use case orchestrates domain + repos + events.

**Has only an authorization check, then delegates to a port or third-party API?**
→ Thin use case (example #22). Server function still calls the use case, but the use case is a one-liner. Keep it because future logic will land here.

**Pure delegation to a third-party library, no auth check, no event, no transformation?**
→ Server function calls the port (or third-party API) directly (example #24). No use case at all.

**Writing a form?**
→ Forms follow a fixed pattern: the route defines the mutation, the form component receives it as a prop. See example #25 (form component) and the "Forms" section in `conventions.md`.

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
22. [Thin use case (auth check + delegation)](#22-thin-use-case-auth-check--delegation) 23. [Anonymous use case (member registration)](#23-anonymous-use-case-member-registration--no-auth-no-org)
23. [Server function calling a port directly (pure delegation)](#24-server-function-calling-a-port-directly-pure-delegation)
24. [Form component (TanStack Form + shadcn)](#25-form-component-tanstack-form--shadcn)
25. [Shared form building block (SubmitButton)](#26-shared-form-building-block-submitbutton)
26. [Shared form building block (FormErrorBanner)](#27-shared-form-building-block-formerrorbanner)
27. [Update use case (partial validation)](#28-update-use-case-partial-validation)
28. [Soft-delete use case (minimal deps)](#29-soft-delete-use-case-minimal-deps)
29. [Form schema rules — when forms differ from DTOs](#30-form-schema-rules--when-forms-differ-from-dtos)

- [Choosing the right pattern](#choosing-the-right-pattern)
- [How to use this document](#how-to-use-this-document)

---

## 1. Domain types

**Location:** `src/contexts/property/domain/types.ts`
**Purpose:** Define the shape of entities as the business thinks about them. No framework imports, no DB concerns.

```ts
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'

/** Property entity — the organizational unit everything else lives under. */
export type Property = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  timezone: string
  gbpPlaceId: string | null
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}>

/** Re-export PropertyId from shared for convenience */
export type { PropertyId } from '#/shared/domain/ids'
```

**Key points:**

- `readonly` on every field
- Branded IDs (`PropertyId`, `OrganizationId`) so IDs can't be accidentally swapped
- `Readonly<{...}>` for object types, `ReadonlyArray<T>` for arrays
- No methods, no classes — types are data only
- String literal unions instead of `enum`
- Re-export shared IDs for consumer convenience

---

## 2. Domain rules

**Location:** `src/contexts/property/domain/rules.ts`
**Purpose:** Pure business rules. No async, no I/O, no throws. Validation returns `Result`.

```ts
import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import { VALID_TIMEZONES } from '#/shared/domain/timezones'
import type { PropertyError } from './errors'
import { propertyError } from './errors'

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

/** Normalize a string into a URL-friendly slug (infallible). */
export const normalizeSlug = (input: string): string =>
  input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64)

/** Validate a slug format. */
export const validateSlug = (slug: string): Result<string, PropertyError> =>
  SLUG_PATTERN.test(slug)
    ? ok(slug)
    : err(propertyError('invalid_slug', 'slug must be URL-friendly and 2-64 chars'))

/** Validate a property name. */
export const validatePropertyName = (name: string): Result<string, PropertyError> => {
  const trimmed = name.trim()
  if (trimmed.length < 1) {
    return err(propertyError('invalid_name', 'Property name is required'))
  }
  if (trimmed.length > 100) {
    return err(
      propertyError('invalid_name', 'Property name must be at most 100 characters'),
    )
  }
  return ok(trimmed)
}

/** Validate that a timezone string is a recognized IANA timezone. */
export const validateTimezone = (tz: string): Result<string, PropertyError> => {
  if (VALID_TIMEZONES.includes(tz)) {
    return ok(tz)
  }
  return err(propertyError('invalid_timezone', `Unknown timezone: ${tz}`))
}
```

**Key points:**

- All functions are pure
- Fallible functions return `Result<T, PropertyError>`; infallible ones return the plain type
- General authorization uses `can()` from `shared/domain/permissions.ts` (tested in use case tests)
- Some contexts keep additional authorization predicates alongside business rules (e.g., `canInviteWithRole` in `identity/domain/rules.ts`) when the check depends on domain-specific constraints

---

## 3. Domain constructors (smart constructors)

**Location:** `src/contexts/property/domain/constructors.ts`
**Purpose:** Build domain entities from raw input, composing all validations, returning a `Result`.

```ts
import { Result } from 'neverthrow'
import type { Property, PropertyId } from './types'
import type { PropertyError } from './errors'
import type { OrganizationId } from '#/shared/domain/ids'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
} from './rules'

export type BuildPropertyInput = Readonly<{
  id: PropertyId
  organizationId: OrganizationId
  name: string
  providedSlug?: string
  timezone: string
  gbpPlaceId?: string | null
  now: Date
}>

export const buildProperty = (
  input: BuildPropertyInput,
): Result<Property, PropertyError> => {
  const nameResult = validatePropertyName(input.name)
  const slug = validateSlug(input.providedSlug ?? normalizeSlug(input.name))
  const tz = validateTimezone(input.timezone)

  return Result.combine([nameResult, slug, tz]).map(
    ([validName, validSlug, validTz]): Property => ({
      id: input.id,
      organizationId: input.organizationId,
      name: validName,
      slug: validSlug,
      timezone: validTz,
      gbpPlaceId: input.gbpPlaceId ?? null,
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
- Returns `Result<Property, PropertyError>` — can't construct an invalid Property

---

## 4. Domain events

**Location:** `src/contexts/property/domain/events.ts`
**Purpose:** Tagged discriminated unions representing facts that happened.

```ts
import type { PropertyId } from './types'
import type { OrganizationId } from '#/shared/domain/ids'

export type PropertyCreated = Readonly<{
  _tag: 'property.created'
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

export type PropertyUpdated = Readonly<{
  _tag: 'property.updated'
  propertyId: PropertyId
  organizationId: OrganizationId
  name: string
  slug: string
  occurredAt: Date
}>

export type PropertyDeleted = Readonly<{
  _tag: 'property.deleted'
  propertyId: PropertyId
  organizationId: OrganizationId
  occurredAt: Date
}>

export type PropertyEvent = PropertyCreated | PropertyUpdated | PropertyDeleted

export const propertyCreated = (
  args: Omit<PropertyCreated, '_tag'>,
): PropertyCreated => ({ _tag: 'property.created', ...args })

export const propertyUpdated = (
  args: Omit<PropertyUpdated, '_tag'>,
): PropertyUpdated => ({ _tag: 'property.updated', ...args })

export const propertyDeleted = (
  args: Omit<PropertyDeleted, '_tag'>,
): PropertyDeleted => ({ _tag: 'property.deleted', ...args })
```

**Key points:**

- Event names are past tense facts
- `_tag` matches the event name, enforced by the smart constructor
- Event union type (`PropertyEvent`) covers all events in the context

---

## 5. Domain errors

**Location:** `src/contexts/property/domain/errors.ts`
**Purpose:** Tagged error types.

```ts
export type PropertyErrorCode =
  | 'forbidden'
  | 'invalid_slug'
  | 'invalid_name'
  | 'invalid_timezone'
  | 'slug_taken'
  | 'property_not_found'

export type PropertyError = Readonly<{
  _tag: 'PropertyError'
  code: PropertyErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

/** Smart constructor — the only way to build a PropertyError. */
export const propertyError = (
  code: PropertyErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): PropertyError => ({
  _tag: 'PropertyError',
  code,
  message,
  ...(context ? { context } : {}),
})

/** Type guard — lets server functions detect PropertyError at catch time. */
export const isPropertyError = (e: unknown): e is PropertyError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'PropertyError'
```

**Key points:**

- Plain objects, not classes
- Two levels of discrimination: `_tag` (error type) and `code` (specific reason)
- `isPropertyError` type guard for catching
- Error codes form a closed union so `ts-pattern` `.exhaustive()` works at the server boundary

---

## 6. Application port (repository interface)

**Location:** `src/contexts/property/application/ports/property.repository.ts`

```ts
import type { Property, PropertyId } from '../../domain/types'
import type { OrganizationId } from '#/shared/domain/ids'

export type PropertyRepository = Readonly<{
  findById: (orgId: OrganizationId, id: PropertyId) => Promise<Property | null>
  list: (orgId: OrganizationId) => Promise<ReadonlyArray<Property>>
  slugExists: (
    orgId: OrganizationId,
    slug: string,
    excludeId?: PropertyId,
  ) => Promise<boolean>
  insert: (orgId: OrganizationId, property: Property) => Promise<void>
  update: (
    orgId: OrganizationId,
    id: PropertyId,
    patch: Readonly<Partial<Property>>,
  ) => Promise<void>
  softDelete: (orgId: OrganizationId, id: PropertyId) => Promise<void>
}>
```

**Key points:**

- Every method takes `organizationId` as the first parameter
- Return types are domain types, never row shapes
- `type` alias, not `interface`

---

## 7. Application port (external service interface)

**Location:** `src/contexts/identity/application/ports/identity.port.ts`
**Purpose:** Port wrapping an external service (better-auth). Use cases depend on the type; the implementation lives in infrastructure.

```ts
import type { Role } from '#/shared/domain/roles'
import type { OrganizationId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'

/** Organization member shape returned by the port. */
export type MemberRecord = Readonly<{
  id: string
  userId: string
  email: string
  name: string
  role: Role
  image: string | null
  createdAt: Date
}>

/** Invitation record shape returned by the port. */
export type InvitationRecord = Readonly<{
  id: string
  email: string
  role: Role
  status: 'pending' | 'accepted' | 'rejected' | 'canceled'
  expiresAt: Date
  createdAt: Date
  organizationId?: OrganizationId
  organizationName?: string
}>

/** Port for identity operations — wraps better-auth API calls. */
export type IdentityPort = Readonly<{
  signUp: (name: string, email: string, password: string) => Promise<string>
  listMembers: (ctx: AuthContext) => Promise<ReadonlyArray<MemberRecord>>
  getMember: (ctx: AuthContext, memberId: string) => Promise<MemberRecord | null>
  createInvitation: (
    ctx: AuthContext,
    email: string,
    role: string,
    propertyIds?: ReadonlyArray<string>,
  ) => Promise<string>
  acceptInvitation: (invitationId: string, headers: Headers) => Promise<void>
  rejectInvitation: (invitationId: string, headers: Headers) => Promise<void>
  listInvitations: (ctx: AuthContext) => Promise<ReadonlyArray<InvitationRecord>>
  listUserInvitations: (headers: Headers) => Promise<ReadonlyArray<InvitationRecord>>
  updateMemberRole: (ctx: AuthContext, memberId: string, role: string) => Promise<void>
  removeMember: (ctx: AuthContext, memberId: string) => Promise<void>
  listUserOrganizations: (headers: Headers) => Promise<ReadonlyArray<OrganizationRecord>>
  setActiveOrganization: (headers: Headers, organizationId: string) => Promise<void>
}>
```

**Key points:**

- Port defines the capability contract; the adapter implements it
- Methods that need auth take `AuthContext`; public methods take `Headers` directly
- Return types are port-level shapes (`MemberRecord`, `InvitationRecord`), not third-party API shapes
- `type` alias, not `interface`

---

## 8. Application DTO

**Location:** `src/contexts/identity/application/dto/invitation.dto.ts`
**Purpose:** Zod schemas for HTTP input. Also reused as form schemas.

```ts
import { z } from 'zod/v4'

export const inviteMemberInputSchema = z.object({
  email: z.email('A valid email address is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager', 'Staff'] as const),
  propertyIds: z.array(z.string().min(1, 'This field is required')).default([]),
})
export type InviteMemberInput = z.infer<typeof inviteMemberInputSchema>

export const updateMemberRoleInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
  role: z.enum(['AccountAdmin', 'PropertyManager', 'Staff'] as const),
})
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleInputSchema>

export const removeMemberInputSchema = z.object({
  memberId: z.string().min(1, 'Member ID is required'),
})
export type RemoveMemberInput = z.infer<typeof removeMemberInputSchema>

export const registerUserInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  email: z.email('A valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  organizationName: z
    .string()
    .min(2, 'Organization name must be at least 2 characters')
    .max(100, 'Organization name must be at most 100 characters'),
})
export type RegisterUserInput = z.infer<typeof registerUserInputSchema>
```

**Key points:**

- Schema and inferred TypeScript type both exported
- Used by the server function AND by the form component
- Validates structural things (types, formats) — business rules live in use cases/domain
- One DTO per major input or output shape
- Multiple related DTOs can share a file when they serve the same flow

---

## 9. Use case (full pattern)

**Location:** `src/contexts/identity/application/use-cases/invite-member.ts`

```ts
import type { IdentityPort } from '../ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { canInviteWithRole } from '../../domain/rules'
import { identityError } from '../../domain/errors'
import { memberInvited } from '../../domain/events'
import type { InviteMemberInput } from '../dto/invitation.dto'

export type InviteMemberOutput = Readonly<{
  success: boolean
}>

type Deps = Readonly<{
  identity: IdentityPort
  events: EventBus
  clock: () => Date
}>

export const inviteMember =
  (deps: Deps) =>
  async (input: InviteMemberInput, ctx: AuthContext): Promise<InviteMemberOutput> => {
    // 1. Authorize — domain rule checks role hierarchy
    const authResult = canInviteWithRole(ctx.role, input.role)
    if (authResult.isErr()) {
      throw identityError(authResult.error.code, authResult.error.message)
    }

    // 3. Persist — delegate to port (better-auth handles the rest)
    const invitationId = await deps.identity.createInvitation(
      ctx,
      input.email,
      input.role,
      input.propertyIds,
    )

    // 4. Emit event
    deps.events.emit(
      memberInvited({
        organizationId: ctx.organizationId,
        email: input.email,
        role: input.role,
        inviterId: ctx.userId,
        invitationId,
        occurredAt: deps.clock(),
      }),
    )

    return { success: true }
  }

export type InviteMember = ReturnType<typeof inviteMember>
```

**Key points:**

- Factory function: `(deps) => async (input, ctx) => Promise<T>`
- Dependencies are explicit — no globals, no imports for DB clients
- `clock` is injected so tests can control timestamps deterministically
- Throws tagged errors
- Steps used from the 7-step pattern: (1) authorize, (3) persist, (4) emit event — only the steps that apply
- Authorization uses domain-specific rules (`canInviteWithRole`) when the check depends on context-specific constraints beyond simple role-to-action mapping
- For simpler authorization, use `can(ctx.role, 'resource.action')` from `shared/domain/permissions` (see section 22)

---

## 10. Drizzle schema

**Location:** `src/shared/db/schema/property.schema.ts`

```ts
import { sql } from 'drizzle-orm'
import { createdAtColumn, updatedAtColumn, deletedAtColumn } from '../columns'
import { pgTable, uuid, varchar, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const properties = pgTable(
  'properties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Note: better-auth owns the `organization` table and uses varchar IDs,
    // so most tables reference it with varchar, not uuid + FK.
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 64 }).notNull(),
    timezone: varchar('timezone', { length: 64 }).notNull(),
    gbpPlaceId: varchar('gbp_place_id', { length: 500 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    deletedAt: deletedAtColumn(),
  },
  (t) => ({
    orgSlugUnique: uniqueIndex('properties_org_slug_unique')
      .on(t.organizationId, t.slug)
      .where(sql`deleted_at IS NULL`),
    orgIdx: index('properties_org_idx').on(t.organizationId),
  }),
)
```

**Key points:**

- Every table has `id`, `organization_id`, `created_at`, `updated_at`; soft-deletable tables add `deleted_at`
- Shared column helpers (`createdAtColumn`, `updatedAtColumn`, `deletedAtColumn`) ensure consistency
- Partial unique index on `(organization_id, slug) WHERE deleted_at IS NULL`
- snake_case columns, camelCase field names — Drizzle handles mapping
- Exception: better-auth tables use camelCase columns

---

## 11. Row ↔ domain mapper

**Location:** `src/contexts/property/infrastructure/mappers/property.mapper.ts`

```ts
import type { properties } from '#/shared/db/schema/property.schema'
import type { Property } from '../../domain/types'
import type { PropertyId } from '#/shared/domain/ids'
import type { OrganizationId } from '#/shared/domain/ids'

type PropertyRow = typeof properties.$inferSelect
type PropertyInsertRow = typeof properties.$inferInsert

export const propertyFromRow = (row: PropertyRow): Property => ({
  id: row.id as PropertyId,
  organizationId: row.organizationId as OrganizationId,
  name: row.name,
  slug: row.slug,
  timezone: row.timezone,
  gbpPlaceId: row.gbpPlaceId,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
})

export const propertyToRow = (property: Property): PropertyInsertRow => ({
  id: property.id,
  organizationId: property.organizationId,
  name: property.name,
  slug: property.slug,
  timezone: property.timezone,
  gbpPlaceId: property.gbpPlaceId,
  createdAt: property.createdAt,
  updatedAt: property.updatedAt,
  deletedAt: property.deletedAt,
})
```

**Key points:**

- Pure functions, no I/O
- The only place in the codebase where both row and domain shapes are known at once
- `$inferSelect` and `$inferInsert` give accurate row types from Drizzle
- Branded IDs are cast at the mapper boundary — the rest of the codebase stays type-safe

---

## 12. Repository implementation

**Location:** `src/contexts/property/infrastructure/repositories/property.repository.ts`

```ts
import { and, eq, not } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { baseWhere } from '#/shared/db/base-where'
import { properties } from '#/shared/db/schema/property.schema'
import type { PropertyRepository } from '../../application/ports/property.repository'
import { propertyFromRow, propertyToRow } from '../mappers/property.mapper'

/** Mutable set-values type for Drizzle .set() — strips readonly from Property fields. */
type SetValues = {
  name?: string
  slug?: string
  timezone?: string
  gbpPlaceId?: string | null
  updatedAt?: Date
  deletedAt?: Date | null
}

export const createPropertyRepository = (db: Database): PropertyRepository => ({
  findById: async (orgId, id) => {
    const rows = await db
      .select()
      .from(properties)
      .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
      .limit(1)
    return rows[0] ? propertyFromRow(rows[0]) : null
  },

  list: async (orgId) => {
    const rows = await db
      .select()
      .from(properties)
      .where(and(...baseWhere(properties, orgId)))
    return rows.map(propertyFromRow)
  },

  slugExists: async (orgId, slug, excludeId) => {
    const conditions = [...baseWhere(properties, orgId), eq(properties.slug, slug)]
    if (excludeId) {
      conditions.push(not(eq(properties.id, excludeId)))
    }

    const rows = await db
      .select({ id: properties.id })
      .from(properties)
      .where(and(...conditions))
      .limit(1)
    return rows.length > 0
  },

  insert: async (orgId, property) => {
    // Tenant guard — the use case constructs the property with ctx.organizationId,
    // but the repo is the last line of defense against cross-tenant writes.
    if (property.organizationId !== orgId) {
      throw new Error('Tenant mismatch on property insert')
    }
    await db.insert(properties).values(propertyToRow(property))
  },

  update: async (orgId, id, patch) => {
    const setValues: SetValues = {}
    if (patch.updatedAt !== undefined) setValues.updatedAt = patch.updatedAt
    if (patch.name !== undefined) setValues.name = patch.name
    if (patch.slug !== undefined) setValues.slug = patch.slug
    if (patch.timezone !== undefined) setValues.timezone = patch.timezone
    if (patch.gbpPlaceId !== undefined) setValues.gbpPlaceId = patch.gbpPlaceId

    await db
      .update(properties)
      .set(setValues)
      .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
  },

  softDelete: async (orgId, id) => {
    const now = new Date()
    await db
      .update(properties)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(...baseWhere(properties, orgId), eq(properties.id, id)))
  },
})
```

**Key points:**

- Factory function returning a record of functions
- Every query filters by `organizationId AND deleted_at IS NULL` via `baseWhere()` helper
- Returns domain types via mapper
- Insert includes a tenant guard — last line of defense against cross-tenant writes
- `SetValues` type strips `readonly` for Drizzle's mutable `.set()`

---

## 13. External service adapter

**Location:** `src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts`
**Purpose:** Wraps better-auth's API behind the `IdentityPort` interface so use cases remain testable with in-memory fakes.

```ts
import type { IdentityPort, MemberRecord } from '../../application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getAuth } from '#/shared/auth/auth'
import { toDomainRole, toBetterAuthRole } from '#/shared/domain/roles'
import { getRequest } from '@tanstack/react-start/server'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
} from './better-auth-schemas'

/** Build request headers that carry the better-auth session cookie. */
function headersFromRequest(): Headers {
  const headers = new Headers()
  const req = getRequest()
  if (req) {
    req.headers.forEach((value: string, key: string) => {
      headers.set(key, value)
    })
  }
  return headers
}

/** Map a raw better-auth member object to our MemberRecord. */
function toMemberRecord(m: {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: { id: string; email: string; name: string; image?: string | null }
}): MemberRecord {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: toDomainRole(m.role),
    image: m.user.image ?? null,
    createdAt: m.createdAt,
  }
}

/** Create the better-auth implementation of IdentityPort. */
export function createAuthIdentityAdapter(): IdentityPort {
  return {
    async signUp(name, email, password): Promise<string> {
      const auth = getAuth()
      const result = await auth.api.signUpEmail({
        body: { name, email, password },
      })
      const data = parseBetterAuthResponse(
        signUpResponseSchema,
        result,
        'registration_failed',
        'Sign-up response did not match expected schema',
      )
      if (!data.user.id) {
        throw new Error('Sign-up failed: no user ID returned')
      }
      return data.user.id
    },

    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listMembers({ headers })
      const data = parseBetterAuthResponse(
        listMembersResponseSchema,
        result,
        'org_setup_failed',
        'listMembers response did not match expected schema',
      )
      return data.members.map(toMemberRecord)
    },

    // ... other methods follow the same pattern — each API call is validated
    // through its corresponding Zod schema before mapping to domain records
  }
}
```

**Key points:**

- Implements the port interface exactly — use cases can't tell if they're talking to better-auth or an in-memory fake
- Maps third-party shapes to domain shapes (`toDomainRole`, `toMemberRecord`)
- Request headers are extracted per-method because better-auth authenticates via cookies, not via context objects
- Factory function receives no external deps — `getAuth()` is called internally (acceptable for adapters that are integration-tested)

---

## 14. BullMQ job handler

**Pattern reference:** The code below is a hypothetical example illustrating the job handler pattern. The only real job handler today is `src/shared/jobs/health-check.job.ts`. The send-invitation-email handler shown here follows the same structure and will be implemented when invitation emails are wired.
**Purpose:** Asynchronous job handler for background processing. Follows the same dependency-injection pattern as use cases.

```ts
import type { Job } from 'bullmq'
import type { Logger } from '#/shared/observability/logger'

export type SendInvitationEmailJobData = Readonly<{
  organizationId: string
  invitationId: string
  email: string
  organizationName: string
  inviteLink: string
}>

export type SendInvitationEmailDeps = Readonly<{
  logger: Logger
  sendEmail: (params: { to: string; subject: string; body: string }) => Promise<void>
}>

export const JOB_NAME = 'send-invitation-email' as const

export const createSendInvitationEmailHandler =
  (deps: SendInvitationEmailDeps) =>
  async (job: Job<SendInvitationEmailJobData>): Promise<void> => {
    const { email, organizationName, inviteLink } = job.data
    deps.logger.info({ jobId: job.id, email }, 'sending invitation email')

    await deps.sendEmail({
      to: email,
      subject: `You're invited to join ${organizationName}`,
      body: `Click here to accept: ${inviteLink}`,
    })

    deps.logger.info({ jobId: job.id, email }, 'invitation email sent')
  }
```

**Key points:**

- Factory function returning a BullMQ-compatible handler
- `JOB_NAME` exported as a `const` literal
- Idempotent: sending the same invitation email twice is harmless
- Dependencies are injected — `sendEmail` can be faked in tests

---

## 15. Event handler (cross-context subscriber)

**Pattern reference:** The code below is a hypothetical example illustrating the cross-context event handler pattern. No event handler files exist yet (event handlers will be created as cross-context reactions are needed). The pattern shown here is the target architecture.
**Purpose:** Lives in the **receiving** context (`staff`), not the emitting context (`identity`). Subscribes to events from another context and performs local side effects.

```ts
import type { MemberRemoved } from '#/contexts/identity/domain/events'
import type { StaffAssignmentRepository } from '#/contexts/staff/application/ports/staff-assignment.repository'
import type { Logger } from '#/shared/observability/logger'

export type HandleMemberRemovedDeps = Readonly<{
  staffRepo: StaffAssignmentRepository
  logger: Logger
}>

export const handleMemberRemoved =
  (deps: HandleMemberRemovedDeps) =>
  async (event: MemberRemoved): Promise<void> => {
    try {
      // When a member is removed from an org, soft-delete all their staff assignments
      await deps.staffRepo.softDeleteByUser(event.organizationId, event.userId)
    } catch (err) {
      // Handlers log via the shared logger, never throw — one bad event
      // shouldn't bring down the bus
      deps.logger.error(
        { err, event },
        'failed to clean up staff assignments for removed member',
      )
    }
  }
```

**Key points:**

- Lives in `contexts/staff/`, not `contexts/identity/`
- Imports the event type from the identity context; never imports use cases or repositories from identity
- Failures are logged via the shared logger, not `console`
- Registered in `composition.ts` with `eventBus.on('member.removed', handleMemberRemoved(deps))`

---

## 16. Server function (authenticated)

**Location:** `src/contexts/property/server/properties.ts`

```ts
import { createServerFn } from '@tanstack/react-start'
import { match } from 'ts-pattern'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError } from '#/shared/auth/server-errors'
import { getContainer } from '#/composition'
import { createPropertyInputSchema } from '../application/dto/create-property.dto'
import { isPropertyError } from '../domain/errors'
import type { PropertyErrorCode } from '../domain/errors'

export const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_name', 'invalid_timezone', () => 400)
    .exhaustive()

export const createProperty = createServerFn({ method: 'POST' })
  .inputValidator(createPropertyInputSchema)
  .handler(async ({ data }) => {
    const headers = headersFromContext()
    const ctx = await resolveTenantContext(headers)

    try {
      const { useCases } = getContainer()
      const property = await useCases.createProperty(data, ctx)
      return { property }
    } catch (e) {
      if (isPropertyError(e))
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
      throw e
    }
  })
```

**Key points:**

- Thin: resolve auth → validate input → call use case → translate errors → return
- Auth/tenant resolution is explicit at the top of the handler: `headersFromContext()` → `resolveTenantContext()`
- `resolveTenantContext` extracts the session from request headers, resolves the active organization, and returns a typed `AuthContext`
- `.inputValidator()` uses the DTO schema from the application layer
- `handler` calls the use case from `getContainer().useCases`
- `ts-pattern` with `.exhaustive()` ensures new error codes force a compiler error
- `throwContextError` is the shared helper for throwing tagged errors with status codes
- `resolveTenantContext` throws `AuthError` via the same helper — auth failures (no session, no active org, not a member) are `Error` instances with `.name`, `.code`, `.status` just like domain errors
- Non-context errors re-thrown; TanStack Start's error boundary handles them
- **Throws Error objects (not Response)** — TanStack Start serializes Errors via seroval and re-throws them on the client, so mutations fail and `mutation.error` is populated

---

## 17. Server function (public)

**Location:** `src/contexts/identity/server/organizations.ts`

```ts
import { createServerFn } from '@tanstack/react-start'
import { headersFromContext } from '#/shared/auth/headers'
import { getAuth } from '#/shared/auth/auth'
import { toDomainRole } from '#/shared/domain/roles'

export const listUserInvitations = createServerFn({ method: 'GET' }).handler(async () => {
  const headers = headersFromContext()
  const auth = getAuth()

  const result = await auth.api.listUserInvitations({ headers })

  type RawInvitation = {
    id: string
    email: string
    role: string
    status: string
    expiresAt: Date
    createdAt: Date
    organizationId?: string
    organization?: { name: string }
  }

  const rawInvitations = (Array.isArray(result) ? result : []) as RawInvitation[]
  const invitations = rawInvitations.map((inv) => ({
    id: inv.id,
    organizationId: inv.organizationId,
    organizationName: inv.organization?.name ?? 'Unknown Organization',
    email: inv.email,
    role: toDomainRole(inv.role),
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
  }))

  return { invitations }
})
```

**Key points:**

- Lives in the same file as authenticated server functions but does NOT call `resolveTenantContext`
- No auth resolution beyond what the auth library does internally via session cookies
- Maps third-party response shapes to domain-friendly shapes using `toDomainRole`
- Public functions still validate inputs and shape responses — they just skip tenant context resolution

---

## 18. In-memory port fake (for tests)

**Location:** `src/shared/testing/in-memory-identity-port.ts`

```ts
import type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from '#/contexts/identity/application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Role } from '#/shared/domain/roles'

export type InMemoryIdentityPort = IdentityPort & {
  /** Seed members for testing. */
  seedMembers: (members: ReadonlyArray<MemberRecord>) => void
  /** Seed invitations for testing. */
  seedInvitations: (invitations: ReadonlyArray<InvitationRecord>) => void
  /** Seed organizations for testing. */
  seedOrganizations: (orgs: ReadonlyArray<OrganizationRecord>) => void
  /** Access all stored members. */
  readonly allMembers: ReadonlyArray<MemberRecord>
  /** Access all stored invitations. */
  readonly allInvitations: ReadonlyArray<InvitationRecord>
}

export function createInMemoryIdentityPort(): InMemoryIdentityPort {
  const members = new Map<string, MemberRecord>()
  const invitations = new Map<string, InvitationRecord>()
  const organizations = new Map<string, OrganizationRecord>()

  return {
    async signUp(_name, _email, _password): Promise<string> {
      const id = `user-${members.size + 1}`
      return id
    },

    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      return [...members.values()]
    },

    async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      return members.get(memberId) ?? null
    },

    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
      _propertyIds?: ReadonlyArray<string>,
    ): Promise<string> {
      const id = `inv-${invitations.size + 1}`
      invitations.set(id, {
        id,
        email,
        role: role as Role,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })
      return id
    },

    async updateMemberRole(
      _ctx: AuthContext,
      memberId: string,
      role: string,
    ): Promise<void> {
      const member = members.get(memberId)
      if (member) {
        members.set(memberId, { ...member, role: role as Role })
      }
    },

    async removeMember(_ctx: AuthContext, memberId: string): Promise<void> {
      members.delete(memberId)
    },

    // ... other methods (acceptInvitation, rejectInvitation, etc.)

    // ── Test-only helpers ─────────────────────────────────────────────

    seedMembers(ms: ReadonlyArray<MemberRecord>): void {
      for (const m of ms) members.set(m.id, m)
    },

    seedInvitations(invs: ReadonlyArray<InvitationRecord>): void {
      for (const inv of invs) invitations.set(inv.id, inv)
    },

    seedOrganizations(orgs: ReadonlyArray<OrganizationRecord>): void {
      for (const org of orgs) organizations.set(org.id, org)
    },

    get allMembers(): ReadonlyArray<MemberRecord> {
      return [...members.values()]
    },

    get allInvitations(): ReadonlyArray<InvitationRecord> {
      return [...invitations.values()]
    },
  }
}
```

**Key points:**

- Implements the port interface exactly — use cases can't tell the difference
- Extra test-only methods (`seedMembers`, `allMembers`, etc.) typed separately via intersection
- State stored in Maps for O(1) lookups by ID

---

## 19. Domain test

**Location:** `src/contexts/property/domain/rules.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import {
  normalizeSlug,
  validateSlug,
  validatePropertyName,
  validateTimezone,
} from './rules'

describe('normalizeSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(normalizeSlug('Grand Hotel')).toBe('grand-hotel')
  })

  it('strips special characters', () => {
    expect(normalizeSlug("O'Brien's Inn!")).toBe('obriens-inn')
  })

  it('caps at 64 characters', () => {
    expect(normalizeSlug('a'.repeat(100)).length).toBe(64)
  })
})

describe('validateSlug', () => {
  it('accepts valid slugs', () => {
    expect(validateSlug('main-lobby').isOk()).toBe(true)
  })

  it('rejects slugs with uppercase', () => {
    const result = validateSlug('Invalid')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_slug')
  })
})

describe('validatePropertyName', () => {
  it('accepts valid names', () => {
    const result = validatePropertyName('Grand Hotel')
    expect(result.isOk()).toBe(true)
  })

  it('rejects empty name', () => {
    const result = validatePropertyName('')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_name')
  })

  it('rejects name over 100 characters', () => {
    const result = validatePropertyName('a'.repeat(101))
    expect(result.isErr()).toBe(true)
  })
})

describe('validateTimezone', () => {
  it('accepts valid IANA timezones', () => {
    expect(validateTimezone('America/New_York').isOk()).toBe(true)
    expect(validateTimezone('UTC').isOk()).toBe(true)
  })

  it('rejects unknown timezones', () => {
    const result = validateTimezone('Invalid/Zone')
    expect(result.isErr()).toBe(true)
    if (result.isErr()) expect(result.error.code).toBe('invalid_timezone')
  })
})
```

**Key points:**

- No `beforeEach`, no mocks
- Pure functions tested in isolation — runs in milliseconds
- General authorization is tested in use case tests using `can()` from `shared/domain/permissions`
- Some contexts keep domain-level authorization predicates (e.g., `canInviteWithRole` in `identity/domain/rules.test.ts`) that are tested here as pure functions

---

## 20. Use case test

**Location:** `src/contexts/identity/application/use-cases/invite-member.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { inviteMember } from './invite-member'
import { createInMemoryIdentityPort } from '#/shared/testing/in-memory-identity-port'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import { isIdentityError } from '../../domain/errors'

const FIXED_TIME = new Date('2026-04-10T12:00:00Z')

const setup = () => {
  const identity = createInMemoryIdentityPort()
  const events = createCapturingEventBus()
  const useCase = inviteMember({ identity, events, clock: () => FIXED_TIME })
  return { useCase, identity, events }
}

describe('inviteMember', () => {
  it('allows PropertyManager to invite a Staff member', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    const result = await useCase(
      { email: 'new@test.com', role: 'Staff', propertyIds: [] },
      ctx,
    )

    expect(result.success).toBe(true)
    expect(events.capturedEvents).toHaveLength(1)
    expect(events.capturedEvents[0]._tag).toBe('member.invited')
  })

  it('allows AccountAdmin to invite with any role', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'AccountAdmin' })

    const result = await useCase(
      { email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] },
      ctx,
    )
    expect(result.success).toBe(true)
  })

  it('rejects Staff from inviting anyone', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'Staff' })

    await expect(
      useCase({ email: 'any@test.com', role: 'Staff', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('rejects PropertyManager inviting AccountAdmin', async () => {
    const { useCase } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await expect(
      useCase({ email: 'admin@test.com', role: 'AccountAdmin', propertyIds: [] }, ctx),
    ).rejects.toSatisfy((e) => isIdentityError(e) && e.code === 'forbidden')
  })

  it('emits member.invited event with correct data', async () => {
    const { useCase, events } = setup()
    const ctx = buildTestAuthContext({ role: 'PropertyManager' })

    await useCase({ email: 'new@test.com', role: 'Staff', propertyIds: [] }, ctx)

    const emitted = events.capturedByTag('member.invited')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].email).toBe('new@test.com')
    expect(emitted[0].role).toBe('Staff')
    expect(emitted[0].organizationId).toBe(ctx.organizationId)
  })
})
```

**Key points:**

- `setup()` helper builds fresh in-memory port fakes for each test
- `clock` is fixed for deterministic timestamps
- No database, no HTTP, no framework
- Tests happy path AND every error path

---

## 21. Repository integration test

**Location:** `src/contexts/property/infrastructure/repositories/property.repository.test.ts`

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createPropertyRepository } from './property.repository'
import { getDb } from '#/shared/db'
import { buildTestProperty } from '#/shared/testing/fixtures'
import { organizationId } from '#/shared/domain/ids'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'

const ORG_A = organizationId('org-prop-test-1111-111111111111')
const ORG_B = organizationId('org-prop-test-2222-222222222222')

let pool: Pool

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 5 })
})

afterAll(async () => {
  await pool.end()
})

beforeEach(async () => {
  await truncateProperties(pool)
  await seedOrg(pool, [ORG_A, ORG_B])
})

describe('propertyRepository (integration)', () => {
  describe('tenant isolation', () => {
    it('does not return properties from other organizations', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const propertyA = buildTestProperty({ organizationId: ORG_A })
      const propertyB = buildTestProperty({ organizationId: ORG_B })

      await repo.insert(ORG_A, propertyA)
      await repo.insert(ORG_B, propertyB)

      const fromA = await repo.findById(ORG_A, propertyA.id as never)
      expect(fromA?.id).toBe(propertyA.id)

      const crossTenant = await repo.findById(ORG_A, propertyB.id as never)
      expect(crossTenant).toBeNull()
    })

    it('slugExists does not leak across tenants', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const propertyA = buildTestProperty({
        organizationId: ORG_A,
        slug: 'grand-hotel',
      })

      await repo.insert(ORG_A, propertyA)

      expect(await repo.slugExists(ORG_B, 'grand-hotel')).toBe(false)
      expect(await repo.slugExists(ORG_A, 'grand-hotel')).toBe(true)
    })
  })

  describe('softDelete', () => {
    it('allows a new property with the same slug after soft-delete', async () => {
      const db = getDb()
      const repo = createPropertyRepository(db)
      const original = buildTestProperty({
        organizationId: ORG_A,
        slug: 'grand-hotel',
      })

      await repo.insert(ORG_A, original)
      await repo.softDelete(ORG_A, original.id as never)

      const replacement = buildTestProperty({
        organizationId: ORG_A,
        slug: 'grand-hotel',
      })
      await expect(repo.insert(ORG_A, replacement)).resolves.not.toThrow()
    })
  })
})
```

**Key points:**

- Uses a real Postgres (Neon branch or Docker) via direct `Pool`
- Tenant isolation test is non-negotiable
- Tests real DB behaviors: unique constraints, cascading deletes, soft-delete semantics
- Truncates and seeds test data in `beforeEach` for isolation

---

## 22. Thin use case (auth check + delegation)

**Location:** `src/contexts/identity/application/use-cases/remove-member.ts`
**Purpose:** Use case whose only job is an authorization check followed by delegation. Common in wrapper contexts (identity, etc.) where the third-party library owns the domain.

```ts
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
// Authorization is checked inside the use case using can() from shared/domain/permissions.
// Some thin use cases also import domain rules (e.g., canInviteWithRole from domain/rules)
// for context-specific authorization predicates.
import { identityError } from '#/contexts/identity/domain/errors'
import { can } from '#/shared/domain/permissions'

export type RemoveMemberDeps = Readonly<{
  identity: IdentityPort
}>

export type RemoveMemberInput = Readonly<{
  memberId: string
}>

export const removeMember =
  (deps: RemoveMemberDeps) =>
  async (input: RemoveMemberInput, ctx: AuthContext): Promise<void> => {
    // Step 1: Authorize — domain permission check
    if (!can(ctx.role, 'member.delete')) {
      throw identityError('forbidden', 'Insufficient role to remove members')
    }

    // Step 5: Persist (via the port — better-auth handles the actual DB work)
    await deps.identity.removeMember(ctx.organizationId, input.memberId)
  }

export type RemoveMember = ReturnType<typeof removeMember>
```

**Key points:**

- Same factory shape as a full use case
- Uses only steps (1) and (5) of the 7-step pattern — no validation, no construction, no event
- The use case performs its own authorization via `can(ctx.role, 'resource.action')` — the server function may also check `hasPermission()` as defense-in-depth
- Don't add fake steps for symmetry
- This pattern is common in wrapper contexts where a third-party service owns the domain; thick contexts (`property`, `team`) mostly use the full pattern from #9

---

## 23. Anonymous use case (member registration — no auth, no org)

**Location:** `src/contexts/identity/application/use-cases/register-user.ts`
**Purpose:** Registers a user account without creating an organization. Used by invited staff/managers joining an existing org via `/join`. This is the "join" path — distinct from `registerUserAndOrg` which is the "signup" path.

```ts
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import { identityError } from '#/contexts/identity/domain/errors'

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

## 24. Server function calling a port directly (pure delegation)

**Location:** `src/contexts/identity/server/organizations.ts`
**Purpose:** Server function for an operation with no business logic of its own — pure delegation to a third-party API. No use case at all.

```ts
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getAuth } from '#/shared/auth/auth'
import { throwContextError } from '#/shared/auth/server-errors'

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
      throwContextError(
        'AuthError',
        { code: 'invalid_credentials', message: 'Invalid email or password' },
        401,
      )
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

## 25. Form component (TanStack Form + shadcn)

**Location:** `src/components/features/identity/InviteMemberForm.tsx`
**Purpose:** Feature-specific form component. Uses shadcn's Field primitives wired with TanStack Form and the DTO's Zod schema. **Receives the mutation as a prop** — never imports server functions directly.

```tsx
import { useForm } from '@tanstack/react-form'
import { Field, FieldGroup, FieldLabel, FieldError } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { SubmitButton } from '#/components/forms/SubmitButton'
import { FormErrorBanner } from '#/components/forms/FormErrorBanner'
import { inviteMemberInputSchema } from '#/contexts/identity/application/dto/invitation.dto'
import type { Role } from '#/shared/domain/roles'
import { z } from 'zod/v4'

// Form-specific schema: derives from DTO to inherit validation rules
const inviteFormSchema = inviteMemberInputSchema.extend({
  propertyIds: z.array(z.string().min(1)),
})

type Props = Readonly<{
  mutation: MutationLike
  allowedRoles: ReadonlyArray<Role>
  properties: ReadonlyArray<{ id: string; name: string }>
}>

export function InviteMemberForm({ mutation, allowedRoles, properties }: Props) {
  const form = useForm({
    defaultValues: {
      email: '',
      role: (allowedRoles[0] ?? 'Staff') as Role,
      propertyIds: [] as string[],
    },
    validators: {
      onSubmit: inviteFormSchema,
    },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value)
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="flex flex-col gap-4"
    >
      <FormErrorBanner error={mutation.error} />

      <FieldGroup>
        <form.Field name="email">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor="invite-email">Email address</FieldLabel>
                <Input
                  id="invite-email"
                  name={field.name}
                  type="email"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={isInvalid}
                  placeholder="colleague@example.com"
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="role">
          {(field) => {
            const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel>Role</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value as Role)}
                >
                  <SelectTrigger aria-invalid={isInvalid}>
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {allowedRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {roleLabel(r)}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>
      </FieldGroup>

      <SubmitButton mutation={mutation} form={form}>
        Send Invitation
      </SubmitButton>
    </form>
  )
}

function roleLabel(role: Role): string {
  switch (role) {
    case 'AccountAdmin':
      return 'Account Admin'
    case 'PropertyManager':
      return 'Property Manager'
    case 'Staff':
      return 'Staff'
  }
}
```

**Key points:**

- **Receives `mutation` as a prop** — the route defines `useMutation({ mutationFn: inviteMember })` and passes it. Components never import server functions (dependency rules).
- Uses shadcn's `Field`, `FieldLabel`, `FieldError`, `FieldGroup` primitives for consistent visual structure
- Uses TanStack Form's `useForm`, `form.Field`, `form.handleSubmit` for state management
- The form schema is **derived from the DTO schema** via `.extend()` — single source of truth. See section 30 for form schema derivation patterns.
- The `isInvalid` check (`isTouched && !isValid`) gates error display so errors only show after the user has interacted with the field
- `FormErrorBanner` displays top-level mutation errors
- `SubmitButton` reads both the mutation state (for loading/disabled) and the form state (for validation)
- One form component per feature; lives in `components/features/<ctx>/`

**Route wiring example:**

```tsx
// routes/.../settings/members.tsx
import { useMutation } from '@tanstack/react-query'
import { inviteMember } from '#/contexts/identity/server/organizations'
import { InviteMemberForm } from '#/components/features/identity/InviteMemberForm'

function MembersPage() {
  const mutation = useMutation({
    mutationFn: (input) => inviteMember({ data: input }),
  })

  return (
    <InviteMemberForm
      mutation={mutation}
      allowedRoles={['PropertyManager', 'Staff']}
      properties={orgProperties}
    />
  )
}
```

---

## 26. Shared form building block (SubmitButton)

**Location:** `src/components/forms/SubmitButton.tsx`
**Purpose:** Submit button that integrates mutation state and form validation state. Used in every form in the app.

```tsx
import { Button } from '#/components/ui/button'
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

## 27. Shared form building block (FormErrorBanner)

**Location:** `src/components/forms/FormErrorBanner.tsx`
**Purpose:** Displays top-level mutation errors in a consistent way. Translates tagged error responses to user-friendly messages.

```tsx
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
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

## 28. Update use case (partial validation)

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

## 29. Soft-delete use case (minimal deps)

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

## 30. Form schema rules — derive from DTOs

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

1. **Check existing code first** — `contexts/identity/`, `contexts/property/`, `contexts/team/`, and `contexts/staff/` are the canonical live references.
2. **Check `conventions.md`** for the rules and rationale, especially "When to skip layers" and the forms section.
3. **If still unclear, decide deliberately and add a new example to this document** before writing the code.
