# BQC-2.1 — Action/Resource Catalogue

**Date:** 2026-07-17
**Slice:** BQC-2.1 (canonical action/resource catalogue)
**Findings:** STD-P1-02, SPEC-P0-03 (catalogue portion); supports completion of STD-P0-01
**Executable truth:** `src/shared/governance/entry-point-catalogue.ts` (rows) + `src/shared/governance/entry-point-catalogue.test.ts` (guard). This document is the narrative; the catalogue is the authority. If they disagree, the catalogue wins.

## 1. What this is

Every executable entry point in the system has exactly one catalogue row assigning a canonical **action** and **resource scope**, and recording its **capability gate**, **principal types**, **beta posture**, **external-effect flag**, and **purpose/consent class** (`none` until governed classes exist — phase §9).

Entry-point kinds: `server_function`, `route_ui`, `route_api`, `job`, `consumer`, `schedule`, `operator_command`.

Actions are either a role `Permission` (ADR 0033) or a `SystemAction` for work that has no role permission: session/identity bootstrap, guest/public surface, machine ingress, UI rendering, delayed system execution, operator commands.

Beta posture is **derived** from the authoritative capability sets (ADR 0032 core/blocked), never declared by hand — posture drift is impossible by construction.

## 2. Coverage (as of 2026-07-17, guard-verified)

| Kind               | Rows | Discovery mechanism pinned by the guard                                    |
| ------------------ | ---: | -------------------------------------------------------------------------- |
| `server_function`  |  129 | `createServerFn` exports, per-function authz extraction                    |
| `route_ui`         |   43 | `src/routes` file walk (TanStack conventions; layout/index disambiguated)  |
| `route_api`        |    9 | `src/routes/api/**` file walk                                              |
| `job`              |   19 | `JOB_NAME(S)` constants + `bootstrap.ts` register calls/literals           |
| `consumer`         |    9 | `event-handlers/index.ts` registration tables + durable `registerConsumer` |
| `schedule`         |   12 | `worker/index.ts` `backgroundQueue.add` jobIds (imports resolved)          |
| `operator_command` |   40 | `scripts/**` file walk (33) + `package.json` operator scripts (7 CLI-only) |
| **Total**          |  261 |                                                                            |

Derived counts: 17 `canonicalOnly` rows (§4.2), 26 external-effect entry points, 23 blocked-posture rows, 55 non-core rows.

## 3. The CI gate (phase §2.1: "CI fails when a new executable entry point lacks a catalogue row and policy test")

The guard test fails when:

1. Any discovered entry point has **no row** (all six discovery scans, both directions — no stale rows either).
2. A server function's code asserts a permission/capability its row doesn't declare (`requireAuthorized` / `assertBetaCapability` / `assertGlobalCapability` extraction; derived capability must equal `capabilityForPermission(action)` per ADR 0033).
3. A job's capability gate (registration-gate in `bootstrap.ts`, else in-handler) differs from its row.
4. A consumer module's `eventTags` differ from its registration table; `registerConsumer({` outside catalogued modules.
5. A row's posture differs from the capability sets.
6. A public-principal entry point uses a capability outside the declared public surface (`portal.read`, `identity.register`, `organization.create`, `none`).
7. **Policy test:** every row's capability decision executes against the default policy store — blocked rows must hard-deny (`capability_blocked`), non-core rows must deny without allowlist, core rows must allow.

## 4. What the catalogue surfaced (input to later slices)

### 4.1 Activity surface gated by the wrong capability

`getActivityTimelineFn` / `getOrgActivityFn` authorize via `inbox.read`, which maps to `inbox.use` — not `activity.use` (the ADR 0032 surface capability). Rows record current truth with notes; **BQC-2.4** remaps to `activity.use`.

### 4.2 Seventeen `canonicalOnly` entry points (no mechanically checkable authz)

These have no extractable authorization call; the row is the canonical **assignment** BQC-2.4 must wire into `ExecutionPolicy`:

- Session: `getSession`, `ensureActiveOrg`, `setActiveOrganization`, `listUserInvitations`, `listUserOrganizations`, `signInUser`
- Identity: `acceptInvitation`, `createOrganizationFn` (F045: no `organization.create` assert), `updateOrganization`, `updateOrgResponseSlaFn`, `requestOrgLogoUpload`, `finalizeOrgLogoUpload`, `requestAvatarUpload`, `finalizeAvatarUpload`
- Property: `listProperties`, `getProperty`, `deleteProperty` (authz claimed in use cases — BQC-2.4 verifies)

### 4.3 Dark-context in-process consumers are ungated in code

`badge`, `goal`, and `leaderboard` event-handler modules execute on `metric.recorded` (which `review.created` feeds — a **core** event) with no capability check. Rows record `capability: 'none'` + notes. **BQC-2.6** must gate registration/execution or remove the handlers.

### 4.4 Public/API endpoints without capability asserts (canonical assignments recorded)

- `/api/public/click/$linkId` — no `portal.read` assert (BQC-2.4 wires).
- `/api/auth/google/callback` — no `integration.use` assert (HMAC state + session only).
- `/api/webhooks/gbp/notifications` — no `property.connect_gbp` assert at ingress; BQC-2.5 defines the required ingress/delayed policy contract and BQC-3 performs the worker/job integration once.

### 4.5 Operator commands bypass application authorization

All `DIRECT-DB` scripts (cleanup, seed, perf seed, migration SQL) are flagged in row notes. Possession of `DATABASE_URL` is the only gate — **BQC-2.7** owns authenticated/audited operator workflows.

## 5. Deliberately out of the catalogue

- **Use cases / repositories** — not entry points; reached only via catalogued boundaries.
- **`server/plugins` (Nitro)** — dead in builds (STD-P1-07, owned by BQC-7).
- **`src/shared/jobs/runtime.ts`** — declarative scheduler path wired only in tests; the guard fails if it ever gains a production registration path (worker scan covers only `worker/index.ts` — a second scheduler source would need a catalogue row to pass review).
- **Full decision matrices and route `beforeLoad` drift detection** — BQC-2.4/2.6. The 2.1 guard pins existence + server-function/job/consumer conformance, not per-principal decision outcomes.
