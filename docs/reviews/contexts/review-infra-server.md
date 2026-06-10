# Review Context — Infrastructure & Server Layer Review

**Reviewed:** 2026-06-10  
**Scope:** `src/contexts/review/infrastructure/` and `src/contexts/review/server/`  
**Dimensions:** D5 (Repository Ports), D7 (Multi-Tenancy), D8 (Server Functions), D12 (Context Doc Accuracy), D15 (Error Handling)

## Summary

| Severity | Count |
| -------- | ----- |
| BLOCKER  | 0     |
| MAJOR    | 3     |
| MINOR    | 4     |
| NIT      | 3     |

---

## Findings

### D15 — Error Handling

````
[D15] [MAJOR] throw new Error in infrastructure repository — violates "no throw new Error in domain/application" boundary
  File: src/contexts/review/infrastructure/repositories/review.repository.ts:93
  Quote: ```throw new Error('Review upsert failed — no row returned')```
  Rule:  D15 — No throw new Error in domain/application; infrastructure should use domain error types or explicit error returns
  Fix:   Either use a ReviewError via reviewError() factory, or return a Result type. The upsert returning no rows is a genuine failure state that should be expressed as a domain error.
````

````
[D15] [MAJOR] throw new Error in infrastructure repository — same pattern as review upsert
  File: src/contexts/review/infrastructure/repositories/reply.repository.ts:99
  Quote: ```throw new Error('Reply upsert failed — no row returned')```
  Rule:  D15 — Consistent error envelope; no bare throw new Error
  Fix:   Same as above — use reviewError() factory or Result type.
````

````
[D15] [MAJOR] throw new Error in infrastructure mapper — invalid data from DB should not be bare Error
  File: src/contexts/review/infrastructure/mappers/review.mapper.ts:23-24
  Quote: ```
  if (!VALID_PLATFORMS.has(row.platform)) {
    throw new Error(`Invalid review platform from DB: ${row.platform}`)
````

Rule: D15 — Consistent error handling; bare Error gives no structured recovery path
Fix: Create a dedicated DbCorruptionError or use the shared error factory. The validation itself is good — the error shape is the issue.

```

### D7 — Multi-Tenancy

```

[D7] [NIT] Cross-tenant query methods are well-documented and correctly scoped
File: src/contexts/review/infrastructure/repositories/review.repository.ts:130-152
Quote: `/** ⚠️ CROSS-TENANT: Reviews where expiresAt <= date ... Scans ALL orgs. Only for background jobs. */`
Rule: D7 — Cross-tenant queries require explicit documentation and restricted usage
Fix: No fix needed — both findAllExpiringBeforeAcrossTenants and findAllExpiredBeforeAcrossTenants are clearly documented, correctly omit organizationId from signatures, and are only called from system-level jobs. The purge job correctly re-scopes per review using deleteById(review.id, review.organizationId). Good practice.

```

```

[D7] [NIT] All tenant-scoped queries correctly include organizationId in WHERE clause
File: src/contexts/review/infrastructure/repositories/review.repository.ts (all methods)
Rule: D7 — Every DB query on tenant-owned table has organizationId
Fix: Verified all methods: findById (L27), findByIds (L40), findByExternalId (L59), findByPropertyId (L107), findByOrganizationId (L124), deleteById (L158), deleteByPropertyId (L169). All correct. Reply repo similarly correct across all 7 methods.

```

### D5 — Repository & Port Standards

