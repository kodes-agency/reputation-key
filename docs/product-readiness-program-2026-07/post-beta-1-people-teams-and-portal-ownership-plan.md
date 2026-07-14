# POST-BETA-1 — People, Teams, and Portal Ownership

**Status:** Proposed  
**Depends on:** Beta identity/authorization, property lifecycle, durable outbox, migration authority  
**Contexts:** Identity, property, staff, team, portal, activity  
**Effort:** 9–14 engineering days

## 1. Goal

Make the answer to four questions unambiguous for every point in time:

1. Which properties may this user access?
2. Which administrative team did this person belong to?
3. Which portal/touchpoint was this person responsible for?
4. Which reporting group did that portal belong to when an event occurred?

The current `staff_assignments` shape combines property access, team membership, and portal responsibility in one row. Portal ownership also uses a polymorphic `entityType/entityId` relation without database integrity. This makes authorization, history, reassignment, and performance attribution affect one another accidentally.

## 2. Scope

### In

- Separate property authorization, staff participation, team membership, team lead responsibility, portal responsibility, and portal-group membership.
- Effective dates and immutable history for memberships/responsibilities.
- Same-organization and same-property invariants.
- Team directory, membership management, lead assignment, and staff-facing team page.
- Portal responsibility management without granting access implicitly.
- Staff view of attributed portals and a correction/dispute request path.
- Transactional commands, durable events, idempotent projections, audit/activity entries.
- Migration from `staff_assignments` and portal polymorphic ownership.
- Authorization, concurrency, lifecycle, accessibility, and scale tests.

### Out

- Shift scheduling, time tracking, payroll, HRIS, compensation, hiring, promotion, or discipline.
- Teams as metric, goal, or leaderboard scopes. Portal groups remain the property-local reporting scope.
- Cross-property employee rankings.
- AI evaluation of staff.
- Goal/badge/leaderboard implementation; they consume this phase later.

## 3. Current-state findings to resolve

| Finding                                                                      | Consequence                                                                     |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| One assignment row carries property, team, and portal dimensions             | Updating one concern can duplicate, clear, or infer another.                    |
| Portal updates copy `teamId` from the first current assignment               | Multi-team membership has no reliable meaning and can be corrupted.             |
| Portal `entityType/entityId` is polymorphic                                  | Database cannot prove the target exists or belongs to the same tenant/property. |
| Team lead is not strongly validated against current membership and property  | A stale or foreign lead can survive command mistakes.                           |
| Team deletion is blocked in application code but schema cascades assignments | Bypassing the use case can erase history.                                       |
| Multi-write portal assignment changes are not one transaction                | Partial responsibility state and partial events are possible.                   |
| `/team` is a placeholder while the context mentions shift management         | Product promise and implementation do not match; shifts are not modeled.        |
| Membership and responsibility lack effective history                         | Historical measurement and correction cannot be explained.                      |

## 4. Domain contract

### 4.1 Canonical concepts

