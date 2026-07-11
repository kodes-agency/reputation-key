# Codebase Standards

**Status:** Accepted
**Date:** 2026-06-02
**Scope:** Entire `reputation-key/oslo` codebase

This document codifies naming, structural, and documentation standards for every bounded context. All new code MUST follow these rules. Existing code is grandfathered until refactored.

---

## 1. Event Standards

### 1.1 Naming: `context.entity.verb`

Every event `_tag` follows `context.entity.verb`:

| Segment   | Rule                                                                                                            | Example     |
| --------- | --------------------------------------------------------------------------------------------------------------- | ----------- |
| `context` | Bounded context name (identity, integration, portal, property, team, staff, guest, review, inbox, goal, metric) | `review`    |
| `entity`  | Domain entity name (can contain underscores for multi-word: `portal_link`, `google_account`)                    | `reply`     |
| `verb`    | Past-tense action (can contain underscores: `status_changed`, `visibility_changed`)                             | `published` |

**Shorthand:** When `context === entity`, omit the entity segment: `review.created` (not `review.review.created`).

**Hyphens forbidden.** Use underscores: `review_link` not `review-link`. `role_changed` not `role-changed`.

| Before (non-standard)       | After (standard)                        | Rule applied                      |
| --------------------------- | --------------------------------------- | --------------------------------- |
| `reply.published`           | `review.reply.published`                | Add context prefix                |
| `feedback.submitted`        | `guest.feedback.submitted`              | Add context prefix                |
| `scan.recorded`             | `guest.scan.recorded`                   | Add context prefix                |
| `member.invited`            | `identity.member.invited`               | Add context prefix                |
| `organization.created`      | `identity.organization.created`         | Add context prefix                |
| `review-link.clicked`       | `guest.review_link.clicked`             | Hyphen→underscore, context prefix |
| `member.role-changed`       | `identity.member.role_changed`          | Hyphen→underscore                 |
| `inbox.status.changed`      | `inbox.inbox_item.status_changed`       | Add entity segment                |
| `portal_link.created`       | `portal.portal_link.created`            | Three-segment format              |
| `google_account.connected`  | `integration.google_account.connected`  | Add context prefix                |
| `property_import.completed` | `integration.property_import.completed` | Add context prefix                |

### 1.2 Type naming

TypeScript type name = `PascalCase(tag)` with all dots removed and context-entity deduplication:

| Tag                        | Type name                                           |
| -------------------------- | --------------------------------------------------- |
| `review.reply.published`   | `ReviewReplyPublished`                              |
| `guest.feedback.submitted` | `GuestFeedbackSubmitted`                            |
| `identity.member.invited`  | `IdentityMemberInvited`                             |
| `inbox.inbox_item.created` | `InboxItemCreated`                                  |
| `review.created`           | `ReviewCreated` (shorthand: context=entity, no dup) |

### 1.3 Constructor naming

`camelCase(TypeName)`: `ReviewReplyPublished` → `reviewReplyPublished`.

### 1.4 Constructor validation

All event constructors SHALL include minimal assertions for impossible states:

```ts
export const inboxItemStatusChanged = (
  args: Omit<InboxItemStatusChanged, '_tag' | 'eventId'>,
): InboxItemStatusChanged => {
  assert(
    args.oldStatus !== args.newStatus,
    'Status change must transition to different status',
  )
  assert(args.organizationId !== '', 'organizationId required')
  return {
    _tag: 'inbox.inbox_item.status_changed',
    eventId: crypto.randomUUID(),
    ...args,
  }
}
```

Assertions throw in development. They do NOT change the return type (no `Result<T,E>`).

### 1.5 Event envelope

Every event type SHALL include these envelope fields:

```ts
type BaseEvent = Readonly<{
  eventId: string // UUID, generated at emit time by the constructor
  occurredAt: Date // Caller-provided (use case injects deps.clock())
  correlationId: string | null // Groups related events (bulk ops, workflows)
}>
```

