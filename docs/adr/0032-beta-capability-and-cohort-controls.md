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

## Amendment 2026-09-29 — declared capability posture survives a database reset

Below the allowlist sit two database-held kill switches: the Google content
capability controls (`capability_execution_control`) and the AI capability
heads (`ai_execution_control_heads`). The seed leaves every Google content
capability denied (operator `NULL` or `migration:0124`) and every AI capability
`killed`/`draining` at generation 1 — the dark posture an operator lifts. After
the old production activation script was deleted nothing lifted it, so each
closed-beta database reset silently broke Connect Google (`capability_killed`)
and all AI until the rows were repaired by hand.

The environment now declares its posture, on `web`:
`GOOGLE_CONTENT_CAPABILITIES_ALLOWED` and `AI_CAPABILITIES_ENABLED`, each `*` or
a comma list, unset meaning no change. Web's `preDeployCommand`
(`scripts/migrate-deploy.ts`) applies it right after the schema tracks, inside
the same advisory-locked step, through the existing authorities:
`allowCapability` (which advances the shared emergency generation) and
`transition_ai_execution_control_v1` (`operator_restore`, actor
`deploy:declared-posture`, the deployed `RELEASE_SHA` — else the image-baked
`IMAGE_SOURCE_REVISION` — as the audited candidate).

The declaration restores a reset; it is not a second switch. It lifts only an
untouched seed default — a Google row (or a missing one) still denied with no
operator or a `migration:` operator AND a `*_default_deny` reason, read under
the emergency-generation lock and a row lock; an AI head still at generation 1.
Any other denial, or an AI head an operator moved (any later generation that is
not `enabled`/`accepting`), is kept and reported, as is a stopped global or
provider plane; a compare-and-set lost to a concurrent move is re-read and the
move kept. A hand kill must therefore record who and why: an operator id and a
reason other than a default-deny one. Removing a capability from the declaration does not re-deny it: stopping
stays the operator's act (the controls themselves, or `BETA_CAPABILITIES_OFF`).
An unknown capability name fails the deploy before any migration. Every run
logs one `[declared-posture]` line naming what was lifted and what was left and
why; nothing is written when nothing needs to change.

## Amendment 2026-09-30 — `portal.upload` leaves the safety block

`portal.upload` was `safety_blocked` on the strength of one condition: a signed
SAFE-01 completion record (a named signer, an independent reviewer, four
deployed drills). **The owner removed that ceremony on 2026-09-30.** The owner
is the sole developer and the beta is a closed team, so there is no one to be
the independent reviewer and nothing a signature would add.

The capability is now `controlled_beta`, the fate `portal.write` already has:
the persisted Organization and Property policy decides who may upload, and
`BETA_CAPABILITIES_OFF` still stops it. It is not `core`, so an Organization
nobody has admitted cannot upload. The fate table is still the only authority;
this ADR records why the entry changed (the rule above that an allowlist may
enable only a `controlled_beta` capability is unchanged).

What the ceremony protected against is still true of hostile bytes, so **the
technical safeguards remain in the build** and are specified in ADR 0063: the
server decodes and re-encodes every image and stores only its own WebP (so
EXIF, GPS, colour profiles and trailing data do not survive), accepts only
JPEG, PNG and WebP up to 10 MiB, refuses SVG, GIF, HEIC and animated images,
requires the uploader's rights confirmation, and serves stored images
same-origin from a private bucket. Takedown, garbage collection of unreferenced
objects and removal of the stored objects on an Organization purge shipped
before the switch, because a stored object that nothing can delete is the one
thing the design must not allow.

## Consequences

- UI affordances may explain a refusal but cannot bypass it.
- Core, controlled-beta, and blocked membership is changed in the fate table,
  not copied into this ADR.
- Capability and authorization remain separate decisions: enabled work still
  requires the correct principal and tenant scope.