```

[D5] [MINOR] Repository factory function signature matches port — no issues
File: src/contexts/review/infrastructure/repositories/review.repository.ts:21
Quote: `export const createReviewRepository = (db: Database): ReviewRepository => ({`
Rule: D5 — Port: {Entity}Repository interface, create{Entity}Repository(db) factory
Fix: Convention followed correctly. Both createReviewRepository and createReplyRepository take (db: Database) and return the respective port type.

```

```

[D5] [MINOR] Domain-generated IDs used correctly — upsert does not auto-generate IDs
File: src/contexts/review/infrastructure/repositories/review.repository.ts:67-97
Rule: D5 — Domain-generated IDs, adapter returns domain types
Fix: Upsert receives a pre-built domain object (with ID already set by idGen in build.ts). The adapter maps to rows and returns domain types via reviewFromRow/replyFromRow. Correct.

```

```

[D5] [MINOR] Adapter returns domain types via mapper functions
File: src/contexts/review/infrastructure/mappers/review.mapper.ts:20-51
Quote: `export const reviewFromRow = (row: ReviewRow): Review => {`
Rule: D5 — Adapter returns domain types
Fix: Both reviewFromRow and replyFromRow rebrand raw DB values into domain IDs. replyFromRow uses null-coalescing for nullable userId fields. Correct.

```

### D8 — Server Functions

```

[D8] [NIT] All server functions follow tracedHandler + can(role, permission) pattern
File: src/contexts/review/server/reply.ts, reply-draft.ts, reply-read.ts
Rule: D8 — Wrapped in tracedServerFn, auth middleware, input validation, permission check, use case from composition
Fix: All 7 server functions (getReply, draftReply, submitReply, approveReply, rejectReply, deleteReply, retryPublish) follow the pattern: createServerFn → inputValidator → tracedHandler → resolveTenantContext → can(ctx.role, 'reply.manage') → getContainer().useCases → catch isReviewError. Consistent and correct.

```

```

[D8] [MINOR] staff-recent-activity uses reviewRepo directly instead of a use case
File: src/contexts/review/server/staff-recent-activity.ts:51-55
Quote: `const recentReviews = await container.reviewRepo.findByPropertyId(
            propertyId,
            ctx.organizationId,
            { limit: 5 },
          )`
Rule: D8 — Server functions should call use cases from composition root, not access repositories directly
Fix: The server function bypasses the use case layer and calls container.reviewRepo directly. While this is a read-only query with no business logic, it violates the D8 pattern of routing through use cases. Consider wrapping in a getRecentReviews use case or document why direct repo access is acceptable here.

```

### D12 — Context Documentation Accuracy

```

[D12] [MINOR] CONTEXT.md lists only reply.ts and staff-recent-activity.ts under server/, but actual files include reply-draft.ts and reply-read.ts
File: src/contexts/review/CONTEXT.md:66
Quote: `server/              reply.ts, staff-recent-activity.ts`
Rule: D12 — CONTEXT.md claims must match actual code
Fix: Update CONTEXT.md to list all four server files: `reply.ts, reply-draft.ts, reply-read.ts, staff-recent-activity.ts`. The code was split but the documentation was not updated.

```

```

[D12] [MAJOR] CONTEXT.md says server functions are in reply.ts — but reply.ts re-exports from reply-draft.ts and reply-read.ts
File: src/contexts/review/CONTEXT.md:91
Quote: `reply.ts — Server functions for reply CRUD operations (draft, submit, approve, reject, delete, retry). All require PM+ role.`
Rule: D12 — CONTEXT.md claims must match actual code architecture
Fix: Update the server functions section to document the three-file structure: reply.ts (reject, delete, retry + re-exports), reply-draft.ts (draft, submit, approve), reply-read.ts (getReply + shared DTOs/error mapping). Also note that getReply requires reply.manage permission but is a GET — the CONTEXT.md does not mention getReply at all.

```

### D15 — Error Handling (continued)

```

[D15] [NIT] build.ts throws bare Error for missing jobQueue
File: src/contexts/review/build.ts:64
Quote: `if (!input.jobQueue) throw new Error('jobQueue required')`
Rule: D15 — No bare throw new Error
Fix: This is in the composition root (startup path), not runtime. Low severity, but a configuration error type would be more idiomatic. Acceptable as-is.

```

```