- `eventId` is auto-generated inside the constructor. Callers do not pass it.
- `occurredAt` is caller-provided for test determinism. Add assertion: `assert(args.occurredAt instanceof Date)`.
- `correlationId` is optional — pass the same value when emitting multiple related events from one use case.

### 1.6 Flat payload

Event data stays flat at the root (no `data: { ... }` wrapper). Envelope fields (`eventId`, `occurredAt`, `correlationId`, `organizationId`) are siblings of domain-specific fields.

### 1.7 Union naming

One union per context: `{ContextName}Event`. Merge sub-entity unions:

```ts
// Before
type ReviewEvent = ReviewCreated | ReviewUpdated | ReviewExpired
type ReplyEvent = ReplyPublished | ...

// After
type ReviewEvent = ReviewCreated | ReviewUpdated | ReviewExpired
  | ReviewReplyPublished | ReviewReplySubmitted | ReviewReplyApproved | ReviewReplyRejected
```

### 1.8 File organization

One file per context: `domain/events.ts`. Monolithic. All event types, constructors, and the union in one file.

### 1.9 Field naming standards

| Concept        | Standard field name                                                 | Notes                                                            |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Timestamp      | `occurredAt`                                                        | Not `recordedAt`, not `createdAt` (that's for DB rows)           |
| Actor          | `userId`                                                            | Not `authorUserId`, `inviterId`, `changedBy`                     |
| Action target  | Descriptive: `assignedTo`, `removedBy`                              | These identify the SUBJECT of the action, not the actor          |
| Organization   | `organizationId`                                                    | Already consistent                                               |
| Property       | `propertyId`                                                        | Must be present on every event emitted by a use case that has it |
| Source origin  | `source: 'web' \| 'import'`                                         | Set at emit time                                                 |
| Ordered fields | `id, organizationId, propertyId, userId, ...payload..., occurredAt` | Required IDs first, data in the middle, timestamp last           |

---

## 2. Use Case Standards

### 2.1 Type naming

Every use case exports three types:

```ts
type {UseCaseName}Input = Readonly<{ ... }>    // What the caller passes
type {UseCaseName}Deps = Readonly<{ ... }>     // Dependencies injected at build time
type {UseCaseName} = ReturnType<typeof useCaseFn>  // Return type for consumers
```

Example:

```ts
export type AddInboxNoteInput = Readonly<{ ... }>
export type AddInboxNoteDeps = Readonly<{ ... }>
export type AddInboxNote = ReturnType<typeof addInboxNote>
```

**Shared deps:** Multiple use cases in the same file MAY share a single deps type if all dependencies are identical. Example: `ReplyDeps` for 6 reply operations.

### 2.2 Steps in order

```
1. Authorize     — can(role, 'resource.action')
2. Load entities — repo.findById()
3. Check rules   — domain rules, invariants
4. Build domain  — smart constructor, returns Result
5. Persist       — repo.insert() / repo.update()
6. Emit events   — await deps.events.emit(constructor({ ... }))
7. Return        — domain object or DTO
```

Skip steps that don't apply. Query: (1) + (5) + (7). Mutation: all 7.

---

## 3. Build Function Standards

### 3.1 Return shape

Every context build function SHALL return:

```ts
type ContextApi<T> = Readonly<{
  publicApi: T              // Cross-context boundary. Only this is imported by other contexts.
  internal: Readonly<{
    repos: { ... }          // Repositories for adapter wiring in composition.ts
    useCases: { ... }       // Use cases for server function wiring in composition.ts
    // Additional context-specific keys (e.g. storage, events) allowed if consumed by composition.ts only
  }>
}>
```

- `publicApi` — the ONLY cross-context boundary. Contains types, query functions, port interfaces.
- `internal.repos` — repositories accessible to cross-context adapters.
- `internal.useCases` — use cases accessible to server functions.

`composition.ts` may access `internal`. Other contexts may NOT import `internal`.

---

## 4. CONTEXT.md Standards

### 4.1 Required sections (in order)

Every `src/contexts/<name>/CONTEXT.md` SHALL contain:

| #   | Section                 | Content                                                     |
| --- | ----------------------- | ----------------------------------------------------------- |
| 1   | **Bounded context**     | One sentence: what this context does                        |
| 2   | **Glossary**            | Terms defined here, markdown table                          |
| 3   | **Relationships**       | Entity relationships (within context + cross-context)       |
| 4   | **Invariants**          | Rules that must always hold                                 |
| 5   | **Events produced**     | Table: `_tag` → payload fields → when emitted               |
| 6   | **Events consumed**     | Table: `_tag` → source context → handler action             |
| 7   | **Architecture layers** | Directory tree (standard format from `contexts/CONTEXT.md`) |
| 8   | **Use cases**           | Table: name → input → output → permission                   |
| 9   | **Public API**          | Exported types, functions, port interfaces                  |
| 10  | **Server functions**    | Table: name → method → permission → route                   |
| 11  | **Permissions**         | Role × permission matrix                                    |

### 4.2 Optional sections

Add only when the context genuinely has them:

- **Background jobs** — BullMQ jobs specific to this context
- **Ports** — lookup ports, queue ports defined by this context
- **Testing** — deviation notes, coverage gaps
- **Resolved decisions** — grill-with-docs outcomes captured inline

### 4.3 Removed sections

These do NOT belong in CONTEXT.md (move to appropriate location):

- **Language / Example dialogue** → belongs in prompt engineering docs, not the codebase
- **Flagged ambiguities** → resolve or log as GitHub Issues
- **Intentional deviations** → belongs in ADRs
- **Dependencies (inbound/outbound)** → "Events consumed" + "Ports" already cover this
- **Facade ports / Lookup ports** → merge into "Ports" optional section

---

## 5. Repository Standards

### 5.1 Port naming

- Interface: `{EntityName}Repository` (e.g., `InboxRepository`)
- Factory: `create{EntityName}Repository(db)` returning the interface
- File: `src/contexts/<name>/application/ports/<entity>.repository.ts`

### 5.2 Port signatures

- `insert(entry: DomainType): Promise<void>` — accepts the full domain type, no `Omit`
- `findById(id, orgId): Promise<DomainType | null>` — tenant-scoped
- `update(entry: DomainType): Promise<DomainType>` — full replacement
- Domain-generated IDs — no `defaultRandom()` on schema columns. Constructor receives ID from use case.

---

## 6. Dependency Rules

Re-affirming from `src/contexts/CONTEXT.md`:

| Layer             | Imports from                                        | Forbidden                        |
| ----------------- | --------------------------------------------------- | -------------------------------- |
| `domain/`         | itself, `shared/domain/`                            | async, I/O, framework imports    |
| `application/`    | `domain/`, `shared/domain/`, `shared/events/`       | DB queries, HTTP, React          |
| `infrastructure/` | `domain/`, `application/`, `shared/`, external libs | Business rules, HTTP routing     |
| `server/`         | `application/`, `shared/`, TanStack Start           | Business logic, direct DB access |

Cross-context: import ONLY from `application/public-api.ts`. Never from `domain/`, `infrastructure/`, `server/`.

---

## 7. Migration Path

Existing code is grandfathered. When refactoring a context:

1. Standardize `_tag` values and type names (Section 1)
2. Add event envelope fields and constructor assertions (Sections 1.4–1.5)
3. Standardize field names (Section 1.9)
4. Standardize CONTEXT.md sections (Section 4)
5. Standardize build function return shape (Section 3)
6. Standardize use case type exports (Section 2)
7. Update all subscribers and emitters

New contexts MUST follow all standards from inception.

---

## 8. File Naming Standards

### 8.1 File name conventions by layer

| Layer                         | Convention                                        | Example                                                             |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Domain                        | camelCase, single file per concept                | `constructors.ts`, `events.ts`, `types.ts`, `rules.ts`, `errors.ts` |
| Application ports             | kebab + `.port.ts` suffix                         | `review.repository.ts`, `attention-signals.port.ts`                 |
| Application use-cases         | kebab-case (mirrors use case name)                | `get-dashboard-data.ts`, `submit-reply.ts`                          |
| Application public API        | always `public-api.ts`                            | `public-api.ts`                                                     |
| Infrastructure repos          | kebab + `.repository.ts`                          | `badge.repository.ts`                                               |
| Infrastructure adapters       | kebab + `.adapter.ts`                             | `attention-signals.adapter.ts`, `db-user-lookup.adapter.ts`         |
| Infrastructure mappers        | kebab + `.mapper.ts`                              | `goal.mapper.ts`                                                    |
| Infrastructure jobs           | kebab + `.job.ts`                                 | `purge-expired-reviews.job.ts`                                      |
| Infrastructure event handlers | kebab + directory name                            | `on-review-created.ts`                                              |
| Server functions              | kebab-case                                        | `attention-signals.ts`, `auth-settings.ts`                          |
| Build function                | always `build.ts`                                 | `build.ts`                                                          |
| Schema                        | kebab + `.schema.ts` (single word: dot-separated) | `property.schema.ts`, `google-connection.schema.ts`                 |

### 8.2 Test file naming

Test files SHALL mirror the source file name with `.test.ts` / `.test.tsx` appended:

| Source                  | Test                         |
| ----------------------- | ---------------------------- |
| `constructors.ts`       | `constructors.test.ts`       |
| `get-dashboard-data.ts` | `get-dashboard-data.test.ts` |
| `review.repository.ts`  | `review.repository.test.ts`  |

### 8.3 Factory declaration style

All infrastructure factories (repos, adapters, mappers, job handlers) SHALL use arrow-const:

```ts
// CORRECT — arrow const
export const createReviewRepository = (db: Database): ReviewRepository => ({
  findById: async (id) => { ... },
})

// CORRECT — arrow const with intermediate statements
export const createBetterAuthIdentityAdapter = (db: Database): IdentityPort => {
  const auth = getAuth()
  return { ... }
}

// WRONG — function declaration (inconsistent with codebase convention)
export function createReviewRepository(db: Database): ReviewRepository {
  return { ... }
}
```

**Exception:** Domain constructors (`createBadgeDefinition`, `createActivityLog`, etc.) MAY use `export function` — they create domain entities, not infrastructure wiring.

## 9. Code Quality Tooling (Fallow)

Fallow (dead-code, complexity, boundaries) is a devDependency. Config + regression baseline: `.fallowrc.json` (audit.gate: new-only).

Self-check a changeset before committing:

```bash
pnpm exec fallow dead-code --changed-since origin/main --format json
```

Clean → proceed. A newly-orphaned export/file → remove it, but **confirm reachability first** with `pnpm exec fallow dead-code --trace <file>:<export> --format json`. Never delete to silence a finding.

**CI gate:** `.github/workflows/fallow.yml` runs `fallow audit --gate new-only` on every PR — the shared source of truth. It fails only on issues a PR introduces; the regression baseline never blocks.

**WIP caution:** the baseline may include unused exports/files in active work. Do not delete flagged WIP symbols without a `trace` confirming they are truly dead. Prefer `@expected-unused` or leave them for the feature to complete.

---

## Documentation map

Co-located context files in the source tree:

- Root: `CONTEXT.md` — glossary, architecture overview, pointers to layer docs
- Components: `src/components/CONTEXT.md` — folder structure, naming, forms, hooks
- Contexts: `src/contexts/CONTEXT.md` — layers, use cases, server functions, dependency rules
- Shared: `src/shared/CONTEXT.md` — auth, cache, observability, testing
- Routes: `src/routes/CONTEXT.md` — loaders, mutations, auth guards, staleTime
- Plan: `docs/plan/plan.md` — remaining phases
- ADRs: `docs/adr/`
- Auth migrations: `docs/auth-migrations.md`

---

## Related

- ADR 0010: Activity Context BullMQ Delivery
- Events master union: `src/shared/events/events.ts`
- Event bus: `src/shared/events/event-bus.ts`
- Layer guide: `src/contexts/CONTEXT.md`
- Root glossary: `CONTEXT.md`