| Concept                 | Owner                         | Meaning                                                                                                  |
| ----------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PropertyAccessGrant`   | Identity authorization module | User may perform declared actions within a property scope.                                               |
| `StaffParticipation`    | Staff context                 | User participates as staff at a property; holds profile/display and active lifecycle, not authorization. |
| `Team`                  | Team context                  | Property-local administrative grouping.                                                                  |
| `TeamMembership`        | Team context                  | Effective-dated relation between staff participation and team, optionally `member` or `lead`.            |
| `Portal`                | Portal context                | Stable physical/digital touchpoint at one property.                                                      |
| `PortalResponsibility`  | Staff context                 | Effective-dated attribution of one staff participation to one portal. It does not grant access.          |
| `PortalGroup`           | Portal context                | Property-local performance/reporting grouping of portals.                                                |
| `PortalGroupMembership` | Portal context                | Effective-dated portal-to-group relation used for event-time attribution.                                |

One person may belong to multiple teams and be responsible for multiple portals. A portal may have multiple responsible people when explicitly allowed. If the product wants exactly one primary owner, model `responsibility_kind = primary|supporting` and enforce at most one active primary; do not infer this from row order.

### 4.2 Invariants

- Every relation carries `organization_id` and `property_id`; referenced rows must match both.
- A team, portal, portal group, membership, and responsibility belongs to exactly one property.
- A staff participation must be active for a new team membership or portal responsibility.
- Time intervals are half-open: `[effective_from, effective_to)`. `effective_to = null` means active.
- The same relation cannot have overlapping active intervals. Enforce with PostgreSQL exclusion constraints where practical; otherwise use serializable/locked commands plus a database validation trigger.
- A team may have multiple leads only if product explicitly chooses that behavior. Default: at most one active `lead` membership per team.
- Removing property access does not erase participation/history. It immediately prevents access and starts a separate lifecycle command to close active memberships/responsibilities if requested.
- Archiving a portal/team closes active relations; it never cascades historical facts.
- Moving a portal to another group ends the old membership and starts a new one. Past metric facts retain event-time group attribution.
- Authorization never derives from team membership, lead status, portal responsibility, or a badge.

## 5. Proposed data changes

Exact types and names can follow repository conventions, but the model must express these constraints.

### 5.1 New/reworked tables

`property_access_grants`

- `id`, `organization_id`, `property_id`, `user_id`
- grant/capability reference compatible with the accepted authorization ADR
- `status`, `granted_at`, `revoked_at`, `granted_by`, `revoked_by`, `reason`
- unique active grant per user/property/grant kind

`staff_participations`

- `id`, `organization_id`, `property_id`, `user_id`
- staff display/profile fields that are not identity credentials
- `status`, `started_at`, `ended_at`, `created_by`, `updated_at`
- unique active participation per user/property

`team_memberships`

- `id`, `organization_id`, `property_id`, `team_id`, `staff_participation_id`
- `membership_role = member|lead`
- `effective_from`, `effective_to`, `created_by`, `end_reason`
- no cascade from team/staff to historical membership

`portal_responsibilities`

- `id`, `organization_id`, `property_id`, `portal_id`, `staff_participation_id`
- `responsibility_kind = primary|supporting`
- `effective_from`, `effective_to`, `created_by`, `end_reason`
- optional uniqueness for one active primary per portal

`portal_group_memberships`

- `id`, `organization_id`, `property_id`, `portal_id`, `portal_group_id`
- `effective_from`, `effective_to`, `created_by`, `end_reason`
- exactly one active group membership per portal when the portal must be grouped; otherwise zero or one

### 5.2 Existing-table changes

- Replace portal `propertyId` varchar-only relation with the authoritative property foreign key and tenant-consistency constraint.
- Remove `entityType/entityId` only after responsibility migration and cutover.
- Remove team lead shortcut column after lead memberships are authoritative, or retain it only as a maintained read projection.
- Retire `staff_assignments` after all consumers use the new modules and reconciliation is exact.
- Replace destructive cascades with restrictive or lifecycle-aware behavior.

### 5.3 Domain events

Events are facts, not commands. Minimum event set:

- `property_access.granted|revoked`
- `staff_participation.started|ended|profile_updated`
- `team.created|updated|archived`
- `team_membership.started|role_changed|ended`
- `portal_responsibility.started|kind_changed|ended`
- `portal_group_membership.started|ended`

Every event includes stable event ID, organization/property, actor, effective timestamp, occurred timestamp, aggregate/version, reason where applicable, and schema version. Do not copy sensitive profile fields into durable payloads unless a consumer needs a declared snapshot.

## 6. Work packages

### PB1.0 — Decisions, glossary, and characterization

1. Confirm whether “leadership” means team-lead workflows in addition to leaderboards.
2. Confirm one or multiple leads and one or multiple portal owners.
3. Accept ADR 0039 and ADR 0040 from the master plan.
4. Correct context ownership documents only after ADR acceptance.
5. Add characterization tests around current access, invitation assignment, team CRUD, portal reassignment, property change, and deletion.
6. Produce data profiling queries: duplicate assignment combinations, cross-tenant references, missing users/properties, multi-team users, multi-owner portals, orphaned teams, and rows with incompatible null combinations.

**Exit:** Every existing row has a deterministic migration interpretation or is placed in a reviewed quarantine report.

### PB1.1 — Deep authorization and staff modules

1. Make Identity's `AuthorizationPolicy` the only place that decides an action/resource/property scope.
2. Add `PropertyAccessGrant` commands and repository with last-owner/admin protection and explicit revocation.
3. Add staff participation lifecycle independent of access.
4. Ensure invite acceptance creates all required objects atomically or through one durable workflow with compensation/status.
5. Add bulk-list APIs with cursor pagination and bounded property/member searches.
6. Prevent staff performance data from appearing in broad member-directory responses.

**Exit:** Removing a team or portal relation cannot add/remove authorization; revoking access takes effect immediately and preserves history.

### PB1.2 — Team aggregate and lead workflow

1. Make create/update/archive commands transactional and version checked.
2. Replace mutable lead reference with role-bearing, effective-dated membership.
3. Validate tenant/property/current staff participation on every membership command.
4. Define archive behavior: prevent new membership, close active membership at requested effective time, preserve history.
5. Implement manager team list/detail/member management and the current staff `/team` page.
6. Show team lead and membership dates; omit shifts/schedules copy and navigation.
7. Add permission/empty/error/concurrent-edit UI states.

**Exit:** A team can be created, staffed, led, viewed, corrected, and archived without relying on assignment-row conventions.

### PB1.3 — Portal responsibility and group history

1. Replace polymorphic ownership with explicit responsibility commands.
2. Treat portal grouping and staff responsibility as independent changes.
3. Resolve responsible staff and group as of an event's `occurred_at`, not query time.
4. Add a manager change-preview showing which future attribution changes and confirming that history will not be rewritten.
5. Add staff self-view of current portals and bounded history.
6. Emit correction request when staff disputes attribution; manager accepts/rejects with reason, and metric corrections occur later through the governed metric engine.

**Exit:** Reassigning a portal changes future attribution only and produces an explainable history.

### PB1.4 — Expand/backfill/cutover/contract

1. Add new tables and constraints without changing reads.
2. Backfill staff participation per unique user/property.
3. Backfill access only from authoritative access evidence; do not assume every historical assignment still grants access.
4. Backfill team memberships and portal responsibilities with a documented effective-time rule. Flag ambiguous rows rather than guessing.
5. Backfill portal group membership from current state and record the historical-limit marker: facts before migration may have `group_attribution_quality = current_state_backfill`.
6. Verify counts, active relation uniqueness, tenant/property consistency, and sampled UI equivalence.
7. Cut command writes to new modules; dual-read behind a temporary capability only if necessary.
8. Cut every consumer and projection, then remove old fields/table in a later deploy.

**Rollback:** Disable new commands, keep old reads during observation, and retain mapping/reconciliation tables. Never reverse by deleting the new historical records.

### PB1.5 — Activity, audit, correction, and lifecycle

1. Create user-facing activity items for understandable changes only.
2. Record restricted security audit for grants, revocations, exports, sensitive staff views, and correction decisions.
3. Apply property/member archive and erasure policy without removing operational evidence needed for disputes, subject to retention/legal policy.
4. Notify affected staff of meaningful responsibility/membership changes when notification capability is enabled.
5. Add export of a staff member's attributed portals, team membership, and correction status; exclude other staff's restricted data.

### PB1.6 — Scale, test, and release

Run the following gates:

- unit tests for interval, role, archive, and last-owner rules;
- PostgreSQL integration tests for non-overlap, tenant/property consistency, restrict/cascade behavior, and concurrent reassignments;
- command/outbox atomicity and consumer idempotency tests;
- migration tests from real-shape anonymized fixtures including every null/duplicate combination;
- authorization matrix tests for owner/admin/manager/member and revoked users;
- E2E for invite → access → participation → team → portal responsibility → correction → archive;
- keyboard/screen-reader/zoom/mobile tests for team and portal assignment UI;
- target-scale query tests for 5,000 properties, high-member properties, and bounded histories.

## 7. Acceptance criteria

- Property access, team membership, and portal responsibility can change independently.
- No query or command treats team/portal ownership as authorization.
- Database/application invariants reject cross-tenant and cross-property relations.
- History is effective-dated, non-overlapping, inspectable, and not erased by archive.
- Portal group movement affects future events only; historical attribution quality is explicit.
- Team leads are current members and have only explicitly granted management capabilities.
- The staff team page is complete for the accepted grouping/lead scope and makes no shift-management promise.
- Staff can see and dispute their attribution; manager decisions are recorded.
- Migration reconciliation is exact for all non-quarantined rows and every quarantine has owner/disposition.
- There is no P0/P1 accessibility, authorization, tenant-separation, or data-loss issue.

## 8. Decisions required before PB1.1

| Decision                   | Recommended default                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------- |
| Team leads                 | One active lead per team; make multiple leads an explicit later extension.            |
| Portal responsibility      | One primary plus zero or more supporting staff.                                       |
| Team scope                 | Administrative membership/lead only; no shifts/schedules.                             |
| Portal usage               | Support both area portals and staff-specific QR/NFC without changing authorization.   |
| Historical group semantics | Event-time, non-retroactive.                                                          |
| Staff correction SLA       | Manager acknowledges within three working days during internal beta; configure later. |
