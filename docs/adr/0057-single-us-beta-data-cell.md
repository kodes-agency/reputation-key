---
status: accepted
date: 2026-08-27
---

# 0057 — Single US beta Data Cell

## Context

ADR 0054 established the durable Data Cell vocabulary and fail-closed routing
model, but assumed that the beta would operate three independent Railway Data
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

The audited `ops:cutover-single-us-data-cell` command owns the transition. Its
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

This ADR supersedes ADR 0054 only where 0054 requires three beta deployments,
country partitioning across those deployments, or all-cell beta evidence. ADR
0054 remains authority for stable Data Cell identity, immutable Property
assignment, fail-closed routing, cell-local resources, credential boundaries,
and operator-controlled future moves. ADR 0048 remains historical: unlike its
containment policy, this decision admits every supported country into the one
beta cell.

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
