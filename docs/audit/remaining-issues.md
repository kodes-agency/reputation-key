# Remaining Issues — Post-Audit

Generated from comprehensive codebase audit (172 findings triaged).
All CRITICAL, HIGH, MAJOR, MEDIUM, LOW, and MINOR code-fix items resolved.
Below are items requiring architectural decisions, product input, or test coverage work.

---

## 1. Architectural Decisions Needed

These items need design before implementation. Each has significant cross-cutting impact.

### 1.1 Webhook Replay Protection (F058)

- **File**: `src/routes/api/webhooks/`
- **Issue**: No idempotency key or replay detection on webhook endpoints
- **Impact**: Duplicate webhook deliveries cause duplicate processing
- **Decision needed**: Redis-based dedup cache? DB idempotency log? TTL window?
- **Priority**: HIGH

### 1.2 Rate Limiting Design (F059)

- **File**: `src/shared/auth/middleware.ts`
- **Issue**: No rate limiting on server functions or API endpoints
- **Impact**: Vulnerable to abuse on public endpoints (invite links, password reset)
- **Decision needed**: Per-IP? Per-user? Redis sliding window? Fixed window?
- **Priority**: HIGH

### 1.3 Event Sourcing / Audit Trail (F060)

- **File**: `src/shared/events/`
- **Issue**: Events are fire-and-forget. No persistent event log for replay/debugging
- **Impact**: Cannot reconstruct state from events; lost events = lost history
- **Decision needed**: Event store table? Outbox pattern? Separate event DB?
- **Priority**: MEDIUM

### 1.4 Composition Locking Strategy (F061)

- **File**: `src/composition.ts`
- **Issue**: No distributed lock during bootstrap. Multiple instances could race on initialization
- **Impact**: Potential duplicate event handler registration in multi-instance deployments
- **Decision needed**: Redis lock? DB advisory lock? Single-instance constraint?
- **Priority**: MEDIUM

### 1.5 Real-time Notification Architecture (F062)

- **File**: `src/contexts/inbox/`
- **Issue**: No push notifications. Clients must poll for inbox changes
- **Impact**: Poor UX for time-sensitive review responses
- **Decision needed**: SSE? WebSocket? Push notifications? Redis pub/sub?
- **Priority**: MEDIUM

### 1.6 Multi-tenant Query Optimization (F063)

- **File**: `src/contexts/dashboard/`
- **Issue**: Dashboard aggregation queries run per-request. No materialized views or caching
- **Impact**: Slow dashboard loads at scale; N+1 on property metrics
- **Decision needed**: Materialized views? Redis cache with TTL? Background aggregation job?
- **Priority**: MEDIUM

### 1.7 File Upload / Attachment Architecture (F064)

- **File**: `src/contexts/review/`
- **Issue**: Reviews mention attachments in domain types but no upload pipeline exists
- **Impact**: Feature gap — users cannot attach images to replies
- **Decision needed**: S3 presigned URLs? Base64 inline? Size limits? CDN?
- **Priority**: LOW

### 1.8 Bulk Operation Framework (F065)

- **File**: `src/contexts/inbox/`
- **Issue**: Bulk operations (assign, status change) are ad-hoc per use case
- **Impact**: No consistent bulk pattern; each new bulk op requires custom error handling
- **Decision needed**: Generic batch processor? Queue-based? Chunk size strategy?
- **Priority**: LOW

### 1.9 Database Migration Strategy (F066)

- **File**: `drizzle.config.ts`
- **Issue**: New schema indexes (portal_groups, recurring goals) need generated migrations
- **Impact**: Indexes only exist after `drizzle-kit generate` + deploy
- **Decision needed**: Migration naming convention? Rollback strategy? Zero-downtime?
- **Priority**: HIGH (blocks deployed indexes)

### 1.10 Error Monitoring Integration (F067)

- **File**: `src/shared/observability/`
- **Issue**: Logger exists but no error monitoring service (Sentry, Honeybadger, etc.)
- **Impact**: Production errors invisible without log tailing
- **Decision needed**: Which service? Sampling rate? Source map upload?
- **Priority**: MEDIUM

### 1.11 CORS / Security Headers (F068)

- **File**: `src/server.ts`
- **Issue**: No explicit CORS configuration or security headers (HSTS, CSP, X-Frame)
- **Impact**: Browser security relies on defaults; no CSP to prevent XSS
- **Decision needed**: Which origins? CSP policy? Helmet middleware?
- **Priority**: MEDIUM

### 1.12 Health Check Endpoint (F069)

- **File**: `src/server.ts`
- **Issue**: No `/health` endpoint for load balancer / orchestrator probes
- **Impact**: Cannot do zero-downtime deploys; orchestrators can't detect unhealthy instances
- **Decision needed**: Liveness vs readiness? DB connectivity check? Dependency probes?
- **Priority**: LOW

