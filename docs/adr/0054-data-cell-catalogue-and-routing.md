---
status: accepted
date: 2026-08-26
---

# 0054 — Data Cell catalogue and routing

## Context

ADR 0048 treated `us` as the only approved beta processing region and treated
`europe` and `global` as denied placeholders. The agreed beta is geographically
broad and must support three independently recoverable Railway Data Cells. A
physical Railway region, a country, and a logical residency/routing class are
different concepts and must not be encoded in one mutable Property field.

## Decision

1. RepKey has three stable logical Data Cell identifiers: `us`, `europe`, and
   `global`. Their current intended Railway placements are a selected US Metal
   region, EU West (Amsterdam), and Southeast Asia (Singapore). Physical
   placement may change through a signed catalogue revision without changing a
   Property's logical Data Cell identity.
2. A signed `DataCellCatalogue` is the allocation and routing authority. Each
   entry includes its stable ID, residency class, physical placement, policy
   version, allowed countries/workloads, provider profile, domains, resource
   references, and lifecycle state: `provisioning | accepting | draining |
denied`.
3. All approved country mappings ship for beta, but a Property can be allocated
   only to an `accepting` cell. Missing, ambiguous, unsupported, or denied
   catalogue results fail closed for operator review; they never fall back to
   another cell.
4. Property creation/import persists immutable `dataCellId` and the allocation
   policy version. Country and timezone remain editable business facts and do
   not move existing data. Customer self-service moves are unavailable.
5. Every Property-scoped command, fact, job, provider operation, object key, and
   protected repository operation carries or freshly resolves the cell and
   denies a mismatch before data access or external effects.
6. Every Data Cell has co-located web/worker execution and independent
   PostgreSQL, Cache Redis, Queue Redis, object storage, backups, and required
   provider-control services. A stateless replica connected to a remote shared
   database is not a Data Cell.
7. Content-bearing records and credentials do not silently cross cells. An
   Organization has one explicit credential-home cell. Multi-cell Google access
   requires a narrowly permissioned broker issuing short-lived, operation-bound
   material to an approved cell-local egress path; refresh credentials are not
   copied to Property databases.
8. A minimal routing directory may contain only opaque identifiers, cell ID,
   and catalogue/policy version. Routing may select a cell but may not inspect or
   relay tenant content, and no service may open another cell's database.
9. Exceptional moves are operator-managed: snapshot, checksum/count manifest,
   write fence, delta catch-up, provider/webhook switch, verified reversible
   routing flip, and final source retention/erasure evidence. Cross-cell fallback
   during failure is prohibited.

## Supersession

This ADR supersedes ADR 0048. ADR 0048 remains the historical record of the
single-US containment phase; its `ProcessingRegion` approval model and
US-only admission decision are not beta implementation authority.

## Consequences

- `ProcessingRegion` compatibility fields and US-only guards are migration debt,
  not the canonical routing model.
- Railway topology and application routing share one catalogue vocabulary but
  keep logical identity separate from physical placement.
- A cell is not `accepting` merely because Railway offers its region. Provision,
  restore, isolation, provider, and critical-journey evidence are required.
- Regional outage leaves that cell honestly unavailable while other cells
  continue without receiving its work or data.

## Rejected alternatives

- **One global database with multi-region web replicas** — moves execution away
  from state and does not provide residency or failure isolation.
- **Country as the routing key on every request** — business corrections could
  silently move data and make routing non-reproducible.
- **Treat `global` as fallback** — violates fail-closed residency and hides an
  unavailable or ambiguous target.
