---
status: superseded
date: 2026-08-27
superseded_by: docs/BETA.md
---

# 0057 — Single US beta Data Cell

> Superseded on 2026-09-07 by [`docs/BETA.md`](../BETA.md) §1: the beta is one
> deployment serving every supported country, with no Data Cell catalogue,
> routing plane, execution fence, credential home, or cross-cell broker in the
> code. This file records the topology that the collapsed machinery enforced
> and is not current authority.

## Context

ADR 0054 (now merged into this ADR, see "Retained from ADR 0054" below)
established the durable Data Cell vocabulary and fail-closed routing model, but
assumed that the beta would operate three independent Railway Data
Cells. The product requirement is geographic availability for customers during
beta, not three simultaneous data-residency deployments. Operating three cells
would multiply databases, queues, object stores, credentials, recovery drills,
release evidence, and incident paths before beta usage justifies that cost.

Railway currently documents US West Metal compute in California as `us-west2`
and its US West/California bucket region as `sjc`. These are explicit supported
placements; the `sjc` identifier is not evidence of a guaranteed city-level
location, and the design does not guess a provider-internal compute city.

## Decision

1. Beta has exactly one production Data Cell: logical cell `us`, Railway
   environment `cell-us`, compute region `us-west2` (US West/California), and
   bucket region `sjc` (US West/California). Its public host remains
   `us.reputationkey.app`.
2. All 245 countries in the versioned supported-country set allocate new and
   imported Properties to `us`. This is an explicit policy mapping, not a
   fallback. Missing, malformed, or unsupported country facts remain
   `unresolved` and require correction.
3. `europe` and `global` remain stable, readable identifiers so persisted
   history, negative isolation tests, and later expansion do not require a
   vocabulary break. During beta they are `denied`, have no allocated
   countries or workloads, and are not deployable Railway environments.
4. Deployment, recovery, and beta acceptance paths target only `us`; no
   procedure may provision or route beta work to `europe` or `global`.
5. The one cell still has independent production resources and process
   boundaries: web, worker, PostgreSQL, Cache Redis, Queue Redis,
   provider-ephemeral Redis, private object storage, Google admission/egress,
   and AI admission/egress. “One cell” does not permit shared cache/queue
   infrastructure or collapsing trust boundaries.
6. Existing wrong-cell, no-fallback, routing-envelope, broker, restore-source,
   and region-move protections remain. They prove that dormant identifiers
   cannot execute and preserve safe seams for future expansion; they do not
   require dormant infrastructure to be provisioned for beta.
7. `europe` or `global` may become deployable only through a later accepted
   ADR and catalogue-policy revision. Activation requires explicit country and
   workload allocation, current Railway placement verification, isolated
   state, credentials, restore and recovery evidence, provider approval,
   release read-back, and wrong-cell drills before a state can become
   `accepting`.
8. Data Cell identity is separate from the AI provider-deployment vocabulary.
   AI records that use processing profile `global` or
   `private-beta-global-v1` describe the externally governed AI route; they do
   not select or imply a Railway `cell-global` deployment and are not rewritten
   by this decision.

## Existing Property assignments

The Europe and Global cells were never activated or provisioned as independent
authoritative stores. Any existing `europe` or `global` Property assignment is
therefore pre-activation routing metadata in the legacy shared datastore, not
evidence that customer content resides in a live second cell.

The forward, expand-only `0140_single_us_beta_data_cell` migration rewrites no
tenant or credential rows. It installs a durable topology-cutover control row,
an initially open admission fence, and database backstops for every workflow
family that must drain. The same backstops pin resolved Property and current
credential-home writes to `us`/policy 3 after completion, so an old replica
cannot revive a dormant assignment.

The audited `ops:cutover-single-us-data-cell` command owned the transition
(deleted 2026-09-06 with the completed cutover; see "Retained from ADR 0054"). Its
default mode is a content-free report with a canonical SHA-256. An apply must
name that exact reviewed digest, ticket, reason, operator, typed confirmation,
and a batch size no greater than 500. The first apply exclusively activates the
durable fence only after all workflow and integrity blockers are zero. Every
later invocation changes at most one bounded Property or Organization batch,
persists a checkpoint and progress/error counts, and reports remaining work.
It is idempotent and safe to resume after interruption.

