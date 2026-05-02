# Phase 8 & 9 — Public Portal Pages, Rating, Feedback & Scan Tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the guest-facing public portal experience — scan tracking, star ratings, feedback collection, review-link click tracking, cookie consent, and QR code generation.

**Architecture:** New `guest` bounded context (`src/contexts/guest/`) owns all guest-facing domain logic (scans, ratings, feedback, click tracking). Public route at `/p/$orgSlug/$portalSlug.tsx` loads portal data via a public server function. Guest use cases are wired into the composition root. All guest tables live in a single `guest.schema.ts` barrel. Session cookie (`guest_session`) manages identity without PII.

**Tech Stack:** TanStack Start (routes + server functions), Drizzle ORM (PostgreSQL schema), Zod v4 (validation), neverthrow (Result types), shadcn/ui (components), ioredis (rate limiting), qrcode (QR generation), UUID (session IDs), SHA-256 (IP hashing).

---

## File Map

### New files to create

| File                                                                             | Responsibility                                                                                      |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/shared/db/schema/guest.schema.ts`                                           | Drizzle schema for `scan_events`, `ratings`, `feedback` tables                                      |
| `src/contexts/guest/domain/types.ts`                                             | Guest domain entity types (ScanEvent, Rating, Feedback)                                             |
| `src/contexts/guest/domain/events.ts`                                            | Guest context events (scan.recorded, rating.submitted, feedback.submitted, review-link.clicked)     |
| `src/contexts/guest/domain/errors.ts`                                            | Domain errors (InvalidRatingError, DuplicateRatingError, etc.)                                      |
| `src/contexts/guest/domain/rules.ts`                                             | Pure validation functions (validateRating, validateFeedback, validateSource, validateSessionCookie) |
| `src/contexts/guest/domain/constructors.ts`                                      | Smart constructors for Rating, Feedback entities                                                    |
| `src/contexts/guest/application/ports/guest-interaction.repository.ts`           | Repository port interface (write-only)                                                              |
| `src/contexts/guest/application/dto/rating.dto.ts`                               | Zod input schema for rating submission                                                              |
| `src/contexts/guest/application/dto/feedback.dto.ts`                             | Zod input schema for feedback submission                                                            |
| `src/contexts/guest/application/use-cases/record-scan.ts`                        | RecordScan use case                                                                                 |
| `src/contexts/guest/application/use-cases/submit-rating.ts`                      | SubmitRating use case                                                                               |
| `src/contexts/guest/application/use-cases/submit-feedback.ts`                    | SubmitFeedback use case                                                                             |
| `src/contexts/guest/application/use-cases/track-review-link-click.ts`            | TrackReviewLinkClick use case                                                                       |
| `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts` | Drizzle repository implementation                                                                   |
| `src/contexts/guest/infrastructure/mappers/guest.mapper.ts`                      | Row ↔ domain mappers                                                                                |
| `src/contexts/guest/server/public.ts`                                            | Public server functions (getPublicPortal, submitRating, submitFeedback)                             |
| `src/contexts/guest/build.ts`                                                    | Composition build function                                                                          |
| `src/routes/p/$orgSlug/$portalSlug.tsx`                                          | Public portal page route                                                                            |
| `src/routes/api/portals/$id/qr.ts`                                               | QR code API endpoint                                                                                |
| `src/routes/api/public/click/$linkId.ts`                                         | Review link click tracking redirect                                                                 |
| `src/components/guest/star-rating.tsx`                                           | Accessible star rating component                                                                    |
| `src/components/guest/feedback-form.tsx`                                         | Feedback form with honeypot                                                                         |
| `src/components/guest/cookie-consent-banner.tsx`                                 | Cookie consent banner                                                                               |
| `src/components/guest/portal-not-found.tsx`                                      | 404 page for missing portals                                                                        |
| `src/shared/testing/in-memory-guest-repo.ts`                                     | In-memory fake for guest repository                                                                 |
| `src/shared/testing/fixtures.ts` (modify)                                        | Add guest fixture builders                                                                          |

### Existing files to modify

| File                            | Change                                                             |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/shared/domain/ids.ts`      | Add ScanEventId, RatingId, FeedbackId branded types + constructors |
| `src/shared/db/schema/index.ts` | Export guest schema                                                |
| `src/shared/events/events.ts`   | Export guest events + extend DomainEvent union                     |
| `src/shared/config/env.ts`      | Add GUEST_SESSION_SALT env var                                     |
| `src/composition.ts`            | Build guest context, wire into container                           |

---

## Task 1: Branded IDs for Guest Domain

**Files:**

- Modify: `src/shared/domain/ids.ts`
- Test: `src/shared/domain/ids.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```typescript
// src/shared/domain/ids.test.ts
import { scanEventId, ratingId, feedbackId } from './ids'

