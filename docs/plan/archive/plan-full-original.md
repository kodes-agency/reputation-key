# Neon Reputation — Phased Build Plan

## Philosophy

This plan is a sequence of small, verifiable increments. Each phase ends with a **gate** — a set of concrete checks you can perform to decide whether the phase is actually done, not just "I think it's done." You don't move on until the gate passes.

**Priorities in order:** correctness, testability, cleanliness, speed. Never trade the first three for the fourth.

**Rule of thumb:** a phase that takes 50% longer than expected because you're doing it right is fine. A phase that ships with unknown behavior is not.

**Every phase produces:** working code, passing tests, a git commit. No phase ends with half-working code or "we'll fix that later" todos.

---

## Arc 1 — Foundation (Phases 1-4)

Before anything else, we need a runnable system with a clean architecture skeleton, auth, and multi-tenancy. No product features yet. By the end of this arc, a user can sign up, create an organization, and be authenticated. That's the whole deliverable.

### Phase 1 — Repository setup and hello-world

**Goal.** A TanStack Start app running locally, deployed to Railway staging, connected to a Neon database, with CI running tests on every push.

**Why now.** Establishes the concrete foundation everyone else assumes. If any of this is wrong, everything built on top is wrong.

**Scope (in).**

- pnpm workspace with a single app (we'll split if needed later — for solo, one package is simpler)
- TanStack Start scaffolded, React, TypeScript strict mode, ESLint 9 flat config, Prettier
- Drizzle configured with a `postgres` driver and Neon connection string
- better-auth installed and minimally configured (no UI yet, just the handler mounted)
- Vitest configured, with a single smoke test that imports from the app and passes
- Environment variable loading via Zod-validated schema in `shared/config/env.ts`
- Health check endpoint (`/api/health`) that returns DB and Redis connectivity status
- GitHub Actions CI: install, typecheck, lint, test on every push
- Railway deployment: two services (web + worker), Redis plugin, Neon connection
- Staging environment live, `/api/health` reachable over HTTPS

**Scope (out).**

- Any product features
- Real auth UI — we'll do that in Phase 2
- Any database tables beyond what better-auth generates
- Production environment (staging only for now)

**Gate criteria.**

- `pnpm dev` starts TanStack Start locally without errors
- Local `/api/health` returns 200 with `{ db: true, redis: true }`
- `pnpm test` runs the smoke test and exits with code 0
- `pnpm typecheck` passes with strict mode and no warnings
- Staging URL reachable, `/api/health` returns 200 over HTTPS
- CI pipeline runs and passes on a test PR
- Folder structure matches the architecture we designed (`contexts/`, `shared/`, `routes/`, etc.) — even if most folders are empty

**Open questions to resolve during this phase.**

- Exact Node version to pin (likely 22 LTS, whatever's current)
- Whether the worker entry runs at all yet (probably just a "hello, I'm the worker" process until Phase 3)
- Whether to enable Railway PR preview environments now or later (I'd say now — they're cheap once set up)

**Rough effort.** 2-3 days solo. Mostly configuration and getting the deploy pipeline smooth.

**Phase after this.** Auth and tenancy.

---

### Phase 2 — Authentication foundation

**Goal.** A user can register with email + password, log in, log out, and reset their password. better-auth is fully wired in, sessions are database-backed, and auth middleware is working for a single placeholder protected route.

**Why now.** Auth is a prerequisite for everything tenant-scoped. Do this before any business domain code because every server function needs it.

**Scope (in).**

- better-auth with email+password provider configured
- Drizzle schema for better-auth tables (`user`, `session`, `account`, `verification`) generated and migrated
- Email sending set up via Resend for verification and password reset emails
- Login, register, password reset UI pages at `/login`, `/register`, `/reset-password`
- `useSession()` hook working on the client side
- `authMiddleware` in `shared/auth/middleware.ts` that attaches user to server function context
- Protected placeholder route `/dashboard` that redirects to `/login` if not authenticated
- Tests: at least one integration test verifying the full register → login → access-protected-route flow

**Scope (out).**

- Organizations (that's Phase 3)
- Role-based access (Phase 3)
- Admin plugin (later)
- 2FA (much later)
- Social login (probably never, or later)

**Gate criteria.**

- User can register on staging with a real email, receive the verification email, click the link, be marked verified
- User can log in, be taken to `/dashboard`, log out, and be redirected to `/login`
- Password reset flow works end-to-end
- Hitting `/dashboard` unauthenticated redirects to `/login`
- `authMiddleware` correctly rejects requests without a valid session and accepts requests with one
- Integration tests for the full auth flow pass locally and in CI

**Open questions to resolve during this phase.**

- Exact email templates (we'll draft simple ones, polish later)
- Whether to allow unverified users to log in (better-auth default is no; let's keep that)
- Session duration — suggest 30 days rolling, configurable via env

**Rough effort.** 3-4 days. The tricky parts are email deliverability testing and getting the protected-route redirect behavior right across SSR and client-side navigation.

**Phase after this.** Organizations and tenancy.

---

### Phase 3 — Organizations and tenancy

**Goal.** better-auth's organization plugin is integrated. A user can create an organization during registration (or after). Invitations work: an AccountAdmin can invite someone by email, they receive a link, accept, and join the org with the assigned role. The `tenantMiddleware` is wired up and every authenticated server function has access to `{ userId, organizationId, role }`.

**Why now.** Tenancy is the structural invariant of the whole app. Every subsequent table has `organization_id`. Every subsequent server function needs the tenant context. Get this right now or pay for it forever.

**Scope (in).**

- better-auth organization plugin configured
- Drizzle schema for `organization`, `member`, `invitation` tables (better-auth generates these)
- Registration flow creates user + organization in one step (user becomes owner) — route: `/register`
- Separate "join" flow for invited users (creates user account only, no organization) — route: `/join`
- Invitation UI: AccountAdmin can invite by email + role from a settings page
- Invitation acceptance: user clicks link in email, arrives at `/accept-invitation?id=...`. If unauthenticated, redirected to `/join?redirect=/accept-invitation?id=...` (not `/login` — most invitees are new users). After registering, they're sent back to accept the invitation. If they already have an account, they can navigate to `/login` instead.
- `tenantMiddleware` in `shared/auth/middleware.ts` that extracts active organization from session and attaches `{ userId, organizationId, role }` to context
- Permission checks via better-auth's `createAccessControl` system: a single statement of all resources × actions defined in `shared/auth/permissions.ts`, with default roles (owner, admin, member) passed to both the `organization()` server plugin and `organizationClient()` client plugin
- Role mapping: better-auth's `owner` = AccountAdmin, `admin` = PropertyManager, `member` = Staff
- Server functions check permissions via `auth.api.hasPermission({ body: { permissions: { resource: ['action'] } } })` — replaces the old `roleGuard()` function and the hand-rolled `canXxx()` functions
- Audit log table (`audit_logs`) with a minimal implementation — we'll use it more later
- Tests: unit tests for permission logic, integration tests for invitation flow

**Scope (out).**

- SuperAdmin role (add later via better-auth admin plugin — separate from org roles)
- Dynamic access control (runtime custom roles) — deferred until Phase B; current system uses code-defined roles only
- Organization switcher UI (most users will have one org; add later if needed)
- Role changes after invitation (later)
- Deactivation/removal of members (later)

**Gate criteria.**

- A new user can register at `/register` and an organization is created for them
- The registering user is assigned the AccountAdmin role in the new organization
- An AccountAdmin can invite another user by email + role; the invitation email is delivered
- The invitee can register at `/join` (no org name required), then accept the invitation and is added to the organization with the correct role
- The invitation email links to `/accept-invitation?id=...`; unauthenticated users are redirected to `/join?redirect=...`
- A user who already has an account can log in at `/login` and then accept the invitation
- `tenantMiddleware` correctly resolves `organizationId` for authenticated requests and rejects if the user isn't a member of the active organization
- Permission check `auth.api.hasPermission({ permissions: { property: ['create'] } })` correctly allows/rejects based on the role's granted actions
- Permission definitions in `shared/auth/permissions.ts` have test coverage verifying each role's allowed actions
- Integration test: full flow (owner signs up → invites admin → admin registers at /join → accepts invitation → admin is in org as PropertyManager) passes

**Open questions to resolve during this phase.**

- Whether to support users being in multiple organizations (better-auth does; we allow it but defer the org-switcher UI)
- Invitation expiry duration (suggest 7 days)
- What to do if someone accepts an expired invitation (show clear message, offer to request new invite)

**Rough effort.** 4-5 days. The invitation flow has edge cases that need testing.

**Phase after this.** Testing infrastructure and shared plumbing.

---

### Phase 4 — Testing infrastructure and shared plumbing

**Goal.** Before building any business features, set up the testing infrastructure that will make every subsequent phase faster. Also build the shared plumbing (event bus, cache, rate limit, jobs) that every context will depend on.

**Why now.** Building this before the first business context means every business context gets to use it from day one. Retrofitting is painful. A day of infrastructure investment here saves weeks across the project.

**Scope (in).**

- `shared/testing/in-memory-repos.ts` — base patterns for in-memory repository implementations (template to copy per context)
- `shared/testing/fixtures.ts` — fixture builders for domain types (`buildTestAuthContext`, etc.)
- `shared/testing/db.ts` — helper for setting up/tearing down a Neon test branch per test suite
- `shared/events/event-bus.ts` — in-process event bus implementation with typed `emit` and `on`
- `shared/events/events.ts` — the master `DomainEvent` union (initially empty, contexts will add their events)
- `shared/jobs/queue.ts` — BullMQ queue factory
- `shared/jobs/worker.ts` — BullMQ worker factory
- `shared/jobs/registry.ts` — pattern for registering job handlers
- `shared/cache/redis.ts` — Redis client factory (shared with BullMQ)
- `shared/cache/cache.port.ts` — Cache port interface + Redis implementation
- `shared/rate-limit/middleware.ts` — rate limiting middleware using Redis
- `shared/observability/logger.ts` — structured logger (pino) configured for dev and prod
- `shared/observability/errors.ts` — Sentry setup
- `shared/domain/result.ts` — re-exports from neverthrow
- `shared/domain/pattern.ts` — re-exports from ts-pattern
- `shared/domain/brand.ts` — Brand type utility
- `shared/domain/ids.ts` — `OrganizationId`, `UserId` branded types
- `composition.ts` — container pattern, builds all the above at startup
- `bootstrap.ts` — registers event handlers and job handlers (empty for now)
- Sample "health-check" background job that runs every 5 minutes and logs DB/Redis connectivity — verifies the whole job pipeline works

**Scope (out).**

- Any context-specific code
- Actual business events (contexts will add them)
- Specific adapters like GBP, AI, FCM (contexts will add them)

**Gate criteria.**

- Event bus tests pass: events can be emitted and subscribed to, with correct type inference
- Cache tests pass: can get/set/delete, handles missing keys correctly, errors degrade gracefully
- Rate limit middleware tests pass: blocks requests over limit, resets after window
- Logger outputs structured JSON in production mode, human-readable in dev
- BullMQ health-check job runs every 5 minutes on Railway worker, logs are visible
- Running `pnpm test` executes all shared tests in under 5 seconds (fast feedback loop verified)
- Running `pnpm test:integration` executes integration tests against a real Neon branch in under 60 seconds
- `composition.ts` can be called with mock env and returns a fully wired container

**Open questions to resolve during this phase.**

- Exact Sentry DSN and sampling rate (can defer until staging has real errors)
- Whether to use `pino-pretty` for local dev (yes, probably)
- Test database strategy — Neon branching per test suite vs. Docker Postgres vs. transactions-with-rollback (suggest Neon branching for integration tests, pure in-memory for unit tests)

**Rough effort.** 3-4 days. The work is mostly configuration, but getting the whole pipeline (test DB lifecycle, CI running integration tests, Sentry connected) smooth takes real time.

**Phase after this.** First business context: Property.

---

## Arc 2 — Core Domain Scaffolding (Phases 5-6)

With foundation in place, we build the boring-but-essential entities that everything else depends on.

### Phase 5 — Property context (complete vertical slice)

**Goal.** First real business context. User can create, list, update, and soft-delete properties within their organization. This phase is the template — every subsequent context follows the same shape. We spend extra time here establishing patterns that will be repeated many times.

**Why now.** Properties are the organizational unit everything else lives under (portals, reviews, feedback, metrics). And doing one full vertical slice early validates the architecture in practice, before we've repeated patterns 9 times.

**Scope (in).**

- `contexts/property/` with full layer structure:
  - `domain/` — `types.ts`, `rules.ts`, `constructors.ts`, `events.ts`, `errors.ts`
  - `application/ports/` — `property.repository.ts`
  - `application/dto/` — Zod schemas for all input/output shapes
  - `application/use-cases/` — create, update, list, get, soft-delete
  - `infrastructure/repositories/` — Drizzle implementation
  - `infrastructure/mappers/` — row ↔ domain
  - `server/` — TanStack Start server functions
- `shared/db/schema/property.schema.ts` — table definition, migration generated
- Property management UI at `/properties` (list + create + edit + delete)
- Tests:
  - Domain: 100% coverage on rules, constructors, errors
  - Use cases: 100% coverage using in-memory repos
  - Repository: integration tests against real DB, including tenant isolation test (attempt cross-tenant query, assert empty result)
  - Server functions: integration tests for happy path and error paths (403, 404, 400)
- One E2E test: user logs in, creates a property, sees it in the list, edits it, deletes it

**Scope (out).**

- Teams (Phase 6)
- Staff assignments (Phase 6)
- Any property-level settings beyond name/slug/timezone/gbp_place_id

**Gate criteria.**

- AccountAdmin can create a property with name, slug, timezone, optional GBP place ID
- Property slug is unique per organization
- Property appears in the list immediately after creation
- AccountAdmin can edit all fields
- AccountAdmin can delete (soft delete) — property disappears from list but row is preserved in DB
- PropertyManager can view but not delete (only AccountAdmin can)
- Staff cannot create properties
- Attempting to access a property from another organization returns 404 (not 403 — don't leak existence)
- All tests pass: unit + integration + E2E
- Tenant isolation test explicitly verifies queries with wrong `organizationId` return no results
- Code review checklist: no Drizzle imports outside `infrastructure/`, no framework imports in `domain/`, use case throws tagged errors, Result types used in domain validators

**Open questions to resolve during this phase.**

- Exact shape of the Property form (what fields, what validation)
- Whether to show deleted properties in a separate "archived" view (defer — not needed yet)
- Timezone dropdown source (use IANA timezone list, filter to sensible subset)

**Rough effort.** 5-7 days. First context always takes longer because patterns are being established. The next one is faster.

**Phase after this.** Teams and staff assignments.

---

### Phase 6 — Teams and staff assignments

**Goal.** Users can be assigned to properties, optionally through teams. The permission model now accounts for "this user can only access these specific properties."

**Why now.** Portals will be associated with properties and optionally teams/staff. Reviews will be attributed to properties. Goals will target properties, teams, or individuals. We need the assignment model before any of that makes sense.

**Scope (in).**

- `contexts/team/` — CRUD following the Property pattern
- `contexts/staff/` (or `contexts/staff-assignment/` — name TBD) — CRUD for assignments
- `shared/db/schema/team.schema.ts` and `staff-assignment.schema.ts`
- `propertyAccessMiddleware` — resolves which properties the current user can access, attaches to context
- UI: teams management within a property, staff list within an organization, assign staff to property/team
- Tests: full coverage following Phase 5 pattern
- The `propertyAccessMiddleware` is specifically tested — users only see their assigned properties when applicable

**Scope (out).**

- Role changes after invitation (still deferred)
- Property transfer between teams (later, if ever)

**Gate criteria.**

- Team can be created under a property, with optional team lead
- Staff user can be assigned to a property directly or to a team within the property
- A Staff user querying `/properties` sees only properties they're assigned to
- An AccountAdmin sees all properties in their org
- A PropertyManager sees only properties they're explicitly assigned to (if this is the intended behavior — confirm)
- All CRUD operations work, all tests pass
- Integration test: create org, create 3 properties, invite 2 staff, assign staff to 2 of 3 properties, log in as staff, verify only those 2 are visible

**Open questions to resolve during this phase.**

- **Important:** does a PropertyManager automatically have access to all properties in their org, or only assigned ones? The spec isn't 100% clear — we should confirm before building. Suggest: AccountAdmin sees all, PropertyManager sees assigned, Staff sees assigned.
- What happens when a user is removed from all properties — still an org member? Yes, probably.

**Rough effort.** 4-5 days. Second context is faster than the first.

**Phase after this.** Portal context.

### Phase 6.5 — Permission system overhaul

**Goal.** Replace the hand-rolled `roleGuard()` + `canXxx()` permission functions with better-auth's built-in `createAccessControl` system. This fixes a critical security issue where PropertyManagers had too much power (could change any member's role, see all org data) and establishes a single source of truth for permissions.

**Why now.** The current system has two parallel permission models (our `permissions.ts` functions + better-auth's default role hierarchy) that can contradict each other. A PropertyManager can see all members and change roles — too permissive for a real SaaS. Better-auth's access control system provides fine-grained resource × action permissions out of the box.

**Scope (in).**

- Define the full permission statement (all resources × actions for phases 1–12) in `shared/auth/permissions.ts` using `createAccessControl`
- Define three default roles (owner, admin, member) with specific permission sets — more restrictive than before
- Wire `ac` + `roles` into the `organization()` server plugin and `organizationClient()` client plugin
- Replace all `roleGuard()` calls in server functions with `auth.api.hasPermission()` checks
- Remove `roleGuard()` from `shared/auth/middleware.ts`
- Remove `contexts/identity/domain/permissions.ts` (the hand-rolled `canXxx()` functions)
- Update domain rules (`canInviteWithRole`, `canChangeRole`) to remain as business validation ("can't promote above your own level") but not as the primary permission gate
- Update all doc files (architecture.md, conventions.md, patterns.md) to reflect the new system
- Tests: update tests that relied on the old permission functions

**Scope (out).**

- Dynamic access control (runtime custom roles by AccountAdmin) — Phase B, after the static system is validated
- Admin plugin for platform-level SuperAdmin role — deferred per original plan
- UI for managing roles — deferred to Phase B

**Default role permissions (new).**

| Permission                         | owner (AccountAdmin) | admin (PropertyManager) | member (Staff) |
| ---------------------------------- | -------------------- | ----------------------- | -------------- |
| `organization: update, delete`     | ✅                   | –                       | –              |
| `member: create`                   | ✅                   | ✅                      | –              |
| `member: update`                   | ✅                   | –                       | –              |
| `member: delete`                   | ✅                   | –                       | –              |
| `invitation: create, cancel`       | ✅                   | ✅                      | –              |
| `property: create, update`         | ✅                   | ✅                      | –              |
| `property: delete`                 | ✅                   | –                       | –              |
| `team: create, update`             | ✅                   | ✅                      | –              |
| `team: delete`                     | ✅                   | –                       | –              |
| `staff_assignment: create, delete` | ✅                   | ✅                      | –              |
| `ac: create, read, update, delete` | ✅                   | –                       | –              |
| `portal: create, update`           | ✅                   | ✅                      | –              |
| `portal: delete`                   | ✅                   | –                       | –              |
| `review: read`                     | ✅                   | ✅                      | ✅             |
| `review: reply`                    | ✅                   | ✅                      | –              |
| `feedback: read`                   | ✅                   | ✅                      | –              |
| `feedback: respond`                | ✅                   | ✅                      | –              |
| `integration: manage`              | ✅                   | –                       | –              |

**Key change:** admin (PropertyManager) can no longer update/delete members or change roles. Only owner (AccountAdmin) can manage member roles. Admin can still invite new members.

**Gate criteria.**

- All existing tests pass (updated for new permission model)
- Server functions enforce fine-grained permissions via `hasPermission`
- A PropertyManager cannot change another member's role
- A PropertyManager cannot delete properties or teams
- `tsc --noEmit` is clean

**Rough effort.** 1-2 days. The changes are mechanical — replace one permission system with another.

---

## Arc 3 — Portal and Guest Experience (Phases 7-9)

This is where the product becomes visible. By end of this arc, a manager can create a portal and a guest can visit it, rate their experience, and (for high ratings) leave a public review or (for low ratings) submit private feedback.

### Phase 7 — Portal builder

**Goal.** AccountAdmin / PropertyManager can create a portal associated with a property (and optionally a team or staff member), configure its link tree (categories and links), upload a hero image, configure theme and smart routing, and preview the portal.

**Why now.** Portals are the core content object. They need to exist before guest-facing pages make sense.

**Scope (in).**

- `contexts/portal/` with full layer structure (following the Property template)
- `shared/db/schema/portal.schema.ts` with portals, portal_link_categories, portal_links tables
- All use cases for portal CRUD + link tree management
- Fractional index sort keys for reorderable categories/links (use `fractional-indexing` npm package)
- Hero image upload:
  - R2 configuration
  - Presigned URL generation
  - Two-step upload (request URL, upload direct to R2, finalize)
  - Image processing job (in worker) that resizes and converts to WebP
- UI: Portal list per property, create form, full portal editor with:
  - Basic info (name, entity selection, slug)
  - Link tree builder with drag-and-drop (@dnd-kit/core)
  - Theme editor (color pickers)
  - Smart routing toggle + threshold slider
  - Hero image upload
- Tests:
  - Domain: slug validation, theme validation, smart routing validation, fractional index generation
  - Use cases: all portal CRUD + link tree ops
  - Integration: R2 upload flow (uses R2 sandbox/local MinIO for tests)
  - E2E: create portal, add categories and links, reorder, upload image, save

**Scope (out).**

- Public portal pages (Phase 8)
- Scan tracking (Phase 8)
- QR code generation (Phase 8)
- Guest-facing anything

**Gate criteria.**

- Portal can be created, edited, soft-deleted
- Link tree supports adding categories, adding links within categories, reordering both
- Reordering uses fractional indexes — a test verifies that reordering one item only updates one row
- Hero image upload works end-to-end: client requests URL → uploads to R2 → finalizes → image visible in editor
- Image processing job runs in worker, creates WebP variants
- Theme is persisted as JSONB, validates hex colors
- Smart routing threshold must be between 1 and 4
- Slug is unique per organization
- Polymorphic entity_type/entity_id correctly handles property/team/staff associations
- All tests pass

**Open questions to resolve during this phase.**

- How to handle link icons (library of predefined? upload custom? defer — use a predefined set initially)
- Whether to validate external URLs (defer — just validate URL format)
- Hero image maximum size (suggest 5MB, enforce via presigned URL content-length)

**Rough effort.** 7-10 days. The portal editor UI is substantial work. Architecturally straightforward but UI-heavy.

**Phase after this.** Public portal pages.

---

### Phase 8 — Public portal pages and scan tracking

**Goal.** A guest visiting `/p/{orgSlug}/{portalSlug}` sees the branded portal page. Scan events are recorded (with source detection from URL params). QR codes can be generated and downloaded.

**Why now.** The portal exists; now we need it to actually be reachable by guests. This phase is entirely public-facing.

**Scope (in).**

- `contexts/guest/` with full layer structure
- Public route `/p/$orgSlug/$portalSlug` in TanStack Start
- Route uses the `getPortalBySlug` use case from portal context (we expose this via a dedicated public server function)
- Public page renders with custom theme, link tree, hero image
- Anti-gating compliance rules in `contexts/guest/domain/compliance.rules.ts` (pure functions, aggressively unit-tested)
- Scan event recording via `POST /api/public/scan` with URL source detection
- `scan_events` table with organization_id, portal_id, source, session_id, ip_hash, created_at
- `portal.scanned` event emission
- Rate limiting on public endpoints (60 req/min per IP via Redis)
- Cookie consent banner on public pages
- QR code generation: `GET /api/portals/:id/qr?format=png|svg` returns downloadable QR code
- NFC URL is the same as QR URL (spec for programming NFC tags)
- SEO: Open Graph tags on public portal pages

**Scope (out).**

- Rating submission (Phase 9)
- Feedback submission (Phase 9)
- Review link click tracking (Phase 9)
- Caching layer on portal page (add in performance phase if needed)

**Gate criteria.**

- Visiting `/p/{orgSlug}/{portalSlug}` renders the portal page in under 2 seconds
- Invalid slugs return a clean 404 page (not a crash)
- Scan events are recorded with correct source (qr/nfc/direct) based on URL parameter
- Rate limiting triggers on excessive requests from same IP
- Cookie consent banner appears on first visit, is respected on subsequent visits
- QR code download works in both PNG and SVG formats
- Anti-gating compliance tests: given a range of ratings and configurations, the rendered layout always shows review links above the fold
- `portal.scanned` event fires; a simple test subscriber can verify it's called with correct payload

**Open questions to resolve during this phase.**

- IP hashing strategy for GDPR (suggest SHA-256 with a daily-rotating salt)
- Whether to preload TanStack Router's route data on the public page (yes, for performance)
- Cookie consent banner library (keep it custom and simple, or use a library like `react-cookie-consent`)

**Rough effort.** 5-7 days. The public-facing pages need to be genuinely fast and polished.

**Phase after this.** Rating flow + smart routing + feedback.

---

### Phase 9 — Rating, smart routing, and feedback

**Goal.** Guest can rate the portal (1-5 stars). Based on rating and smart routing config, they see review links plus possibly a private feedback form. Review link clicks are tracked. Feedback submissions are recorded. This phase completes the guest experience loop.

**Why now.** We have portals and scan tracking; now we need the actual interaction that the product is built around.

**Scope (in).**

- Star rating UI component (fully accessible: keyboard, screen reader, touch-friendly 44x44px targets)
- Rating submission: `POST /api/public/rating`
- Smart routing logic: rendered layout always shows review links first; for low ratings, an ADDITIONAL feedback form appears below
- `feedback` table schema, full CRUD for feedback context
- `contexts/guest/` extended with rating submission, feedback submission use cases
- `contexts/feedback/` (or merge into guest) — feedback is owned by the guest context conceptually
- Spam protection: honeypot fields, timestamp-based submission velocity check, per-session rate limiting
- Review platform link click tracking: `POST /api/public/click`
- Conversion tracking events emitted (`rating.submitted`, `review-link.clicked`, `feedback.submitted`)
- Compliance tests exhaustively cover the anti-gating rules (every combination of rating 1-5 × smart-routing enabled/disabled × threshold 1-4)

**Scope (out).**

- Manager-facing feedback inbox (Phase 11 — part of unified inbox with reviews)
- Review sync from Google (Arc 4)
- Auto-categorization of feedback (Arc 7, AI)

**Gate criteria.**

- Guest can rate 1-5 stars on a portal page
- For ratings above threshold: only review links shown (no feedback prompt)
- For ratings at/below threshold with smart routing enabled: feedback form appears below review links
- For smart routing disabled: never show feedback form, regardless of rating
- Review links are NEVER hidden, reordered, or visually deprioritized based on rating (exhaustive compliance tests verify this)
- Feedback submission works, includes spam protection
- Review link clicks are tracked
- Events are emitted for all interactions
- Public-facing rate limit prevents abuse
- E2E test: visit portal → rate 5 stars → see review links → click one (tracked). Visit portal → rate 2 stars → see review links and feedback form → submit feedback (recorded)

**Open questions to resolve during this phase.**

- Default feedback categories per org (start with a fixed list: "Service", "Cleanliness", "Food Quality", "Noise", "Value", "Other" — configurable later)
- Feedback character limit (start with 1000, configurable per org later)
- Whether rating is anonymous or tied to a session (session-tied for conversion tracking, but no PII collected)

**Rough effort.** 5-6 days. Most of the architecture is in place; this phase is mostly domain logic + UI + compliance tests.

**Phase after this.** Review sync from GBP. This is where we start becoming a real reputation tool.

---

## Arc 4 — Reviews (Phases 10-12)

The product becomes a reputation management tool. Reviews come in from Google, managers see them in an inbox, they can reply.

### Phase 10 — Review schema and GBP sync (read-only)

**Goal.** Reviews are automatically imported from Google Business Profile every 15 minutes. They appear in the database with sentiment fields blank (Arc 7 adds AI). No inbox UI yet — just the sync mechanism.

**Why now.** Reviews are the product's core data. The inbox depends on them. AI features operate on them. Metrics depend on review events.

**Scope (in).**

- `contexts/review/` with full layer structure
- `shared/db/schema/review.schema.ts` with full review table (see features-and-tasks-v2 for exact fields)
- `contexts/review/domain/platform.port.ts` — `ReviewPlatformAdapter` interface
- `contexts/review/infrastructure/platforms/google.adapter.ts` — implements the port using GBP API v1
- Service account authentication for GBP
- `contexts/review/infrastructure/jobs/sync-reviews.job.ts` — BullMQ job that syncs per property
- BullMQ repeatable job: every 15 minutes, enqueue sync job for each property with GBP configured
- Per-organization job fairness (a Marriott tenant doesn't block small tenants)
- GBP rate limit handling: respect `Retry-After`, exponential backoff, spread syncs across the 15-min window
- Deduplication on `(platform, external_id)`
- `review.received` event emitted for new reviews
- Manual sync trigger on property settings page
- GBP connection status indicator on property settings
- Tests: adapter in integration test with mocked GBP responses, sync job with mock adapter, dedup behavior

**Scope (out).**

- Inbox UI (Phase 11)
- Reply publishing (Phase 12)
- Sentiment analysis (Arc 7)
- TripAdvisor sync (out of scope — TripAdvisor has no public API)

**Gate criteria.**

- Property configured with GBP place ID syncs reviews automatically every 15 minutes
- New reviews appear in the database with all fields mapped correctly
- Duplicate reviews are not re-inserted
- `review.received` events fire for new reviews only
- Manual sync trigger works
- GBP rate limit errors are handled gracefully — job retries with backoff, doesn't fail the whole queue
- Multiple tenants' syncs run in parallel but don't starve each other
- Tests: mock GBP returns, verify correct DB state; mock GBP returns 429, verify retry behavior; mock GBP returns malformed data, verify graceful handling

**Open questions to resolve during this phase.**

- Exact GBP API authentication flow (service account vs OAuth — service account is simpler for MVP)
- Where GBP service account credentials are stored (secrets in Railway, never in code)
- How to bootstrap a property's GBP connection (UI flow: user pastes place ID, we verify by calling GBP API)

**Rough effort.** 7-10 days. GBP API has quirks, rate limiting is non-trivial, and the sync job needs real care to handle failure modes.

**Phase after this.** Inbox.

---

### Phase 11 — Unified inbox (reviews + feedback)

**Goal.** Managers see all reviews and all private feedback in a single unified list. They can filter, sort, mark as read, escalate, and open individual items to see details.

**Why now.** The inbox is where managers spend most of their time. It's the core value delivery. It has to feel good.

**Scope (in).**

- Inbox server functions: `getInboxItems` (paginated, filtered), status update functions
- Unified query: reviews + feedback joined into one list with a discriminator column
- Filtering: property, rating range, status, platform, date range, source
- Sorting: date, rating, status
- Bulk actions: mark read, mark addressed, assign to team member (assignment to user ID)
- Review detail view: full text, reviewer name, platform, date, quick reply input (reply flow in Phase 12)
- Feedback detail view: rating, comment, category, portal, date, internal notes
- Status workflow: new → read → replied → escalated → archived
- Tests: unit tests for filter/sort logic, integration tests for the combined query, E2E for a manager reviewing their inbox

**Scope (out).**

- Reply creation/approval/publishing (Phase 12)
- Sentiment badges (Arc 7 — placeholder until then)
- Priority score (Arc 7 — placeholder)
- Export to CSV (Arc 8)

**Gate criteria.**

- Manager can see all reviews and feedback in one list, sortable and filterable
- Status transitions work correctly (can't go from "new" to "published" directly, must go through intermediate states)
- Bulk actions work on multiple selected items
- Pagination handles 1000+ items without performance issues (cursor-based pagination, tested)
- Tenant isolation: inbox only shows items from current organization
- Role check: Staff sees only items related to their assigned properties; PropertyManager sees their assigned properties; AccountAdmin sees all
- E2E test: manager logs in, sees inbox with test data, filters to 2-star reviews, marks one as read, escalates another

**Open questions to resolve during this phase.**

- Default sort (suggest: newest first)
- Default filters on first load (suggest: status = new, all properties visible to role)
- Whether to show unread count badge on the nav (yes, polls or uses cache)

**Rough effort.** 5-7 days. UI-heavy but architecturally straightforward.

**Phase after this.** Reply flow.

---

### Phase 12 — Reply flow

**Goal.** Managers can draft, submit, approve, reject, and publish replies to reviews. Published replies are pushed to Google via the GBP adapter. The approval workflow is enforced.

**Why now.** Without reply publishing, we're just a read-only review viewer. This completes the core review management loop.

**Scope (in).**

- `replies` table schema
- Full reply lifecycle use cases: create draft, edit, submit for approval, approve, reject, publish
- CHECK constraint: exactly one of review_id or feedback_id is set
- Reply UI: inline editor in inbox detail view, approval queue for managers, reply history timeline
- Character counter (Google limit: 4096)
- Publish to Google via `replyToReview` method on the Google adapter (added to Phase 10's adapter, now fully exercised)
- Publish error handling: retry with exponential backoff via BullMQ job, notify manager on final failure
- `reply.published` event emitted on success
- Tests: full lifecycle test (draft → approved → published → verified pushed to Google mock), rejection path, error handling

**Scope (out).**

- AI reply drafting (Arc 7)
- Reply templates (later, if needed)

**Gate criteria.**

- AccountAdmin or PropertyManager can draft a reply
- Reply status transitions are enforced: can only approve from pending_approval, can only publish from approved
- Only PropertyManager+ can approve
- Approved reply publishes to Google within 1 minute (via job)
- Publish failures retry up to 3 times with exponential backoff, then notify the manager
- Published timestamp is recorded
- Character limit enforced at domain level
- AI-generated replies are flagged (field exists; Arc 7 sets it to true when applicable)
- All tests pass
- E2E test: PropertyManager drafts a reply → submits → AccountAdmin approves → reply publishes (verified via mock GBP) → reply appears as "published" in UI

**Open questions to resolve during this phase.**

- Whether rejected replies can be edited and resubmitted (yes — draft status again)
- Whether approvers can be notified of pending approvals (yes — add to Arc 8 notifications)
- Auto-approval for AccountAdmins (i.e., their drafts skip approval) — suggest no, keep the workflow uniform for clarity

**Rough effort.** 5-6 days.

**Phase after this.** Metrics foundation.

---

## Arc 5 — Metrics and Dashboard (Phases 13-14)

Now we have events flowing. Metrics captures them into structured data that the dashboard can visualize.

### Phase 13 — Metrics foundation

**Goal.** Every domain event that matters is captured as a metric reading. The 12 built-in metrics from the spec are defined. Aggregations are pre-computed via materialized views. The metrics system is tenant-isolated and performant at scale.

**Why now.** The dashboard depends on metrics. Goals and gamification depend on metrics. Conversion analytics depends on metrics.

**Scope (in).**

- `contexts/metric/` with full layer structure
- `shared/db/schema/metric.schema.ts` with `metric_definitions` and `metric_readings` tables
- **Partitioned `metric_readings` table** — by month, on `recorded_at`. This is critical for scale.
- Seed migration for 12 built-in metric definitions
- Event handlers in `contexts/metric/infrastructure/event-handlers/` subscribing to every relevant event:
  - `portal.scanned` → `portal.scan_count`
  - `rating.submitted` → `portal.average_rating`
  - `review.received` → `portal.public_review_count`, `property.total_reviews`
  - `feedback.submitted` → `portal.private_feedback_count`
  - `review-link.clicked` → tracked for `portal.conversion_rate`
  - etc.
- Materialized views: `mv_daily_metrics`, `mv_weekly_metrics`
- Background jobs: `refreshDailyMetrics` (hourly), `refreshWeeklyMetrics` (daily)
- Background job: `createPartitions` (monthly) — creates 3 months of partitions ahead
- Background job: `archiveOldReadings` (monthly) — archives partitions older than 24 months
- Custom metric registration (AccountAdmin can define new metrics)

**Scope (out).**

- Dashboard UI (Phase 14)
- Analytics page (Arc 8)
- Leaderboards (Arc 6)

**Gate criteria.**

- Every relevant event produces a metric reading
- Materialized views refresh on schedule
- Partition creation job runs and creates future partitions correctly
- Tenant isolation on all metric queries
- Performance test: insert 1 million readings across 12 months, verify queries against materialized views return in <100ms
- All 12 built-in metrics produce sensible values when event data exists
- Tests: event handler unit tests, materialized view refresh integration tests, partition management tests

**Open questions to resolve during this phase.**

- Whether to use `pg_partman` extension (check Neon support) or manual partition SQL (suggest manual — more portable)
- Refresh strategy for materialized views under load (CONCURRENTLY with unique index required)
- Whether custom metrics should have their own table or share with built-in (share, via `metric_definitions`)

**Rough effort.** 7-10 days. Partitioning and materialized views need careful testing.

**Phase after this.** Dashboard.

---

### Phase 14 — Dashboard

**Goal.** Authenticated users see a dashboard with KPI cards, time-range filters, and scope selectors. Data is fast (from materialized views and cache).

**Why now.** First user-visible moment of "this product shows me something valuable at a glance."

**Scope (in).**

- Dashboard layout with sidebar navigation (shell, nav, user menu)
- KPI cards: total reviews, average rating, scan count, conversion rate
- Time range selector: 7d, 30d, 90d, custom
- Scope selector: organization, property, team, staff
- Charts: Recharts, lazy-loaded (not in initial bundle)
- Cache dashboard queries via Redis with 5-minute TTL
- `getDashboardKPIs` use case in metric context
- Role-scoped: Staff sees their own metrics, PropertyManager sees assigned properties, AccountAdmin sees org-wide
- Tests: use case tests, integration test for cache behavior, E2E for dashboard loading

**Scope (out).**

- Comparison mode (add in analytics phase)
- Drill-down from KPIs (later)
- Export dashboard (Arc 8)

**Gate criteria.**

- Dashboard loads in under 2 seconds with meaningful data
- KPI cards show correct values from materialized views
- Time range and scope selectors update KPIs correctly
- Cache is hit for repeat queries within 5 minutes
- Role-based data scoping is enforced (Staff can't see other staff's metrics)
- E2E test: user logs in → dashboard renders → switches time range → KPIs update

**Open questions to resolve during this phase.**

- Which specific charts to show initially (start simple: rating over time, scan count over time — add more as product evolves)
- Default time range (suggest 30d)

**Rough effort.** 5-7 days.

**Phase after this.** Goals + gamification, or AI first — discuss at the gate.

---

## Arc 6 — Gamification (Phases 15-16)

Goals and badges motivate teams. Leaderboards create healthy competition.

### Phase 15 — Goals

**Goal.** Managers can set performance goals at org, property, team, or individual level. Goals cascade (child ≤ parent). Progress is computed automatically from metrics.

**Why now.** Goals give meaning to metrics. Without them, metrics are just numbers.

**Scope (in).**

- `contexts/gamification/` (or split into `goal` and `badge` contexts — decide during phase)
- `goals` and `goal_progress` tables
- Goal domain: cascade validation, period alignment, circular reference prevention
- Use cases: create, update, delete, list, get progress
- Event-driven progress updates: `metric.recorded` event handler checks affected goals, updates progress
- Periodic reconciliation job (hourly): recompute all active goals from raw metric data
- Milestone notifications at 25%, 50%, 75%, 100% (requires notifications, which we're building in Arc 8 — defer the notification part or build minimal in-app for now)
- UI: goals list with progress bars, create form, cascade visualization
- Tests: cascade validation, progress computation, event-driven updates

**Scope (out).**

- Email/push milestone notifications (Arc 8)
- Goal templates (later)

**Gate criteria.**

- Goal can be created at any entity level
- Child goal target cannot exceed parent (validation enforced)
- Period alignment validated (quarterly parent requires quarterly or monthly children)
- Progress updates in near-real-time when metric events fire
- Hourly reconciliation job runs and matches live-computed progress
- Tests pass, cascade validation is comprehensive

**Open questions to resolve during this phase.**

- Exact period types (start with: weekly, monthly, quarterly)
- What happens when a goal's parent is deleted (suggest: orphan the child, mark it as "orphaned" status)

**Rough effort.** 5-7 days.

**Phase after this.** Badges and leaderboards.

---

### Phase 16 — Badges and leaderboards

**Goal.** Users earn badges automatically based on metric-driven criteria. Leaderboards rank entities by metric performance. Users can see their earned badges.

**Why now.** Completes the gamification loop. Goals give direction; badges and leaderboards give recognition.

**Scope (in).**

- `badge_definitions` and `badge_awards` tables
- Badge criteria schema (typed JSONB — metric_key, operator, value, time_window, streak_days)
- Criteria evaluation engine as pure domain function
- Seed migration for system-wide default badges ("First Review", "100 Scans", "7-Day Streak", etc.)
- Background job: `evaluateBadges` (hourly) — checks criteria against metric data, awards new badges
- Leaderboard use cases — computed from materialized views
- UI: badge showcase per user/team, leaderboard page with time window and scope tabs
- `badge.awarded` event emission
- Tests: criteria evaluation across all types (performance, streak, milestone), leaderboard computation, award idempotency

**Scope (out).**

- Custom badge creation UI (backend supports it; UI can come later)
- Badge notifications via email/push (Arc 8)

**Gate criteria.**

- All four badge types evaluate correctly (performance, streak, milestone, special)
- Badges are awarded exactly once per user/team per criteria-met event
- Leaderboards rank correctly and load fast (from materialized views)
- Tests: 100% coverage on criteria evaluation engine

**Open questions to resolve during this phase.**

- Initial badge library (10-15 system badges is a good start)
- Whether to support team badges (yes — badges can target entity_type = team)

**Rough effort.** 5-7 days.

**Phase after this.** AI.

---

## Arc 7 — AI Features (Phases 17-18)

AI adds differentiation. Sentiment, priority, reply drafting, trend detection.

### Phase 17 — AI v1: sentiment, priority, reply drafting

**Goal.** Every new review is automatically analyzed for sentiment and scored for priority. Managers can generate AI-drafted replies. Feedback is auto-categorized. AI usage is tracked and quota-managed.

**Why now.** Without AI, the product is good. With AI, it's differentiated.

**Scope (in).**

- `contexts/ai/` with full layer structure
- `AIProvider` port with `generateReply`, `analyzeSentiment`, `categorize`
- Anthropic adapter implementation
- `ai_usage` table + per-org quota tracking
- Quota check inside the adapter (not a separate middleware — cannot be bypassed)
- `review.received` event handler: trigger sentiment analysis + priority scoring via BullMQ job
- `feedback.submitted` event handler: trigger categorization
- Priority scoring: pure domain function combining rating + sentiment + recency with configurable weights
- "Generate Reply" button in review detail view → calls use case → returns draft
- AI-generated replies flagged (`ai_generated = true`)
- Sentiment and priority badges in inbox
- Tests: adapter tests with mocked Anthropic API, quota enforcement, priority scoring edge cases

**Scope (out).**

- Trend detection (Phase 18)
- Batch historical analysis (Phase 18)
- Fine-tuning / custom prompts per org (later)

**Gate criteria.**

- New reviews get sentiment + priority within 60 seconds of arrival
- Reply generation works and takes <10 seconds for typical reviews
- Quota enforcement: exceeding quota returns graceful error, doesn't break non-AI features
- AI calls are logged with token counts and estimated cost
- Priority score threshold triggers "urgent review" events (used in Arc 8 for push notifications)
- Tests pass

**Open questions to resolve during this phase.**

- Initial per-plan quotas (suggest: $10/mo for free tier, $50/mo for pro, $500/mo for enterprise — revisit based on actual costs)
- Whether to support "tone" selection in reply generation (yes — professional / friendly / casual)
- How many previous published replies to include as few-shot examples (start with 3, tune empirically)

**Rough effort.** 7-10 days.

**Phase after this.** AI v2.

---

### Phase 18 — AI v2: trend detection and AI dashboard

**Goal.** Daily trend reports identify recurring themes in reviews. AI dashboard shows sentiment trends, top themes, priority distribution, and weekly summaries.

**Why now.** Second layer of AI value — not just processing individual reviews but surfacing patterns.

**Scope (in).**

- `trend_reports` table
- Background job: `detectTrends` (daily) — sends last N reviews per property + org to AI, gets back top 5 themes with trajectories
- Batch historical sentiment analysis: on-demand job for orgs newly connecting GBP
- AI dashboard page with:
  - Sentiment trend chart over time
  - Top themes from latest trend report
  - Priority score distribution
  - AI-generated weekly summary
- Tests: trend detection pipeline, batch analysis job, dashboard use cases

**Scope (out).**

- Embeddings / topic modeling (post-MVP if ever needed)
- Custom AI dashboards (later)

**Gate criteria.**

- Daily trend detection job runs successfully for all orgs with reviews
- Trend reports are human-readable and identify real themes
- Batch analysis processes historical reviews within quota
- AI dashboard loads fast (uses materialized views + cache)
- Tests pass

**Rough effort.** 5-7 days.

**Phase after this.** Arc 8 polish.

---

## Arc 8 — Polish and Production Readiness (Phases 19-22)

Now we fill in the gaps that make this a real product, not just a collection of features.

### Phase 19 — Notifications

**Goal.** Users receive notifications through three channels (in-app, email digest, push for critical). Preferences are configurable.

**Scope.** Notifications context, Resend for email, FCM for push, in-app bell icon, preferences UI, all notification types from the spec.

**Rough effort.** 5-7 days.

---

### Phase 20 — Compliance: GDPR flows and audit logs

**Goal.** Full audit log coverage. Account deletion (with grace period). Data export (GDPR Article 20). Cookie consent properly integrated.

**Scope.** Audit log event handlers subscribed to all auditable actions. Account deletion flow with 30-day grace period. Data export job (generates JSON archive, stores in R2, signed URL). Hard-delete job for expired grace periods.

**Rough effort.** 5-7 days.

---

### Phase 21 — Conversion analytics and account dashboard

**Goal.** The analytics page from Phase 14's scope-out lands here. Conversion funnel, before/after comparison, rating distribution, top performers, exports.

**Scope.** Analytics context (or fold into metrics), conversion funnel computation, before/after comparison logic, CSV/PDF export jobs.

**Rough effort.** 5-7 days.

---

### Phase 22 — Production hardening

**Goal.** Before real users touch the system: load testing, error handling audit, security audit, observability review.

**Scope.**

- Load test against Railway staging — 1000 concurrent guests hitting public portals, 100 managers in dashboard
- Audit error handling: every try/catch, every thrown tagged error, verify graceful degradation
- Security audit: rate limits on all public endpoints, CORS correct, session cookies correctly configured, no secrets leaked
- Sentry fully wired, alerts configured
- Uptime monitoring on `/api/health`
- Runbook for common incidents
- Production environment created on Railway
- Migration of any pilot data from staging
- Go-live checklist

**Rough effort.** 5-7 days.

---

## Summary: the full plan at a glance

| Arc | Phase | Name                              | Rough effort |
| --- | ----- | --------------------------------- | ------------ |
| 1   | 1     | Repo + hello-world                | 2-3 days     |
| 1   | 2     | Auth foundation                   | 3-4 days     |
| 1   | 3     | Organizations + tenancy           | 4-5 days     |
| 1   | 4     | Testing + shared plumbing         | 3-4 days     |
| 2   | 5     | Property (first full context)     | 5-7 days     |
| 2   | 6     | Teams + staff                     | 4-5 days     |
| 3   | 7     | Portal builder                    | 7-10 days    |
| 3   | 8     | Public portal + scan tracking     | 5-7 days     |
| 3   | 9     | Rating + smart routing + feedback | 5-6 days     |
| 4   | 10    | Review schema + GBP sync          | 7-10 days    |
| 4   | 11    | Unified inbox                     | 5-7 days     |
| 4   | 12    | Reply flow                        | 5-6 days     |
| 5   | 13    | Metrics foundation                | 7-10 days    |
| 5   | 14    | Dashboard                         | 5-7 days     |
| 6   | 15    | Goals                             | 5-7 days     |
| 6   | 16    | Badges + leaderboards             | 5-7 days     |
| 7   | 17    | AI v1                             | 7-10 days    |
| 7   | 18    | AI v2                             | 5-7 days     |
| 8   | 19    | Notifications                     | 5-7 days     |
| 8   | 20    | Compliance + audit                | 5-7 days     |
| 8   | 21    | Analytics                         | 5-7 days     |
| 8   | 22    | Production hardening              | 5-7 days     |

**Total: 22 phases, roughly 120-160 working days.** At a solo-dev pace with AI assistance, 6-8 months to MVP. Call it 9-12 months with revisions, bug fixes, and the unexpected.

---

## How to use this plan

**Each phase gets its own session (or a few).** We start a session, load the phase's scope, build and test together, hit the gate, commit.

**Before starting each phase, we revisit.** Is the scope still right? Have we learned something that changes the approach? Should the next phase be reordered?

**The gate is real.** If a phase doesn't pass its gate, we don't start the next one. Either finish the work or consciously reduce scope and document what's deferred.

**Reorder phases freely.** If a customer conversation makes AI (Arc 7) more important than gamification (Arc 6), swap them. If GBP sync is blocked by API access, skip Arc 4 temporarily and build Arc 5-6 on internal review data.

**Each session should produce:** working code, passing tests, a git commit, updated docs if anything changed. No exceptions.

---

## What to do right now

Read this plan. Push back on anything that feels wrong. I'd especially welcome challenges on:

1. **The ordering.** Is infrastructure-first the right call? Should anything be pulled earlier or pushed later?
2. **The scope of Phase 1.** Is it too much? Too little? I tried to keep it small but "set up the whole toolchain" tends to expand.
3. **The scope of Phase 4** (shared plumbing). Am I trying to build too much before it's needed? I argued we should, but it's a judgment call.
4. **Anything missing.** Is there a phase I didn't include that you think is necessary?
5. **Anything I marked "later" that should be earlier.** Notifications, for example — is Arc 8 too late?

Once you're happy with the plan, we stop this session. Next session, we start Phase 1. Future sessions tackle one phase each.
