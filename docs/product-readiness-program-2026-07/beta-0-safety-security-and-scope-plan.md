# BETA-0 — Safety, Security, and Controlled Scope

**Status:** Proposed  
**Date:** 2026-07-14  
**Effort:** 7–11 engineering days, plus privacy/legal review calendar time  
**Depends on:** A reviewable release revision; no real property data  
**Unlocks:** PRE17A and the synthetic-production rehearsal

## 1. Objective

Create an engineering and product safety envelope in which beta work cannot accidentally touch a non-test database, expose unfinished capabilities, admit an unknown user/property, leak one tenant into another, or deploy a known-broken artifact.

BETA-0 does not make the product ready for a real property. It makes subsequent work safe and reproducible enough to prove that readiness.

## 2. Current evidence and stop-the-line findings

The repository already has useful foundations: strict TypeScript, a strong bounded-context layout, broad unit/integration coverage, explicit environment helpers, Better Auth, PostgreSQL, Redis/BullMQ, and a coherent design system. The current release baseline nevertheless fails the minimum safety bar:

- `pnpm typecheck`, `pnpm lint`, and `pnpm build:worker` pass.
- `pnpm build` fails because an API test is discovered as a route and the Vite 8 build receives an incompatible `manualChunks` shape.
- Five goal tests fail because the recurring goal builder and current metric/scope vocabulary disagree.
- formatting fails across a large active worktree;
- Vitest loads the normal `.env`, which currently resolves to a remote managed database, and destructive test setup has no lease/identity guard;
- production dependencies include one critical and several high advisories at the audit date;
- CI does not block on the production web/worker build, critical E2E, Storybook accessibility, migration install/upgrade, or security gates;
- public signup and organization creation remain available;
- authorization mixes custom role definitions, built-in role branches, and a hand-maintained permission union;
- there is no server-enforced beta capability/cohort boundary.

No real Google connection, production email, public guest submission, or production upload may be enabled while these findings remain.

## 3. Architectural decisions

Write and approve these records before their implementation merges:

1. **ADR 0032 — Beta capability and cohort controls.** A server-side `BetaCapabilities` policy decides whether a user, organization, property, route, command, event consumer, and scheduled job may use a capability.
2. **ADR 0033 — Authorization policy.** Identity owns action/resource/property-scope decisions and owner invariants through a stable `AuthorizationPolicy`; contexts do not infer permission from role strings.
3. **ADR 0038 — Beta service objectives and recovery.** Record initial availability, freshness, RPO/RTO, severity, ownership, and exception policy now, even though BETA-3 proves them.
4. **Threat model.** Use assets, trust boundaries, entry points, abuse cases, mitigations, residual risks, and named owners. Map controls to an appropriately scoped OWASP ASVS 5.0 matrix.

## 4. Work packages

### B0.1 — Freeze a reproducible release baseline

**Purpose:** Separate active product redesign work from beta-hardening evidence.

Tasks:

1. Inventory every modified/untracked file and split the current worktree into reviewed, purpose-specific commits without discarding user work.
2. Choose and tag the release-base commit used by all BETA/PRE17 branches and test reports.
3. Record exact Node LTS patch and pnpm version in repository and CI configuration; make local and deployed version checks fail clearly.
4. Make `pnpm install --frozen-lockfile` the only CI install path.
5. Add a clean-clone verification script that runs the same commands as CI without reading developer-global configuration.
6. Define supported OS/architecture for development and production native dependencies, especially Sharp.

Acceptance evidence:

- a clean temporary clone produces the same lockfile, generated routes, schema artifacts, web bundle, and worker bundle;
- the source revision, Node version, pnpm version, schema version, and build ID are visible in diagnostic output;
- generated files are either reproducibly generated and checked, or deliberately excluded—never incidentally dirty.

### B0.2 — Repair and harden the blocking quality gate

**Purpose:** A release candidate must build and test the deployed shapes, not only type-check source.

Tasks:

1. Move/rename `src/routes/api/webhooks/gbp/notifications.test.ts` so the router cannot discover it as an application route; add a route-generation regression check.
2. Replace the obsolete Vite/Rolldown `manualChunks` object with the supported Vite 8 form or remove it until measured chunking justifies a custom strategy.
3. Resolve the recurring-goal vocabulary mismatch. Treat `portal.scan`/property scope as a domain decision; update the builder, definitions, and characterization tests together.
4. Reformat only the reviewed release scope, then make formatting blocking.
5. Add blocking jobs for:
   - format, type, lint, unit/domain tests;
   - PostgreSQL repository tests against an ephemeral database;
   - Redis/BullMQ integration tests against an ephemeral Redis;
   - web production build and start smoke;
   - worker production build and start/SIGTERM smoke;
   - Storybook build plus accessibility checks for critical components;
   - critical Playwright journeys on at least Chromium and WebKit;
   - blank install and prior-schema upgrade migrations;
   - dependency, secret, and code scanning.
