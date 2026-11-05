# Architecture

Reputation Key serves managers and staff through a TanStack Start application
and guests through published Portals. A separate Node worker handles durable
jobs, provider synchronization and notifications. PostgreSQL is the durable
authority; Redis provides queueing and cache mechanisms.

Read the [closed beta obligations](docs/obligations.md) before changing behaviour.
The [root map](CONTEXT.md) defines domain terms and links to each area's current
map. The [ADR index](docs/adr/README.md) records decisions and archived locations.

## Follow a request

A route calls a context's server function. The server adapter resolves session,
tenant, role and execution policy, then calls an application command or read.
Domain rules make business decisions; infrastructure implements storage and
provider ports. [Context maps](src/contexts/CONTEXT.md) identify the owner and
entry points. Existing server-function paths are stable RPC entry points.

`src/composition.ts` and `src/composition/` assemble dependencies;
`src/bootstrap.ts` starts the application. A transaction owner commits state and
its identifier-only outbox facts together. The worker relay and dispatcher
redeliver facts until consumers record their receipts. Queue acceptance alone
is not completion.

## Ownership and boundaries

Business code lives in `src/contexts/`. Feature folders may replace layer folders
when a change also simplifies the responsibility. Read another context through
its public API or an explicit browser-safe contract. Keep schema centrally owned
in `src/shared/db/schema/`; the [database map](src/shared/db/CONTEXT.md) describes
journaled migrations and transaction rules.

[Shared infrastructure](src/shared/CONTEXT.md) owns auth, transport admission,
queues, observability and reusable mechanisms. Business decisions stay with their
context. [Routes](src/routes/CONTEXT.md) own navigation and delivery;
[components](src/components/CONTEXT.md) lists canonical UI patterns.

The browser and server are separate bundles. Use `*.server.ts` for Node-only
helpers. A server-function barrel may expose RPC functions and types; a plain
helper export can keep server imports in the browser graph. The import-protection
rules and browser-reachability tests enforce this boundary.

## Runtime safeguards

Membership, Property access and role permissions determine who may act.
Capabilities determine whether an effect may run. Global stops, Organization
suspension and per-Property merchant AI authorization remain independent checks.
Provider writes bind to the exact approved action and source revision; uncertain
reply writes require read-back before retry. Raw Google content has a fetch-based
expiry, while manager work and stable Review identity have separate lifetimes.

Use the [operations index](docs/operations/README.md) for release, incident and
restore procedures. Recovery is forward-only after migrations; an earlier image
is not a supported recovery path. Known enforcement gaps and the limits of
existing evidence remain explicit in the obligations document.
