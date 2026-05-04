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

