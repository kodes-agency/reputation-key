---
status: accepted
date: 2026-05-22
---

# 0007 — Dashboard as a read-only aggregation

## Context

WP3.4 moved Dashboard into the Reporting bounded context. Dashboard presentation
remains a downstream view of Property, Review, Inbox, Guest, and Reporting facts;
it is not a separate source of domain truth.

## Decision

Dashboard read models are assembled through injected public APIs and lookup
ports, never by route-level cross-context SQL. The Dashboard surface owns no
tables or events and does not mutate another context's state. Writes owned by
Reporting, such as Goal Program commands, remain separate from Dashboard reads.

## Consequences

- Dashboard values preserve unavailable, updating, and insufficient-data states
  instead of inventing zero.
- Cross-context schemas remain behind adapters and public interfaces.
- Caching or materialized projections require a later decision when measured
  load justifies them.
