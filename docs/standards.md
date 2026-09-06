# Codebase Standards

**Status:** Accepted
**Date:** 2026-06-02
**Scope:** Entire `reputation-key/oslo` codebase

This document codifies naming, structural, and documentation standards for every
bounded context. It is subordinate to external obligations, the approved product
contract, and accepted superseding ADRs. A retained historical implementation is
never product authority merely because it predates this document.

## Standards tiers and enforcement

| Tier                | Meaning                                                                                                                               | Enforcement                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Invariant**       | Product correctness, authorization, tenant/data boundaries, durable state, recovery, capability posture, and client/server isolation. | Mechanically blocks every changed path and, where stated by a gate, the whole repository. No grandfathering.                      |
| **Maintainability** | Consistent interfaces, event/use-case/repository shapes, file names, factory forms, and documentation structure.                      | Required for new or materially modified code; existing variance migrates context-by-context and does not justify unrelated churn. |
| **Guidance**        | Readability and presentation preferences that do not change behavior or architectural boundaries.                                     | Review or formatter guidance; never a release claim by itself.                                                                    |

---

## 1. Event Standards (Invariant for meaning/envelope; Maintainability for shape)

### 1.1 Naming: `context.entity.verb`

Every event `_tag` follows `context.entity.verb`:

| Segment   | Rule                                                                                                                                                                       | Example     |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `context` | Bounded context name (activity, ai, badge, dashboard, goal, guest, identity, inbox, integration, leaderboard, metric, notification, portal, property, review, staff, team) | `review`    |
| `entity`  | Domain entity name (can contain underscores for multi-word: `portal_link`, `google_account`)                                                                               | `reply`     |
| `verb`    | Past-tense action (can contain underscores: `status_changed`, `visibility_changed`)                                                                                        | `published` |

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

## 2. Use Case Standards (Invariant for authorization/errors; Guidance for type shape)

### 2.1 Type naming (Guidance — not gated)

This naming shape is guidance, not a gated requirement. New or materially modified use cases should export three types:

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

**Error contracts (Invariant):** Pure domain validation and constructors return `Result<T, TaggedError>` and retain `neverthrow`. Application use cases throw real, enumerable tagged errors for business failures; do not propagate `Result` through async orchestration only for ceremony. Ordinary alternatives use explicit outcome unions. Infrastructure failures are translated only when the domain can handle them meaningfully. The delivery boundary maps tagged errors once to safe server errors and sanitizes unexpected programmer, configuration, or corrupt-state failures. See `src/contexts/CONTEXT.md` for the authoritative layer table.

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

## 3. Build Function Standards (Invariant for boundaries; Maintainability for shape)

### 3.1 Return shape

Every context build function SHALL return `publicApi` plus NAMED capability groups.
A capability group states what a class of consumer may do; it never publishes a
repository, a command store, or a bag of use cases.

```ts
type ContextApi<T> = Readonly<{
  publicApi: T            // Cross-context boundary. Only this is imported by other contexts.
  worker?: { ... }        // Job/consumer registration and worker-owned operations.
  maintenance?: { ... }   // Bounded, reviewed operator repair capabilities.
  lifecycle?: { ... }     // Cross-context workflow authority (no request surface).
  webhook?: { ... }       // Authenticated provider ingress handlers.
  // Additional context-named groups where the context genuinely owns one,
  // e.g. `responsibility`, `assignments`, `delivery`, `uploads`, `lookups`.
}>
```

- `publicApi` — the ONLY cross-context boundary. Types, query functions, ports.
- Every other group is named for the CAPABILITY it grants, not for the layer it
  came from. `portal.responsibility.releaseForUser` is a capability;
  `portal.internal.repos.portalResponsibleManagerRepo` is a leaked repository.

**The composition root consumes capability groups only.** It does not read a
context's private wiring, and there is no production `.internal` reach-through.
The single documented exception is the simulation runtime, which is guarded by
`options?.exposeSimulationRuntime` and is absent from every application
container.

`internal` MAY be retained by a context as its own private wiring seam — for
example so the context's `build.test.ts` can assert construction — but it is
never an input to composition, and no other context may import it. A build that
publishes `internal.repos` for the composition root to consume does not meet
this standard.

See `docs/architecture/composition-and-process-boundaries.md` for the process
boundaries these capability groups are projected onto.

---

## 5. Repository Standards (Invariant for tenant scope; Maintainability for shape)

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

## 6. Dependency Rules (Invariant)

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

Existing maintainability variance is migrated deliberately. It does not exempt
an existing path from an Invariant. When materially refactoring a context:

1. Standardize `_tag` values and type names (Section 1)
2. Add event envelope fields and constructor assertions (Sections 1.4–1.5)
3. Standardize field names (Section 1.9)
4. Standardize build function return shape (Section 3)
5. Standardize use case type exports (Section 2)
6. Update all subscribers and emitters

New contexts MUST follow all Invariant and Maintainability standards from
inception.

## 8. File Naming and Factory Standards

### 8.1 File name conventions by layer (Guidance — not gated)

| Layer                         | Convention                                        | Example                                                             |
| ----------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Domain                        | camelCase, single file per concept                | `constructors.ts`, `events.ts`, `types.ts`, `rules.ts`, `errors.ts` |
| Application ports             | kebab + `.port.ts` suffix                         | `review.repository.ts`, `attention-signals.port.ts`                 |
| Application use-cases         | kebab-case (mirrors use case name)                | `get-dashboard-data.ts`, `submit-reply.ts`                          |
| Application public API        | always `public-api.ts`                            | `public-api.ts`                                                     |
| Infrastructure repos          | kebab + `.repository.ts`                          | `review.repository.ts`                                              |
| Infrastructure adapters       | kebab + `.adapter.ts`                             | `attention-signals.adapter.ts`, `db-user-lookup.adapter.ts`         |
| Infrastructure mappers        | kebab + `.mapper.ts`                              | `goal.mapper.ts`                                                    |
| Infrastructure jobs           | kebab + `.job.ts`                                 | `purge-expired-reviews.job.ts`                                      |
| Infrastructure event handlers | kebab + directory name                            | `on-review-created.ts`                                              |
| Server functions              | kebab-case                                        | `attention-signals.ts`, `auth-settings.ts`                          |
| Build function                | always `build.ts`                                 | `build.ts`                                                          |
| Schema                        | kebab + `.schema.ts` (single word: dot-separated) | `property.schema.ts`, `google-connection.schema.ts`                 |

### 8.2 Test file naming (Guidance — not gated)

Test files should mirror the source file name with `.test.ts` / `.test.tsx` appended:

| Source                  | Test                         |
| ----------------------- | ---------------------------- |
| `constructors.ts`       | `constructors.test.ts`       |
| `get-dashboard-data.ts` | `get-dashboard-data.test.ts` |
| `review.repository.ts`  | `review.repository.test.ts`  |

## 9. Code Quality Tooling (Invariant gates plus Maintainability migration)

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
- Archive: `docs/archive/` — superseded plans and closed programmes (historical only)
- ADRs: `docs/adr/`
- ADR navigation and supersession authority: `docs/adr/README.md`
- Beta capability fate authority: `src/shared/governance/capability-fate.ts`
- Auth migrations: `docs/auth-migrations.md`

---

## Related

- ADR 0010: Activity Context BullMQ Delivery
- Events master union: `src/shared/events/events.ts`
- Outbox commit + delivery: `src/shared/outbox/commit.ts`, `src/shared/outbox/relay.ts`, `src/shared/outbox/dispatcher.ts`
- Layer guide: `src/contexts/CONTEXT.md`
- Root glossary: `CONTEXT.md`
