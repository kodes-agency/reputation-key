# Reputation Key — Code Review Prompt Suite

A set of review prompts covering the codebase end-to-end. Each prompt is self-contained: drop it into a fresh Claude/Cursor session, point the reviewer at the relevant directory, and you'll get a strict, evidence-based review.

## How to use

1. **Always start the reviewer with the project's `CONTEXT.md`** and the layer-specific `CONTEXT.md` listed under "Pre-read" in each prompt. Reviews that don't load context become slop.
2. **Scope the review.** Pass the prompt one directory at a time (one bounded context, one feature, one PR diff). Whole-repo passes dilute findings.
3. **Demand evidence.** Every finding must cite `path:line` and quote a short snippet. Reject any finding that cannot.
4. **Severity discipline.** Use the four-level scheme defined in the shared rubric below; do not invent new severities.
5. **Pre-read gate.** If any file listed under "Pre-read" is missing or unreadable, say so and STOP — do not review against an assumed `CONTEXT.md`. A stale pre-read silently degrades the whole review.

---

## Shared rubric (paste into any prompt that doesn't redefine it)

````
Severity:
  BLOCKER   — Violates an explicit rule in CONTEXT.md, breaks a layer
              boundary, leaks tenants/secrets, or is a correctness bug.
  MAJOR     — Convention violation, missing test for a non-trivial code
              path, swallowed error, unsafe type, or duplicated logic
              that already exists in a shared module.
  MINOR     — Naming inconsistency, dead code, redundant comment,
              suboptimal-but-correct pattern, missing JSDoc on a public
              API.
  NIT       — Style preference. Group these; do not enumerate one-by-one.

Output format per finding:
  [SEVERITY] <one-line summary>
    File: path/to/file.ts:LINE
    Quote: ```<≤5 lines>```
    Rule:  <which CONTEXT.md rule / ADR / convention is violated>
    Fix:   <one or two sentences — concrete, not “consider refactoring”>

Hard constraints on the reviewer:
  - Do NOT restate what the code does. Only call out problems.
  - Do NOT say “looks good” — silence implies approval. Only the final
    summary may say "no issues found in <area>".
  - Do NOT invent file paths or line numbers. If you can’t cite, omit.
  - Do NOT mass-flag style; group NITs.
  - If the diff/scope is empty or unreadable, say so and stop.
  - End with a one-paragraph summary: counts per severity + the single
    most important thing to fix first.
  - Mark each finding `[ran]` (you reproduced it — ran the test, build,
    story, or MCP tool) or `[static]` (read-only inference). Do not dress
    an inference up as a confirmed bug.
  - If a finding also violates another prompt's rules, tag it
    `[also: §N]` (e.g. `[also: §11]` for multi-tenancy) so a sweep can
    dedupe across prompts.
````

---

# 1. Architecture & Layering

**When to run:** any PR that adds/moves files across `domain/`, `application/`, `infrastructure/`, `server/`, or `routes/`. Run weekly against the full repo as a regression sweep.

**Pre-read:** `CONTEXT.md` (root), `src/contexts/CONTEXT.md`, `src/shared/CONTEXT.md`.

**Prompt:**

> You are a senior architect reviewing a layered hexagonal codebase. The dependency rule is strict and one-directional:
>
> ```
> routes → contexts/<ctx>/server → contexts/<ctx>/application → contexts/<ctx>/domain
>                                                                      ↑
>                                              infrastructure/ implements ports defined in domain/application
> ```
>
> Review the files in `<SCOPE>` and flag every violation of the following rules. Use the shared rubric.
>
> **Hard rules — every breach is BLOCKER:**
>
> 1. `domain/` imports nothing from `application/`, `infrastructure/`, `server/`, `routes/`, `components/`, `shared/auth/`, or any framework (React, TanStack, better-auth, Drizzle/Prisma, GCP SDKs, fetch).
> 2. `application/` imports nothing from `infrastructure/`, `server/`, `routes/`, or `components/`. It may import `domain/` and `shared/domain/`.
> 3. `infrastructure/` imports `domain/` and `application/` _only_ to implement ports. It does not import other contexts' `infrastructure/`.
> 4. `server/` files are thin: they validate input, resolve the tenant/auth context, instantiate or receive a use case, call it, map the result. No business rules in `server/`.
> 5. Cross-context calls must go through a published application API of the target context — never reach into another context's `domain/` or `infrastructure/`.
> 6. The only place that wires concrete adapters to ports is `src/composition.ts`. Use cases never `new` an infrastructure class.
> 7. Bootstrap order is owned by `src/bootstrap.ts`. No module should perform side effects at import time (no top-level `await`, no `init()` calls at module scope).
>
> **MAJOR if:**
>
> - A use case takes a framework object (request, response, headers) instead of a typed input DTO.
> - An adapter returns a database row shape instead of a domain entity.
> - A port interface is defined in `infrastructure/` instead of next to the use case that owns it.
> - Two contexts share a type by reaching into each other; the type should live in `shared/domain/` or be duplicated intentionally.
>
> Produce findings, then a per-layer table: `layer | files reviewed | BLOCKER | MAJOR | MINOR | NIT`.

---

# 2. Bounded Context Boundaries

**When to run:** when adding a new feature that touches more than one context, or when introducing a new context.

**Pre-read:** root `CONTEXT.md` (bounded contexts table + glossary), `docs/adr/0003-review-as-bc.md`, `docs/adr/0004-inbox-as-bc.md`.

**Prompt:**