6. Quarantine flaky tests only through a time-bound issue with owner and diagnostic artifact. A retry cannot convert a deterministic failure to green.

Acceptance evidence:

- every required job is blocking and can be reproduced locally;
- production web and worker processes start from their built artifacts and answer their intended smoke probes;
- a failing route build, migration, accessibility check, or critical journey prevents merge/deploy;
- no job marked “allowed to fail” is cited as beta evidence.

### B0.3 — Introduce `TestEnvironmentLease`

**Purpose:** Make destructive tests structurally unable to use an ordinary remote database or shared Redis.

Interface responsibility:

```text
TestEnvironmentLease.acquire()
  -> ephemeral database + Redis identifiers
  -> cryptographically/randomly unique lease marker
  -> restricted credentials
  -> verified cleanup scope
```

Tasks:

1. Stop loading the ordinary application `.env` in Vitest. Load explicit test configuration generated by the lease/bootstrap process.
2. Default local integration tests to disposable PostgreSQL and Redis containers or uniquely created local databases; document one command.
3. Require all destructive database helpers to validate:
   - `NODE_ENV=test`;
   - `ALLOW_DESTRUCTIVE_DB_TESTS=1`;
   - a random test database name/prefix;
   - a valid lease marker stored inside that database;
   - host/database not matching a denylist of beta, staging, or production identifiers.
4. Make the database test role non-superuser and owner only of its disposable database. Remove all beta/production credentials and network access from pull-request jobs.
5. Give Redis tests a unique prefix or disposable instance and reject production cache/queue hosts.
6. Test the guard itself: missing marker, malformed URL, pooled Neon URL, encoded hostname, DNS alias, known remote host, shared default DB, and cleanup after interruption.
7. Require a separately protected migration environment for production credentials; PR CI can never read it.

Acceptance evidence:

- an attempted destructive test against the current normal `.env` aborts before opening a mutating transaction;
- CI shows service-container creation and destruction per job;
- repository tests cannot access a network path or credential usable by beta/production;
- cleanup deletes only the leased resource and is safe to retry.

### B0.4 — Patch dependencies and secure the supply chain

**Purpose:** Remove known reachable vulnerabilities and make future drift visible.

Tasks:

1. Upgrade at least:
   - Vitest Browser from 4.1.7 to a non-vulnerable release;
   - Kysely from the override-pinned 0.28.16 to a fixed supported release;
   - Vite from 8.0.14 to a fixed supported release;
   - Better Auth from 1.6.12 to a fixed supported release;
   - vulnerable transitive esbuild/js-yaml paths.
2. For each major or security-sensitive upgrade, run auth, SSR, build, migration, and browser characterization tests. Do not use an override to conceal an incompatible dependency.
3. Add Dependabot or Renovate, dependency review, CodeQL, secret scanning/push protection, lockfile validation, and a release SBOM.
4. Give GitHub Actions explicit least-privilege permissions and pin external actions to full commit SHAs.
5. Add CODEOWNERS or equivalent mandatory reviewers for auth/authorization, workflows, migrations, deployment, secrets, Google integration, retention/deletion, and public request handling.
6. Establish vulnerability SLAs and a signed exception template containing reachability, mitigation, owner, expiry, and upgrade issue.

Acceptance evidence:

- no reachable critical/high production advisory remains without an unexpired accepted exception;
- scans fail a deliberately vulnerable fixture/branch in a controlled test;
- pull-request jobs contain no deployment or production secret;
- the release artifact has a source SHA and SBOM.

### B0.5 — Implement `BetaCapabilities` and cohort enforcement

**Purpose:** Ship a smaller, controlled beta without relying on hidden navigation.

The module consumes authenticated user, organization, property, environment, cohort, region, and operator policy; it returns a typed capability decision with a stable reason code. It must not contain context business logic.

Initial capabilities:

- `identity.invite`, `identity.register`, `organization.create`;
- `property.create`, `property.connect_gbp`, `property.publish_reply`;
- `notification.send_email`;
- `portal.read`, `portal.write`, `portal.upload`;
- `team.use`, `goal.use`, `badge.use`, `leaderboard.use`;
- `ai.analyze`, `ai.generate_reply`, `ai.detect_trends`;
- per-worker/schedule counterparts for every background capability.

Tasks:

