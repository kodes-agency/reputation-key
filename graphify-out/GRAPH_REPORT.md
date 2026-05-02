# Graph Report - orderly-pigeon (2026-05-02)

## Corpus Check

- 412 files · ~179,574 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary

- 947 nodes · 983 edges · 21 communities detected
- Extraction: 60% EXTRACTED · 40% INFERRED · 0% AMBIGUOUS · INFERRED: 398 edges (avg confidence: 0.8)
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
- [[_COMMUNITY_Community 11|Community 11]]
- [[_COMMUNITY_Community 12|Community 12]]
- [[_COMMUNITY_Community 16|Community 16]]
- [[_COMMUNITY_Community 18|Community 18]]
- [[_COMMUNITY_Community 21|Community 21]]
- [[_COMMUNITY_Community 22|Community 22]]
- [[_COMMUNITY_Community 32|Community 32]]
- [[_COMMUNITY_Community 38|Community 38]]
- [[_COMMUNITY_Community 40|Community 40]]
- [[_COMMUNITY_Community 59|Community 59]]

## God Nodes (most connected - your core abstractions)

1. `createContainer()` - 44 edges
2. `organizationId()` - 26 edges
3. `buildPortalContext()` - 20 edges
4. `createCapturingEventBus()` - 20 edges
5. `propertyId()` - 20 edges
6. `portalId()` - 14 edges
7. `getEnv()` - 12 edges
8. `getLogger()` - 11 edges
9. `portalError()` - 10 edges
10. `validateSlug()` - 10 edges

## Surprising Connections (you probably didn't know these)

- `createContainer()` --calls--> `createAuthIdentityAdapter()` [INFERRED]
  src/composition.ts → /Users/bozhidardenev/.superset/worktrees/reputation-key/full-bobble/src/contexts/identity/infrastructure/adapters/auth-identity.adapter.ts
- `runDbCleanup()` --calls--> `getDb()` [INFERRED]
  /Users/bozhidardenev/.superset/worktrees/reputation-key/full-bobble/e2e/helpers/cleanup.ts → src/shared/db/index.ts
- `createContainer()` --calls--> `getLogger()` [INFERRED]
  src/composition.ts → /Users/bozhidardenev/.superset/worktrees/reputation-key/full-bobble/src/shared/observability/logger.ts
- `createContainer()` --calls--> `createStaffAssignmentRepository()` [INFERRED]
  src/composition.ts → /Users/bozhidardenev/.superset/worktrees/reputation-key/full-bobble/src/contexts/staff/infrastructure/repositories/staff-assignment.repository.ts
- `createContainer()` --calls--> `createPropertyRepository()` [INFERRED]
  src/composition.ts → /Users/bozhidardenev/.superset/worktrees/reputation-key/full-bobble/src/contexts/property/infrastructure/repositories/property.repository.ts

## Communities

### Community 0 - "Community 0"

Cohesion: 0.03
Nodes (35): buildPortalContext(), createPortalLinkRepository(), createCapturingEventBus(), createInMemoryPortalLinkRepo(), createInMemoryPortalRepo(), createLinkCategory(), setup(), createLink() (+27 more)

### Community 1 - "Community 1"

Cohesion: 0.04
Nodes (36): createNoopCache(), createRedisCache(), createEventBus(), buildIdentityContext(), createJobQueue(), createRateLimiter(), createPropertyRepository(), createStaffAssignmentRepository() (+28 more)

### Community 2 - "Community 2"

Cohesion: 0.07
Nodes (40): feedbackId(), organizationId(), portalId(), portalLinkCategoryId(), portalLinkId(), propertyId(), ratingId(), scanEventId() (+32 more)

### Community 3 - "Community 3"

Cohesion: 0.08
Nodes (30): parseBetterAuthResponse(), buildPortal(), buildPortalLink(), buildPortalLinkCategory(), buildProperty(), identityError(), portalError(), propertyError() (+22 more)

### Community 4 - "Community 4"

Cohesion: 0.07
Nodes (24): createS3StorageAdapter(), emailShell(), escapeHtml(), getResend(), invitationEmailHtml(), resetPasswordEmailHtml(), sendEmail(), sendInvitationEmail() (+16 more)

### Community 5 - "Community 5"

Cohesion: 0.06
Nodes (20): useAction(), wrapAction(), useMutationAction(), useMutationActionSilent(), toMemberOptions(), toTeamOptions(), CreatePortalPage(), PortalDetailRoute() (+12 more)

### Community 6 - "Community 6"

Cohesion: 0.09
Nodes (15): createTeamRepository(), buildTeamContext(), createInMemoryTeamRepo(), createTeam(), setup(), getTeam(), createStaffApi(), setup() (+7 more)