> You are reviewing inter-context coupling. The known contexts are Identity, Property, Portal, Guest, Team, Integration, Review, Inbox, Dashboard. Each owns the entities listed in the root `CONTEXT.md`. Review `<SCOPE>` and flag:
>
> **BLOCKER:**
>
> - Any context owning an entity assigned to another (e.g. `Review` entity defined outside `contexts/review/`, `Rating` outside `contexts/guest/`).
> - Foreign-key-style direct imports of another context's domain entities into your domain layer. Cross-context references should use IDs (branded), not entity types.
> - A context reading another context's database tables directly. Reads must go through the owning context's application layer or a published projection.
> - `Reply` logic appearing in the `inbox` context (replies belong to `review`); inbox only references items.
> - `GoogleConnection` or token handling outside `integration`.
> - Permission checks scattered across contexts instead of going through `shared/domain/permissions`.
>
> **MAJOR:**
>
> - A use case in context A taking context B's repository as a dependency instead of context B's application service.
> - Denormalized fields in `InboxItem` being written from outside `inbox` (the inbox owns its projection).
> - A new entity that fits an existing context's responsibility being placed elsewhere "because it was convenient." Quote the glossary entry that says where it belongs.
>
> **MINOR:**
>
> - Glossary terms used with the wrong meaning in code (e.g. calling a private `Rating` a "review" in a variable name).
> - Missing context membership doc comment on a top-level file inside a context.
>
> End with a dependency matrix: rows = contexts in scope, columns = contexts they reference, cell = `direct domain import / via application / via shared / none`. Highlight any non-empty `direct domain import` cell as BLOCKER.

---

# 3. Domain Layer Purity (per context)

**When to run:** every PR touching `contexts/<ctx>/domain/`.

**Pre-read:** root `CONTEXT.md`, `src/contexts/CONTEXT.md`, the target context's `CONTEXT.md` if present.

**Prompt:**

> You are reviewing the `domain/` folder of a single bounded context: `<CONTEXT_NAME>`. The domain layer must be pure: it expresses business invariants and nothing else. Review every file in `contexts/<CONTEXT_NAME>/domain/` and flag:
>
> **BLOCKER:**
>
> - Any import from: React, TanStack, better-auth, drizzle/prisma/kysely, `fetch`/`axios`, `google-*`, `@gcp/*`, `node:fs`, `node:crypto` for IO, `process.env`, anything under `infrastructure/`, `application/`, `server/`, `routes/`, `components/`, `shared/auth/`, `shared/observability/`.
> - Domain entities exposing setters or mutable public fields. Mutation must happen via methods that enforce invariants and return a new instance or emit events.
> - Entities constructed with `new SomeEntity({...})` from outside the domain. There must be a named factory / `create` / `rehydrate` distinction (creation validates; rehydration trusts the store).
> - Primitive obsession on identity: IDs passed as raw `string` instead of branded `UserId`, `PropertyId`, etc.
> - Any `throw new Error("...")` for a business rule. Business failures must be typed errors (e.g. `class InvalidRatingValue extends DomainError`).
> - Time read via `new Date()` or `Date.now()` inside domain code. Time must arrive as a parameter or via an injected `Clock` port.
> - Random/UUID generated inline. Must come through an injected `IdGenerator`.
>
> **MAJOR:**
>
> - Anemic entities: data bags with no behavior, where invariants live in services or use cases instead.
> - Domain services that do orchestration (calling multiple repos) — that's an application concern.
> - Inconsistent equality: two entity instances representing the same identity must compare equal via an `equals()` method or a value-object discipline.
> - State transitions implemented as `if/else` chains instead of explicit transition methods. For `Reply` (`draft → pending_approval → approved → published | publish_failed`) and `InboxItem` status (per ADR 0004), the allowed transitions must be in code, not implicit.
>
> **MINOR:**
>
> - Domain types re-exported from outside `domain/index.ts`.
> - Validation duplicated between a value object's constructor and a use case.
>
> Conclude with: list of domain entities found, the invariants each enforces, and any invariant from `CONTEXT.md` glossary that is **not** enforced in code.

---

# 4. Application / Use Case Layer

**When to run:** every PR adding or modifying `application/` files.

**Pre-read:** `src/contexts/CONTEXT.md`, the target context's domain README/CONTEXT if present.

**Prompt:**

> You are reviewing the application layer of `contexts/<CONTEXT_NAME>/application/`. Use cases orchestrate domain entities through ports. They must not contain framework code, persistence code, HTTP shapes, or React concerns. Flag:
>
> **BLOCKER:**
>
> - Use case constructor or method receiving a request/response/headers/cookies object.
> - Use case returning a DB row, an ORM model, or a frontend view-model. It returns domain entities, domain DTOs, or void.
> - Use case calling `fetch`, opening a connection, reading env vars, or logging via `console`. All side effects via injected ports; logging via injected logger or via the `traced-server-fn` wrapper above.
> - Authorization performed by checking strings in `if`/`switch`. Must go through `can(role, permission)` from `shared/domain/permissions` (and the `AuthContext` is passed in, not pulled from a global).
> - A use case writing to a repo it does not own (cross-context write). Cross-context effects must go through the target context's application API or be modelled as a domain event consumed by the other context.
> - Silent catches: `catch { return null }`, `catch (e) { /* ignore */ }`. Failures map to typed `Result` / domain errors.
>
> **MAJOR:**
>
> - A use case doing >1 conceptual thing (e.g. "create property + assign staff + send email"). Split, or compose explicitly via a coordinator that documents the steps and the rollback policy.
> - Transactions implicit. If multiple repo writes happen, the boundary must be explicit — either an injected `UnitOfWork` or a single repo method.
> - Use case has no input DTO; it takes 5+ positional args.
> - Use case mutates input arguments.
> - Missing test file colocated next to the use case (or under `__tests__/`), or test exists but only covers the happy path.
>
> **MINOR:**
>
> - Naming: use case classes must be `VerbNoun` (`CreateProperty`, `ApproveReply`). `Service`, `Manager`, `Helper` suffixes are MAJOR unless justified.
> - Ports named `*Port` or `*Repository` consistently — pick the project's convention and call out drift.
>
> End with: use cases found, the ports each depends on, and whether each port has at least one infrastructure implementation wired in `composition.ts`.

---

# 5. Infrastructure Adapters

**When to run:** every PR adding a repo, HTTP client, queue subscriber, or OAuth adapter.

**Pre-read:** `src/contexts/CONTEXT.md`, `src/shared/CONTEXT.md`.

**Prompt:**