1. Store allowlists and overrides in a versioned, auditable server-side source. Environment variables may define an emergency global off switch but are not the only per-tenant store.
2. Enforce decisions in server functions/API routes, use cases, event handlers, schedulers, workers, and external adapters. UI consumes the same read model for explanation, not authority.
3. Default every non-core capability off. Unknown capability, missing policy, unsupported region, or unavailable policy store fails closed for mutations and external effects.
4. Add operator-only, audited commands to allow/suspend a user, organization, or property and to disable imports, publish, email, uploads, or all external effects.
5. Ensure queued jobs re-check current capability before side effects so a kill switch affects already-enqueued work safely.
6. Add a capability decision log containing identifiers and reason codes only; never raw review/guest data.

Acceptance evidence:

- direct HTTP/server-function calls cannot bypass a disabled UI capability;
- disabled event consumers and schedules do no work and expose an observable reason;
- emergency switches stop new effects while preserving canonical data and evidence;
- every exception is auditable and automatically expires or requires review.

### B0.6 — Close the identity and authorization beta envelope

**Purpose:** Permit only known internal operators and prove tenant/property isolation.

Tasks:

1. Disable public registration and self-service organization creation. Implement operator-created organization plus single-use, expiring invitation.
2. Require verified email before organization/property access. Add recovery, invitation expiry/revoke/resend, session revoke, and last-owner protections.
3. Use built-in owner/admin/member roles only for initial beta. Server-disable custom/dynamic role mutation until repository-wide authorization supports it.
4. Implement `AuthorizationPolicy.authorize(actor, action, resource)` with:
   - organization membership;
   - effective property scope;
   - direct assignment/team assignment source;
   - built-in role capability;
   - last-owner and sensitive-operation invariants;
   - current suspension/capability state.
5. Migrate highest-risk surfaces first: identity/team/staff/property/integration/review/inbox/notification/portal. Remove direct role branches as each context moves.
6. Stop using raw session tokens as cache keys. Use keyed hashes or opaque internal IDs, strict TTL, revocation/invalidation, and no token logging.
7. Inventory every route, API handler, server function, use case, repository query, worker, and scheduled job. Give each a required action and resource scope.
8. Add negative tests for same-org/wrong-property, different-org, removed assignment, suspended user/property, stale session/cache, ID enumeration, and batch/list leakage.

Acceptance evidence:

- an automatically generated authorization matrix has an owner and test link for every entry point;
- cross-tenant/property negative tests cover every bounded context and direct server surface;
- membership/assignment removal invalidates effective access promptly;
- only built-in roles can be assigned in beta, and last owner cannot be removed or demoted accidentally.

### B0.7 — Harden the web/request boundary and secrets

**Purpose:** Establish safe defaults for all browser and external traffic.

Tasks:

1. Validate all production environment variables at process startup, including email verification, trusted proxy count/ranges, canonical origin, cookie policy, encryption-key version, provider endpoints, and capability defaults.
2. Define trusted proxy behavior and derive client address only from headers written by the trusted edge; never trust arbitrary `X-Forwarded-For` input.
3. Enforce canonical HTTPS origin, secure/httpOnly/sameSite cookies, host/origin checks for state-changing requests, CSRF controls where framework protections do not suffice, and explicit body/time limits.
4. Add a strict initial security-header policy: CSP tested against TanStack/Vite assets, HSTS after HTTPS-only verification, frame restrictions, content-type sniffing protection, referrer policy, and a minimal permissions policy.
5. Separate public error codes from private diagnostics. The root error boundary must not render arbitrary exception messages or provider/database details.
6. Define request IDs and redaction allowlists. Prohibit tokens, cookies, raw bodies, review text, reviewer identity, emails, presigned URLs, and provider credentials from logs/errors.
7. Inventory secrets, remove stale credentials, rotate any broadly exposed development/beta credential, and define owner/rotation/revocation procedure. Version encrypted OAuth ciphertext before real tokens exist.
8. Add dependency timeouts and bounded retry classification at existing external clients even before their durable workflow work lands.

Acceptance evidence:

- header/cookie/origin/proxy/error behavior is covered by integration/browser tests;
- a deliberate private error produces a stable public code and a correlated redacted operator record;
- startup rejects missing or inconsistent beta configuration;
- secret scanning contains no unexplained live credential.

### B0.8 — Establish privacy, policy, and pilot governance

**Purpose:** Make entry of real data a conscious, reviewable decision.

Tasks:

1. Build a field-level data inventory and lineage map for all 16 contexts, queues, caches, logs/traces, object storage, email, Google, backups, tests, and future AI.
2. Record purpose, role, lawful basis where applicable, source, sensitivity, tenant/property, region, recipients/subprocessors, retention, deletion propagation, and operator access for every class.
3. Obtain the written Google disposition for storage duration, derivation/aggregation, AI processing, regional processing, and permitted backup/log behavior. Translate it into ADR 0031 and executable capabilities/retention; do not rely on an informal interpretation.
4. Draft and approve accurate internal-beta terms, property authorization, privacy notice(s), Google access disclosure, subprocessor list, security contact, request process, and incident contact tree.
5. Name product/privacy/security owners for access, correction, deletion, export, breach, and disconnect requests. Counsel decides controller/processor, GDPR transfer/DPIA, CCPA, and accessibility legal applicability.
6. Restrict production access to named people with work reason, audited elevation, short-lived credentials, and review-text masking in routine tooling.
7. Define automatic beta stop conditions: tenant isolation, unauthorized Google action, unexplained loss, duplicate publish, leaked token/secret, inability to restore, or policy violation.

Acceptance evidence:

- an accountable owner signs the data map and real-property checklist;
- written Google policy is mapped to code/data controls before Stage 2;
- every subprocessor and processing region is known;
- request and incident dry runs identify affected property/data and accountable responder without querying raw production tables ad hoc.

## 5. Cross-context BETA-0 checklist

Before BETA-0 closes, every context must supply at least the following metadata, even if the feature stays dark:

| Context      | Required BETA-0 evidence                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| activity     | Authorized read scope, immutable event intent, sensitive-field allowlist, retention owner             |
| badge        | Disabled capability covers definitions, evaluation jobs, awards, and UI/API reads                     |
| dashboard    | Property-scoped authorization and policy capability for every source/aggregate                        |
| goal         | Contract vocabulary fixed; schedules and mutations disabled unless explicitly enabled                 |
| guest        | Public writes and workers disabled; collected identifiers/cookies represented accurately in inventory |
| identity     | Invite-only, verified email, built-in roles, session/recovery/last-owner tests                        |
| inbox        | Entry-point inventory and cross-property negative tests for reads, notes, and status writes           |
| integration  | Google connect disabled until property allowlist; token/secrets inventory and rotation version        |
| leaderboard  | Entire read/evaluation/snapshot path disabled; staff-monitoring decision recorded                     |
| metric       | Definitions/sources inventoried; fleet jobs disabled where feature is dark                            |
| notification | In-app versus email capabilities separated; email fail-closed by default                              |
| portal       | Public read/write/upload capabilities independently disabled                                          |
| property     | Operator allowlist, processing-region field decision, lifecycle decision                              |
| review       | Google source-content capability and manual publish capability separated                              |
| staff        | Direct assignment scope/authorization tests and removal invalidation behavior                         |
| team         | Disabled by default; membership/assignment entry points included in authorization matrix              |

## 6. Sequence and commit plan

| Order | Change set                                                  |              Estimate | Merge condition                      |
| ----: | ----------------------------------------------------------- | --------------------: | ------------------------------------ |
|     1 | Release-base isolation, pinned runtime, clean-clone command |             0.5–1 day | Reproducible clean state             |
|     2 | Test DB/Redis lease and destructive guard                   |            1–1.5 days | Guard negative tests pass            |
|     3 | Build/goal/format fixes and CI matrix                       |            1–1.5 days | Production artifacts smoke           |
|     4 | Security dependency upgrades and GitHub controls            |             0.5–1 day | Advisory/security gates pass         |
|     5 | ADR/threat model, endpoint and data inventories             |            1–1.5 days | Owners review completeness           |
|     6 | `BetaCapabilities` plus server/worker enforcement           |            1.5–2 days | Bypass/kill-switch tests pass        |
|     7 | Identity/auth/request boundary hardening                    |          1.5–2.5 days | Authorization/security journeys pass |
|     8 | Governance evidence and synthetic go/no-go                  | 0.5–1 day engineering | Accountable approvals recorded       |

The estimates assume custom roles, public portal/guest, recognition features, and non-auth email remain dark. Enabling them belongs to later gates.

## 7. Exit gate

BETA-0 closes only when:

- a clean clone runs the complete blocking baseline against disposable services;
- production web and worker artifacts build and start;
- no destructive test can mutate a normal remote database or Redis;
- no unknown user, organization, or property can enter the beta;
- disabled features are blocked in routes, use cases, events, jobs, and schedules;
- identity/property authorization negative tests pass across all contexts;
- dependency/security findings meet the documented exception policy;
- private failures, secrets, and personal/source content are absent from public errors and telemetry;
- the threat model, data inventory, Google-policy dependency, and internal-beta governance have named accountable owners.

Failure of any item blocks PRE17/BETA real-data work; it is not a launch exception.
