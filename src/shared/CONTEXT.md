# Shared — Context

**Audience:** Developers and agents working in `src/shared/`.

## Responsibility

Shared owns reusable infrastructure and genuinely cross-context primitives. It does not take product meaning away from a bounded context. Wait for a second real consumer before extracting code here; context-specific policy stays with its owner.

Primary areas:

- `auth/`, `security/`, `rate-limit/`, `provider-ephemeral/`, and
  `google-provider-control/` own reusable admission and transport fences.
- `commands/command.server.ts` wraps tenant server handlers with headers,
  membership, execution policy, tracing and declared error translation.
  `commands/public-command.server.ts` resolves public scope and applies limits
  and public execution policy without creating a manager session. `contracts.ts`
  holds their browser-safe types; own-account and operator authorization stay
  with their existing adapters.
- `db/`, `events/`, `outbox/`, and `jobs/` own durable storage/delivery mechanics.
- `architecture/` and `governance/` hold executable boundaries and catalogues.
- `health/` and `observability/` expose content-minimal runtime evidence.
- `domain/`, `http/`, `email/`, `cache/`, and `lifecycle/` hold small mechanisms.
- `hooks/` and `queries/` are browser-safe cross-feature access/cache utilities.
- `ops/` and `release/` own operational and promotion contracts. Restore apply
  requires `--yes closed-beta-v2`, logged with the operator and time, after the
  isolated database and side-service refusals. Review retains durable page
  checkpoints; retries keep the receipt's original operator and correlation
  for fence execution while logging the current confirmer separately.
  After resuming the frozen pass, verification sweeps expiry again from the
  start at a fresh cutoff. These atomic pages can replay after interruption
  without changing the receipt's evidence or resetting its durable checkpoint.
  Expiry is checked again after fencing before the receipt can complete.
  `recovery_runs` retains the fence and cutover generation. Erasure
  replay runs from the local journal export (`journal=<file>`) before the
  receipt completes.
  `release/railway-service-settings.ts` defines web and worker settings; image
  promotion checks deployed manifests and replica counts against that contract.

Notification, Integration, Staff self, Identity and Product updates query families
come from `queries/query-keys.ts`'s `createKeys(scope)`. `TenantScope` names the signed-in
person and Organization; own-account reads outside the manager workspace use a
null Organization. Loaders pass their scope explicitly, while components use
`hooks/useTenantScope.ts`, which takes the deepest resolved identity in the
presented matches while a pending route's descendants await their context.
Reads, optimistic updates and invalidations share that
scope. Tenant and session transitions still clear the caches independently.

- `testing/` and `db/testing/` are test-only support, never runtime authorities.

`ops/local-database.ts` is the shared local-only database guard for development
scripts and the manual rights command. It checks the process environment and
the PostgreSQL driver's effective host and database name before allowing writes.

Shared-area dependency and production/test fences are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Root contracts

The shared root is not a general placement target. Its loose files are the attested AI language wrappers, their pinned manifests and vectors, the merchant-AI notice contract and the Reply language catalogue, each kept at the root because a digest, manifest or script names its path. Everything else sits in a topic folder: `ai-gateway/`, `ai-operation/`, `ai-provider-profile/`, `ai-redaction/` and `ai-review-source/` (AI contracts, profiles and the deterministic redactor), `analysis/`, `reply/` and `reply-library/` (the Review analysis and Reply contracts and the built-in library), `beta-feedback/`, `merchant-ai-notice/`, `google-contracts/` (Google Review/Performance wire normalization and provider-subject bindings), `json/` (canonical, closed and strict AI JSON), `responsible-manager/`, `routing/`, `whats-new/`, `dashboard/` and `domain-schemas/`, and the browser-side helpers `format/` (number, date and time wording), `class-names/` (`cn`), `clipboard/` and `fonts/`. Each folder is declared in `LAYOUT.sharedFolders` (`scripts/ci/check-layout.ts`), and `pnpm check:layout` counts the loose files that remain. New workflow orchestration belongs in an owning context.

Responsible-manager eligibility has two owners, Property and Portal, and its
contract includes the one rule both follow when a member is removed: release,
from `identity.member.removed`, what the member still holds and may no
longer hold (`releaseRemovedMemberResponsibilities`), through the one handler
that reads the fact and records the receipt after the release
(`responsible-manager/removed-member-consumer.ts`). `responsible-manager/` holds only that rule and that handler.
Each owner registers the consumer under its own name and catalogue row and binds
the rule to its own store, and the check an assignment makes after it commits
stays in the owner's use case.