### 1.13 Graceful Shutdown (F070)

- **File**: `src/server.ts`
- **Issue**: No SIGTERM handler. In-flight requests dropped on deploy
- **Impact**: Potential data loss on rolling deploys
- **Decision needed**: Drain timeout? Connection pool cleanup? Job cancellation?
- **Priority**: LOW

### 1.14 API Versioning Strategy (F071)

- **File**: `src/routes/api/`
- **Issue**: No versioning on API routes. Breaking changes affect all clients
- **Impact**: Cannot evolve API without breaking existing integrations
- **Decision needed**: URL versioning? Header versioning? No versioning (internal only)?
- **Priority**: LOW

---

## 2. Product Decisions Needed

### 2.1 HTTP Links in Review Responses (F160)

- **File**: `src/contexts/review/domain/rules.ts`
- **Issue**: `validateUrl` currently allows `http:` and `https:` only. Product should decide if all HTTP links are acceptable or only specific domains
- **Impact**: Could allow phishing/malware links in public review responses
- **Decision needed**: Allowlist? OEmbed preview? Link warnings?

### 2.2 Inline Edit-and-Resubmit UX (F094)

- **File**: `src/components/inbox/reply-editor-actions.tsx`
- **Issue**: `onEditResubmit` is a placeholder (no-op). Product should define the edit-and-resubmit workflow
- **Impact**: Feature gap — users cannot edit draft responses inline
- **Decision needed**: Full inline editor? Modal? Version history?

---

## 3. Test Coverage Gaps

These files have logic paths not covered by automated tests. Not bugs — just missing coverage.

| ID  | File                                                                   | Gap                                                                                    |
| --- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| T01 | `src/contexts/goal/infrastructure/jobs/reconcile-goal-progress.job.ts` | No test for reconciliation edge cases (orphaned progress, concurrent reconciliation)   |
| T02 | `src/contexts/staff/application/use-cases/bulk-assign-portals.ts`      | No test for partial failure (some assignments succeed, some fail)                      |
| T03 | `src/contexts/portal/application/use-cases/smart-routing.ts`           | No test for threshold boundary (1 vs 5 portals) with actual routing                    |
| T04 | `src/contexts/inbox/infrastructure/adapters/redis-new-counter.ts`      | No test for Redis connection failure fallback                                          |
| T05 | `src/shared/auth/middleware.ts`                                        | No test for cache eviction under memory pressure                                       |
| T06 | `src/contexts/review/infrastructure/repositories/reply.repository.ts`  | No test for `conditionalUpdate` race condition (status changed between read and write) |
| T07 | `src/contexts/team/application/use-cases/soft-delete-team.ts`          | No test for assignment check returning >0 (only 0 is tested)                           |
| T08 | `src/contexts/identity/application/use-cases/remove-member.ts`         | No test for last-admin guard with multiple admins (only single admin tested)           |

---

## 4. Known By-Design Patterns (Not Issues)

These patterns were flagged during audit but confirmed as intentional architecture decisions.

| Pattern                                          | Location                 | Rationale                                                                                   |
| ------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------- |
| `'' as BrandedId` sentinel in event constructors | `src/shared/events/`     | Events use empty string as "not yet set" marker. Event bus wraps all handlers in try/catch. |
| `Promise.allSettled` + inner try/catch           | `src/contexts/review/`   | Defense-in-depth for parallel operations                                                    |
| `UnreachableError` as class (not function)       | `src/shared/domain/`     | Explicitly allowed by AGENTS.md                                                             |
| `                                                |                          | null` for empty-string coercion                                                             | Event handlers | Correct pattern for coercing empty-string sentinels to null |
| 2-part event names (`context.verb`)              | All contexts             | §1.1 shorthand: when context === entity, omit entity segment                                |
| Application layer throws                         | Use cases                | CONTEXT.md line 137: "Application: Throws tagged errors on Result.isErr()"                  |
| Activity `resourceId`/`resourceType` as strings  | `src/contexts/activity/` | Polymorphic reference pattern — different entity types share same fields                    |
| BullMQ payloads with raw strings                 | Job files                | Serialization boundary — branded IDs must be serialized to strings for Redis                |

---

## Summary Statistics

| Category                        | Count  | Status                             |
| ------------------------------- | ------ | ---------------------------------- |
| Architectural decisions         | 14     | Needs design before implementation |
| Product decisions               | 2      | Needs product input                |
| Test coverage gaps              | 8      | No bugs, but uncovered paths       |
| By-design patterns              | 8      | Confirmed intentional, no action   |
| **Total remaining**             | **32** |                                    |
| **Total resolved (this audit)** | **93** | Fixed across 219 files             |