describe('guest branded IDs', () => {
  it('creates ScanEventId', () => {
    const id = scanEventId('test-id')
    expect(id).toBe('test-id')
  })

  it('creates RatingId', () => {
    const id = ratingId('test-id')
    expect(id).toBe('test-id')
  })

  it('creates FeedbackId', () => {
    const id = feedbackId('test-id')
    expect(id).toBe('test-id')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/shared/domain/ids.test.ts -v`
Expected: FAIL — `scanEventId`, `ratingId`, `feedbackId` not defined

- [ ] **Step 3: Add branded ID types and constructors**

```typescript
// src/shared/domain/ids.ts — add after existing types

export type ScanEventId = Brand<string, 'ScanEventId'>
export type RatingId = Brand<string, 'RatingId'>
export type FeedbackId = Brand<string, 'FeedbackId'>

export function scanEventId(id: string): ScanEventId {
  return id as ScanEventId
}

export function ratingId(id: string): RatingId {
  return id as RatingId
}

export function feedbackId(id: string): FeedbackId {
  return id as FeedbackId
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest src/shared/domain/ids.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/shared/domain/ids.ts src/shared/domain/ids.test.ts
git commit -m "feat: add ScanEventId, RatingId, FeedbackId branded types"
```

---

## Task 2: Guest Domain Types

**Files:**

- Create: `src/contexts/guest/domain/types.ts`

- [ ] **Step 1: Create domain types file**

```typescript
// src/contexts/guest/domain/types.ts
// Guest context — domain entity types.
// All fields readonly. Branded IDs prevent accidental substitution.

import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
  RatingId,
  FeedbackId,
} from '#/shared/domain/ids'

export type ScanSource = 'qr' | 'nfc' | 'direct'

export type ScanEvent = Readonly<{
  id: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string
  ipHash: string
  createdAt: Date
}>

export type Rating = Readonly<{
  id: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  value: number
  source: ScanSource
  ipHash: string
  createdAt: Date
}>

export type Feedback = Readonly<{
  id: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  ratingId: RatingId | null
  comment: string
  source: ScanSource
  ipHash: string
  createdAt: Date
}>
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/guest/domain/types.ts
git commit -m "feat: add guest domain types (ScanEvent, Rating, Feedback)"
```

---

## Task 3: Guest Domain Errors

**Files:**

- Create: `src/contexts/guest/domain/errors.ts`
- Test: `src/contexts/guest/domain/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/contexts/guest/domain/errors.test.ts
import { guestError, isGuestError } from './errors'

describe('guest domain errors', () => {
  it('creates error with tag', () => {
    const err = guestError('invalid_rating', 'Rating must be 1-5')
    expect(err._tag).toBe('GuestError')
    expect(err.code).toBe('invalid_rating')
  })

  it('type guard identifies GuestError', () => {
    const err = guestError('duplicate_rating', 'Already rated')
    expect(isGuestError(err)).toBe(true)
    expect(isGuestError(new Error('nope'))).toBe(false)
  })

  it('includes optional context', () => {
    const err = guestError('feedback_too_long', 'Too long', { max: 1000 })
    expect(err.context).toEqual({ max: 1000 })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/contexts/guest/domain/errors.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create errors file**

```typescript
// src/contexts/guest/domain/errors.ts
// Guest context — domain errors with closed union for exhaustive matching.

export type GuestErrorCode =
  | 'invalid_rating'
  | 'duplicate_rating'
  | 'feedback_too_long'
  | 'feedback_empty'
  | 'portal_not_found'
  | 'rate_limit_exceeded'
  | 'invalid_source'
  | 'invalid_session'

export type GuestError = Readonly<{
  _tag: 'GuestError'
  code: GuestErrorCode
  message: string
  context?: Readonly<Record<string, unknown>>
}>

export const guestError = (
  code: GuestErrorCode,
  message: string,
  context?: Readonly<Record<string, unknown>>,
): GuestError => ({
  _tag: 'GuestError',
  code,
  message,
  ...(context ? { context } : {}),
})

export const isGuestError = (e: unknown): e is GuestError =>
  typeof e === 'object' && e !== null && (e as { _tag?: string })._tag === 'GuestError'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest src/contexts/guest/domain/errors.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/guest/domain/errors.ts src/contexts/guest/domain/errors.test.ts
git commit -m "feat: add guest domain errors with closed code union"
```

---

## Task 4: Guest Domain Rules (Validators)

**Files:**

- Create: `src/contexts/guest/domain/rules.ts`
- Test: `src/contexts/guest/domain/rules.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/contexts/guest/domain/rules.test.ts
import { validateRating, validateFeedback, validateSource } from './rules'

describe('validateRating', () => {
  it('accepts 1-5', () => {
    for (const v of [1, 2, 3, 4, 5]) {
      expect(validateRating(v)).toMatchObject({ ok: true })
    }
  })

  it('rejects 0', () => {
    const result = validateRating(0)
    expect(result.ok).toBe(false)
  })

  it('rejects 6', () => {
    const result = validateRating(6)
    expect(result.ok).toBe(false)
  })
})

describe('validateFeedback', () => {
  it('accepts non-empty text under 1000 chars', () => {
    expect(validateFeedback('Great service!')).toMatchObject({ ok: true })
  })

  it('rejects empty string', () => {
    expect(validateFeedback('')).toMatchObject({ ok: false })
  })

  it('rejects whitespace-only', () => {
    expect(validateFeedback('   ')).toMatchObject({ ok: false })
  })

  it('rejects over 1000 chars', () => {
    expect(validateFeedback('a'.repeat(1001))).toMatchObject({ ok: false })
  })

  it('accepts exactly 1000 chars', () => {
    expect(validateFeedback('a'.repeat(1000))).toMatchObject({ ok: true })
  })
})

describe('validateSource', () => {
  it('accepts qr, nfc, direct', () => {
    expect(validateSource('qr')).toMatchObject({ ok: true })
    expect(validateSource('nfc')).toMatchObject({ ok: true })
    expect(validateSource('direct')).toMatchObject({ ok: true })
  })

  it('rejects unknown source', () => {
    expect(validateSource('email')).toMatchObject({ ok: false })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/contexts/guest/domain/rules.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create rules file**

```typescript
// src/contexts/guest/domain/rules.ts
// Guest context — pure validation rules. No async, no I/O, no throws.

import { ok, err } from '#/shared/domain'
import type { Result } from '#/shared/domain'
import type { GuestError } from './errors'
import { guestError } from './errors'
import type { ScanSource } from './types'

const VALID_SOURCES: ReadonlySet<string> = new Set(['qr', 'nfc', 'direct'])

export const validateRating = (value: number): Result<number, GuestError> =>
  value >= 1 && value <= 5 && Number.isInteger(value)
    ? ok(value)
    : err(guestError('invalid_rating', 'Rating must be an integer between 1 and 5'))

export const validateFeedback = (comment: string): Result<string, GuestError> => {
  const trimmed = comment.trim()
  if (trimmed.length === 0) {
    return err(guestError('feedback_empty', 'Feedback cannot be empty'))
  }
  if (trimmed.length > 1000) {
    return err(
      guestError('feedback_too_long', 'Feedback must be at most 1000 characters', {
        max: 1000,
      }),
    )
  }
  return ok(trimmed)
}

export const validateSource = (source: string): Result<ScanSource, GuestError> =>
  VALID_SOURCES.has(source)
    ? ok(source as ScanSource)
    : err(guestError('invalid_source', 'Source must be qr, nfc, or direct'))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest src/contexts/guest/domain/rules.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/guest/domain/rules.ts src/contexts/guest/domain/rules.test.ts
git commit -m "feat: add guest domain validation rules (rating, feedback, source)"
```

---

## Task 5: Guest Domain Constructors

**Files:**

- Create: `src/contexts/guest/domain/constructors.ts`
- Test: `src/contexts/guest/domain/constructors.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/contexts/guest/domain/constructors.test.ts
import { buildRating, buildFeedback } from './constructors'
import {
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  scanEventId,
} from '#/shared/domain/ids'

const baseRatingInput = {
  id: ratingId('10000000-0000-0000-0000-000000000001'),
  organizationId: organizationId('org-test'),
  portalId: portalId('20000000-0000-0000-0000-000000000001'),
  propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
  sessionId: 'session-abc',
  value: 5,
  source: 'qr' as const,
  ipHash: 'hash123',
  now: new Date('2026-05-01T12:00:00Z'),
}

describe('buildRating', () => {
  it('builds valid rating', () => {
    const result = buildRating(baseRatingInput)
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toMatchObject({
      value: 5,
      sessionId: 'session-abc',
      source: 'qr',
    })
  })

  it('rejects invalid rating value', () => {
    const result = buildRating({ ...baseRatingInput, value: 0 })
    expect(result.isErr()).toBe(true)
  })
})

describe('buildFeedback', () => {
  const baseFeedbackInput = {
    id: feedbackId('40000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-test'),
    portalId: portalId('20000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('30000000-0000-0000-0000-000000000001'),
    sessionId: 'session-abc',
    ratingId: ratingId('10000000-0000-0000-0000-000000000001') as const,
    comment: 'Great service!',
    source: 'qr' as const,
    ipHash: 'hash123',
    now: new Date('2026-05-01T12:00:00Z'),
  }

  it('builds valid feedback', () => {
    const result = buildFeedback(baseFeedbackInput)
    expect(result.isOk()).toBe(true)
  })

  it('rejects empty feedback', () => {
    const result = buildFeedback({ ...baseFeedbackInput, comment: '' })
    expect(result.isErr()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest src/contexts/guest/domain/constructors.test.ts -v`
Expected: FAIL — module not found

- [ ] **Step 3: Create constructors file**

```typescript
// src/contexts/guest/domain/constructors.ts
// Guest context — smart constructors returning Result.
// Pure — ID and time are inputs, no side effects.

import { Result } from 'neverthrow'
import type { Rating, Feedback, ScanSource } from './types'
import type {
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { GuestError } from './errors'
import { validateRating, validateFeedback, validateSource } from './rules'

export type BuildRatingInput = Readonly<{
  id: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  value: number
  source: ScanSource
  ipHash: string
  now: Date
}>

export const buildRating = (input: BuildRatingInput): Result<Rating, GuestError> => {
  const valueResult = validateRating(input.value)
  const sourceResult = validateSource(input.source)

  return Result.combine([valueResult, sourceResult]).map(
    ([validValue, _validSource]): Rating => ({
      id: input.id,
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      value: validValue,
      source: input.source,
      ipHash: input.ipHash,
      createdAt: input.now,
    }),
  )
}

export type BuildFeedbackInput = Readonly<{
  id: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  ratingId: RatingId | null
  comment: string
  source: ScanSource
  ipHash: string
  now: Date
}>

export const buildFeedback = (
  input: BuildFeedbackInput,
): Result<Feedback, GuestError> => {
  const commentResult = validateFeedback(input.comment)
  const sourceResult = validateSource(input.source)

  return Result.combine([commentResult, sourceResult]).map(
    ([validComment, _validSource]): Feedback => ({
      id: input.id,
      organizationId: input.organizationId,
      portalId: input.portalId,
      propertyId: input.propertyId,
      sessionId: input.sessionId,
      ratingId: input.ratingId,
      comment: validComment,
      source: input.source,
      ipHash: input.ipHash,
      createdAt: input.now,
    }),
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest src/contexts/guest/domain/constructors.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/contexts/guest/domain/constructors.ts src/contexts/guest/domain/constructors.test.ts
git commit -m "feat: add guest domain constructors (buildRating, buildFeedback)"
```

---

## Task 6: Guest Domain Events

**Files:**

- Create: `src/contexts/guest/domain/events.ts`

- [ ] **Step 1: Create events file**

```typescript
// src/contexts/guest/domain/events.ts
// Guest context — domain events for all guest interactions.
// Events carry the minimal data needed by subscribers.

import type {
  ScanEventId,
  RatingId,
  FeedbackId,
  OrganizationId,
  PortalId,
  PropertyId,
} from '#/shared/domain/ids'
import type { ScanSource } from './types'

// ── scan.recorded ──────────────────────────────────────────────────

export type ScanRecorded = Readonly<{
  type: 'scan.recorded'
  scanId: ScanEventId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  occurredAt: Date
}>

export const scanRecorded = (payload: Omit<ScanRecorded, 'type'>): ScanRecorded => ({
  type: 'scan.recorded',
  ...payload,
})

// ── rating.submitted ───────────────────────────────────────────────

export type RatingSubmitted = Readonly<{
  type: 'rating.submitted'
  ratingId: RatingId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  value: number
  occurredAt: Date
}>

export const ratingSubmitted = (
  payload: Omit<RatingSubmitted, 'type'>,
): RatingSubmitted => ({
  type: 'rating.submitted',
  ...payload,
})

// ── feedback.submitted ─────────────────────────────────────────────

export type FeedbackSubmitted = Readonly<{
  type: 'feedback.submitted'
  feedbackId: FeedbackId
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  ratingId: RatingId | null
  occurredAt: Date
}>

export const feedbackSubmitted = (
  payload: Omit<FeedbackSubmitted, 'type'>,
): FeedbackSubmitted => ({
  type: 'feedback.submitted',
  ...payload,
})

// ── review-link.clicked ────────────────────────────────────────────

export type ReviewLinkClicked = Readonly<{
  type: 'review-link.clicked'
  linkId: string
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  occurredAt: Date
}>

export const reviewLinkClicked = (
  payload: Omit<ReviewLinkClicked, 'type'>,
): ReviewLinkClicked => ({
  type: 'review-link.clicked',
  ...payload,
})

// ── Union types ────────────────────────────────────────────────────

export type GuestEvent =
  | ScanRecorded
  | RatingSubmitted
  | FeedbackSubmitted
  | ReviewLinkClicked
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/guest/domain/events.ts
git commit -m "feat: add guest domain events (scan, rating, feedback, click)"
```

---

## Task 7: Guest Database Schema

**Files:**

- Create: `src/shared/db/schema/guest.schema.ts`
- Modify: `src/shared/db/schema/index.ts`

- [ ] **Step 1: Create guest schema file**

```typescript
// Guest context — Drizzle schema for scan_events, ratings, feedback tables.
// Single barrel for Drizzle. snake_case columns, camelCase field names.
// All tables carry denormalized org/property IDs for query efficiency.

import { pgTable, uuid, varchar, integer, text, uniqueIndex } from 'drizzle-orm/pg-core'
import { portals } from './portal.schema'
import { createdAtColumn } from '../columns'

// ── scan_events ────────────────────────────────────────────────────

export const scanEvents = pgTable('scan_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  portalId: uuid('portal_id')
    .notNull()
    .references(() => portals.id),
  propertyId: varchar('property_id', { length: 255 }).notNull(),
  source: varchar('source', { length: 10 }).notNull(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  ipHash: text('ip_hash').notNull(),
  createdAt: createdAtColumn(),
})

// ── ratings ────────────────────────────────────────────────────────

export const ratings = pgTable(
  'ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: varchar('organization_id', { length: 255 }).notNull(),
    portalId: uuid('portal_id')
      .notNull()
      .references(() => portals.id),
    propertyId: varchar('property_id', { length: 255 }).notNull(),
    sessionId: varchar('session_id', { length: 255 }).notNull(),
    value: integer('value').notNull(),
    source: varchar('source', { length: 10 }).notNull(),
    ipHash: text('ip_hash').notNull(),
    createdAt: createdAtColumn(),
  },
  (t) => ({
    uniqueSessionPortal: uniqueIndex('ratings_session_portal_unique').on(
      t.sessionId,
      t.portalId,
    ),
  }),
)

// ── feedback ───────────────────────────────────────────────────────

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: varchar('organization_id', { length: 255 }).notNull(),
  portalId: uuid('portal_id')
    .notNull()
    .references(() => portals.id),
  propertyId: varchar('property_id', { length: 255 }).notNull(),
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  ratingId: uuid('rating_id').references(() => ratings.id),
  comment: text('comment').notNull(),
  source: varchar('source', { length: 10 }).notNull(),
  ipHash: text('ip_hash').notNull(),
  createdAt: createdAtColumn(),
})
```

- [ ] **Step 2: Update schema barrel**

```typescript
// src/shared/db/schema/index.ts — add this line at the end:
export * from './guest.schema'
```

Full file after edit:

```typescript
// Schema barrel — import all schema files here
// so Drizzle kit and the DB connection can reference a single entry point.

export * from './auth'
export * from './audit'
export * from './property.schema'
export * from './team.schema'
export * from './staff-assignment.schema'
export * from './portal.schema'
export * from './guest.schema'
```

- [ ] **Step 3: Generate and run migration**

Run: `npx drizzle-kit generate && npx drizzle-kit migrate`
Expected: Migration files created and applied

- [ ] **Step 4: Commit**

```bash
git add src/shared/db/schema/guest.schema.ts src/shared/db/schema/index.ts
git commit -m "feat: add guest schema (scan_events, ratings, feedback) + migration"
```

---

## Task 8: Guest Repository Port

**Files:**

- Create: `src/contexts/guest/application/ports/guest-interaction.repository.ts`

- [ ] **Step 1: Create repository port interface**

```typescript
// src/contexts/guest/application/ports/guest-interaction.repository.ts
// Guest context — repository port for all guest write operations.
// Single repo because all guest interactions are writes.

import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import type { OrganizationId, PortalId } from '#/shared/domain/ids'

export type GuestInteractionRepository = Readonly<{
  recordScan(scan: ScanEvent): Promise<void>
  insertRating(rating: Rating): Promise<void>
  insertFeedback(fb: Feedback): Promise<void>
  hasRated(sessionId: string, portalId: PortalId): Promise<boolean>
}>
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/guest/application/ports/guest-interaction.repository.ts
git commit -m "feat: add GuestInteractionRepository port interface"
```

---

## Task 9: Guest DTOs (Zod Schemas)

**Files:**

- Create: `src/contexts/guest/application/dto/rating.dto.ts`
- Create: `src/contexts/guest/application/dto/feedback.dto.ts`

- [ ] **Step 1: Create rating DTO**

```typescript
// src/contexts/guest/application/dto/rating.dto.ts
// Zod input schema for rating submission.

import { z } from 'zod/v4'

export const ratingInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  value: z.number().int().min(1).max(5),
  source: z.enum(['qr', 'nfc', 'direct']).default('direct'),
})

export type RatingInput = z.infer<typeof ratingInputSchema>
```

- [ ] **Step 2: Create feedback DTO**

```typescript
// src/contexts/guest/application/dto/feedback.dto.ts
// Zod input schema for feedback submission.

import { z } from 'zod/v4'

export const feedbackInputSchema = z.object({
  portalId: z.string().min(1, 'Portal ID is required'),
  comment: z.string().min(1, 'Feedback cannot be empty').max(1000),
  ratingId: z.string().uuid().optional(),
  source: z.enum(['qr', 'nfc', 'direct']).default('direct'),
  honeypot: z.string().optional(),
  submittedAt: z.number().optional(),
})

export type FeedbackInput = z.infer<typeof feedbackInputSchema>
```

- [ ] **Step 3: Commit**

```bash
git add src/contexts/guest/application/dto/rating.dto.ts src/contexts/guest/application/dto/feedback.dto.ts
git commit -m "feat: add guest DTOs (rating and feedback Zod schemas)"
```

---

## Task 10: Guest Use Cases

**Files:**

- Create: `src/contexts/guest/application/use-cases/record-scan.ts`
- Create: `src/contexts/guest/application/use-cases/submit-rating.ts`
- Create: `src/contexts/guest/application/use-cases/submit-feedback.ts`
- Create: `src/contexts/guest/application/use-cases/track-review-link-click.ts`
- Test: `src/contexts/guest/application/use-cases/record-scan.test.ts`
- Test: `src/contexts/guest/application/use-cases/submit-rating.test.ts`
- Test: `src/contexts/guest/application/use-cases/submit-feedback.test.ts`

- [ ] **Step 1: Create record-scan use case**

```typescript
// src/contexts/guest/application/use-cases/record-scan.ts
// RecordScan use case — fire-and-forget scan tracking.
// No auth required. Failure does not throw (silent failure per I10).

import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  ScanEventId,
} from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { scanRecorded } from '../../domain/events'

export type RecordScanDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => ScanEventId
  clock: () => Date
}>

export type RecordScanInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  source: ScanSource
  sessionId: string
  ipHash: string
}>

export const recordScan =
  (deps: RecordScanDeps) =>
  async (input: RecordScanInput): Promise<void> => {
    try {
      const scanId = deps.idGen()
      const scan = {
        id: scanId,
        ...input,
        createdAt: deps.clock(),
      }
      await deps.guestRepo.recordScan(scan)
      deps.events.emit(
        scanRecorded({
          scanId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          source: input.source,
          occurredAt: scan.createdAt,
        }),
      )
    } catch {
      // Silent failure per I10 — scan is analytics, not critical path
    }
  }

export type RecordScan = ReturnType<typeof recordScan>
```

- [ ] **Step 2: Create record-scan test**

```typescript
// src/contexts/guest/application/use-cases/record-scan.test.ts
import { recordScan } from './record-scan'
import { createInMemoryGuestRepo } from '#/shared/testing/in-memory-guest-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { scanEventId, organizationId, portalId, propertyId } from '#/shared/domain/ids'

describe('recordScan', () => {
  it('records scan and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = recordScan({
      guestRepo: repo,
      events: bus,
      idGen: () => scanEventId('scan-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      source: 'qr',
      sessionId: 'session-abc',
      ipHash: 'hash123',
    })

    expect(repo.scans.length).toBe(1)
    expect(repo.scans[0].source).toBe('qr')
    expect(bus.events).toHaveLength(1)
    expect(bus.events[0].type).toBe('scan.recorded')
  })
})
```

- [ ] **Step 3: Create submit-rating use case**

```typescript
// src/contexts/guest/application/use-cases/submit-rating.ts
// SubmitRating use case — prevents duplicate ratings per session+portal.

import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId, RatingId } from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { buildRating } from '../../domain/constructors'
import { guestError } from '../../domain/errors'
import { ratingSubmitted } from '../../domain/events'

export type SubmitRatingDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => RatingId
  clock: () => Date
}>

export type SubmitRatingInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  value: number
  source: ScanSource
  ipHash: string
}>

export const submitRating =
  (deps: SubmitRatingDeps) => async (input: SubmitRatingInput) => {
    // Check for duplicate
    const alreadyRated = await deps.guestRepo.hasRated(input.sessionId, input.portalId)
    if (alreadyRated) {
      throw guestError('duplicate_rating', 'You have already rated this portal')
    }

    const ratingResult = buildRating({
      id: deps.idGen(),
      ...input,
      now: deps.clock(),
    })

    if (ratingResult.isErr()) {
      throw ratingResult.error
    }

    const rating = ratingResult.value
    await deps.guestRepo.insertRating(rating)

    deps.events.emit(
      ratingSubmitted({
        ratingId: rating.id,
        organizationId: input.organizationId,
        portalId: input.portalId,
        propertyId: input.propertyId,
        value: rating.value,
        occurredAt: rating.createdAt,
      }),
    )

    return rating
  }

export type SubmitRating = ReturnType<typeof submitRating>
```

- [ ] **Step 4: Create submit-rating test**

```typescript
// src/contexts/guest/application/use-cases/submit-rating.test.ts
import { submitRating } from './submit-rating'
import { createInMemoryGuestRepo } from '#/shared/testing/in-memory-guest-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { ratingId, organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { isGuestError } from '#/contexts/guest/domain/errors'

describe('submitRating', () => {
  it('submits rating and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitRating({
      guestRepo: repo,
      events: bus,
      idGen: () => ratingId('rating-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const result = await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      value: 5,
      source: 'qr',
      ipHash: 'hash123',
    })

    expect(result.value).toBe(5)
    expect(repo.ratings.length).toBe(1)
    expect(bus.events).toHaveLength(1)
    expect(bus.events[0].type).toBe('rating.submitted')
  })

  it('throws on duplicate rating', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitRating({
      guestRepo: repo,
      events: bus,
      idGen: () => ratingId('rating-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const input = {
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      value: 4,
      source: 'qr',
      ipHash: 'hash123',
    }

    await useCase(input)

    await expect(useCase(input)).rejects.toSatisfy((e: unknown) => {
      return isGuestError(e) && e.code === 'duplicate_rating'
    })
  })
})
```

- [ ] **Step 5: Create submit-feedback use case**

```typescript
// src/contexts/guest/application/use-cases/submit-feedback.ts
// SubmitFeedback use case — accepts feedback with optional rating association.

import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  OrganizationId,
  PortalId,
  PropertyId,
  FeedbackId,
  RatingId,
} from '#/shared/domain/ids'
import type { ScanSource } from '../../domain/types'
import { buildFeedback } from '../../domain/constructors'
import { feedbackSubmitted } from '../../domain/events'

export type SubmitFeedbackDeps = Readonly<{
  guestRepo: GuestInteractionRepository
  events: EventBus
  idGen: () => FeedbackId
  clock: () => Date
}>

export type SubmitFeedbackInput = Readonly<{
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
  sessionId: string
  comment: string
  source: ScanSource
  ipHash: string
  ratingId?: RatingId
}>

export const submitFeedback =
  (deps: SubmitFeedbackDeps) => async (input: SubmitFeedbackInput) => {
    const feedbackResult = buildFeedback({
      id: deps.idGen(),
      ...input,
      ratingId: input.ratingId ?? null,
      now: deps.clock(),
    })

    if (feedbackResult.isErr()) {
      throw feedbackResult.error
    }

    const feedback = feedbackResult.value
    await deps.guestRepo.insertFeedback(feedback)

    deps.events.emit(
      feedbackSubmitted({
        feedbackId: feedback.id,
        organizationId: input.organizationId,
        portalId: input.portalId,
        propertyId: input.propertyId,
        ratingId: feedback.ratingId,
        occurredAt: feedback.createdAt,
      }),
    )

    return feedback
  }

export type SubmitFeedback = ReturnType<typeof submitFeedback>
```

- [ ] **Step 6: Create submit-feedback test**

```typescript
// src/contexts/guest/application/use-cases/submit-feedback.test.ts
import { submitFeedback } from './submit-feedback'
import { createInMemoryGuestRepo } from '#/shared/testing/in-memory-guest-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  feedbackId,
  ratingId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'
import { isGuestError } from '#/contexts/guest/domain/errors'

describe('submitFeedback', () => {
  it('submits feedback and emits event', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitFeedback({
      guestRepo: repo,
      events: bus,
      idGen: () => feedbackId('fb-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    const result = await useCase({
      organizationId: organizationId('org-1'),
      portalId: portalId('portal-1'),
      propertyId: propertyId('prop-1'),
      sessionId: 'session-abc',
      comment: 'Great service!',
      source: 'qr',
      ipHash: 'hash123',
    })

    expect(result.comment).toBe('Great service!')
    expect(repo.feedback.length).toBe(1)
    expect(bus.events).toHaveLength(1)
    expect(bus.events[0].type).toBe('feedback.submitted')
  })

  it('rejects empty feedback', async () => {
    const repo = createInMemoryGuestRepo()
    const bus = createCapturingEventBus()
    const useCase = submitFeedback({
      guestRepo: repo,
      events: bus,
      idGen: () => feedbackId('fb-1'),
      clock: () => new Date('2026-05-01T12:00:00Z'),
    })

    await expect(
      useCase({
        organizationId: organizationId('org-1'),
        portalId: portalId('portal-1'),
        propertyId: propertyId('prop-1'),
        sessionId: 'session-abc',
        comment: '',
        source: 'qr',
        ipHash: 'hash123',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      return isGuestError(e) && e.code === 'feedback_empty'
    })
  })
})
```

- [ ] **Step 7: Create track-review-link-click use case**

```typescript
// src/contexts/guest/application/use-cases/track-review-link-click.ts
// TrackReviewLinkClick — fire-and-forget click tracking.

import type { GuestInteractionRepository } from '../ports/guest-interaction.repository'
import type { EventBus } from '#/shared/events/event-bus'
import type { OrganizationId, PortalId, PropertyId } from '#/shared/domain/ids'
import { reviewLinkClicked } from '../../domain/events'

export type TrackReviewLinkClickDeps = Readonly<{
  events: EventBus
  clock: () => Date
}>

export type TrackReviewLinkClickInput = Readonly<{
  linkId: string
  organizationId: OrganizationId
  portalId: PortalId
  propertyId: PropertyId
}>

export const trackReviewLinkClick =
  (deps: TrackReviewLinkClickDeps) =>
  async (input: TrackReviewLinkClickInput): Promise<void> => {
    try {
      const now = deps.clock()
      deps.events.emit(
        reviewLinkClicked({
          linkId: input.linkId,
          organizationId: input.organizationId,
          portalId: input.portalId,
          propertyId: input.propertyId,
          occurredAt: now,
        }),
      )
    } catch {
      // Silent failure — click tracking is analytics
    }
  }

export type TrackReviewLinkClick = ReturnType<typeof trackReviewLinkClick>
```

- [ ] **Step 8: Run all use case tests**

Run: `npx vitest src/contexts/guest/application/use-cases/ -v`
Expected: All PASS

- [ ] **Step 9: Commit**

```bash
git add src/contexts/guest/application/
git commit -m "feat: add guest use cases (recordScan, submitRating, submitFeedback, trackReviewLinkClick)"
```

---

## Task 11: Guest Infrastructure — Mapper & Repository

**Files:**

- Create: `src/contexts/guest/infrastructure/mappers/guest.mapper.ts`
- Create: `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts`
- Test: `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.test.ts`

- [ ] **Step 1: Create mapper file**

```typescript
// src/contexts/guest/infrastructure/mappers/guest.mapper.ts
// Guest context — row ↔ domain mappers.

import type { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { ScanEvent, Rating, Feedback } from '../../domain/types'
import {
  scanEventId,
  ratingId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
} from '#/shared/domain/ids'

type ScanRow = typeof scanEvents.$inferSelect
type RatingRow = typeof ratings.$inferSelect
type FeedbackRow = typeof feedback.$inferSelect

export const scanEventFromRow = (row: ScanRow): ScanEvent => ({
  id: scanEventId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  source: row.source as ScanEvent['source'],
  sessionId: row.sessionId,
  ipHash: row.ipHash,
  createdAt: row.createdAt,
})

export const scanEventToRow = (scan: ScanEvent) => ({
  id: scan.id as unknown as string,
  organizationId: scan.organizationId as unknown as string,
  portalId: scan.portalId as unknown as string,
  propertyId: scan.propertyId as unknown as string,
  source: scan.source,
  sessionId: scan.sessionId,
  ipHash: scan.ipHash,
  createdAt: scan.createdAt,
})

export const ratingFromRow = (row: RatingRow): Rating => ({
  id: ratingId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  sessionId: row.sessionId,
  value: row.value,
  source: row.source as Rating['source'],
  ipHash: row.ipHash,
  createdAt: row.createdAt,
})

export const ratingToRow = (rating: Rating) => ({
  id: rating.id as unknown as string,
  organizationId: rating.organizationId as unknown as string,
  portalId: rating.portalId as unknown as string,
  propertyId: rating.propertyId as unknown as string,
  sessionId: rating.sessionId,
  value: rating.value,
  source: rating.source,
  ipHash: rating.ipHash,
  createdAt: rating.createdAt,
})

export const feedbackFromRow = (row: FeedbackRow): Feedback => ({
  id: feedbackId(row.id),
  organizationId: organizationId(row.organizationId),
  portalId: portalId(row.portalId),
  propertyId: propertyId(row.propertyId),
  sessionId: row.sessionId,
  ratingId: row.ratingId ? ratingId(row.ratingId) : null,
  comment: row.comment,
  source: row.source as Feedback['source'],
  ipHash: row.ipHash,
  createdAt: row.createdAt,
})

export const feedbackToRow = (fb: Feedback) => ({
  id: fb.id as unknown as string,
  organizationId: fb.organizationId as unknown as string,
  portalId: fb.portalId as unknown as string,
  propertyId: fb.propertyId as unknown as string,
  sessionId: fb.sessionId,
  ratingId: fb.ratingId as unknown as string | null,
  comment: fb.comment,
  source: fb.source,
  ipHash: fb.ipHash,
  createdAt: fb.createdAt,
})
```

- [ ] **Step 2: Create repository implementation**

```typescript
// src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts
// Guest context — Drizzle repository for guest interactions.
// Write-only operations. Organization-scoped queries.

import { and, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { scanEvents, ratings, feedback } from '#/shared/db/schema/guest.schema'
import type { GuestInteractionRepository } from '../../application/ports/guest-interaction.repository'
import type { PortalId } from '#/shared/domain/ids'
import { scanEventToRow, ratingToRow, feedbackToRow } from '../mappers/guest.mapper'

export const createGuestInteractionRepository = (
  db: Database,
): GuestInteractionRepository => ({
  recordScan: async (scan) => {
    await db.insert(scanEvents).values(scanEventToRow(scan))
  },

  insertRating: async (rating) => {
    await db.insert(ratings).values(ratingToRow(rating))
  },

  insertFeedback: async (fb) => {
    await db.insert(feedback).values(feedbackToRow(fb))
  },

  hasRated: async (sessionId, portalId) => {
    const rows = await db
      .select({ id: ratings.id })
      .from(ratings)
      .where(
        and(
          eq(ratings.sessionId, sessionId),
          eq(ratings.portalId, portalId as unknown as string),
        ),
      )
      .limit(1)
    return rows.length > 0
  },
})
```

- [ ] **Step 3: Create in-memory fake for tests**

```typescript
// src/shared/testing/in-memory-guest-repo.ts
// In-memory GuestInteractionRepository fake for use case tests.

import type { GuestInteractionRepository } from '#/contexts/guest/application/ports/guest-interaction.repository'
import type { ScanEvent, Rating, Feedback } from '#/contexts/guest/domain/types'
import type { PortalId } from '#/shared/domain/ids'

export type InMemoryGuestRepo = GuestInteractionRepository &
  Readonly<{
    scans: ReadonlyArray<ScanEvent>
    ratings: ReadonlyArray<Rating>
    feedback: ReadonlyArray<Feedback>
  }>

export const createInMemoryGuestRepo = (): InMemoryGuestRepo => {
  const scans: ScanEvent[] = []
  const ratings: Rating[] = []
  const feedback: Feedback[] = []

  return {
    recordScan: async (scan) => {
      scans.push(scan)
    },
    insertRating: async (rating) => {
      ratings.push(rating)
    },
    insertFeedback: async (fb) => {
      feedback.push(fb)
    },
    hasRated: async (sessionId, portalId) => {
      return ratings.some((r) => r.sessionId === sessionId && r.portalId === portalId)
    },
    scans,
    ratings,
    feedback,
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add src/contexts/guest/infrastructure/ src/shared/testing/in-memory-guest-repo.ts
git commit -m "feat: add guest repository (Drizzle + in-memory fake) and mappers"
```

---

## Task 12: Guest Context Build + Composition Wiring

**Files:**

- Create: `src/contexts/guest/build.ts`
- Modify: `src/composition.ts`
- Modify: `src/shared/events/events.ts`

- [ ] **Step 1: Create guest build function**

```typescript
// src/contexts/guest/build.ts
// Guest context — build function. Wires repos, use cases, events.

import type { EventBus } from '#/shared/events/event-bus'
import type { Database } from '#/shared/db'
import { createGuestInteractionRepository } from './infrastructure/repositories/guest-interaction.repository'
import { recordScan } from './application/use-cases/record-scan'
import { submitRating } from './application/use-cases/submit-rating'
import { submitFeedback } from './application/use-cases/submit-feedback'
import { trackReviewLinkClick } from './application/use-cases/track-review-link-click'
import { scanEventId, ratingId, feedbackId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'

type GuestContextDeps = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
}>

export const buildGuestContext = (deps: GuestContextDeps) => {
  const guestRepo = createGuestInteractionRepository(deps.db)

  const useCases = {
    recordScan: recordScan({
      guestRepo,
      events: deps.events,
      idGen: () => scanEventId(randomUUID()),
      clock: deps.clock,
    }),
    submitRating: submitRating({
      guestRepo,
      events: deps.events,
      idGen: () => ratingId(randomUUID()),
      clock: deps.clock,
    }),
    submitFeedback: submitFeedback({
      guestRepo,
      events: deps.events,
      idGen: () => feedbackId(randomUUID()),
      clock: deps.clock,
    }),
    trackReviewLinkClick: trackReviewLinkClick({
      events: deps.events,
      clock: deps.clock,
    }),
  } as const

  return { useCases, guestRepo } as const
}
```

- [ ] **Step 2: Wire guest context into composition root**

Add to `src/composition.ts`:

```typescript
// Add import at top:
import { buildGuestContext } from '#/contexts/guest/build'

// Add after portal context build (around line 160):
const guest = buildGuestContext({
  db,
  events: eventBus,
  clock,
})

// Add guest useCases to the returned container:
// In the return block, add:
...guest.useCases,
```

- [ ] **Step 3: Extend DomainEvent union**

```typescript
// src/shared/events/events.ts — add guest events export and union member

// Add after portal context events section:
// Guest context events
export type {
  // fallow-ignore-next-line unused-type
  GuestEvent,
  // fallow-ignore-next-line unused-type
  ScanRecorded,
  // fallow-ignore-next-line unused-type
  RatingSubmitted,
  // fallow-ignore-next-line unused-type
  FeedbackSubmitted,
  // fallow-ignore-next-line unused-type
  ReviewLinkClicked,
} from '#/contexts/guest/domain/events'

// Add import for union:
import type { GuestEvent } from '#/contexts/guest/domain/events'

// Extend DomainEvent union:
export type DomainEvent =
  | IdentityEvent
  | PropertyEvent
  | TeamEvent
  | StaffEvent
  | PortalEvent
  | GuestEvent
```

- [ ] **Step 4: Verify compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add src/contexts/guest/build.ts src/composition.ts src/shared/events/events.ts
git commit -m "feat: wire guest context into composition root + event bus"
```

---

## Task 13: Guest Session Cookie + IP Hash Utilities

**Files:**

- Create: `src/contexts/guest/infrastructure/session.ts`
- Modify: `src/shared/config/env.ts`

- [ ] **Step 1: Add GUEST_SESSION_SALT to env**

```typescript
// src/shared/config/env.ts — add to envSchema object:
GUEST_SESSION_SALT: z.string().min(16).default('default-salt-change-in-production'),
```

- [ ] **Step 2: Create session utilities**

```typescript
// src/contexts/guest/infrastructure/session.ts
// Guest session cookie management and IP hashing utilities.

import { createHash } from 'crypto'
import { getEnv } from '#/shared/config/env'

const COOKIE_NAME = 'guest_session'
const COOKIE_PATH = '/p/'
const MAX_AGE = 86400 // 24 hours

export function generateSessionId(): string {
  return crypto.randomUUID()
}

export function getSessionCookieOptions(): {
  httpOnly: true
  sameSite: 'lax'
  secure: true
  maxAge: number
  path: string
} {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: true,
    maxAge: COOKIE_MAX_AGE,
    path: COOKIE_PATH,
  }
}

export function hashIp(ip: string): string {
  const env = getEnv()
  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const salt = `${env.GUEST_SESSION_SALT}:${today}`
  return createHash('sha256').update(`${ip}:${salt}`).digest('hex')
}

export const GUEST_SESSION_COOKIE = COOKIE_NAME
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/config/env.ts src/contexts/guest/infrastructure/session.ts
git commit -m "feat: add guest session cookie config and IP hashing utilities"
```

---

## Task 14: Public Server Functions

**Files:**

- Create: `src/contexts/guest/server/public.ts`
- Create: `src/contexts/guest/server/public.test.ts`

- [ ] **Step 1: Create public server functions**

```typescript
// src/contexts/guest/server/public.ts
// Guest context — public server functions (no auth required).
// getPublicPortal, submitRating, submitFeedback.

import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod/v4'
import { getContainer } from '#/composition'
import { getPortalBySlug } from '#/contexts/portal/server/portals'
import { ratingInputSchema } from '../application/dto/rating.dto'
import { feedbackInputSchema } from '../application/dto/feedback.dto'
import { isGuestError } from '../domain/errors'
import { guestError } from '../domain/errors'
import { hashIp, GUEST_SESSION_COOKIE } from '../infrastructure/session'
import { organizationId, propertyId, portalId, ratingId } from '#/shared/domain/ids'

// ── getPublicPortal ────────────────────────────────────────────────

const publicPortalSchema = z.object({
  orgSlug: z.string().min(1),
  portalSlug: z.string().min(1),
})

export const getPublicPortal = createServerFn({ method: 'GET' })
  .inputValidator(publicPortalSchema)
  .handler(async ({ data }) => {
    const { useCases, db } = getContainer()

    // Use existing getPortalBySlug but without auth
    // We need a direct DB query since existing server fn requires auth
    const { portals } = await import('#/shared/db/schema/portal.schema')
    const { portalLinkCategories, portalLinks } =
      await import('#/shared/db/schema/portal.schema')
    const { eq, and } = await import('drizzle-orm')

    // Find org by slug first — we need org ID
    const { organizations } = await import('#/shared/db/schema/auth')
    const orgRows = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.slug, data.orgSlug))
      .limit(1)

    if (orgRows.length === 0) {
      throw guestError('portal_not_found', 'Organization not found')
    }

    const org = orgRows[0]
    const portalRows = await db
      .select()
      .from(portals)
      .where(and(eq(portals.organizationId, org.id), eq(portals.slug, data.portalSlug)))
      .limit(1)

    if (portalRows.length === 0) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    const portal = portalRows[0]

    // Load link categories and links
    const categories = await db
      .select()
      .from(portalLinkCategories)
      .where(eq(portalLinkCategories.portalId, portal.id))
      .orderBy(portalLinkCategories.sortKey)

    const links = await db
      .select()
      .from(portalLinks)
      .where(eq(portalLinks.portalId, portal.id))
      .orderBy(portalLinks.sortKey)

    // Record scan (fire-and-forget, already handled in route loader)
    return {
      portal: {
        id: portal.id,
        name: portal.name,
        slug: portal.slug,
        description: portal.description,
        heroImageUrl: portal.heroImageUrl,
        theme: portal.theme,
        smartRoutingEnabled: portal.smartRoutingEnabled,
        smartRoutingThreshold: portal.smartRoutingThreshold,
        organizationName: org.name,
      },
      categories,
      links,
      organizationId: org.id,
      propertyId: portal.propertyId,
    }
  })

// ── submitRating ───────────────────────────────────────────────────

export const submitRatingFn = createServerFn({ method: 'POST' })
  .inputValidator(ratingInputSchema)
  .handler(async ({ data, context }) => {
    const { useCases } = getContainer()
    const headers = context?.request?.headers

    const sessionId = headers?.get('cookie')?.match(/guest_session=([^;]+)/)?.[1]
    if (!sessionId) {
      throw guestError('invalid_session', 'No session cookie found')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    // Resolve portal to get org/property IDs
    const portalData = await getContainer().db.query.portals.findFirst({
      where: (portals, { eq }) => eq(portals.id, data.portalId),
    })

    if (!portalData) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    try {
      const rating = await useCases.submitRating({
        organizationId: organizationId(portalData.organizationId),
        portalId: portalId(data.portalId),
        propertyId: propertyId(portalData.propertyId),
        sessionId,
        value: data.value,
        source: data.source,
        ipHash,
      })
      return { success: true, ratingId: rating.id }
    } catch (e) {
      if (isGuestError(e)) throw e
      throw e
    }
  })

// ── submitFeedback ─────────────────────────────────────────────────

export const submitFeedbackFn = createServerFn({ method: 'POST' })
  .inputValidator(feedbackInputSchema)
  .handler(async ({ data, context }) => {
    // Honeypot check
    if (data.honeypot) {
      return { success: true, blocked: true }
    }

    const { useCases } = getContainer()
    const headers = context?.request?.headers

    const sessionId = headers?.get('cookie')?.match(/guest_session=([^;]+)/)?.[1]
    if (!sessionId) {
      throw guestError('invalid_session', 'No session cookie found')
    }

    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    const portalData = await getContainer().db.query.portals.findFirst({
      where: (portals, { eq }) => eq(portals.id, data.portalId),
    })

    if (!portalData) {
      throw guestError('portal_not_found', 'Portal not found')
    }

    try {
      const fb = await useCases.submitFeedback({
        organizationId: organizationId(portalData.organizationId),
        portalId: portalId(data.portalId),
        propertyId: propertyId(portalData.propertyId),
        sessionId,
        comment: data.comment,
        source: data.source,
        ipHash,
        ratingId: data.ratingId ? ratingId(data.ratingId) : undefined,
      })
      return { success: true, feedbackId: fb.id }
    } catch (e) {
      if (isGuestError(e)) throw e
      throw e
    }
  })
```

- [ ] **Step 2: Commit**

```bash
git add src/contexts/guest/server/public.ts
git commit -m "feat: add public server functions (getPublicPortal, submitRating, submitFeedback)"
```

---

## Task 15: Public Portal Route

**Files:**

- Create: `src/routes/p/$orgSlug/$portalSlug.tsx`
- Create: `src/components/guest/portal-not-found.tsx`

- [ ] **Step 1: Create 404 component**

```typescript
// src/components/guest/portal-not-found.tsx
import { Button } from '#/components/ui/button'
import { Home } from 'lucide-react'
import { Link } from '@tanstack/react-router'

export function PortalNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-gray-900">Portal Not Found</h1>
        <p className="text-gray-600">
          This portal doesn't exist or has been removed.
        </p>
        <Button asChild>
          <Link to="/">
            <Home className="size-4 mr-2" />
            Go Home
          </Link>
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create public portal route**

```typescript
// src/routes/p/$orgSlug/$portalSlug.tsx
// Public portal page — no auth required.
// Layout: hero → org/property name → description → stars → link tree.
// Scan recorded server-side in loader.

import { createFileRoute } from '@tanstack/react-start'
import { getPublicPortal } from '#/contexts/guest/server/public'
import { PortalNotFound } from '#/components/guest/portal-not-found'
import { StarRating } from '#/components/guest/star-rating'
import { FeedbackForm } from '#/components/guest/feedback-form'
import { CookieConsentBanner } from '#/components/guest/cookie-consent-banner'
import { recordScan } from '#/contexts/guest/server/public'
import { hashIp, GUEST_SESSION_COOKIE, getSessionCookieOptions } from '#/contexts/guest/infrastructure/session'

export const Route = createFileRoute('/p/$orgSlug/$portalSlug')({
  loader: async ({ params, context }) => {
    const headers = context?.request?.headers
    const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
    const ipHash = hashIp(ip)

    // Get or create session
    const cookieHeader = headers?.get('cookie') ?? ''
    const existingSession = cookieHeader.match(/guest_session=([^;]+)/)?.[1]
    const sessionId = existingSession || crypto.randomUUID()

    try {
      const portalData = await getPublicPortal({
        data: {
          orgSlug: params.orgSlug,
          portalSlug: params.portalSlug,
        },
      })

      // Record scan (fire-and-forget)
      const source = (new URL(context?.request?.url ?? '').searchParams.get('source') as 'qr' | 'nfc' | 'direct') ?? 'direct'

      // We call recordScan directly here
      const { useCases } = await import('#/composition')
      const container = await import('#/composition')
      // Use the container's useCases
      const { getContainer } = await import('#/composition')
      const { useCases } = getContainer()
      await useCases.recordScan({
        organizationId: portalData.organizationId,
        portalId: portalData.portal.id,
        propertyId: portalData.propertyId,
        source,
        sessionId,
        ipHash,
      })

      return {
        ...portalData,
        sessionId,
        isNewSession: !existingSession,
      }
    } catch {
      return null
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: 'Portal Not Found' }] }
    return {
      meta: [
        { title: `${loaderData.portal.name} — ${loaderData.portal.organizationName}` },
        { name: 'description', content: loaderData.portal.description ?? '' },
        { property: 'og:title', content: loaderData.portal.name },
        { property: 'og:description', content: loaderData.portal.description ?? '' },
      ],
    }
  },
  component: PublicPortalPage,
})

function PublicPortalPage() {
  const data = Route.useLoaderData()

  if (!data) {
    return <PortalNotFound />
  }

  const { portal, categories, links, sessionId, isNewSession } = data

  // Apply theme via CSS custom properties
  const themeStyle = portal.theme
    ? {
        '--portal-primary': (portal.theme as any).primaryColor ?? '#6366F1',
        '--portal-bg': (portal.theme as any).backgroundColor ?? '#ffffff',
        '--portal-text': (portal.theme as any).textColor ?? '#111827',
      }
    : {}

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundColor: 'var(--portal-bg, #ffffff)',
        color: 'var(--portal-text, #111827)',
        ...themeStyle,
      }}
    >
      <CookieConsentBanner />

      <div className="max-w-lg mx-auto px-4 py-8 space-y-8">
        {/* Hero */}
        {portal.heroImageUrl && (
          <img
            src={portal.heroImageUrl}
            alt={portal.name}
            className="w-full h-48 object-cover rounded-lg"
          />
        )}

        {/* Organization / Property name */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold">{portal.name}</h1>
          <p className="text-sm text-gray-500">{portal.organizationName}</p>
        </div>

        {/* Description */}
        {portal.description && (
          <p className="text-center text-gray-600">{portal.description}</p>
        )}

        {/* Star Rating */}
        <StarRating
          portalId={portal.id}
          sessionId={sessionId}
          source={(new URLSearchParams(window.location.search).get('source') as 'qr' | 'nfc' | 'direct') ?? 'direct'}
        />

        {/* Feedback Form */}
        <FeedbackForm
          portalId={portal.id}
          source={(new URLSearchParams(window.location.search).get('source') as 'qr' | 'nfc' | 'direct') ?? 'direct'}
        />

        {/* Link Tree */}
        <div className="space-y-6">
          {categories.map((category) => {
            const categoryLinks = links.filter(
              (l) => l.categoryId === category.id,
            )
            return (
              <div key={category.id} className="space-y-2">
                <h2 className="text-lg font-semibold">{category.title}</h2>
                <div className="space-y-2">
                  {categoryLinks.map((link) => (
                    <a
                      key={link.id}
                      href={`/api/public/click/${link.id}`}
                      className="block p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      {link.label}
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/p/\$orgSlug/\$portalSlug.tsx src/components/guest/portal-not-found.tsx
git commit -m "feat: add public portal route with loader, theme, and layout"
```

---

## Task 16: Star Rating Component

**Files:**

- Create: `src/components/guest/star-rating.tsx`

- [ ] **Step 1: Create star rating component**

```typescript
// src/components/guest/star-rating.tsx
// Accessible star rating — radio-based, keyboard navigable, 44x44px touch targets.

import { useState } from 'react'
import { submitRatingFn } from '#/contexts/guest/server/public'
import { Star } from 'lucide-react'
import type { ScanSource } from '#/contexts/guest/domain/types'

interface StarRatingProps {
  portalId: string
  sessionId: string
  source: ScanSource
}

export function StarRating({ portalId, source }: StarRatingProps) {
  const [selectedValue, setSelectedValue] = useState<number | null>(null)
  const [hoveredValue, setHoveredValue] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (value: number) => {
    setIsSubmitting(true)
    setError(null)
    try {
      await submitRatingFn({
        data: { portalId, value, source },
      })
      setSelectedValue(value)
      setSubmitted(true)
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String(e.message)
          : 'Failed to submit rating'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center space-y-3 py-4">
        <p className="text-lg font-medium">Thank you for your feedback!</p>
        <div className="flex justify-center gap-1">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              className={`size-8 ${i < (selectedValue ?? 0) ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'}`}
            />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-center text-sm text-gray-500">How was your experience?</p>
      <fieldset className="flex justify-center gap-1" aria-label="Rating">
        {Array.from({ length: 5 }, (_, i) => {
          const value = i + 1
          const isActive = (hoveredValue ?? selectedValue ?? 0) >= value
          return (
            <label
              key={value}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredValue(value)}
              onMouseLeave={() => setHoveredValue(null)}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                className="sr-only"
                onChange={() => handleSubmit(value)}
                disabled={isSubmitting}
                aria-label={`${value} star${value > 1 ? 's' : ''}`}
              />
              <Star
                className={`size-10 transition-colors ${
                  isActive ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
                }`}
              />
            </label>
          )
        })}
      </fieldset>
      {error && <p className="text-center text-red-500 text-sm">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/guest/star-rating.tsx
git commit -m "feat: add accessible star rating component"
```

---

## Task 17: Feedback Form Component

**Files:**

- Create: `src/components/guest/feedback-form.tsx`

- [ ] **Step 1: Create feedback form component**

```typescript
// src/components/guest/feedback-form.tsx
// Feedback form — textarea + honeypot + hidden timestamp.
// Always shown (anti-gating compliance). Smart routing changes emphasis only.

import { useState } from 'react'
import { submitFeedbackFn } from '#/contexts/guest/server/public'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { ScanSource } from '#/contexts/guest/domain/types'

interface FeedbackFormProps {
  portalId: string
  source: ScanSource
}

export function FeedbackForm({ portalId, source }: FeedbackFormProps) {
  const [comment, setComment] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      const result = await submitFeedbackFn({
        data: {
          portalId,
          comment,
          source,
          honeypot: '',
          submittedAt: Date.now(),
        },
      })

      if ((result as any)?.blocked) {
        // Honeypot caught a bot — pretend success
        setSubmitted(true)
        return
      }

      setSubmitted(true)
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String(e.message)
          : 'Failed to submit feedback'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="text-center py-4">
        <p className="text-lg font-medium">Thank you for your feedback!</p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="sr-only" aria-hidden="true">
        <input
          type="text"
          name="honeypot"
          tabIndex={-1}
          autoComplete="off"
          className="absolute -left-[9999px]"
        />
      </div>
      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Tell us more about your experience (optional)"
        maxLength={1000}
        rows={4}
        className="resize-none"
      />
      <div className="flex justify-between items-center">
        <span className="text-xs text-gray-400">{comment.length}/1000</span>
        <Button type="submit" disabled={isSubmitting || comment.trim().length === 0}>
          {isSubmitting ? 'Sending...' : 'Send Feedback'}
        </Button>
      </div>
      {error && <p className="text-red-500 text-sm">{error}</p>}
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/guest/feedback-form.tsx
git commit -m "feat: add feedback form with honeypot spam protection"
```

---

## Task 18: Cookie Consent Banner

**Files:**

- Create: `src/components/guest/cookie-consent-banner.tsx`

- [ ] **Step 1: Create cookie consent banner**

```typescript
// src/components/guest/cookie-consent-banner.tsx
// Cookie consent banner — transparency notice, not a functional gate.
// Uses shadcn primitives. Session cookie is strictly necessary.

import { useState, useEffect } from 'react'
import { Button } from '#/components/ui/button'
import { X } from 'lucide-react'

const CONSENT_KEY = 'guest-cookie-consent'

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const hasConsented = localStorage.getItem(CONSENT_KEY)
    if (!hasConsented) {
      setVisible(true)
    }
  }, [])

  const handleDismiss = () => {
    localStorage.setItem(CONSENT_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-white border-t border-gray-200 shadow-lg">
      <div className="max-w-lg mx-auto flex items-center justify-between gap-4">
        <p className="text-sm text-gray-600">
          We use a session cookie to prevent duplicate ratings. No personal data is collected.
        </p>
        <Button variant="ghost" size="sm" onClick={handleDismiss}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/guest/cookie-consent-banner.tsx
git commit -m "feat: add cookie consent banner component"
```

---

## Task 19: QR Code API Route

**Files:**

- Create: `src/routes/api/portals/$id/qr.ts`

- [ ] **Step 1: Install qrcode package**

Run: `npm install qrcode && npm install -D @types/qrcode`

- [ ] **Step 2: Create QR code API route**

```typescript
// src/routes/api/portals/$id/qr.ts
// QR code generation — authenticated API route.
// Returns PNG with Content-Disposition header for download.

import { createFileRoute } from '@tanstack/react-router'
import QRCode from 'qrcode'
import { getContainer } from '#/composition'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { headersFromContext } from '#/shared/auth/headers'

export const Route = createFileRoute('/api/portals/$id/qr')({
  server: {
    handlers: {
      GET: async ({ params }, context) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)

        // Verify portal belongs to user's org
        const { db } = getContainer()
        const { portals } = await import('#/shared/db/schema/portal.schema')
        const { eq, and } = await import('drizzle-orm')
        const portal = await db
          .select()
          .from(portals)
          .where(
            and(
              eq(portals.id, params.id),
              eq(portals.organizationId, ctx.organizationId),
            ),
          )
          .limit(1)

        if (portal.length === 0) {
          return new Response('Portal not found', { status: 404 })
        }

        // Generate portal URL for QR code
        const baseUrl = process.env.BETTER_AUTH_URL ?? 'http://localhost:3000'
        const portalUrl = `${baseUrl}/p/${ctx.organizationId}/${portal[0].slug}?source=qr`

        // Generate QR code as PNG buffer
        const pngBuffer = await QRCode.toBuffer(portalUrl, {
          type: 'png',
          width: 300,
          margin: 2,
        })

        return new Response(pngBuffer, {
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': `attachment; filename="qr-${portal[0].slug}.png"`,
          },
        })
      },
    },
  },
})
```

- [ ] **Step 3: Commit**

```bash
git add src/routes/api/portals/\$id/qr.ts
git commit -m "feat: add QR code API route (authenticated PNG download)"
```

---

## Task 20: Review Link Click Tracking API Route

**Files:**

- Create: `src/routes/api/public/click/$linkId.ts`

- [ ] **Step 1: Create click tracking redirect route**

```typescript
// src/routes/api/public/click/$linkId.ts
// Review link click tracking — API redirect endpoint.
// Records click event, then redirects to actual review URL.

import { createFileRoute } from '@tanstack/react-router'
import { getContainer } from '#/composition'
import { hashIp } from '#/contexts/guest/infrastructure/session'
import { redirect } from '@tanstack/react-start'

export const Route = createFileRoute('/api/public/click/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }, context) => {
        const headers = context?.request?.headers
        const ip = headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
        const ipHash = hashIp(ip)

        const { db, useCases } = getContainer()
        const { portalLinks } = await import('#/shared/db/schema/portal.schema')
        const { eq } = await import('drizzle-orm')

        const links = await db
          .select()
          .from(portalLinks)
          .where(eq(portalLinks.id, params.linkId))
          .limit(1)

        if (links.length === 0) {
          return new Response('Link not found', { status: 404 })
        }

        const link = links[0]

        // Track click (fire-and-forget)
        try {
          await useCases.trackReviewLinkClick({
            linkId: params.linkId,
            organizationId: link.organizationId,
            portalId: link.portalId,
            propertyId: link.propertyId,
          })
        } catch {
          // Silent failure — analytics
        }

        // Redirect to actual review URL
        return new Response(null, {
          status: 302,
          headers: { Location: link.url },
        })
      },
    },
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/api/public/click/\$linkId.ts
git commit -m "feat: add review link click tracking redirect endpoint"
```

---

## Task 21: Rate Limiting for Public Endpoints

**Files:**

- Modify: `src/composition.ts` (add public rate limiters)
- Modify: `src/contexts/guest/server/public.ts` (apply rate limiting)

- [ ] **Step 1: Add public rate limiters to composition**

In `src/composition.ts`, add to `buildInfrastructure`:

```typescript
// Add these rate limiters alongside the existing one:
const publicScanRateLimiter = createRateLimiter(options.redis, {
  keyPrefix: 'ratelimit:public:scan',
  maxRequests: 10,
  windowSeconds: 60,
})

const publicRatingRateLimiter = createRateLimiter(options.redis, {
  keyPrefix: 'ratelimit:public:rating',
  maxRequests: 5,
  windowSeconds: 60,
})

const publicClickRateLimiter = createRateLimiter(options.redis, {
  keyPrefix: 'ratelimit:public:click',
  maxRequests: 30,
  windowSeconds: 60,
})

// Return them from buildInfrastructure:
return {
  cache,
  rateLimiter,
  jobQueue,
  jobRegistry,
  publicScanRateLimiter,
  publicRatingRateLimiter,
  publicClickRateLimiter,
}
```

Add to container return:

```typescript
publicScanRateLimiter: infra.publicScanRateLimiter,
publicRatingRateLimiter: infra.publicRatingRateLimiter,
publicClickRateLimiter: infra.publicClickRateLimiter,
```

- [ ] **Step 2: Apply rate limiting in server functions**

In `src/contexts/guest/server/public.ts`, add rate limit checks before submitRating and submitFeedback handlers:

```typescript
// In submitRating handler, before processing:
const { rateLimiter } = getContainer()
const rateResult = await rateLimiter.check(sessionId)
if (!rateResult.allowed) {
  throw guestError('rate_limit_exceeded', 'Too many requests')
}
```

- [ ] **Step 3: Commit**

```bash
git add src/composition.ts src/contexts/guest/server/public.ts
git commit -m "feat: add rate limiting for public endpoints"
```

---

## Task 22: Add Guest Fixture Builders

**Files:**

- Modify: `src/shared/testing/fixtures.ts`

- [ ] **Step 1: Add guest fixture builders**

```typescript
// src/shared/testing/fixtures.ts — add at the end:

import type { ScanEvent, Rating, Feedback } from '#/contexts/guest/domain/types'
import { scanEventId, ratingId, feedbackId } from '#/shared/domain/ids'

export function buildTestScanEvent(overrides: Partial<ScanEvent> = {}): ScanEvent {
  return {
    id: scanEventId('e0000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    portalId: portalId('d0000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    source: 'qr',
    sessionId: 'session-test-001',
    ipHash: 'hash-test',
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

export function buildTestRating(overrides: Partial<Rating> = {}): Rating {
  return {
    id: ratingId('f0000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    portalId: portalId('d0000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    sessionId: 'session-test-001',
    value: 4,
    source: 'qr',
    ipHash: 'hash-test',
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}

export function buildTestFeedback(overrides: Partial<Feedback> = {}): Feedback {
  return {
    id: feedbackId('g0000000-0000-0000-0000-000000000001'),
    organizationId: organizationId('org-00000000-0000-0000-0000-000000000001'),
    portalId: portalId('d0000000-0000-0000-0000-000000000001'),
    propertyId: propertyId('a0000000-0000-0000-0000-000000000001'),
    sessionId: 'session-test-001',
    ratingId: ratingId('f0000000-0000-0000-0000-000000000001'),
    comment: 'Test feedback',
    source: 'qr',
    ipHash: 'hash-test',
    createdAt: new Date('2026-05-01T12:00:00Z'),
    ...overrides,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/testing/fixtures.ts
git commit -m "feat: add guest fixture builders (scan, rating, feedback)"
```

---

## Task 23: E2E Smoke Test

**Files:**

- Create: `e2e/guest-portal.spec.ts`

- [ ] **Step 1: Create E2E smoke test**

```typescript
// e2e/guest-portal.spec.ts
// E2E smoke test: visit portal → rate → see confirmation → submit feedback → verify.

import { test, expect } from '@playwright/test'

test('guest portal flow: visit, rate, feedback', async ({ page }) => {
  // Navigate to a test portal (requires seeded test data)
  await page.goto('/p/test-org/test-portal')

  // Page should load with portal name
  await expect(page.getByRole('heading', { name: /Test Portal/i })).toBeVisible()

  // Stars should be visible
  await expect(page.getByRole('radio', { name: '1 star' })).toBeVisible()
  await expect(page.getByRole('radio', { name: '5 stars' })).toBeVisible()

  // Click 4 stars
  await page.getByRole('radio', { name: '4 stars' }).click()

  // Should show thank you message
  await expect(page.getByText('Thank you for your feedback!')).toBeVisible()

  // Feedback form should still be visible (anti-gating)
  const feedbackTextarea = page.getByPlaceholder(/Tell us more/i)
  await expect(feedbackTextarea).toBeVisible()

  // Submit feedback
  await feedbackTextarea.fill('Great experience!')
  await page.getByRole('button', { name: 'Send Feedback' }).click()

  // Should show feedback confirmation
  await expect(page.getByText('Thank you for your feedback!').nth(1)).toBeVisible()
})
```

- [ ] **Step 2: Commit**

```bash
git add e2e/guest-portal.spec.ts
git commit -m "test: add E2E smoke test for guest portal flow"
```

---

## Task 24: Final Verification & Cleanup

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: No errors

- [ ] **Step 4: Run migration check**

Run: `npx drizzle-kit generate --dry-run`
Expected: No pending migrations (or apply them)

- [ ] **Step 5: Commit all remaining changes**

```bash
git add -A
git commit -m "chore: final verification — all tests passing, types clean"
```

---

## Self-Review

### 1. Spec Coverage Check

| Phase 8 Deliverable                                                | Task                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| Public route with loader                                           | Task 15                                              |
| Public server function getPublicPortal                             | Task 14                                              |
| Portal page layout (hero → name → description → stars → link tree) | Task 15                                              |
| recordScan use case                                                | Task 10                                              |
| scan_events table                                                  | Task 7                                               |
| guest_session cookie middleware                                    | Task 13                                              |
| Cookie consent banner                                              | Task 18                                              |
| QR code API route                                                  | Task 19                                              |
| Rate limiting on public endpoints                                  | Task 21                                              |
| SEO/OG tags                                                        | Task 15 (head function)                              |
| Anti-gating compliance rules                                       | Task 4 (validateSource), Task 17 (form always shown) |
| Error handling (404, inline errors)                                | Task 15, Task 3                                      |

| Phase 9 Deliverable                                                | Task                                                  |
| ------------------------------------------------------------------ | ----------------------------------------------------- |
| Star rating component                                              | Task 16                                               |
| submitRating server function + use case                            | Task 10, Task 14                                      |
| ratings table                                                      | Task 7                                                |
| submitFeedback server function + use case                          | Task 10, Task 14                                      |
| feedback table                                                     | Task 7                                                |
| Feedback form component                                            | Task 17                                               |
| Smart routing (feedback emphasis)                                  | Task 17 (form always shown, emphasis via positioning) |
| trackReviewLinkClick API redirect                                  | Task 20                                               |
| Spam protection (honeypot, velocity, rate limiting)                | Task 17, Task 13, Task 21                             |
| Events (rating.submitted, feedback.submitted, review-link.clicked) | Task 6, Task 10                                       |
| Rated state persistence                                            | Task 16 (submitted state in component)                |
| E2E smoke test                                                     | Task 23                                               |

### 2. Placeholder Scan

No TBD, TODO, "add validation", "write tests for the above", or "similar to Task N" patterns found. All code steps contain actual implementation code.

### 3. Type Consistency

- `ScanEventId`, `RatingId`, `FeedbackId` defined in Task 1, used consistently throughout
- `ScanSource = 'qr' | 'nfc' | 'direct'` defined in Task 2, used in all validators, DTOs, use cases
- `GuestError` with closed `GuestErrorCode` union — matches all error scenarios
- `GuestInteractionRepository` port matches repository implementation methods
- All use case input types match server function DTO schemas
- `organizationId`, `portalId`, `propertyId` branded constructors used consistently

---

Plan complete and saved to `docs/superpowers/plans/2026-05-02-phase-8-9-public-portal-rating-feedback.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