> Review `contexts/<CONTEXT_NAME>/infrastructure/` (and `src/shared/` if relevant adapters live there). Adapters implement ports defined in the domain/application layer. Flag:
>
> **BLOCKER:**
>
> - Adapter file does not implement a port interface (it's a service that something calls directly).
> - Adapter leaks its tech into the return type (returns a `RowDataPacket`, `PostgrestResponse`, `gaxios` response object).
> - Secrets read at module scope. Read from injected config or at instance construction; never at import time.
> - OAuth tokens stored unencrypted. `GoogleConnection` token fields must be encrypted at rest; the adapter that talks to GBP must decrypt only inside the call.
> - `process.env` accessed from anywhere except a single config module.
> - Pub/Sub push handler that does not verify the signed JWT / sender claim from Google.
> - SQL string interpolation with user input. Parameterized queries only.
> - Multi-tenant query without an explicit `organizationId` (or equivalent scoping column) in the WHERE clause. Every read and write in a tenant-owned table must scope by tenant; reviewer must call out every query that doesn't.
>
> **MAJOR:**
>
> - Adapter does retries/backoff inline instead of using a shared policy from `shared/`.
> - HTTP/GBP errors not translated to domain errors at the adapter boundary.
> - Adapter logs sensitive fields (tokens, emails, full review bodies tied to a reviewer).
> - Migrations missing for a new table/column; or migration not idempotent.
> - Adapter holds mutable module-level state (cache, singleton client) — should be injected.
>
> **MINOR:**
>
> - Adapter class named after the tech (`PostgresPropertyRepo`) is fine; flag if it's named after the port (`PropertyRepoImpl`) — prefer the tech-named form so the composition root reads clearly.
>
> End with: ports in this context, adapter(s) for each, and any port without an adapter or any adapter not bound in `composition.ts`.

---

# 6. Server Functions

**When to run:** every PR adding or modifying `contexts/<ctx>/server/`.

**Pre-read:** `src/contexts/CONTEXT.md`, `src/shared/auth/middleware.ts`, `src/shared/observability/traced-server-fn.ts`.

**Prompt:**

> Review the server functions in `<SCOPE>`. A server function is the thin edge between a route mutation/loader and a use case. The required shape, in order:
>
> 1. Wrapped in `tracedServerFn` (or the project's tracing wrapper).
> 2. Auth middleware applied — produces `AuthContext` via `resolveTenantContext()`.
> 3. Input validated by a schema (zod/valibot/etc.) at the entry, before any logic.
> 4. Permission check via `can(role, permission)` from `shared/domain/permissions`.
> 5. Resolve / construct the use case from the composition root (or receive injected).
> 6. Call use case, map the result to the client shape.
> 7. Errors translated to a stable error envelope.
>
> Flag:
>
> **BLOCKER:**
>
> - Any of steps 1–7 missing.
> - Permission check using `hasRole()` instead of `can()`. (`hasRole` is for hierarchy only.)
> - Double-mapping the role: calling `toDomainRole()` on a value that came out of `resolveTenantContext()` (which already returns a domain role).
> - Server function reaching into another context's internals.
> - Server function performing repository calls directly (skipping the use case).
> - `organizationId` taken from the request body or query string instead of from `AuthContext`. Tenant id is server-authoritative.
> - Catching and returning raw error messages to the client (leak risk). Map to a coded envelope.
>
> **MAJOR:**
>
> - Validation schema defined inline and duplicated across functions. Hoist to a shared schema.
> - Server function name does not match the use case (e.g. `saveStuff` calling `CreateProperty`).
> - No integration test that exercises the auth + permission + use case path.
> - Tracing span lacks attributes for `organizationId`, `userId`, `useCase`, and the resource id being acted on.
>
> End with: server functions reviewed, per-function checklist (✅/❌ for the 7 steps), and any function failing more than 2 checks flagged as a priority fix.

---

# 7. Routes, Loaders & Mutations

**When to run:** every PR adding or modifying files under `src/routes/`.

**Pre-read:** `src/routes/CONTEXT.md`, `src/routes/_authenticated.tsx`.

**Prompt:**

> Review files in `<SCOPE>` under `src/routes/`. Routes are responsible for: auth guards in `beforeLoad`, fetching via loaders, writing via mutations, and rendering by composing components. They contain no business logic. Flag:
>
> **BLOCKER:**
>
> - Authenticated route not nested under `_authenticated.tsx` and not implementing its own `beforeLoad` guard.
> - `beforeLoad` doing data fetching as a side effect of auth resolution. Auth guard returns route context (`user`, `role`, `activeOrganization`); loaders fetch.
> - Loader / mutation calling a repository, ORM, or `fetch` directly. Must call a server function.
> - Route reading `organizationId` from URL params or local storage to scope a query. Tenant scoping comes from the auth context resolved server-side.
> - Loader returning unsanitized errors to the client (stack traces, internal messages).
> - Mutation that performs an irreversible action without an optimistic-rollback or confirmation pattern documented elsewhere in the codebase.
> - Permission gating expressed as `if (user.role === 'AccountAdmin')` in a route. Use `can()` server-side; mirror with `usePermissions()` for UI affordances only.
>
> **MAJOR:**
>
> - Loader and mutation key/cache invariants drift (e.g. mutation invalidates `['property']` but the loader keys on `['properties', id]`).
> - Route file containing JSX > ~80 lines of layout — should extract a component.
> - `Suspense`/`ErrorBoundary` missing around a child that uses `useSuspenseQuery` (or equivalent).
> - Route owning state that belongs in the URL (filters, pagination) — not bookmarkable.
> - Mutation handler that toggles UI state directly instead of relying on the mutation's pending/success/error.
>
> **MINOR:**
>
> - File naming drift from the router's convention.
> - Missing route-level title / meta when sibling routes have one.
>
> End with: routes reviewed, those that change auth/permission posture flagged separately, and a list of any loader→mutation key mismatches.

---

# 8. React Components & Hooks

**When to run:** every PR touching `src/components/` or hooks under `src/shared/hooks/`.

**Pre-read:** `src/components/CONTEXT.md`, `src/shared/hooks/usePermissions.ts`.

**Prompt:**

> Review components and hooks in `<SCOPE>`. Flag:
>
> **BLOCKER (per project rules):**
>
> - A component receiving `canEdit`, `canCreate`, `canDelete` (or similar) boolean props for permission gating. Use `usePermissions()` in the component itself.
> - A component using `hasRole()` to gate UI. `hasRole` is for hierarchy decisions in the sidebar/domain only; gating is `usePermissions()`.
> - A component calling `toDomainRole()` (this is server-side mapping only).
> - A component reaching into another context's internals (importing from `contexts/*/infrastructure` or another context's `domain/` directly).
> - A "client" component performing data fetches with raw `fetch` instead of through a loader/mutation/server function.
>
> **MAJOR:**
>
> - Hooks called conditionally or inside loops/handlers.
> - `useEffect` syncing state that derives from props/state — derive directly.
> - `useEffect` doing data fetching that belongs in a loader.
> - Inline event handlers re-created on every render and passed to memoized children (defeats memoization).
> - Components > ~250 lines or with > ~10 props — should decompose.
> - Form state hand-rolled with `useState` for each field when the project has a form library/pattern; identify the shared pattern and require it.
> - Error states swallowed (catch → toast generic message → no telemetry).
> - Accessibility: interactive elements without role/keyboard support, images without alt, color used as sole signal, missing `<label>` associations.
> - i18n: hard-coded user-facing strings in a project that has an i18n setup.
>
> **MINOR:**
>
> - `index.tsx` re-exports inconsistent with sibling folders.
> - Tailwind class lists not sorted by the project's plugin / convention.
> - Inconsistent component naming (`UserCard` vs `userCard.tsx`).
>
> End with: components reviewed, top 3 with most findings, and a list of any prop interfaces that smell like leaked server concerns.
>
> **Storybook — component verification (this project's component test surface):**
>
> Stories are co-located as `*.stories.tsx` next to the component and run as tests via the `storybook` vitest project (headless Chromium) plus `@storybook/addon-a11y`. They are not decoration — they are the component test.
>
> **BLOCKER:**
>
> - A non-presentational component (state, error, loading, validation, or permission-gated UI) with no co-located `*.stories.tsx`.
> - A story that value-imports from `#/contexts/*/server/**` (enforced by `scripts/check-component-boundaries.mjs`; `import type` is the only allowed form — needed for `Action`/`mutation` prop typing).
> - A story that calls a real server function or raw `fetch` instead of constructing a mock `Action`/`useServerFn` wrapper with controllable `isPending`/`error`/`isSuccess` (canonical pattern: `makeAction` in `src/components/features/identity/login/login-form.stories.tsx`).
>
> **MAJOR:**
>
> - A story file rendering only the happy-path variant — must cover `idle / pending / error / validation-failure / success` for any component that has those states.
> - A component needing router/auth context whose story re-declares providers instead of using `RouterDecorator` / `AuthedRouterDecorator` from `.storybook/`.
> - A story whose `play` function asserts on implementation details (private method calls) instead of observable DOM (`userEvent` + `expect` from `storybook/test`).
> - A story reaching for a server-leaking module not covered by a `.storybook/stubs/*` alias in `.storybook/main.ts` `viteFinal` — that is a preview crash waiting to happen.
>
> **MINOR:**
>
> - Story title not namespaced by feature (`Identity/LoginForm`, not `LoginForm`); missing `tags: ['autodocs']`.
>
> End with the component table extended: `component | has story? | covers 5 states? | a11y clean (addon-a11y)? | play function?`.

---

# 9. Permissions & Authorization (CRITICAL)

**When to run:** every PR touching `shared/auth/`, `shared/domain/permissions.ts`, `shared/domain/roles.ts`, any `server/` file, or `_authenticated.tsx`. Run monthly as a sweep across the repo.

**Pre-read:** root `CONTEXT.md` (Glossary, Permission Patterns, Forbidden patterns), `src/shared/auth/permissions.ts`, `src/shared/domain/permissions.ts`, `src/shared/domain/roles.ts`, `src/shared/hooks/usePermissions.ts`, `docs/adr/0001-dynamic-access-control.md`.

**Prompt:**

> You are auditing authorization. The project's rules are explicit and non-negotiable. Quote the violated rule verbatim from `CONTEXT.md` in every finding.
>
> **The three APIs and where each is allowed:**
>
> | API                           | Allowed only in                             |
> | ----------------------------- | ------------------------------------------- |
> | `can(role, permission)`       | Server functions, route `beforeLoad` guards |
> | `usePermissions()`            | React components                            |
> | `hasRole(role, requiredRole)` | Sidebar visibility, domain hierarchy rules  |
>
> **Forbidden, per CONTEXT.md:**
>
> 1. Passing `canEdit` / `canCreate` / `canDelete` boolean props — use `usePermissions()` in the component.
> 2. Using `hasRole()` for permission checks — only for hierarchy.
> 3. Calling `toDomainRole()` on an already-mapped domain role — `resolveTenantContext()` already returns domain roles.
>
> Review `<SCOPE>`. The three forbidden API misuses above (boolean perm props, `hasRole()` for gating, `toDomainRole()` on a mapped role) are **MAJOR** convention drift — **BLOCKER** only when the misuse is the sole authorization on a path (i.e. no effective server-side check exists behind it).
>
> **BLOCKER (authz bypass / data exposure — these are security bugs):**
>
> - PropertyManager actions on a property that do not verify a `staff_assignment` for that property. Per CONTEXT.md: "PropertyManagers only manage assigned properties." Quote the file/line and confirm an assignment lookup precedes the mutation.
> - Replies surfaced to Staff role anywhere in the UI or API. CONTEXT.md: "Only PM+ roles can manage replies; Staff cannot view or manage them."
> - AccountAdmin-only operations (anything under `ac.*`, including role management) accessible by lower roles.
> - Permission check on the client without a matching server-side check. The client-side check is an affordance, never a guard.
>
> **MAJOR (convention / hygiene — fix fast, not a vuln):**
>
> - Permission strings hard-coded as bare literals (`'portal.create'`) instead of referencing the permission constant/enum in `shared/auth/permissions.ts`.
> - A role check that uses string equality (`role === 'AccountAdmin'`) when a permission would express intent (`can(role, 'role.manage')`). Roles are who you are; permissions are what you can do.
> - The three forbidden API misuses (boolean perm props / `hasRole()` for gating / `toDomainRole()` on a mapped role) when a server-side check does backstop them.
> - Permission added in `shared/auth/permissions.ts` but no role grants it (dead permission), or granted to a role with no use case enforcing it.
> - New permission introduced without an ADR note when it crosses an existing role boundary (e.g. giving Staff a write permission).
> - `AuthContext` constructed anywhere outside `resolveTenantContext()`.
> - Permission cached longer than the tenant cache TTL (`shared/auth/middleware.ts`) — risks stale role after role change.
>
> End with: a permission matrix table — rows = permissions used in scope, columns = `AccountAdmin | PropertyManager | Staff`, cells = `granted? / enforced where?`. Highlight any row with "granted but not enforced" or "enforced but not granted to any role."

---

# 10. Auth Flow & Better-auth Integration

**When to run:** PRs touching `shared/auth/`, `routes/_authenticated.tsx`, `composition.ts`, or any code referencing `better-auth`.

**Pre-read:** root `CONTEXT.md` (Auth Architecture, Roles), `src/shared/auth/auth.ts`, `src/shared/auth/auth-client.ts`, `src/shared/auth/middleware.ts`, `docs/adr/0001-dynamic-access-control.md`.

**Prompt:**

> Audit the integration between better-auth and the domain. Flag:
>
> **BLOCKER:**
>
> - Domain code importing from `better-auth` directly. The mapping `better-auth role → domain role` happens once, in `toDomainRole()` (server) and is reflected in the auth context. Downstream code must see only domain roles.
> - Anywhere `owner`/`admin`/`member` (the better-auth strings) appear outside `shared/auth/`. Domain and use cases must work with `AccountAdmin | PropertyManager | Staff`.
> - Dynamic Access Control (DB-backed role overrides) being bypassed by a hard-coded role check.
> - Session/cookie read by anything other than the auth middleware. Downstream code receives `AuthContext`.
> - OAuth/SSO/passwordless login flows that auto-create accounts on the user's behalf in a way that violates the global rule (creating an account is a user action, not a Claude/agent action).
>
> **MAJOR:**
>
> - `resolveTenantContext()` not memoized per-request → multiple DB hits for role lookup in a single request lifecycle.
> - Tenant cache invalidation missing when membership/role changes are committed.
> - Route context (`user`, `role`, `activeOrganization`) duplicated in component props instead of read via a `useRouteContext`-style hook.
> - `activeOrganization` switching not invalidating tenant cache / query cache.
>
> **MINOR:**
>
> - Inconsistent naming between `AuthContext` (server) and route context (client) fields.
>
> End with: a flow diagram (text is fine) of `cookie → better-auth session → toDomainRole → AuthContext → can() check`, listing the file/function at each hop and noting any hop without a test.

---

# 11. Multi-tenancy & Tenant Isolation

**When to run:** every PR touching repos, queries, or any code with an `organizationId` parameter. Run quarterly across the repo as a regression sweep.

**Pre-read:** root `CONTEXT.md` (Identity, Property Access), `src/shared/auth/middleware.ts`.

**Prompt:**

> The unit of tenancy is the organization. PropertyManagers are further scoped by `staff_assignment` to specific properties. Review `<SCOPE>` and flag:
>
> **BLOCKER:**
>
> - Any DB query (read or write) on a tenant-owned table without `organizationId` in the predicate. Enumerate them; do not summarize.
> - `organizationId` trusted from request input rather than `AuthContext`.
> - A PropertyManager-allowed mutation on a property where the code does not verify a `staff_assignment` row exists for `(userId, propertyId)`.
> - Cross-tenant joins (a query that could return rows from another organization given a crafted input).
> - Background jobs / Pub/Sub handlers that act on a property without re-establishing the tenant context.
> - A test that uses a single tenant and would pass even if tenant isolation were broken. Tests for tenant-scoped code must include a second-org fixture and assert non-visibility.
>
> **MAJOR:**
>
> - Tenant id passed implicitly via module-level state or an async-local-storage pattern not documented in `CONTEXT.md`.
> - Cache keys missing `organizationId` (would serve org A's data to org B on cache hit).
> - Logs / spans missing `organizationId` attribute.
> - GBP / GoogleConnection lookups not scoped by org.
>
> End with: a table — `entity | table | tenant column | found-unscoped queries`. Any non-empty last column is a top-priority fix.

---

# 12. Observability — Tracing, Logging, Metrics

**When to run:** PRs adding server functions, adapters, background jobs, or modifying anything in `shared/observability/`.

**Pre-read:** `src/shared/CONTEXT.md`, `src/shared/observability/traced-server-fn.ts`.

**Prompt:**

> Review tracing and logging in `<SCOPE>`. Flag:
>
> **BLOCKER:**
>
> - A server function not wrapped in `tracedServerFn` (or the equivalent).
> - PII / secrets logged: tokens, full reviewer names with email, raw OAuth payloads, encrypted token blobs (even encrypted, don't log).
> - Logger called with string concatenation instead of structured fields.
> - Error caught and logged without re-throwing (or returning a typed error) — invisible failures.
>
> **MAJOR:**
>
> - Span attributes missing the canonical set: `organizationId`, `userId`, `role`, `useCase`, `resource.type`, `resource.id`.
> - Manual `console.log` anywhere outside scripts.
> - Inconsistent log levels (info for errors, error for routine validation failures).
> - Background job / Pub/Sub handler not creating its own root span and not linking back to the originating event id.
> - A new external call (GBP, DB, OAuth refresh) not wrapped in a span.
>
> **MINOR:**
>
> - Log messages without a stable, greppable prefix or event name.
>
> End with: a table — `code path | has span? | attrs complete? | log on failure?`. Highlight any "no span" row.

---

# 13. Error Handling & Result Types

**When to run:** any PR adding new failure modes (validation, external calls, business rule violations).

**Pre-read:** `src/contexts/CONTEXT.md`, `src/shared/CONTEXT.md`.

**Prompt:**

> Review error handling in `<SCOPE>`. Flag:
>
> **BLOCKER:**
>
> - `throw new Error('...')` in domain or application layers. Domain errors are typed classes; application surfaces them or maps them.
> - Bare `catch (e) {}` or `catch { return null }`. Every catch documents and either rethrows, maps to a typed error, or is recovery with a logged decision.
> - HTTP status codes leaking up into the domain or application layer.
> - Error message containing internal details returned to the client.
> - Validation errors and authorization errors collapsed into the same generic error type.
>
> **MAJOR:**
>
> - Inconsistent error envelope at the server function boundary. There must be one shape `{ code, message, details? }` (or similar) — enumerate any deviation.
> - Use cases returning `null` to signal failure instead of `Result<T, DomainError>` (or the project's equivalent).
> - Domain error classes that don't extend a common `DomainError` base — breaks `instanceof` discrimination.
> - Retryable vs non-retryable external errors not distinguished — caller cannot make a sensible decision.
>
> **MINOR:**
>
> - Error class names without `Error` suffix (or with redundant `ErrorException` suffix).
>
> End with: a catalogue of distinct error types found, grouped by layer, and flag any layer that throws untyped errors.

---

# 14. Type Safety & Naming Conventions

**When to run:** continuous. Cheap to run on every PR.

**Pre-read:** root `CONTEXT.md`, `tsconfig.json`, `eslint`/`biome` config.

**Prompt:**

> Strict TypeScript review of `<SCOPE>`. Flag:
>
> **BLOCKER:**
>
> - `any` (explicit or via `as any`) outside of test scaffolding or a `// FIXME: <reason>` with a tracked issue id. Enumerate every occurrence.
> - `as unknown as T` to force a cast. Must be replaced with proper type guards or schema validation.
> - `// @ts-ignore` / `// @ts-expect-error` without a reason comment.
> - Non-null assertion `!` used to dodge a real possibility of `undefined`. (OK only after a checked invariant on the same line.)
> - `Function`, `Object`, `{}` types used as parameter or return types.
> - `enum` (numeric) where a discriminated union or `as const` literal union would do — pick the project convention and flag drift.
>
> **MAJOR:**
>
> - Branded ID types (`UserId`, `PropertyId`, `OrganizationId`, etc.) absent where the codebase has them — raw `string` slipping in.
> - `Date` passed as a domain value instead of an injected `Clock`-produced value (cross-link with the Domain Purity prompt).
> - `unknown` returned from a parsing layer with no follow-up narrowing.
> - Discriminated unions without exhaustive `never` assertions in switches.
> - Generic parameters named `T`, `U` when they have a clear meaning (`TUser`, `TInput`).
> - Public exports without explicit return types on functions.
>
> **MINOR:**
>
> - File / folder casing inconsistent with project (`kebab-case` vs `PascalCase` for component files).
> - Import order inconsistent with project formatter.
> - Re-exports via `export *` instead of named re-exports in a barrel file.
>
> End with counts per BLOCKER category and the file with the highest density of issues.

---

# 15. Tests

**When to run:** every PR. A PR adding non-trivial code without tests should fail this review.

**Pre-read:** any test config (`vitest.config.*`, `jest.config.*`), `src/contexts/CONTEXT.md`.

**Prompt:**

> Review test coverage and test quality for `<SCOPE>`. Flag:
>
> **BLOCKER:**
>
> - Use case added without a unit test that exercises a real failure path (not only the happy path).
> - Domain entity invariant not tested (e.g. `Rating` accepts out-of-range value because no test asserts the rejection).
> - State machine transition (Reply, InboxItem) added/changed without a test asserting allowed and forbidden transitions.
> - Adapter touching an external system has no contract/integration test against a fake/double or recorded fixture.
> - Server function with auth/permission logic has no test that exercises a forbidden role.
> - Tenant-scoped code with no second-tenant test (cross-link with Multi-tenancy prompt).
>
> **MAJOR:**
>
> - Tests asserting implementation details (private method calls) instead of observable behavior.
> - Heavy mocking of the domain — domain code should be testable without mocks.
> - Snapshot tests on large objects with no review discipline (always re-blessed).
> - Shared fixtures mutated across tests, causing order dependence.
> - Test names that describe what is called instead of the expected behavior (`calls repo.save` vs `persists the property when fields are valid`).
> - Time / random not stubbed — flaky tests.
>
> **MINOR:**
>
> - Inconsistent `describe`/`it` phrasing.
> - Helpers in the same file as tests when a sibling `__fixtures__` would serve.
>
> **Component tests live in Storybook (cross-ref §8):**
>
> - A component with state, error, loading, validation, or permission-gated UI and no co-located `*.stories.tsx` is a BLOCKER — stories _are_ the component test surface here.
> - A story file rendering only the happy path (no `idle / pending / error / validation / success` variants where the component has those states) is MAJOR.
> - A story `play` function is the interaction test; it runs in the `storybook` vitest project (headless Chromium). A component with logic and no `play` function is MAJOR.
> - a11y findings come from `@storybook/addon-a11y` via `run-story-tests` (or `pnpm test:storybook`), not reviewer opinion. Unresolved violations are MAJOR; BLOCKER when color or interaction is the sole signal.
> - Do NOT flag "missing vitest unit test for component X" — that is intentionally covered by the story. Only flag if the story is missing or shallow.
>
> **Testing infrastructure (cross-ref ADR 0019, root `CONTEXT.md` "Key Files"):**
>
> - BLOCKER: a claimed "invariant enforced" (per §3) that is not exercised by a test in `src/shared/testing/invariants/` — the invariant harness is the authority, not the reviewer's say-so.
> - BLOCKER: the simulation harness (`simulation-container.ts`, `in-memory-queue.ts`, `scenario/builder.ts`, `scripts/seed.ts`) changed without a test that the simulation still produces deterministic outputs (clock, queue, ids all injected).
> - MAJOR: a new testing helper in `src/shared/testing/` with no test of its own and no consumer in the same PR — dead test infra.
>
> End with: a layer-by-layer coverage estimate (domain / application / infra / server / route / component) for the scope, and a list of the three code paths most urgently needing tests.

---

# 16. Schema & Migrations

**When to run:** every PR adding a table/column/index, or touching a migration or a tenant-owned table.

**Pre-read:** root `CONTEXT.md` (Architecture, Client/Server Boundary), `src/shared/CONTEXT.md`, the project's migration directory convention.

**Prompt:**

> Review the schema changes and migrations in `<SCOPE>`. Flag:
>
> **BLOCKER:**
>
> - A new tenant-owned table without an `organizationId` (or equivalent scoping) column. [also: §11]
> - A migration that is not idempotent — re-running it must not throw or double-apply (`IF NOT EXISTS` / guards on data backfills).
> - A destructive migration (`DROP`, a type `ALTER` that loses data, a column removal) without a reversible companion migration or a documented backfill plan.
> - A `NOT NULL` column added to a non-empty table without a default or a backfill step.
> - SQL string interpolation with user input in any migration or repo query. Parameterized only.
>
> **MAJOR:**
>
> - Missing index on the tenant column, or on any column used in a `WHERE`/`ORDER BY`/`JOIN` of a hot query. Enumerate the access patterns and call out the missing index.
> - Foreign key without an explicit `ON DELETE`/`ON UPDATE` policy — the default is silent and usually wrong; pick `CASCADE`/`RESTRICT`/`SET NULL` deliberately and say why.
> - A status/state column typed as free `string`/`text` when the domain defines a finite set (Reply, InboxItem statuses per ADR 0004) — use a checked enum or a constraint.
> - A generated/derived column whose formula drifts from the domain rule that computes the same value in code.
> - A column the domain invariant requires but the schema leaves nullable.
> - A type change on a zero-downtime path without a two-step expand/contract plan (add new → backfill → switch reads → drop old).
>
> **MINOR:**
>
> - Inconsistent naming between the migration file, the table, and the entity.
> - Migration filename not monotonic with merge order.
>
> End with: tables changed, per-table `(tenant-scoped? | index coverage | FK policy | idempotent migration? | reversible?)`, and any access pattern with no supporting index.

---

# 17. Composition Root & Bootstrap

**When to run:** every PR touching `src/composition.ts`, `src/bootstrap.ts`, or adding/renaming a port or adapter; on any PR that wires a new context.

**Pre-read:** root `CONTEXT.md` (Architecture, Key Files), `src/contexts/CONTEXT.md`, ADR 0018 (injectable container).

**Prompt:**

> The composition root (`src/composition.ts`) is the _only_ place concrete adapters are bound to ports; bootstrap (`src/bootstrap.ts`) owns startup order. Review `<SCOPE>` and flag:
>
> **BLOCKER:**
>
> - A use case, server function, or route that `new`s an infrastructure adapter directly instead of receiving it via the composition root. (Restate of §1 rule 6 — cite the specific call site.)
> - A port bound to two concrete adapters in the same scope (ambiguous resolution), or a port with no binding that is resolved at runtime.
> - Bootstrap performing side effects at import time (top-level `await`, module-scope `init()`/`connect()` calls). Side effects begin in an explicit `start()`/`bootstrap()` entry point.
> - Bootstrap order that violates a real dependency (cache started after the first read, migrations not run before traffic). State the required order and quote the line that breaks it.
>
> **MAJOR:**
>
> - A new port added in domain/application with no adapter wired in `composition.ts`, or an adapter written but never bound.
> - Lifecycle mismatch: an adapter holding a connection/pool with no teardown registered with bootstrap.
> - The composition root branching on `process.env.NODE_ENV` in a way that hides a production adapter from the test/sim harness — wire via the injectable container (ADR 0018) instead.
>
> **MINOR:**
>
> - Adapter bindings not grouped by context in the composition file.
>
> End with: a binding table — `port | adapter | bound in composition.ts? | lifecycle (create/teardown) | used by which use cases`. Flag any port with no adapter or any adapter with no binding.

---

# 18. Shared Infrastructure (`shared/`)

**When to run:** every PR touching anything under `src/shared/` (auth, cache, db, jobs, observability, domain, testing). Changes here have repo-wide blast radius.

**Pre-read:** `src/shared/CONTEXT.md`, root `CONTEXT.md` (Client/Server Boundary, Key Files), ADR 0015 (import protection), ADR 0017/0018/0019 (injectable clock/container, simulation harness).

**Prompt:**

> `shared/` is depended on by every context; a regression here is a regression everywhere. Review `<SCOPE>` and flag:
>
> **BLOCKER:**
>
> - A change to `shared/domain/permissions.ts` or `shared/domain/roles.ts` that alters what a role can do, without an ADR note and without updating every call site of `can()`/`usePermissions()`/`hasRole()`. [also: §9]
> - A change to `shared/auth/middleware.ts` (`resolveTenantContext`, tenant cache) that changes the `AuthContext` shape or cache TTL without updating every consumer.
> - A change to `shared/observability/traced-server-fn.ts` that drops canonical span attributes or breaks the wrapper contract relied on by §6's 7-step shape.
> - New code under `shared/` that imports a framework or a concrete context's internals — `shared/` depends inward only on `shared/domain`.
> - Server-only code (Node builtins, `pg`, `drizzle-orm`, `bullmq`) newly reachable from a client bundle path. [also: root CONTEXT.md Client/Server Boundary; ADR 0015]
> - A cache key or TTL change in `shared/cache` without considering cross-tenant leakage (key must include `organizationId`). [also: §11]
>
> **MAJOR:**
>
> - A public export added/removed from `shared/` without updating the barrel and every importer — list the importers.
> - A change to the simulation/testing harness (`shared/testing/*`) that changes the determinism contract (clock, ids, queue) without updating tests that rely on it. [also: ADR 0019, §15]
> - A helper duplicated between `shared/` and a context's local code — the shared version is canonical.
>
> **MINOR:**
>
> - Inconsistent error-translation policy at a `shared/` boundary.
>
> End with: the `shared/` modules changed, and for each, every consuming context/file. Any module whose change is not reflected in a consumer is a top-priority fix.

---

# 19. Per-Context Deep Dive (template — instantiate per context)

**When to run:** ahead of a release that materially changes a single bounded context, or when onboarding to that context.

**Pre-read:** root `CONTEXT.md`, `src/contexts/CONTEXT.md`, the context's own `CONTEXT.md` if present, the relevant ADRs (e.g. ADR 0003 for Review, ADR 0004 for Inbox).

**Prompt:**

> You are doing a deep review of a single bounded context: **`<CONTEXT_NAME>`**. Walk the context layer-by-layer and produce findings using the shared rubric.
>
> For each of the following, list what exists, then flag gaps/issues:
>
> 1. **Domain entities owned** — name each, list invariants enforced, list invariants from the glossary not enforced.
> 2. **Use cases** — name each, list the ports it depends on, the permission required, and whether a test exists for happy + forbidden + business-failure paths.
> 3. **Ports vs adapters** — for each port, name the adapter(s); flag ports without adapters and adapters without bindings in `composition.ts`.
> 4. **Server functions** — for each, verify the 7-step shape from the Server Functions prompt.
> 5. **Routes / loaders / mutations** — verify guards and key consistency.
> 6. **Components specific to this context** — verify they use `usePermissions()` and not boolean prop drilling; verify each feature component has a co-located `*.stories.tsx` covering its states, with `play` functions that exercise the permission-gated paths (cross-ref §8, §9).
> 7. **Cross-context interactions** — list each, classify as `via application API` / `via domain event` / `direct import (BLOCKER)`.
> 8. **ADR compliance** — for each ADR that names this context, quote the rule and confirm the code complies; flag drift.
>
> Context-specific spot-checks:
>
> - **Identity**: `toDomainRole()` is the single mapping site; `AuthContext` shape matches glossary; dynamic access control overrides are loaded per-org and cached with correct TTL.
> - **Property**: Properties are organization-owned; PropertyManager mutations always check `staff_assignment`.
> - **Portal / Guest**: Public surfaces never expose internal IDs that allow enumeration; rate-limit on rating/feedback submission.
> - **Integration**: Tokens encrypted at rest; Pub/Sub push verified; subscribe-on-first-import and unsubscribe-on-last-removal lifecycle implemented and tested.
> - **Review**: `Review` and `Reply` are separate entities; `Reply.source` correctly distinguishes `google_sync` from `internal`; internal reply lifecycle `draft → pending_approval → approved → published | publish_failed` implemented as explicit transitions; Staff role cannot read or write replies in any code path.
> - **Inbox**: `InboxItem` carries denormalized filter/sort fields written only from inside `inbox`; status transitions match ADR 0004; `Addressed` semantics match glossary for both reviews and feedback.
> - **Team**: `StaffAssignment` is the source of truth for property scoping — referenced by the Property context's permission checks, not duplicated.
> - **Dashboard**: read-only; no writes; aggregates via published projections from other contexts, not by reading their tables.
>
> End with: a one-page health report for the context — entities, use cases, ports/adapters, routes, components — and the top 3 risks.

---

# 20. ADR & Documentation Compliance

**When to run:** monthly, and whenever an ADR is added or amended.

**Pre-read:** all files in `docs/adr/`, root `CONTEXT.md`, every layer `CONTEXT.md`.

**Prompt:**

> Audit consistency between documentation and code. Flag:
>
> **BLOCKER:**
>
> - A rule stated in any `CONTEXT.md` or ADR that the code violates. Quote the rule, cite the violating file.
> - An ADR marked "Accepted" whose decision is not reflected anywhere in the code.
> - Two `CONTEXT.md` files contradicting each other.
> - No ADR exists for a load-bearing frontend testing decision: "stories are the component test surface" and the `.storybook/stubs/*` server-leak stubbing strategy (stubs exist because real server modules crash the browser preview — rationale currently only in `.storybook/main.ts` code comments). Cite the ADR if it exists; absent → BLOCKER, require one.
> - Root `CONTEXT.md` "Key Files" omits Storybook-critical entries: `.storybook/main.ts`, `scripts/check-component-boundaries.mjs`, and the story-test command (`pnpm test:storybook` / `run-story-tests`). Doc drift — flag it.
>
> **MAJOR:**
>
> - A bounded context exists in code but is missing from the root `CONTEXT.md` bounded-contexts table (or vice versa). (Today: `Dashboard`'s row in the bounded contexts table is formatted differently from the rest — verify the table is consistent.)
> - A glossary term used in code with a meaning that drifts from the glossary.
> - A "Key Files" entry in root `CONTEXT.md` pointing to a file that no longer exists or has moved.
> - An ADR referenced in `CONTEXT.md` (`ADR 0001..0004`) that does not exist on disk, or an ADR on disk not indexed in `CONTEXT.md`.
>
> **MINOR:**
>
> - Stale TODOs older than N months without an issue link.
> - Doc comments referencing renamed symbols.
>
> End with: a table of every ADR → status → "compliant / drift / no-evidence" and a list of doc edits required.

---

## Suggested cadence

| Cadence               | Prompts to run                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every PR              | 1 (if cross-layer), the layer prompt(s) for changed files, 8 + story tests (if `src/components/` touched), 9 (if auth/permission touched), 14, 15 |
| Every PR (structural) | 16 (if schema/migrations touched), 17 (if `composition.ts`/`bootstrap.ts` touched), 18 (if anything under `src/shared/` touched)                  |
| Weekly                | 1, 2, 11 as sweeps                                                                                                                                |
| Per release           | 19 for any context with significant change, 20                                                                                                    |
| Quarterly             | Full 1, 2, 9, 11, 12, 18 sweeps across the whole repo                                                                                             |
