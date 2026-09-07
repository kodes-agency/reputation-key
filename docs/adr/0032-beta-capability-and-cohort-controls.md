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

## Consequences

- UI affordances may explain a refusal but cannot bypass it.
- Core, controlled-beta, and blocked membership is changed in the fate table,
  not copied into this ADR.
- Capability and authorization remain separate decisions: enabled work still
  requires the correct principal and tenant scope.