The operator preserves credential authority history, creates a new
`legacy_backfill` generation only when the current tuple changes, and bumps
access and credential generations for rebound active connections. Completion
requires a fresh zero-blocker verification with no remaining eligible
Properties, credential homes, or operator errors. Only then may the command
write canonical Data Cell cutover evidence under `docs/release-evidence/`.
The completed evidence records that controlled transition; it is not permission
for ordinary code to bypass immutable assignment or credential authority rules.

## Supersession

This ADR absorbs ADR 0054 (deleted 2026-09-06, WP3.2a of the lean
transformation). 0054's three-deployment beta topology, country partitioning
across deployments and all-cell beta evidence are superseded by the single US
cell above. The decisions 0054 retained authority for are carried here verbatim
so nothing is lost with the file. ADR 0048 remains historical: unlike its
containment policy, this decision admits every supported country into the one
beta cell.

## Retained from ADR 0054 — Data Cell catalogue and routing

Context as recorded 2026-08-26: a physical Railway region, a country, and a
logical residency/routing class are different concepts and must not be encoded
in one mutable Property field.

1. RepKey has three stable logical Data Cell identifiers: `us`, `europe`, and
   `global`. Physical placement may change through a signed catalogue revision
   without changing a Property's logical Data Cell identity.
2. A signed `DataCellCatalogue` is the allocation and routing authority. Each
   entry includes its stable ID, residency class, physical placement, policy
   version, allowed countries/workloads, provider profile, domains, resource
   references, and lifecycle state: `provisioning | accepting | draining |
denied`.
3. A Property can be allocated only to an `accepting` cell. Missing, ambiguous,
   unsupported, or denied catalogue results fail closed for operator review;
   they never fall back to another cell.
4. Property creation/import persists immutable `dataCellId` and the allocation
   policy version. Country and timezone remain editable business facts and do
   not move existing data.
5. Every Property-scoped command, fact, job, provider operation, object key,
   and protected repository operation carries or freshly resolves the cell and
   denies a mismatch before data access or external effects.
6. Every Data Cell has co-located web/worker execution and independent
   PostgreSQL, Cache Redis, Queue Redis, object storage, backups, and required
   provider-control services. A stateless replica connected to a remote shared
   database is not a Data Cell.
7. Content-bearing records and credentials do not silently cross cells. An
   Organization has one explicit credential-home cell; refresh credentials are
   not copied to Property databases.
8. A minimal routing directory may contain only opaque identifiers, cell ID,
   and catalogue/policy version. Routing may select a cell but may not inspect
   or relay tenant content, and no service may open another cell's database.

Withdrawn with the code on 2026-09-06 (WP3.2a): 0054's decision 9, the
operator-managed exceptional move (snapshot, manifest, write fence, delta
catch-up, provider switch, routing flip, source erasure). With one beta cell
there is nothing to move between; the `region_moves` machine, the one-time
`data_cell_topology_cutovers` transition and their fences were deleted, and
`docs/BETA.md` §1 records one deployment serving every supported country.

Rejected alternatives recorded by 0054, still standing: one global database
with multi-region web replicas (no residency or failure isolation); country as
the routing key on every request (business corrections could silently move
data); `global` as a fallback (hides an unavailable or ambiguous target).

## Consequences

- Beta can serve supported-country Properties from one maintainable Railway
  deployment and one recovery boundary.
- Geographic distance to a single US origin may increase latency for some
  users; edge ingress and caching can help delivery but do not change the
  authoritative data location.
- Beta does not claim European or other regional data residency. Legal and
  customer materials must describe the live US placement accurately.
- A future regional expansion is additive and reviewable because the stable
  identifiers and isolation contracts remain in place, but it is not a beta
  blocker.

## Rejected alternatives

- **Provision three mostly idle beta cells** — adds substantial operational and
  recovery risk without a current product requirement.
- **Delete Europe/Global identifiers and safety code** — would make persisted
  history unreadable and make later expansion a breaking redesign.
- **Treat `us` as an implicit fallback** — would hide malformed country data;
  the exhaustive versioned country map is the allocation authority.
- **Move the legacy Amsterdam database in place** — region mutation can be
  destructive and obscures rollback. Restore and cut over to fresh US state
  under the existing recovery fence instead.
