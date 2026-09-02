# Blocked capability implementation survey — 2026-09-02

**Scope:** the 13 entries currently in `BLOCKED_CAPABILITIES`.
**Disposition:** evidence-only survey for issue
[#405](https://github.com/kodes-agency/reputation-key/issues/405). This record makes
**no ruling** to unblock, retain, rename, or remove any capability.

## Method and terms

The runtime authority is unambiguous: `checkScopedCapability()` checks
`BLOCKED_CAPABILITIES` before any kill switch, Organization policy, or Property
policy and returns `capability_blocked` (`src/shared/auth/beta-capabilities.ts:475-489`).
The permission map is exhaustive (`src/shared/auth/capability-for-permission.ts:11-96`),
so the permission lists below distinguish mapped permissions from explicit
capability arguments at an entry point.

Classification means:

- **built-and-fenced** — the repository contains a complete server/use-case/storage
  path for the behavior and the blocked capability is an operative fence; a UI may
  still be deliberately absent;
- **partial** — domain, persistence, historical, or support machinery exists, but
  the tenant-facing activation path is absent, removed, or independently refuses;
- **id-only** — the capability is a prohibition/catalogue identifier with policy and
  invariant tests, not a product implementation with its own route, use case, or
  storage.

Source inspection covered routes, components, server functions, use cases,
composition, workers, schemas, migrations, and tests. History inspection used
`git log -S'<capability-id>'` plus blame of the blocked set; the per-capability
sections identify the blocked-set introduction commit. Current fate records were
introduced by git commit `3a172678475e4e2178fe90182b1b750db092b230`
(`feat(governance): codify beta capability fates`).

## Summary

| Capability id                          | Classification                                                                                                                                                                                                               | Third-party data / outbound write                                                                                                                                                             | Recorded reason?                                             |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `identity.custom_roles`                | **built-and-fenced** — complete dormant write service (`src/contexts/identity/server/organizations.roles.ts:1-21`)                                                                                                           | No reviewer, Guest, or Google content; writes internal authorization rows (`src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:310-393`)                                  | **Yes** (`src/shared/governance/capability-fate.ts:56-58`)   |
| `identity.register`                    | **built-and-fenced** — public route and registration gate exist (`src/routes/register.tsx:15-34`)                                                                                                                            | No reviewer, Guest, or Google content; collects account identity data (`src/contexts/identity/application/dto/invitation.dto.ts:30-38`)                                                       | **Yes** (`src/shared/governance/capability-fate.ts:59`)      |
| `organization.create`                  | **built-and-fenced** — two server paths and complete registration use case exist (`src/contexts/identity/server/organizations.registration.ts:88-118`; `src/contexts/identity/server/auth-settings.org.ts:34-68`)            | No reviewer, Guest, or Google content; writes local Organization/member records (`src/contexts/identity/application/use-cases/register-user-and-org.ts:91-108`)                               | **Yes** (`src/shared/governance/capability-fate.ts:60-62`)   |
| `property.erase`                       | **partial** — support authority/ledger exist, execution is unarmed (`scripts/ops/property-erase.ts:53-63`)                                                                                                                   | No current effect; the designed irreversible inventory includes Review and Guest contexts (`src/contexts/property/application/ports/property-erase-contributor.port.ts:30-48,70-78`)          | **Yes** (`src/shared/governance/capability-fate.ts:64-66`)   |
| `team.use`                             | **partial** — quarantined data and source, no runtime surface (`src/contexts/team/CONTEXT.md:5-20`)                                                                                                                          | No reviewer, Guest, or Google content; retained workforce membership identifiers (`src/shared/db/schema/people-access.schema.ts:217-265`)                                                     | **Yes** (`src/shared/governance/capability-fate.ts:107-109`) |
| `badge.use`                            | **partial** — historical rows/export only; runtime mechanics removed (`src/contexts/badge/CONTEXT.md:5-17,61-71`)                                                                                                            | No active touch or outbound write; retained tenant/recognition target identifiers (`src/shared/db/schema/badge.schema.ts:70-99`)                                                              | **Yes** (`src/shared/governance/capability-fate.ts:113-117`) |
| `leaderboard.use`                      | **partial** — historical rows/export only; ranking mechanics removed (`src/contexts/leaderboard/CONTEXT.md:5-15,52-61`)                                                                                                      | No active touch or outbound write; retained target/rank/score rows (`src/shared/db/schema/leaderboard.schema.ts:26-75`)                                                                       | **Yes** (`src/shared/governance/capability-fate.ts:118-122`) |
| `portal.upload`                        | **built-and-fenced** — UI, server, use cases, storage, and worker exist (`src/contexts/portal/server/portals.ts:551-647`; `src/bootstrap.ts:293-310`)                                                                        | **Yes** — writes object storage and can publish a hero image on the Guest Portal (`src/contexts/portal/application/use-cases/request-upload-url.ts:68-86`; `src/routes/p/$token.tsx:117-124`) | **Yes** (`src/shared/governance/capability-fate.ts:85-89`)   |
| `portal.guest_contact`                 | **partial** — backend lifecycle/storage only, with an executable no-entry-path test (`src/shared/architecture/guest-contact-containment.test.ts:27-61`)                                                                      | **Yes if activated** — encrypted Guest email and optional name, with audited reveal (`drizzle/0120_guest_contact_requests.sql:13-68`)                                                         | **Yes** (`src/shared/governance/capability-fate.ts:99-103`)  |
| `portal.guest_media`                   | **partial** — internal media lifecycle/storage remain, public server functions were removed (`src/contexts/guest/application/use-cases/guest-response-lifecycle.ts:729-800`; git `9f09c217c9e3f2a14d61d920ac3f93502d2554cd`) | **Yes if activated** — Guest bytes go to object storage and a public URL (`src/shared/db/schema/guest.schema.ts:730-797`)                                                                     | **Yes** (`src/shared/governance/capability-fate.ts:104-106`) |
| `gbp.reply.auto_publish`               | **id-only** — no activation path (`src/shared/governance/capability-fate.ts:132-136`)                                                                                                                                        | No current path; intended behavior would write a reply to Google (`src/contexts/review/infrastructure/jobs/publish-reply.job.ts:1-25`)                                                        | **Yes** (`src/shared/governance/capability-fate.ts:132-136`) |
| `gbp.ai.cross_property_summary`        | **id-only** — no activation path (`src/shared/governance/capability-fate.ts:137-141`)                                                                                                                                        | No current path; intended behavior would combine Google-derived Review information across tenants/scopes (`docs/adr/0031-google-source-content-and-ai-processing-boundary.md:11-23`)          | **Yes** (`src/shared/governance/capability-fate.ts:137-141`) |
| `gbp.review_solicitation_gamification` | **id-only** — no activation path (`src/shared/governance/capability-fate.ts:142-146`)                                                                                                                                        | No current path; intended behavior would use Google/review-solicitation or Guest signals in recognition (`docs/adr/0043-worker-recognition-boundary.md:14-22`)                                | **Yes** (`src/shared/governance/capability-fate.ts:142-146`) |

## `ENABLE_CUSTOM_ROLES=true` readback

**Yes, source reads it.** The environment parser turns only case-insensitive
`"true"` into true (`src/shared/config/env.ts:265-272`). Both ordinary tenant
resolution and transaction-snapshot resolution use it to select the dynamic role
strategy (`src/shared/auth/tenant-resolver.ts:286-297,345-367`). The dynamic strategy
loads `customRoles` and their policies and passes them to `resolvePermissions()`
(`src/shared/auth/tenant-resolver.ts:248-273`).

Therefore the flag is **not dead as an authorization-strategy switch**: when true,
retained role definitions can affect effective permissions. It is, however, **not
an unblock lever** for `identity.custom_roles`: capability refusal still happens
first and cannot be overridden by policy or the E2E override
(`src/shared/auth/beta-capabilities.ts:475-489`), while current invitation and
member-role mutation DTOs accept only `AccountAdmin` and `PropertyManager`
(`src/contexts/identity/application/dto/invitation.dto.ts:7-22`). This creates a
factual tension with the fate text saying retained definitions are
“reconciliation input only” (`src/shared/governance/capability-fate.ts:56-58`);
this survey records the tension and makes no policy ruling.

## `identity.custom_roles`

- **Implementation — built-and-fenced.** The source labels the implementation
  complete and tested but deliberately dormant, with no UI; it contains create,
  update, and delete TanStack server functions, each checking
  `identity.custom_roles` before persistence
  (`src/contexts/identity/server/organizations.roles.ts:1-21,40-111`). The create
  use case independently checks `member.update`, prevents privilege/scope
  escalation, and writes through the identity port
  (`src/contexts/identity/application/use-cases/create-custom-role.ts:18-44`).
- **Persistence, migration, tests.** The adapter atomically maintains Better Auth's
  `organizationRole` and app-owned `organization_role_policy`
  (`src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:310-393`);
  the mirrors/contracts are at `src/shared/db/schema/auth.ts:99-110` and
  `src/shared/db/schema/dac.schema.ts:11-17,29-55`, with the app-owned table in
  `drizzle/0000_init.sql:435-445`. Authorized creation and rejection of permission
  or scope escalation are tested at
  `src/contexts/identity/application/use-cases/create-custom-role.test.ts:42-93`;
  update and delete are also exercised at
  `src/contexts/identity/application/use-cases/update-custom-role.test.ts:37-68` and
  `src/contexts/identity/application/use-cases/delete-custom-role.test.ts:15-35`.
- **Permission/blast.** There is no permission-to-`identity.custom_roles` mapping in
  the exhaustive map; `member.update` maps to `identity.invite`
  (`src/shared/auth/capability-for-permission.ts:66-70,94-96`). The server functions
  deliberately require both `member.update` and the explicit blocked capability
  (`src/contexts/identity/server/organizations.roles.ts:47-56,74-80,98-104`). If
  the capability fact became allowed, that explicit fence would fall and the
  dormant backend could mutate definitions when directly invoked, but no UI would
  appear and invitation/member assignment would remain built-in-only
  (`src/contexts/identity/server/organizations.roles.ts:9-21`;
  `src/contexts/identity/application/dto/invitation.dto.ts:7-22`).
- **Third-party/outbound.** The path writes internal authorization definitions and
  data scopes only; its adapter dependencies show no Review, Guest, Google, mail,
  or object-store port (`src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts:310-393`).
  The security blast is nevertheless broad because those definitions are consumed
  to calculate effective request permissions when the dynamic resolver is selected
  (`src/shared/auth/tenant-resolver.ts:248-273`).
- **Recorded reason — yes.** The block comment says runtime definitions and
  assignment are excluded and cannot be reopened by tenant policy or E2E override
  (`src/shared/auth/beta-capabilities.ts:131-135`); the fate authority says they are
  excluded from beta (`src/shared/governance/capability-fate.ts:56-58`). Git commit
  `77a0e19883b347ba7ec3917ccd839f713c7dedc8` introduced both the capability and
  block with that explanation.

## `identity.register`

- **Implementation — built-and-fenced.** `/register` calls the server-side
  `identity.register` gate before rendering, then wires `RegisterForm` to
  `registerUserAndOrg` (`src/routes/register.tsx:15-34,58-62`). The gate checks the
  blocked capability (`src/contexts/identity/server/organizations.registration.ts:28-50`).
  The use case signs up the user, atomically creates the first Organization/member
  plus fact, and selects it as active
  (`src/contexts/identity/application/use-cases/register-user-and-org.ts:59-127`).
- **Persistence, migration, tests.** The account and Organization mirrors are
  `user`, `account`, `member`, and `organization`
  (`src/shared/db/schema/auth.ts:17-25,41-57,68-97`). Better Auth, not Drizzle Kit,
  owns those migrations (`src/shared/db/schema/auth.ts:3-13,68-72`). The complete
  success, fact, validation, compensation, and failure behavior is tested at
  `src/contexts/identity/application/use-cases/register-user-and-org.test.ts:37-134`.
- **Permission/blast.** No permission maps to `identity.register` in the exhaustive
  permission map (`src/shared/auth/capability-for-permission.ts:11-96`); the route
  uses its explicit global capability check. Allowing it makes `/register` render,
  but submission independently checks blocked `organization.create`, so allowing
  `identity.register` alone still cannot create an account/Organization
  (`src/contexts/identity/server/organizations.registration.ts:88-109`). The
  invitation-only `/join` flow is separate and remains the sole beta account
  creation path (`src/contexts/identity/server/organizations.registration.ts:52-85`).
- **Third-party/outbound.** This path handles a registrant's name, email, and
  password and writes local auth/Organization state; it does not consume reviewer,
  Guest Portal, or Google content (`src/contexts/identity/application/dto/invitation.dto.ts:30-38`;
  `src/contexts/identity/application/use-cases/register-user-and-org.ts:80-108`).
- **Recorded reason — yes.** Fate states, “Public self-registration is excluded
  from beta” (`src/shared/governance/capability-fate.ts:59`), and ADR 0032 records
  public registration as a beta-disabled product decision
  (`docs/adr/0032-beta-capability-and-cohort-controls.md:22-30`). Git commit
  `52635b32a144abc6be1c19047a346adb9f744548` moved it into the blocked set under
  `fix(identity): enforce invitation-only beta manager accounts`.

## `organization.create`

- **Implementation — built-and-fenced.** Public registration checks
  `organization.create` before the complete `registerUserAndOrg` use case
  (`src/contexts/identity/server/organizations.registration.ts:88-118`). A second,
  authenticated `createOrganizationFn` checks the same capability before calling
  Better Auth's Organization API (`src/contexts/identity/server/auth-settings.org.ts:34-68`).
- **Persistence, migration, tests.** `organization` and `member` are Better
  Auth-owned tables mirrored at `src/shared/db/schema/auth.ts:68-97`, and their
  migration authority is explicitly outside Drizzle Kit
  (`src/shared/db/schema/auth.ts:68-72`). First-Organization creation and its
  compensation behavior are tested at
  `src/contexts/identity/application/use-cases/register-user-and-org.test.ts:37-134`.
- **Permission/blast.** No permission maps to `organization.create` in the
  exhaustive map (`src/shared/auth/capability-for-permission.ts:11-96`); both paths
  use an explicit global check. Allowing it would remove the direct fence from the
  authenticated server function, but that function remains catalogued and
  deliberately unwired; public registration would still require
  `identity.register` to reveal `/register`
  (`src/shared/governance/entry-point-catalogue.ts:1700-1709`;
  `src/contexts/CONTEXT.md:91-92`; `src/routes/register.tsx:15-29`).
- **Third-party/outbound.** The direct function writes Better Auth Organization
  state and the registration path writes Organization/member/fact state; neither
  path references Review, Guest, Google, or object storage
  (`src/contexts/identity/server/auth-settings.org.ts:39-53`;
  `src/contexts/identity/application/use-cases/register-user-and-org.ts:91-108`).
- **Recorded reason — yes.** Fate says, “Self-service secondary Organization
  creation is excluded from beta” (`src/shared/governance/capability-fate.ts:60-62`),
  and ADR 0032 records the same beta-disabled product decision
  (`docs/adr/0032-beta-capability-and-cohort-controls.md:22-30`). Git commit
  `52635b32a144abc6be1c19047a346adb9f744548` moved it into the blocked set with
  public registration and Team.

## `property.erase`

- **Implementation — partial.** The stale tenant `deleteProperty` server function
  asks ExecutionPolicy for `property.delete`, then always returns a typed denial
  without calling destructive code (`src/contexts/property/server/property-read.ts:79-110`).
  Its legacy use case also has no dependencies and always refuses
  (`src/contexts/property/application/use-cases/soft-delete-property.ts:10-18`).
  A separate support design implements request, preview, confirm, cancel, a durable
  authority, receipts, and an advance job, but its only CLI entry says destructive
  composition is pending and exits 1 (`src/contexts/property/application/use-cases/erase-property.ts:1-14,74-127`;
  `scripts/ops/property-erase.ts:1-7,53-63`).
- **Persistence, migration, tests.** `property_erase_authorities` and the per-context
  replay receipt ledger are defined at
  `src/shared/db/schema/property-erase.schema.ts:56-58,99-168,168-202` and created by
  `drizzle/0173_property_erase_authority.sql:1-17,43-80`. The operator-only/no-route
  posture and four gates are executable contracts in
  `src/contexts/property/application/use-cases/erase-property.test.ts:111-352`; the
  CLI itself cites that negative test as proof of no tenant edge
  (`scripts/ops/property-erase.ts:3-7`).
- **Permission/blast.** The deliberate indirection is exact: `property.delete` maps
  to blocked `property.erase`, while archive, restore, and disconnect map to
  ordinary `property.create` (`src/shared/auth/capability-for-permission.ts:12-23`).
  Allowing the capability would let the stale server function pass ExecutionPolicy,
  but its independent denial still wins; it would not arm the operator workflow
  (`src/contexts/property/server/property-read.ts:88-107`;
  `scripts/ops/property-erase.ts:53-63`).
- **Third-party/outbound.** The current paths perform no erase. The designed
  irreversible contract requires all 17 owning contexts, including `guest` and
  `review`, to inventory then erase (`src/contexts/property/application/ports/property-erase-contributor.port.ts:1-15,30-48,70-78`),
  and Review storage includes Google external identifiers, reviewer name/photo,
  rating, and text (`src/shared/db/schema/review.schema.ts:54-83`). The removed
  legacy path also explicitly purged Review/Inbox source content and Google import
  state before deletion; git commit
  `e155dd5b1435ccc18fde6f290859b778ce0aa17b` removed that behavior.
- **Recorded reason — yes.** The block comment requires recoverable
  Archive/Disconnect and a distinct support-mediated workflow
  (`src/shared/auth/beta-capabilities.ts:138-141`); fate says ordinary lifecycle is
  recoverable and permanent erasure is support-mediated
  (`src/shared/governance/capability-fate.ts:64-66`). ADR 0032 repeats that boundary
  (`docs/adr/0032-beta-capability-and-cohort-controls.md:22-30`). Git commit
  `e155dd5b1435ccc18fde6f290859b778ce0aa17b` introduced `property.erase` and
  converted the destructive route/use case into independent refusals.

## `team.use`

- **Implementation — partial.** Historical domain/application/repository source and
  data remain for reconciliation, rollback, and export, but there is no route,
  navigation, UI bundle, server function, production composition, job, schedule,
  or consumer (`src/contexts/team/CONTEXT.md:5-20,56-82`). `buildTeamContext()`
  returns empty APIs and constructs nothing (`src/contexts/team/build.ts:1-16`).
- **Persistence, migration, tests.** `teams` retains Organization/Property, name,
  description, and lead identifiers (`src/shared/db/schema/team.schema.ts:18-44`),
  while effective-dated `team_memberships` points to Staff Participation
  (`src/shared/db/schema/people-access.schema.ts:217-265`). The base table originates
  at `drizzle/0000_init.sql:37-48`, with canonical memberships at
  `drizzle/0011_people-access-and-attribution.sql:82-104`. Retained use-case tests
  still exercise create/update/list/delete semantics, for example
  `src/contexts/team/application/use-cases/create-team.test.ts:61-143`; those tests
  do not compose a runtime surface (`src/contexts/team/CONTEXT.md:70-82`).
- **Permission/blast.** `team.create`, `team.update`, `team.delete`, `team.read`, and
  `team.membership.manage` all map to `team.use`
  (`src/shared/auth/capability-for-permission.ts:54-58`). Allowing the capability
  alone makes nothing tenant-reachable because there is no caller that asks those
  permissions and the build is inert (`src/contexts/team/CONTEXT.md:13-20`;
  `src/contexts/team/build.ts:1-16`).
- **Third-party/outbound.** Retained data is tenant/workforce organization data,
  including Team names, lead IDs, Staff Participation IDs, roles, and intervals;
  no active path reads reviewer PII, Guest content, or Google content and no
  outbound writer exists (`src/shared/db/schema/team.schema.ts:18-44`;
  `src/shared/db/schema/people-access.schema.ts:217-265`;
  `src/contexts/team/CONTEXT.md:30-54`).
- **Recorded reason — yes.** Fate says, “Team is quarantined historical data;
  Portal Groups are not Teams” (`src/shared/governance/capability-fate.ts:107-109`).
  ADR 0052 says Team has no beta surface and its tables/events remain quarantined
  (`docs/adr/0052-beta-people-access-attribution-and-manager-responsibility.md:67-77`).
  Git commit `52635b32a144abc6be1c19047a346adb9f744548` first moved it into the blocked
  set; commit `98b977d44d9814b85a4d75e83e419f3b70b91629` then retired its runtime in favor
  of Portal Groups.

## `badge.use`

- **Implementation — partial.** Badge runtime repositories, evaluation,
  enablement, seed, reconciliation, mappers, and award mechanics have been
  removed; only historical event decoding, inventory/export/restore, schema, and
  neutral notification-history rendering remain
  (`src/contexts/badge/CONTEXT.md:5-17,40-46,61-71`). Its build returns empty APIs
  and creates no repository, producer, use case, consumer, or job
  (`src/contexts/badge/build.ts:1-17`).
- **Persistence, migration, tests.** Legacy definitions, Organization enablements,
  and awards remain (`src/shared/db/schema/badge.schema.ts:28-99`), plus governed
  version/award history (`src/shared/db/schema/badge.schema.ts:101-156`). Their
  migrations are `drizzle/0000_init.sql:272-309` and
  `drizzle/0025_recognition-governance.sql:176-272`. Export tests prove retained
  history remains available while the build stays empty and fate stays
  `legacy_blocked`
  (`src/contexts/badge/infrastructure/adapters/badge-organization-export.adapter.test.ts:77-169`).
- **Permission/blast.** `badge.read` and `badge.manage` map to `badge.use`
  (`src/shared/auth/capability-for-permission.ts:63-64`). Allowing the capability
  does not resurrect removed producers, evaluators, routes, or readers; only the
  already-existing neutral compatibility renderer remains, and it cannot create
  awards (`src/contexts/badge/CONTEXT.md:19-29,48-59`).
- **Third-party/outbound.** Current retained rows carry tenant/Property/Portal or
  Portal Group identifiers, target IDs, and award metadata, not reviewer/Guest raw
  content, and there is no active outbound writer (`src/shared/db/schema/badge.schema.ts:70-99`;
  `src/contexts/badge/CONTEXT.md:61-71`). Historical “First Review” derivation from
  private Portal rating is explicitly identified as an invalid legacy model, not
  current behavior (`docs/adr/0043-worker-recognition-boundary.md:6-20,30-35`).
- **Recorded reason — yes.** The block comment says legacy Badge behavior cannot be
  reopened and a Healthy Guest Gateway needs a separate capability
  (`src/shared/auth/beta-capabilities.ts:125-129`). Fate says the legacy behavior is
  not the accepted recognition model and must never be reactivated
  (`src/shared/governance/capability-fate.ts:113-117`). Git commit
  `d3637780b2bb4b989beb10238659b20129048d97` moved Badge and Leaderboard into the
  blocked set under `fix(recognition): block legacy competitive paths`; ADR 0043
  records the privacy/fairness boundary (`docs/adr/0043-worker-recognition-boundary.md:14-40`).

## `leaderboard.use`

- **Implementation — partial.** Ranking repositories, use cases, scoring,
  comparison, mapping, reconciliation, and activation mechanics are removed;
  historical inventory/export and schema remain
  (`src/contexts/leaderboard/CONTEXT.md:5-15,31-36,52-61`). The inert build exposes
  nothing (`src/contexts/leaderboard/build.ts:1-18`), and the retained
  `/leaderboard` URL always redirects to an unavailable state without loading data
  or checking the capability (`src/routes/_authenticated/leaderboard.tsx:9-22`).
- **Persistence, migration, tests.** Legacy snapshots/entries retain target IDs,
  ranks, scores, and metric values (`src/shared/db/schema/leaderboard.schema.ts:26-75`);
  later recognition activation/board records remain at
  `src/shared/db/schema/leaderboard.schema.ts:78-173,216-360`. The migrations are
  `drizzle/0000_init.sql:310-337` and
  `drizzle/0025_recognition-governance.sql:1-175`. Inventory tests verify exact
  retained-table coverage without exposing records
  (`src/contexts/leaderboard/application/legacy-recognition-inventory.test.ts:26-87,177-201`).
- **Permission/blast.** `leaderboard.read` maps to `leaderboard.use`
  (`src/shared/auth/capability-for-permission.ts:65`). Allowing it alone changes no
  user behavior: the only URL redirects before a policy decision and no production
  ranking operation exists (`src/routes/_authenticated/leaderboard.tsx:9-22`;
  `src/contexts/leaderboard/CONTEXT.md:17-25,31-36`).
- **Third-party/outbound.** Retained rows hold tenant/Property/Portal Group target
  identities and historical ranks/scores, not raw reviewer/Guest/Google content;
  there is no current read, calculation, or outbound write path
  (`src/shared/db/schema/leaderboard.schema.ts:26-75,216-360`;
  `src/contexts/leaderboard/CONTEXT.md:17-25`).
- **Recorded reason — yes.** The block comment rejects competitive ranking and
  requires a new capability for a future model
  (`src/shared/auth/beta-capabilities.ts:125-129`). Fate says competitive ranking is
  rejected and the legacy path must never be reactivated
  (`src/shared/governance/capability-fate.ts:118-122`). Git commit
  `d3637780b2bb4b989beb10238659b20129048d97` introduced this blocked posture; ADR
  0043 rejects default-on recognition because of legal/fairness risk
  (`docs/adr/0043-worker-recognition-boundary.md:14-40`).

## `portal.upload`

- **Implementation — built-and-fenced.** The edit form requests an upload issuance,
  performs the presigned PUT, and finalizes by opaque `uploadId`
  (`src/components/features/portal/portal-form/edit-portal-form.tsx:120-134`); the
  route action bundle imports both server functions
  (`src/routes/_authenticated/properties/$propertyId/portals/-portal-detail-actions.ts:151-165`).
  Both server functions authorize the exact Portal with `portal.update` plus
  explicit `portal.upload` before invoking complete use cases
  (`src/contexts/portal/server/portals.ts:551-647`). The worker is also registered
  behind `portal.upload`, while source cleanup intentionally remains active when
  uploads are dark (`src/bootstrap.ts:293-313`).
- **Persistence, migration, tests.** The tenant/Property/Portal-bound issuance row
  retains private source state and separate public derivative keys
  (`src/shared/db/schema/portal.schema.ts:746-793`). Migration 0110 enforces exact
  private source and non-aliasing public derivative key shapes
  (`drizzle/0110_portal_upload_issuances.sql:1-56`). Tests cover opaque issuance,
  replay, cross-Portal scope, expiry, metadata mismatch, assignment, supersession,
  stale workers, decoding, and log safety
  (`src/contexts/portal/application/use-cases/request-upload-url.test.ts:39-160`;
  `src/contexts/portal/application/use-cases/finalize-upload.test.ts:83-348`;
  `src/contexts/portal/infrastructure/jobs/process-image.job.test.ts:83-245`).
- **Permission/blast.** `portal.update` maps to promotable `portal.write`, not to
  upload (`src/shared/auth/capability-for-permission.ts:46-53`). The server adds the
  blocked `portal.upload` capability explicitly
  (`src/contexts/portal/server/portals.ts:573-581,615-622`), and the worker adds its
  own direct gate (`src/bootstrap.ts:293-306`). Allowing `portal.upload` makes
  request/finalize and processing reachable only where `portal.write`, role,
  Property assignment, and scoped policy also allow them
  (`src/contexts/portal/application/use-cases/request-upload-url.ts:40-60`;
  `src/contexts/portal/application/use-cases/finalize-upload.ts:49-69`).
- **Third-party/outbound.** The path writes a guest-facing image to object storage:
  issuance creates a presigned storage write (`src/contexts/portal/application/use-cases/request-upload-url.ts:68-86`),
  finalization verifies the object and stages processing
  (`src/contexts/portal/application/use-cases/finalize-upload.ts:66-134`), and a
  finalized hero URL becomes public Portal/OG image content
  (`src/routes/p/$token.tsx:107-124`). It does not process reviewer or Google source
  content in these implementations (`src/contexts/portal/application/use-cases/request-upload-url.ts:1-29`;
  `src/contexts/portal/application/use-cases/finalize-upload.ts:1-31`).
- **Recorded reason — yes.** The block comment calls this temporary `SEC-01`
  containment pending issuance binding, storage revalidation, non-aliasing keys,
  stale-worker refusal, and an adversarial suite
  (`src/shared/auth/beta-capabilities.ts:106-110`). Fate separately names the
  outstanding signed record `SAFE-01`
  (`src/shared/governance/capability-fate.ts:85-89`). The `SEC-01`/`SAFE-01` label
  mismatch is recorded here, not resolved. Git commit
  `671ddf026e4dfe8c4f5ddf07ec958de6fb91aebd` introduced the containment under
  `fix(portal): contain unsafe image uploads`; ADR 0032 says implementation **and**
  adversarial evidence must be complete
  (`docs/adr/0032-beta-capability-and-cohort-controls.md:22-30`).

## `portal.guest_contact`

- **Implementation — partial.** The lifecycle implements consented submit, masked
  read, audited reveal, withdrawal, and purge semantics
  (`src/contexts/guest/application/use-cases/contact-request-lifecycle.ts:27-47,93-149,150-224`).
  It is deliberately absent from routes, components, server functions, workers,
  public API, and product composition; an architecture test scans those exact
  surfaces and permits only ungated retention cleanup
  (`src/shared/architecture/guest-contact-containment.test.ts:27-61`).
- **Persistence, migration, tests.** Migration 0120 creates encrypted contact,
  reveal-audit, and purge-checkpoint rows with exact 30-day retention and terminal
  content clearing (`drizzle/0120_guest_contact_requests.sql:1-75`). Lifecycle tests
  cover explicit purpose/consent, signed-session authority, normalization, masked
  reads, all three manager permissions, audited reveal, withdrawal, and bounded
  purge (`src/contexts/guest/application/use-cases/contact-request-lifecycle.test.ts:34-445`).
- **Permission/blast.** `feedback.contact_read` maps to
  `portal.guest_contact`; `inbox.read` and `feedback.read` keep their own
  capabilities (`src/shared/auth/capability-for-permission.ts:27-30,82-87`). The
  Guest-owned policy port nevertheless pins every manager decision to explicit
  `portal.guest_contact` (`src/contexts/guest/application/ports/contact-request-execution-policy.port.ts:5-28,31-46`),
  and reveal requires all three actions
  (`src/contexts/guest/application/use-cases/contact-request-lifecycle.ts:182-223`).
  Allowing the capability alone activates nothing because there is no submit/read/
  reveal/withdraw entry point; retention cleanup stays active independently
  (`src/contexts/guest/CONTEXT.md:132-139,174-176`).
- **Third-party/outbound.** This is Guest PII: valid email plus optional name is
  encrypted, scope-bound, masked by default, revealed only with an audit row, and
  cleared on withdrawal/expiry (`docs/adr/0044-public-portal-and-guest-response.md:18-26`;
  `drizzle/0120_guest_contact_requests.sql:13-68`). The accepted shape explicitly
  excludes phone and keeps contact values out of facts, logs, notifications,
  analytics, Inbox/search, AI, and activity payloads
  (`docs/adr/0044-public-portal-and-guest-response.md:20-26`). No outbound delivery
  channel is composed yet (`src/contexts/guest/CONTEXT.md:174-176`).
- **Recorded reason — yes.** The block comment says the backend has no activation
  authority and awaits approved notice, retention wording, manager handling, and
  channel readiness (`src/shared/auth/beta-capabilities.ts:117-119`). Fate adds
  named counsel/product approval (`src/shared/governance/capability-fate.ts:99-103`),
  and ADR 0044 records the same conditions
  (`docs/adr/0044-public-portal-and-guest-response.md:16-26`). Git commit
  `c35c02a83a21b5440a723e9a38df2a3350c67aee` changed it from controlled beta to a
  safety block under `fix(governance): align portal fact catalogue`.

## `portal.guest_media`

- **Implementation — partial.** Internal response lifecycle methods still issue
  and confirm Guest media (`src/contexts/guest/application/use-cases/guest-response-lifecycle.ts:729-800`),
  and domain tests exercise type/size, exact object identity, race, and purge rules
  (`src/contexts/guest/domain/guest-media.test.ts:42-178`). Public
  `issueGuestMediaFn` and `confirmGuestMediaFn` were removed, so the blocked id has
  no current route/server gate; git commit
  `9f09c217c9e3f2a14d61d920ac3f93502d2554cd` contains that removal.
- **Persistence, migration, tests.** `guest_response_media` stores exact tenant,
  Property, Portal, response, session, object key, type/size, lifecycle, and public
  URL (`src/shared/db/schema/guest.schema.ts:730-797`), created by
  `drizzle/0022_guest-response-lifecycle.sql:35-65`. Lifecycle tests cover
  withdrawal/confirmation races, metadata refusal, replay, and successful
  publication (`src/contexts/guest/application/use-cases/guest-response-lifecycle.test.ts:609-655,755-790`).
  The data-fate authority classifies the rows as quarantined reconciliation input
  until a future issued-capability storage migration
  (`src/shared/governance/data-fate-authority.ts:434-442`).
- **Permission/blast.** No permission maps to `portal.guest_media` in the exhaustive
  permission map (`src/shared/auth/capability-for-permission.ts:11-96`). The removed
  public server functions used the capability directly, but current internal
  methods do not consult it; therefore allowing the id alone makes no entry point
  reachable (`src/contexts/guest/application/use-cases/guest-response-lifecycle.ts:729-800`;
  git `9f09c217c9e3f2a14d61d920ac3f93502d2554cd`).
- **Third-party/outbound.** If a new caller were added, the retained implementation
  would accept Guest-supplied bytes, write an object issuance, and persist a public
  URL (`src/shared/db/schema/guest.schema.ts:730-797`;
  `src/contexts/guest/application/use-cases/guest-response-lifecycle.test.ts:755-769`).
  There is no current public caller and no Google/reviewer-content dependency in
  the media methods (`src/contexts/guest/application/use-cases/guest-response-lifecycle.ts:729-800`).
- **Recorded reason — yes.** The block comment says the first cohort deliberately
  excludes media and public issuance/confirmation was removed pending moderation,
  abuse, access, consent, and retention approval
  (`src/shared/auth/beta-capabilities.ts:112-115`). Fate says it has no public
  issuance surface (`src/shared/governance/capability-fate.ts:104-106`), and ADR
  0044 requires separate activation evidence
  (`docs/adr/0044-public-portal-and-guest-response.md:14-16`). Git commit
  `9f09c217c9e3f2a14d61d920ac3f93502d2554cd` introduced the block and removed the
  two public server functions under `feat(portal): make guest gateway rating first`.

## `gbp.reply.auto_publish`

- **Implementation — id-only.** The fate authority explicitly says “No activation
  path exists” (`src/shared/governance/capability-fate.ts:132-136`). The blocked-id
  tests prove allowlists and operator execution cannot enable it
  (`src/shared/auth/beta-capabilities.test.ts:84-115,378-387`;
  `src/shared/auth/execution-policy.test.ts:109-116,519-523`). There is no table or
  migration owned by this identifier; actual reply rows/jobs belong to the distinct
  human-confirmed `property.publish_reply` capability
  (`src/shared/governance/capability-fate.ts:74-76,132-136`).
- **Permission/blast.** No permission maps to this id; `reply.manage` maps to
  `property.publish_reply` (`src/shared/auth/capability-for-permission.ts:26,94-96`).
  Allowing the blocked id alone reaches no route, component, use case, worker, or
  table (`src/shared/governance/capability-fate.ts:132-136`). The actual Google
  publisher accepts only an already-approved/current publication cycle
  (`src/contexts/review/infrastructure/jobs/publish-reply.job.ts:1-31,103-128`), and
  the architecture test restricts enqueue sites to human-gated commands or exact
  durable-intent recovery (`src/shared/architecture/no-auto-publish.test.ts:1-19,65-76`).
- **Third-party/outbound.** The prohibited semantics would write a reply to a
  Google-hosted reviewer thread. No such automatic path exists; the real outbound
  Google write is a separate manager-approved job
  (`src/contexts/review/infrastructure/jobs/publish-reply.job.ts:1-25,34-68`). AI
  drafts cannot transition directly to approved
  (`src/contexts/review/domain/rules.test.ts:220-230`), and the UI says nothing is
  published automatically (`src/components/inbox/reply-composer-footer.tsx:72-85`).
- **Recorded reason — yes.** The common block comment says Google policy
  permanently prohibits automated reply publishing
  (`src/shared/auth/beta-capabilities.ts:100-105`). Fate requires explicit human
  confirmation and observed Google truth (`src/shared/governance/capability-fate.ts:132-136`),
  while ADR 0031 requires a separate manager-controlled publication command
  (`docs/adr/0031-google-source-content-and-ai-processing-boundary.md:13-25`). Git
  commit `c88420a26135d36af52445b7b8e27c81bb4e41d2` introduced the id from Google's
  2026-07-14 response, recording “automated AI reply publishing prohibited.”

## `gbp.ai.cross_property_summary`

- **Implementation — id-only.** Fate says no activation path exists
  (`src/shared/governance/capability-fate.ts:137-141`), and blocked-capability tests
  pin the id as unallowlistable
  (`src/shared/auth/beta-capabilities.test.ts:340-342,378-387`). There is no
  id-specific table or migration; the implemented AI aggregate read requires an
  exact Organization and Property and pins both to every store read
  (`src/contexts/ai/application/use-cases/read-property-aggregates.ts:58-98`).
- **Permission/blast.** No permission maps to this id in the exhaustive map
  (`src/shared/auth/capability-for-permission.ts:11-96`). The actual dashboard
  aggregate endpoint uses `dashboard.read` and an exact `propertyId`, not this
  capability (`src/contexts/ai/server/property-aggregates.ts:11-50`). Allowing the
  blocked id alone therefore reaches no implementation
  (`src/shared/governance/capability-fate.ts:137-141`).
- **Third-party/outbound.** The prohibited semantics would combine Google-derived
  review information across Properties or Organizations; Review storage includes
  Google IDs, reviewer name/photo, rating, and text
  (`src/shared/db/schema/review.schema.ts:54-83`). The implemented boundary permits
  only property-scoped derivative metadata that excludes raw content, PII, Google
  identifiers, and exact replies, and explicitly denies cross-property and
  Organization reports
  (`docs/adr/0031-google-source-content-and-ai-processing-boundary.md:11-25`).
- **Recorded reason — yes.** The common block comment says Google policy
  permanently prohibits cross-property AI summaries
  (`src/shared/auth/beta-capabilities.ts:100-105`). Fate says processing is
  Property-local (`src/shared/governance/capability-fate.ts:137-141`), and ADR 0031
  gives the source-content/data-boundary reason
  (`docs/adr/0031-google-source-content-and-ai-processing-boundary.md:7-25`). Git
  commit `c88420a26135d36af52445b7b8e27c81bb4e41d2` introduced the id from Google's
  response, recording “cross-property combination prohibited.”

## `gbp.review_solicitation_gamification`

- **Implementation — id-only.** Fate says no activation path exists
  (`src/shared/governance/capability-fate.ts:142-146`), and the blocked-capability
  tests pin the id as unallowlistable
  (`src/shared/auth/beta-capabilities.test.ts:104-115,378-387`). There is no
  id-specific route, use case, table, or migration. A domain helper can detect
  forbidden source/consumer combinations, but an architecture test records that
  it deliberately has no production caller
  (`src/contexts/metric/domain/metric-registry.ts:153-179`;
  `src/shared/architecture/context-acceptance-matrix.test.ts:286-297`).
- **Permission/blast.** No permission maps to this id in the exhaustive map
  (`src/shared/auth/capability-for-permission.ts:11-96`). Allowing it alone reaches
  no implementation (`src/shared/governance/capability-fate.ts:142-146`). Legacy
  `badge.use` and `leaderboard.use` are separate blocked capabilities whose runtime
  mechanics have already been removed
  (`src/contexts/badge/CONTEXT.md:5-17`; `src/contexts/leaderboard/CONTEXT.md:5-15`).
- **Third-party/outbound.** The prohibited semantics would turn Google-derived
  Reviews, review-link clicks, scans, named-staff mentions, conversion, or private
  Guest signals into goals, badges, or leaderboards. ADR 0043 forbids all of those
  recognition inputs (`docs/adr/0043-worker-recognition-boundary.md:14-22`), and
  ADR 0041 separately says Google derivatives and review-solicitation analytics
  never enter goals/badges/leaderboards
  (`docs/adr/0041-governed-metric-registry.md:29-34`). No current path performs an
  outbound write or reads such data for gamification
  (`src/shared/governance/capability-fate.ts:142-146`).
- **Recorded reason — yes.** The common block comment says Google policy
  permanently prohibits review-solicitation gamification
  (`src/shared/auth/beta-capabilities.ts:100-105`). Fate says beta does not use AI
  or competitive mechanics to influence review solicitation
  (`src/shared/governance/capability-fate.ts:142-146`); ADRs 0041 and 0043 document
  the privacy/fairness/source exclusions
  (`docs/adr/0041-governed-metric-registry.md:20-34`;
  `docs/adr/0043-worker-recognition-boundary.md:14-40`). Git commit
  `c88420a26135d36af52445b7b8e27c81bb4e41d2` introduced the id from Google's
  response, recording “review solicitation never drives goals/badges/leaderboards.”

## Survey conclusion

All 13 capabilities have a recorded reason; none require the fallback phrase
“no recorded reason” (`src/shared/governance/capability-fate.ts:56-66,85-89,99-121,132-146`).
The implementation survey finds four built-and-fenced capabilities, six partial
capabilities, and three id-only prohibitions, as defined in this document and
summarized above. This count is descriptive evidence, not an activation decision.