AI and Google contracts state their semantic owner explicitly. Browser-safe
catalogues must not pull Node crypto, provider clients, configuration, queues, or
persistence into the client graph. Raw provider/review content and credentials do
not belong in shared contract records.

Browser/server reachability is enforced by `src/shared/architecture/browser-reachability.test.ts` and `eslint.config.js`.

Strict AI JSON parsing lives in `json/ai-json.ts`, independently of admission and
gateway schemas. It accepts a typed `parse` function and preserves byte, UTF-8,
duplicate-key, Unicode, depth, node and number-policy checks for provider bodies
and key material. Parsing and diagnostics share their parsed-value checks; the
gateway adds its noncharacter restriction to the common Unicode scalar check.
Identity uses the bare `provider-source` advisory scope; its bytes and
PostgreSQL hash input must stay stable.

AI admission is in process and typed. The PostgreSQL authority mints an
`AiExecutionAdmission` (`ai-provider-control/execution-admission.ts`) that only the
AI admission adapter may create; the dispatch gate spends it once and checks its
attempt, limits, deadline and descriptor digest against the exact bytes. No grant,
request-binding HMAC or nonce is signed or stored. Settlement uses
`settle(permit, outcome)`: the authority checks the stored attempt and permit and an
open reservation and prices usage from the stored provider. Unknown dispatched usage
costs the reservation; proved no-dispatch releases it at zero. Browser provenance
signatures, output binding and delivery deadlines remain independent.

## Authentication and runtime

`auth/middleware.ts` resolves tenant context through the staged tenant resolver.
`headersFromContext()` is asynchronous and uses a dynamic server import because its
module is browser-reachable; every server caller must await it. Tagged auth errors
are mapped once at the delivery boundary.

Cache Redis and Queue Redis are physically distinct in production. Cache
single-flight/backoff remains Integration-owned through a shared mechanism;
credential generation in PostgreSQL is the durable commit fence. Queue Redis must
use `noeviction`; PostgreSQL may retry pool acquisition only, never a SQL statement
whose commit outcome is ambiguous.

The delayed job gate gives handlers an abort signal at their catalogue deadline.
It holds their BullMQ slot until cleanup finishes; work still running after five
seconds of grace terminates the worker nonzero. Shared database transactions
inherit that deadline and refuse commit after abort. Normal handler results and
policy denials retain their existing meaning.

### Stale tabs (`stale-tab/`)

Deploys happen several times a day and a tab outlives them: it keeps the code of
the release that served its page while the server moves on, so old code receives
new response shapes (or asks for chunk files the new release no longer ships).
The root route writes the serving release into the page head (`repkey-release`,
whether or not monitoring is configured) and the browser entry keeps it
(`startStaleTabGuard`, before hydration, because later navigations rewrite the
head). Every server-function call then states it in `x-repkey-release`
(`release-skew-middleware.ts`, global in `start.ts`), and the server compares it
with its own release **before** the function's validator, middleware or handler
runs:

- a **read** from an older tab is refused with the typed `stale_client` 409
  (`StaleClient`, an expected refusal that monitoring drops);
- a **mutation** is finished as it always was and answered with a flag, so the
  call and the person's input are never lost;
- an unknown release on either side (a development server, a test, Storybook, a
  server render, a client from before the check) means no answer is possible and
  the call runs.

A tab told it is stale is **armed**; so is a tab that meets a missing chunk
(`vite:preloadError`, an unhandled chunk-load rejection). An armed tab turns its
next navigation to another view, a new path **or new search** (the Inbox selects
an item through its search), into a full page load of the target (the router
announces it before the address bar changes, so the target is named, and only a
path on this site is loaded); a change of hash alone does not reload. A read the
server refuses within `FRESH_VIEW_MS` (3 s) of such a navigation reloads the
current address at once, armed or not: the refusal answers the view the
navigation has just drawn, so nothing in it can be lost, and this is what spares
the first item selected in the Inbox after a deploy. So does a read refused within
that window of the person **coming back to the tab** (or the network coming back),
which is how most tabs learn of a deploy: every read on the page is about to fail
and flip to its failure, and they have not started anything yet. Both hold while
a form control the person changed is still on screen (`watchPerson`, from the
signed-in layout: any control but a search, which the address keeps), and coming
back also holds while a dialog is open. A control under `data-reload-safe="true"`
does not count, and the question is asked when a reload is in question, so the
attribute can come and go: it means the words are saved or guarded right now, as
in the autosaved Portal forms, whose `PortalUnsavedChangesPrompt` guards the page,
and the reply composer, whose coordinator holds the reload until they are saved
and which drops the attribute when it cannot save them. Leave a form unmarked
unless all of that is true of it: an unmarked form costs a question, a wrongly
marked one costs the person's words. A guest's page is not watched: it holds what
they did in the page. Any other
refusal (a poll, a part of the page that mounted late) only arms the tab, because
the person may be in the middle of something. A tab also reloads at once
when a route already failed to draw (`useGuardedRouteError`): because of a stale
refusal, a missing chunk, or any failure at all once the tab is armed, since old
code meeting a newer answer fails in ways no shape can name.

