# Shared — Context

**Audience:** Developers and agents working in `src/shared/`.

## Responsibility

Shared owns reusable infrastructure and genuinely cross-context primitives. It does not take product meaning away from a bounded context. Wait for a second real consumer before extracting code here; context-specific policy stays with its owner.

Primary areas:

- `auth/`, `security/`, `rate-limit/`, `provider-ephemeral/`, and
  `google-provider-control/` own reusable admission and transport fences.
- `db/`, `events/`, `outbox/`, and `jobs/` own durable storage/delivery mechanics.
- `architecture/` and `governance/` hold executable boundaries and catalogues.
- `health/` and `observability/` expose content-minimal runtime evidence.
- `domain/`, `http/`, `email/`, `cache/`, and `lifecycle/` hold small mechanisms.
- `hooks/` and `queries/` are browser-safe cross-feature access/cache utilities.
- `ops/` and `release/` own reviewed operational and promotion contracts.
- `testing/` and `db/testing/` are test-only support, never runtime authorities.

Shared-area dependency and production/test fences are enforced by `eslint.config.js` and `scripts/check-architecture-boundary-controls.mjs`.

## Root contracts

The shared root is not a general placement target. Its retained files are narrow multi-owner contracts: AI/provider schemas and pinned vectors, canonical JSON, closed JSON validation, merchant-AI notices, Reply language, responsible-manager eligibility, Google Review/Performance wire normalization, and provider-subject bindings. New workflow orchestration belongs in an owning context.

Responsible-manager eligibility has two owners, Property and Portal, and its
contract includes the one rule both follow when a member is removed: release
again, from `identity.member.removed`, what the member still holds and may no
longer hold (`releaseRemovedMemberResponsibilities`), through the one handler
that reads the fact and records the receipt after the release
(`removed-member-consumer.ts`). The root holds only that rule and that handler.
Each owner registers the consumer under its own name and catalogue row and binds
the rule to its own store, and the check an assignment makes after it commits
stays in the owner's use case.

AI and Google contracts state their semantic owner explicitly. Browser-safe
catalogues must not pull Node crypto, provider clients, configuration, queues, or
persistence into the client graph. Raw provider/review content and credentials do
not belong in shared contract records.

Browser/server reachability is enforced by `src/shared/architecture/browser-reachability.test.ts` and `eslint.config.js`.

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
the first item selected in the Inbox after a deploy. A refusal later than that (a
focus refetch, a poll, a part of the page that mounted late) only arms the tab,
because the person may be in the middle of something. A tab also reloads at once
when a route already failed to draw (`useGuardedRouteError`): because of a stale
refusal, a missing chunk, or any failure at all once the tab is armed, since old
code meeting a newer answer fails in ways no shape can name. It never reloads
under a mutation in flight (the reload waits for the next moment), and never in
a loop: `reload-guard.ts` allows one reload per release being left per two
minutes, remembered in `sessionStorage` before the reload, and refuses when it
cannot remember. A navigation that would lose unsaved work is held by the page's
own blocker (`useBlocker`) before the router announces it, and a reload still
meets the page's `beforeunload`. A page still here ten seconds after asking (a
navigation that was cancelled) draws its failure again instead of a loading state
that never ends. The whole reload path is in first paint because it runs exactly
when a lazy chunk may be gone.

A read refused outside that window on a page that stays put (a focus refetch on
the Inbox) shows the refusal's own sentence ("Reload to continue") in place of
that read until the person's next navigation (another item or another page),
which reloads.

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

## Domain and boundaries

`shared/domain/` contains pure cross-context identifiers, result/error primitives,
roles, calendars, timezones, encodings, and small eligibility rules. A type with one
owner belongs with that owner. No I/O or framework code enters this area.

Cross-context product behavior remains behind each context's
`application/public-api.ts` or a consumer-owned port. Shared events aggregate the
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
`test-integration` job sets it, and `testing/redis-test-lease.test.ts` pins that the
job running the integration project has a Redis service and requires it.

## Verification

Keep unit tests beside each shared contract. Use PostgreSQL/Redis integration tests
for real persistence, leases, delivery, and failure ambiguity. Architecture and
governance tests prove boundaries, protected fields, public interfaces, browser
reachability, runtime registration, and authoritative catalogues.
