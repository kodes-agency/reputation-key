# Graph Report - full-bobble (2026-04-29)

## Corpus Check

- 244 files · ~98,610 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 531 nodes · 503 edges · 13 communities detected
- Extraction: 64% EXTRACTED · 36% INFERRED · 0% AMBIGUOUS · INFERRED: 182 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)

- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 14|Community 14]]

## God Nodes (most connected - your core abstractions)

1. `createContainer()` - 37 edges
2. `createCapturingEventBus()` - 13 edges
3. `organizationId()` - 13 edges
4. `propertyId()` - 11 edges
5. `getLogger()` - 10 edges
6. `getEnv()` - 9 edges
7. `userId()` - 8 edges
8. `resolveTenantContext()` - 7 edges
9. `createInMemoryPropertyRepo()` - 7 edges
10. `teamId()` - 7 edges

## Surprising Connections (you probably didn't know these)

- `runDbCleanup()` --calls--> `getDb()` [INFERRED]
  e2e/helpers/cleanup.ts → src/shared/db/index.ts
- `createContainer()` --calls--> `createAuthIdentityAdapter()` [INFERRED]
  src/composition.ts → src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts
- `createContainer()` --calls--> `setOnAcceptInvitation()` [INFERRED]
  src/composition.ts → src/shared/auth/auth.ts
- `createContainer()` --calls--> `getDb()` [INFERRED]
  src/composition.ts → src/shared/db/index.ts
- `createContainer()` --calls--> `createEventBus()` [INFERRED]
  src/composition.ts → src/shared/events/event-bus.ts

## Communities

### Community 0 - "Community 0"

Cohesion: 0.06
Nodes (22): createNoopCache(), createRedisCache(), getRedis(), isRedisHealthy(), getEnv(), createEventBus(), createHealthCheckHandler(), createJobQueue() (+14 more)

### Community 1 - "Community 1"

Cohesion: 0.1
Nodes (18): organizationId(), propertyId(), staffAssignmentId(), teamId(), userId(), propertyFromRow(), makeProperty(), staffAssignmentFromRow() (+10 more)

### Community 2 - "Community 2"

Cohesion: 0.07
Nodes (17): createCapturingEventBus(), createInMemoryPropertyRepo(), createProperty(), setup(), createTeam(), setup(), getProperty(), setup() (+9 more)

### Community 3 - "Community 3"

Cohesion: 0.12
Nodes (15): createAuthIdentityAdapter(), toMemberRecord(), createAuth(), getAuth(), setOnAcceptInvitation(), authErrorStatus(), getSessionFromHeaders(), getUserFromHeaders() (+7 more)

### Community 4 - "Community 4"

Cohesion: 0.09
Nodes (11): createInMemoryIdentityPort(), inviteMember(), setup(), listInvitations(), setup(), removeMember(), setup(), resendInvitation() (+3 more)

### Community 5 - "Community 5"

Cohesion: 0.15
Nodes (12): parseBetterAuthResponse(), buildProperty(), identityError(), propertyError(), hasRole(), canChangeRole(), canInviteWithRole(), normalizeSlug() (+4 more)

### Community 6 - "Community 6"

Cohesion: 0.11
Nodes (11): createInMemoryTeamRepo(), getTeam(), createAccessProvider(), setup(), listTeams(), createFakePropertyAccess(), setup(), softDeleteTeam() (+3 more)

### Community 7 - "Community 7"

Cohesion: 0.14
Nodes (7): createInMemoryStaffAssignmentRepo(), createStaffAssignment(), setup(), listStaffAssignments(), setup(), removeStaffAssignment(), setup()

### Community 8 - "Community 8"

Cohesion: 0.21
Nodes (7): useAction(), wrapAction(), CreatePropertyPage(), PropertyLayout(), JoinPage(), LoginPage(), RegisterPage()

### Community 9 - "Community 9"

Cohesion: 0.42
Nodes (10): emailShell(), escapeHtml(), getResend(), invitationEmailHtml(), resetPasswordEmailHtml(), sendEmail(), sendInvitationEmail(), sendResetPasswordEmail() (+2 more)

### Community 10 - "Community 10"

Cohesion: 0.2
Nodes (5): getDb(), isDbHealthy(), getPool(), runDbCleanup(), setupTestDatabase()

### Community 12 - "Community 12"

Cohesion: 0.29
Nodes (4): buildStaffAssignment(), staffError(), validateNotSelfAssignment(), validateRequiredId()

### Community 14 - "Community 14"

Cohesion: 0.29
Nodes (3): buildTeam(), teamError(), validateTeamName()

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `createContainer()` connect `Community 0` to `Community 2`, `Community 3`, `Community 4`, `Community 6`, `Community 7`, `Community 10`?**
  _High betweenness centrality (0.121) - this node is a cross-community bridge._
- **Why does `resolveTenantContext()` connect `Community 3` to `Community 1`?**
  _High betweenness centrality (0.048) - this node is a cross-community bridge._
- **Are the 35 inferred relationships involving `createContainer()` (e.g. with `getDb()` and `getLogger()`) actually correct?**
  _`createContainer()` has 35 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `createCapturingEventBus()` (e.g. with `setup()` and `setup()`) actually correct?**
  _`createCapturingEventBus()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 12 inferred relationships involving `organizationId()` (e.g. with `makeProperty()` and `propertyFromRow()`) actually correct?**
  _`organizationId()` has 12 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `propertyId()` (e.g. with `makeProperty()` and `propertyFromRow()`) actually correct?**
  _`propertyId()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `getLogger()` (e.g. with `createContainer()` and `bootstrap()`) actually correct?**
  _`getLogger()` has 8 INFERRED edges - model-reasoned connections that need verification._