**Try again on a read reloads an armed tab** (`useReadRetry`, `staleTab.tryAgain`:
`RegionError`, `PageState`, `LoadMoreButton`, the Google Refresh buttons). The read
can only be refused again, so asking for it again is a button that does nothing,
however often it is pressed. A press cannot loop, so the guard counts it and lets
it through, with the browser's own "Leave site?" first if the person holds
something a reload would lose. So does a read refused within `FRESH_VIEW_MS` of a
press, for a tab that had not yet learned it is stale. A retry that is not a read
(a save) never comes here: it goes through in a stale tab, and a reload could lose
it, so `RetryButton` alone presses exactly what it is given.

A tab never reloads under a mutation in flight (the reload waits for the next
moment), and never in a loop: `reload-guard.ts` allows one reload of its own per
release being left per two minutes, remembered in `sessionStorage` before the
reload, and refuses when it cannot remember. A navigation that would lose unsaved work is held by the page's
own blocker (`useBlocker`) before the router announces it, and a reload still
meets the page's `beforeunload`. A page still here ten seconds after asking (a
navigation that was cancelled) draws its failure again instead of a loading state
that never ends. The whole reload path is in first paint because it runs exactly
when a lazy chunk may be gone.

A read refused outside those windows on a page that stays put (a poll, or coming
back while the person holds something) draws that read's own failure until their
next navigation (another item or another page) or their Try again, either of which
reloads.

A call can also name a server function the new release no longer has (removed or
renamed; production ids are a hash of file and function name, so an unchanged
function keeps its id across deploys). Start looks the id up before any function
middleware, so the release check never sees it. `unknown-server-function.ts`
answers it at the request level with a plain `404` (body `Unknown server
function`, no id), as a response rather than an exception, so Sentry's request
middleware has nothing to capture; the same answer goes to a probe or bot with
any other id. Start's client throws it as an `Error` whose message is that body,
and the tab takes that as proof its code is older than the server's: a current
client never asks for an id its build lacks, so no release comparison is needed
(`isUnknownServerFunctionReply`, in `release-skew.ts` beside the body constant
because it is in first paint; the server module is not). From a read it acts as
the `stale_client` refusal does (arms the tab, and reloads a view just drawn);
from a mutation it only arms the tab, so what the person typed stays until their
next navigation. The caller still sees the failure either way.

Jobs, outbox delivery, health, and observability expose infrastructure mechanics.
Contexts own handler meaning, source transactions, recovery policy, content
classification, and mutation authority.

`events/*-event-descriptors.ts` and the focused event-schema files declare each
issued fact's type, version, allowlist schema and aggregate identifier. The
registry in `events/registry.server.ts` derives startup registrations, emitted
versions and relay metadata from those definitions. Historical decoders stay
available; aggregate identity never depends on unrelated identifiers in a payload.
The existing `events/schema-registrations.ts` startup entry point remains stable.

Server error logs retain validated names, codes and HTTP status, with no client
message or domain context. The logger redacts flattened error text recursively;
Error objects retain their content-free summaries and database facts. Client
error wording and the original monitoring cause are independent of those logs.

