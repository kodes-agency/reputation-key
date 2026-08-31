# Beta capability fate authority

This document points to executable authorities. It is not a second hand-edited
capability list.

## Product capability fate

`src/shared/governance/capability-fate.ts` classifies every runtime capability
exactly once:

- `core` — enabled by default, while kill switches and suspension still win;
- `controlled_beta` — off by default and activated only through persisted
  Organization/Property policy plus its package readiness gates;
- `beta_disabled` — excluded from beta and not activatable by tenant policy;
- `safety_blocked` — temporarily unactivatable until a named safety package is
  closed with evidence;
- `legacy_blocked` — retained only for contraction; never reactivate under the
  legacy capability;
- `permanently_denied` — no activation path exists.

`src/shared/governance/capability-fate.test.ts` proves that this vocabulary is
exhaustive and that every fate agrees with the runtime core/blocked sets.

## Executable surface fate

The following catalogues apply the capability keys to executable work:

| Surface                                              | Authority                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Routes, server functions, API handlers               | `src/shared/governance/entry-point-catalogue.ts`              |
| Jobs, schedules, consumers, and domain-fact families | `src/shared/governance/event-job-catalogue.ts`                |
| Built web/worker/sidecar images                      | `scripts/check-production-artifacts.mjs` and CI image policy  |
| Context ownership and accepted public interfaces     | root and nearest `CONTEXT.md`, checked by architecture suites |

Unknown or stale catalogue entries fail the associated governance tests.
Capability denial must occur at the direct entry point and again before delayed
or external work; hidden navigation is never accepted as feature containment.

## Settled high-risk fates

- Public registration, secondary Organization self-service, Team, destructive
  Property erase, and Guest media are beta-disabled.
- Portal upload remains safety-blocked until SAFE-01 is complete.
- Legacy Badge and Leaderboard are blocked contraction surfaces. Future
  recognition is a separate Healthy Guest Gateway capability and model.
- Automatic reply publication, AI cross-Property summaries, and
  review-solicitation gamification are permanently denied.
- Review Analysis, Reply Drafting, and Property Trends are three independent
  controlled capabilities. Authorization for one never implies another.
- Analytics/Metric processing is core and always available; user-facing
  privacy controls govern data handling, not whether the core function exists.

## Data fate

Data is not deleted merely because its UI capability is dark. Each owning
context must give retained rows one explicit lifecycle disposition: active
authority, compatibility read, quarantined reconciliation input, erasable
source content, recoverable archive, or bounded contraction. Migrations and
operator tools remain governed executable surfaces and require catalogue and
release evidence before a contraction is accepted.

`src/shared/governance/data-fate-authority.ts` names every exported Drizzle
table and its owner, disposition, decision authority, and (for non-active
data) exit criteria. Its bidirectional guard discovers `pgTable` exports from
the schema directory, rejects missing and stale rows, and pins representative
active, erasable, quarantined, compatibility, archive, and contraction
decisions. This is classification authority, not proof that a required purge,
reconciliation, export, restore, or contraction has already run.

The REC-01/CNV-01 read-only inventory mirrors the exact 13 Badge/Leaderboard
physical tables classified here as Staff-owned bounded contraction. Its domain
guard resolves the named schema exports to physical table names and rejects any
coverage or lifecycle-classification drift; the inventory is evidence, not a
second lifecycle authority.

A capability being blocked is containment, not proof that its legacy rows or
code have been safely contracted. The package ledger remains the authority for
that implementation and release evidence.
