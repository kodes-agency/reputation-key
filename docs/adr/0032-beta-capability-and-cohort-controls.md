---
status: accepted
date: 2026-07-15
---

# 0032 — Beta capability and cohort controls

## Context

Navigation and role checks cannot decide whether a capability belongs in the
closed beta. Interactive requests, public routes, operator commands, outbox
consumers, and scheduled jobs need one fail-closed capability decision.

## Decision

`src/shared/governance/capability-fate.ts` is the authority for every
capability's product fate, rationale, and activation condition. Runtime policy
is derived from that table and the environment-backed store in
`src/shared/auth/beta-capabilities.ts`; a second prose list is not authority.

`BETA_CAPABILITIES_OFF` is the emergency kill switch. An unknown capability,
blocked fate, suspended Organization or Property, unavailable policy, or
isolated-restore mode denies before an effect. Delayed work rechecks policy at
execution rather than relying on enqueue-time permission.

Organization and Property allowlists are explicit operator inputs. They may
enable only a `controlled_beta` capability and can never reopen
`beta_disabled`, `safety_blocked`, `legacy_blocked`, or `permanently_denied`
work.

## Merged from ADR 0047

The persisted capability-policy tables introduced by ADR 0047 were removed.
Capability policy now comes from `capability-fate.ts` plus the env-backed store;
the Organization lifecycle authority owns the closure fence. An allowlist is a
capability input, never an inferred access grant.

## Amendment 2026-09-27 — environment-wide Organization allowlist

`BETA_ALLOWLIST_ORGS` names Organization IDs, and every fresh database mints
new ones. Each reset, new cell or hand-built local stack therefore darkened
all twelve controlled-beta capabilities for the Organization someone had just
created — once per feature as testers reached them — and the refusal sent them
to Property settings, where nothing could fix it.

`BETA_ALLOWLIST_ORGS=*` now admits every Organization in the environment. It
is still an explicit operator input and changes only the allowlist question:
`BETA_CAPABILITIES_OFF`, Organization/Property suspension and every blocked
fate are decided first and still win. Use `*` where the environment is one
cohort (the closed beta, a local stack); return to explicit IDs when outside
Organizations join and features roll out per Organization. The local e2e stack
and the perf staging cell keep explicit IDs on purpose: they prove the listed
mode and measure an unlisted Organization's darkness.

An `org_not_allowlisted` refusal now carries its own category,
`not_enabled_for_organization`, whose copy names the RepKey team rather than
Settings. The worker's startup manifest records the allowlist's shape (all /
N listed / none — never an ID), and `ops:bootstrap-owner` reports whether the
Organization it creates is covered, with the exact fix when it is not.

## Consequences

- UI affordances may explain a refusal but cannot bypass it.
- Core, controlled-beta, and blocked membership is changed in the fate table,
  not copied into this ADR.
- Capability and authorization remain separate decisions: enabled work still
  requires the correct principal and tenant scope.