Outbox delivery admits facts into `work_items` in the same transaction as the
publication marker, through two in-process loops in the worker. The relay poll
runs every second and reads unpublished facts only (`published_at IS NULL`,
served by `outbox_events_published_at_idx`), ranked by tenant. The receipt
sweep runs at worker start and every ten minutes: each pass pages through every
published fact from the oldest, keyed on publication time truncated to the
millisecond and then ID, and admits a fact that still misses an expected
catalogued receipt and has no delivery work. It is the only path that
re-admits a published fact. A pass keeps no cursor after it ends, because the
worker restarts often. A fact that already has delivery work is never
back-filled to a consumer added to the catalogue later; the ledger owns its
retries. Both loops skip recovery-fenced facts and active legacy leases. The
relay sends only the work ID; the independent minute reconciler restores lost or failed
transport in bounded batches, up to 20,000 deliveries per pass, without an age
window or an attempt charge. The dispatcher resolves the tenant and fact from
the ledger, claims an execution, applies current policy
to each consumer, and settles only after all required receipts exist. A session
lock isolates a live callback past its lease expiry, without holding a database
transaction around consumer I/O. Failed
executions retry through the ledger and eventually remain visibly quarantined;
terminal failures also reach Redis quarantine, runtime observations and error
monitoring, while `ops work` owns ledger repair. The one-minute delivery lease
expires before BullMQ recovery, and session advisory locks still isolate live
consumers. Health reads also count quarantined delivery work directly from
PostgreSQL, so final-attempt worker death remains covered by the existing
quarantine alerts and error monitoring after Redis loss. Stored recovery fences still
refuse delivery. Legacy queue envelopes drain during rolling releases; their
producers and recovery sweeps are removed.

Outbox retention counts 30 days from publication and then removes only facts
with every catalogued durable consumer receipt. Missing receipts survive even
after redelivery exhausts its budget; recovery-fenced facts also remain. The
receipts leave with their fact through the database cascade. Audit-only facts
need no receipts. `outbox/retention.test.ts` exercises the rule's generated SQL
in memory; `jobs/retention-sweep-consumer-receipts.integration.test.ts` covers
PostgreSQL deletion and receipt cascades.

`jobs/work-items.server.ts` exposes the platform-owned work ledger. A source
command schedules IDs-only work in its own transaction. Adopters register a
kind handler. Before authorization the worker resolves the queue's `workId`
to its ledger Organization and subject, and checks that the kind matches.
The kind's scope resolver derives Property scope from that tenant-bound
`subjectId`; queue-supplied scope is ignored. The existing policy gate runs
before the handler can claim a lease. `complete` commits database effects and the
receipt together; external effects retain their provider fences. `read_back`
work never automatically resends after an expired lease or failed handler.
The worker's independent minute poll fairly rotates due tenants even when
Redis loses its jobs or schedulers; queue acceptance spends no attempt.
Unfinished rows and settled idempotency receipts remain until their owner
explicitly retires them. `pnpm ops work` lists and inspects by Organization,
and retries, cancels or discards with a named operator, reason and `--apply`.
Retry refuses uncertain effects and active leases. Existing jobs keep their
delivery path until their owning handlers adopt the ledger.

## Domain and boundaries

`shared/domain/` contains pure cross-context identifiers, result/error primitives,
roles, calendars, timezones, encodings, and small eligibility rules. A type with one
owner belongs with that owner. No I/O or framework code enters this area.

Cross-context product behavior remains behind each context's
`public-api.ts` at its root (Review and Inbox keep `application/public-api.ts`)
or a consumer-owned port. Shared events aggregate the
master event union but do not gain permission to construct another context's fact.

Cross-context public-interface boundaries are enforced by `eslint-rules/cross-context-public-api.mjs` and `src/shared/architecture/cross-context-public-api.test.ts`.

## Testing

`shared/testing/` contains fakes, fixtures, environment leases, and integration
harnesses. Production code must never import it. Test and architecture-fixture
zones remain distinct so static reachability analysis sees their intentional
cross-context edges without treating them as production dependencies.

The production/test import fence is enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

Redis-backed integration suites take their client from `testing/redis-test-lease.ts`.
On a machine with no Redis the lease reports unavailable and those tests return
without asserting, so a green local run does not prove they ran. With
`REQUIRE_TEST_REDIS=1` an unanswered probe throws and the suite fails; CI's
`integration` job sets it, and `testing/redis-test-lease.test.ts` pins that the
job running the integration project has a Redis service and requires it.

### Server-function harness

Test a server function with `testing/server-function-harness.ts` in a
`*.integration.test.ts` file beside it, not with `vi.mock` of `#/composition`,
`#/shared/auth/headers`, `#/shared/auth/middleware` or
`#/shared/auth/execution-policy`. `setupServerFunctionHarness()` builds the real
container (in-memory queues, Google OAuth, storage and email; no Redis unless
asked) and makes it the process's container. Seeds write the rows; a member
signs in through Better Auth and selects the Organization as the app does.
`callAs(caller, () => fn({ data }))` runs the call in a Start request carrying
that caller's session cookie (`null` for no session), so tenant resolution and
the execution policy decide it: a missing guard or a wrong role fails the test.