### Community 7 - "Community 7"

Cohesion: 0.1
Nodes (16): createAuthIdentityAdapter(), toMemberRecord(), createAuth(), getAuth(), setOnAcceptInvitation(), authErrorStatus(), getSessionFromHeaders(), getUserFromHeaders() (+8 more)

### Community 8 - "Community 8"

Cohesion: 0.1
Nodes (13): buildPropertyContext(), createInMemoryPropertyRepo(), createProperty(), setup(), getProperty(), setup(), listProperties(), createTestStaffApi() (+5 more)

### Community 9 - "Community 9"

Cohesion: 0.15
Nodes (12): useAsRef(), useLazyRef(), ColorPicker(), colorToString(), hexToRgb(), hsvToRgb(), parseColorString(), rgbToHex() (+4 more)

### Community 10 - "Community 10"

Cohesion: 0.14
Nodes (6): getDb(), isDbHealthy(), getPool(), runDbCleanup(), seedPortal(), createPortalRepository()

### Community 11 - "Community 11"

Cohesion: 0.17
Nodes (6): buildGuestContext(), createGuestInteractionRepository(), recordScan(), submitFeedback(), submitRating(), trackReviewLinkClick()

### Community 12 - "Community 12"

Cohesion: 0.31
Nodes (6): buildFeedback(), buildRating(), guestError(), validateFeedback(), validateRating(), validateSource()

### Community 16 - "Community 16"

Cohesion: 0.29
Nodes (4): buildStaffAssignment(), staffError(), validateNotSelfAssignment(), validateRequiredId()

### Community 18 - "Community 18"

Cohesion: 0.29
Nodes (3): buildTeam(), teamError(), validateTeamName()

### Community 21 - "Community 21"

Cohesion: 0.33
Nodes (2): SidebarMenuButton(), useSidebar()

### Community 22 - "Community 22"

Cohesion: 0.4
Nodes (3): buildPermissionSet(), initPermissionTable(), setPermissionLookup()

### Community 32 - "Community 32"

Cohesion: 0.5
Nodes (2): getTimezoneOffsetLabel(), TimezoneCombobox()

### Community 38 - "Community 38"

Cohesion: 0.5
Nodes (2): usePermissions(), EditPortalForm()

### Community 40 - "Community 40"

Cohesion: 0.67
Nodes (2): composeRefs(), useComposedRefs()

### Community 59 - "Community 59"

Cohesion: 1.0
Nodes (2): parseSource(), PublicPortalPage()

## Knowledge Gaps

- **Thin community `Community 21`** (7 nodes): `sidebar.tsx`, `cn()`, `handleKeyDown()`, `SidebarMenu()`, `SidebarMenuButton()`, `SidebarMenuItem()`, `useSidebar()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 32`** (4 nodes): `getTimezoneOffsetLabel()`, `TimezoneCombobox()`, `TimezoneCombobox.tsx`, `timezones.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 38`** (4 nodes): `usePermissions()`, `EditPortalForm()`, `EditPortalForm.tsx`, `usePermissions.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 40`** (4 nodes): `composeRefs()`, `setRef()`, `useComposedRefs()`, `compose-refs.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (3 nodes): `parseSource()`, `PublicPortalPage()`, `$portalSlug.tsx`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions

_Questions this graph is uniquely positioned to answer:_

- **Why does `createContainer()` connect `Community 1` to `Community 0`, `Community 4`, `Community 6`, `Community 7`, `Community 8`, `Community 10`, `Community 11`?**
  _High betweenness centrality (0.107) - this node is a cross-community bridge._
- **Why does `buildPortalContext()` connect `Community 0` to `Community 1`, `Community 10`, `Community 4`?**
  _High betweenness centrality (0.057) - this node is a cross-community bridge._
- **Why does `updateProperty()` connect `Community 8` to `Community 1`, `Community 3`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Are the 41 inferred relationships involving `createContainer()` (e.g. with `getDb()` and `getLogger()`) actually correct?**
  _`createContainer()` has 41 INFERRED edges - model-reasoned connections that need verification._
- **Are the 25 inferred relationships involving `organizationId()` (e.g. with `portalFromRow()` and `categoryFromRow()`) actually correct?**
  _`organizationId()` has 25 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `buildPortalContext()` (e.g. with `createContainer()` and `createPortalRepository()`) actually correct?**
  _`buildPortalContext()` has 19 INFERRED edges - model-reasoned connections that need verification._
- **Are the 19 inferred relationships involving `createCapturingEventBus()` (e.g. with `setup()` and `setup()`) actually correct?**
  _`createCapturingEventBus()` has 19 INFERRED edges - model-reasoned connections that need verification._