The file also declares
`vi.mock('@tanstack/react-start', async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild)`.
It binds each handler as Start's compiler does for the server, so the input
validator runs and the call answers with the handler's result or throws its
error; uncompiled, the result is lost. Global request and function middleware
(Sentry, release skew, request guards) are not run.

Options, each for the whole file:

- `env`: environment variables as the app reads them (`'true'`, comma lists,
  keyrings), parsed by the env schema. They reach the container and every
  `getEnv()` reader (client address, Organization suspension), and the file's
  previous values come back afterwards. A file that needs two settings of one
  variable is two files.
- `redis: true`: the container gets the local test Redis through
  `redis-test-lease.ts`, so rate limits count and refuse (429). Keys carry the
  file's own prefix and are cleared after each test; `harness.redis()` reads
  and writes them under the same prefix. Without Redis it is undefined and the
  limiter fails open: such a test returns early, as the other Redis suites do.
- `clock`, `providers`: the container's clock and provider fakes.
- `cleanupTables`, `afterPropertiesCleanup`, `disabledTriggers`: see cleanup.

Calls: `callAs(caller, call, request?)` takes extra request `headers`
(`user-agent`, `accept-language`, `x-forwarded-for`), `cookies` sent beside the
session cookie (a guest session), and `origin` (`null` sends none).
`respondAs` takes the same and answers `{ ok, value | error, status, headers }`
with the response headers the call set (Set-Cookie, Cache-Control,
Retry-After), also when it throws.

Seeds: `seedOrganization({ id })`; `seedMember(org, role, { userId,
emailVerified })` returns `userId`, `memberId`, `email`, `password` and the
cookie; `seedVisitor()` is a signed-in user with no membership;
`seedInvitation(org, { inviter, email, role, status, propertyIds })`;
`seedProperty(org, { name, timezone, defaultReplyLanguage, lifecycle, google,
reviewDestination })`, where `google` binds the Property through a
google_connections row (its tokens are placeholders unless the file passes the
app's `createTokenEncryptionAdapter` as `googleTokenEncryption`: shared testing
code neither imports a context's infrastructure nor restates a ciphertext
format); `seedPortal(property,
{ kind, publicName, state, primaryLocale, additionalLocales })`;
`grantProperty(member, property)`. Further families sit in
`server-function-*-seeds.ts` and are listed in `server-function-seeds.ts`:
published Portals, Portal Groups and staff participation (portal seeds);
reviews, Inbox items and replies (review seeds); goal programs, rating goals,
Metric readings, Google numbers and merchant AI consent (goal seeds). Each
family exports the tables it writes, children first
(`PORTAL_SEED_CLEANUP_TABLES`, `REVIEW_SEED_TABLES`, `GOAL_CLEANUP_TABLES` with
`GOAL_CLEANUP_TRIGGERS`), for the file's `cleanupTables` and `disabledTriggers`.
Seeds stamp `updated_at` a second before the container's clock, at the
millisecond precision commands fence on. A seed family imports only domain and
application code and shared helpers, never a context's infrastructure.

Fakes: `harness.fakes()` holds the in-memory `storage` (`objects()`,
`failNextPut/Get/Delete`), `googleOAuth`, `email` (`captured()`, `failNext`)
and `queues` the container was given. Use them for provider failures. Fault
injection into our own modules (a store failing mid-command) stays a small
unit test.

Cleanup runs after each test in one transaction: `cleanupTables` (deleted by
organization_id before Portals and Properties; name the ones whose rows keep a
seeded Portal or Property from being deleted), then grants, Portals,
Properties and Google connections, then `afterPropertiesCleanup(client, {
organizationIds, userIds })` for tables with no organization_id, then members,
Organizations and users. `disabledTriggers` names guard triggers disabled
inside that transaction (the last-owner guard always is). Rows a call creates
(a provisioned Organization, a registered user) are cleaned once the test
passes their id to `trackOrganization` or `trackUser`.

Assert on what the caller gets back and on the rows left behind: the allowed
role succeeds, a refused role gets its refusal code, another Organization's
member is refused or finds nothing. Use a plain unit test only for a rule that
needs no request.

## Verification

Keep unit tests beside each shared contract. Use PostgreSQL/Redis integration tests
for real persistence, leases, delivery, and failure ambiguity. Architecture and
governance tests prove boundaries, protected fields, public interfaces, browser
reachability, runtime registration, and authoritative catalogues.
