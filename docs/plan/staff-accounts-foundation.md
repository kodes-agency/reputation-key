# Staff account foundation handoff

Date: 2026-11-01. Implements PR B of [the plan](staff-accounts.md), under [ADR 0076](../adr/0076-staff-accounts-and-personal-portals.md). No product routes or components are added. Existing manager stories use exact reader permissions instead of the staff-only Member role. The capability remains beta_disabled.

## Server contracts

All inputs are strict objects. The session chooses the person and Organization. A participation id is only a choice among that person's current participations. No self function accepts a user or participant id.

Batch checks and Add spend from a separate allowance of 200 address checks per actor per hour. A pending, unexpired invitation at any Property in the Organization returns `already_invited`: “This address already has an open invitation. Add them here once they've accepted.” Checks never spend the invitation-send allowance.

Settings hides staff-only logins and refuses their removal with “Remove this person from Staff”. Removing or leaving a manager login first ends its personal participations and archives their Portals; a failure keeps the login and can be retried. A Group scan target appears to staff only when the colleague list is on or the Group holds at least three personal Portals.

Manager functions are exported by src/contexts/identity/server/staff-accounts.ts:

| Function                | Input                                                                                       | Result                                                                                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| checkStaffBatch         | { propertyId, sourcePortalId?, portalGroupId?, rows: [{ email, displayName }] } (1–20 rows) | { rows: [{ code }], code: string or null, omittedLinks: [{ id, label }], remainingInvitations: number }                                                                            |
| addStaffMember          | { operationId, propertyId, sourcePortalId?, portalGroupId?, email, displayName }            | { operationId, participationId, portalId, status, step, code: string or null }                                                                                                     |
| resendStaffInvitation   | { participationId }                                                                         | { sent: true }                                                                                                                                                                     |
| removeStaffMember       | { participationId }                                                                         | { removed: true }                                                                                                                                                                  |
| renameStaffMember       | { participationId, displayName }                                                            | { renamed: true }                                                                                                                                                                  |
| listStaffMembers        | { propertyId }                                                                              | { members: [{ participationId, operationId: string or null, displayName, portalId: string or null, email?: string or null, access, step: string or null, code: string or null }] } |
| setColleagueListEnabled | { propertyId, enabled }                                                                     | { enabled }                                                                                                                                                                        |

Batch row codes are ok, invalid_email, name_required, duplicate_in_batch, already_staff_here, other_organization. Batch preflight reports source_has_unpublished_changes, source_archived or address_keyring_missing, and other actionable source/Property validation failures. Onboarding status is running, failed, done or cancelled; steps are person, portal, responsibility, code, publication, access. Retry with the same operationId; a failed list row exposes it so a reload does not lose the repair handle. The original row's source and reserved identifiers remain authoritative on retry. Access is active, invited, invite_expired or failed (the latter also covers unfinished running work). Email is omitted unless the caller may invite. An interrupted removal stays listed as failed with step removal and code removal_incomplete until its Portal is archived; retry removeStaffMember for that row, not addStaffMember.

Self functions are exported by src/contexts/identity/server/staff-self.ts:

| Function               | Input               | Result                                                                                                                         |
| ---------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| getMyStaffHome         | none                | { participations: [{ participationId, propertyName, portalState: live or paused, noticeAcknowledged, colleagueListEnabled }] } |
| getMyCode              | { participationId } | { state: paused } or { state: live, qr, wordingKey }                                                                           |
| acknowledgeStaffNotice | { version }         | { acknowledged: true }                                                                                                         |

wordingKey is the Portal's primary guest locale. qr is the short QR print address when available, otherwise the marked long QR address. There is no direct address field. STAFF_NOTICE_VERSION is exported by Identity's application/public-api.ts. The code read is POST, private/no-store, with its own 120-per-hour user budget and one reveal audit per user/token version.

Reporting self functions are exported by src/contexts/reporting/server/staff-self-results.ts:

| Function        | Input                                               | Result                                                                              |
| --------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| getMyResults    | { participationId, period: today or week or month } | Today: { scans }. Week/month: { scans, ratingCount, averageRating?, ratingsCutoff } |
| getMyGoals      | { participationId }                                 | { goals: [{ id, name, target, scans }] }                                            |
| getMyColleagues | { participationId, period }                         | { colleagues: [{ displayName, scans, isYou }] }                                     |

ratingsCutoff is the server's ISO instant for today's start in the Property's time zone. Average is absent below five ratings. Ratings and their corrections/projection arrivals are fixed at that cutoff. Scans remain live. Goals are qualified-scans only and empty when STAFF_SCAN_TARGETS_ENABLED is off. Colleagues are refused while their setting is off.

The staffSelfKeys family in src/shared/queries/query-keys.ts has its own root. Home names the signed-in user; every other leaf names the participation. Results additionally name the period and server-provided rating cutoff. Seed a rating read from the returned server cutoff rather than guessing the Property day from the browser clock. Clear the family on sign-out/account change. The UI PRs own those callers and refresh behavior.

## Metric governance

Added staff_self as a permitted consumer of the existing private Portal rating version and the qualified-scan, rating-count and rating-average Goal versions. Their four definitions now set workerDataFlag true. The raw rating is classified private_response_with_worker_link; the three numeric Goal definitions are guest_gateway_numeric_with_worker_link. The Goal versions' fairness status names manager and staff-self contexts. staff_self is not a gamification consumer. No definition/version id, formula, source-policy allowlist, retention rule, employment-decision eligibility or Google consumer permission changes. Staff results select only the private-rating and qualified-scan versions; staff targets select only qualified scans.

## Implementation choices

- Adding an already-linked person reuses their canonical name. Portal binding reconciles a concurrent rename in the same transaction; Add never renames another Property's person from the batch text.
- A person's canonical name is shared across their participations. Rename requires staff.invite and execution-policy admission at every related Property, including retained historical rows, because those labels change together. The transaction checks that no new Property appeared after authorization.
- A Property public display name longer than the new public_name column's 100 characters is refused in preflight. It is never silently truncated.
- Personal Portal public wording is checked for normalized name words on direct localized-title/description writes and on initial publication, republishing and rollback. Names stay out of guest output even when wording is entered by hand.
- Source copies carry the one loaded copy and original revision/snapshot into the create transaction, which takes the existing publication fences and rechecks the source. A changed source is refused before inserting a copy.
- Group membership and Goal definition commits share a Property advisory fence. Neither a later Group move nor a Goal edit may turn a personal Portal into a rating target.
- Removal cancels only the original participation’s unfinished operations. A login is resolved even if onboarding has not created its StaffUserLink yet. Access ends first; unfinished operation contact details remain available for a failed login-revocation retry, then cancellation scrubs them before Portal archival.
- An unfinished personal setup also locks the ordinary participation actions, before its Portal FK exists; only Remove can cancel that setup.
- Ordinary Delete is refused for personal Portals too; it must not bypass staff removal. Disable remains available.
- Recommendation readiness includes the whole roster. The existing manager overview limit remains a per-request bound for the later UI to batch; no list presentation changes here.
- The staff Portal resolver port/adapter remain because Goal visibility still uses them. Only the dormant staff dashboard use case, wiring, type and tests were removed.
- No ADR requirement was found impossible or changed to excuse existing code. Copies carry skipPrivateRating from the source; the next pull request enforces ADR 0076 item 17.
- Migration 0093 follows migration 0092 in the journal.

## PostgreSQL and browser verification

Written but not run here:

- Identity staff-invitation-acceptance.integration.test.ts: signed-in, registration and recovery acceptance; membership/link atomicity; no Property grant; ended participation refusal.
- Identity staff-account-store.integration.test.ts: every persisted step's fault/retry, stable identifiers, actual address advisory-lock concurrency, existing-member linking without invitation, access denial, active-ownership/scoped FK constraints, completion scrubbing.
- Reporting staff-results.reader.integration.test.ts: non-UTC midnight, sample threshold, late arrival/correction cutoff, accepted roster with zeros and removal.
- Extended Identity staff-participation.repository.test.ts (the PostgreSQL suite) with personal-ownership and Supporting locks.
- The guest browser fixture now clears manager cookies before asserting anonymous scan production. Browser/e2e suites were not run.

No remote service was used. Integration tests require the existing disposable PostgreSQL lease and CI setup.

## Verification results

All commands used Node v22.23.4.

| Check                                                         | Result                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pnpm exec vitest run --project=unit                           | Latest full run: 32,862 passed, 36 skipped; 22 failures in 11 existing local socket/network fixture files, plus 10 associated uncaught socket errors. The sandbox refuses listen with EPERM.                               |
| Latest changed-test and architecture subset                   | 54 files, 985 tests passed after the final canonical-name and removal-recovery fixes.                                                                                                                                      |
| NODE_OPTIONS=--max-old-space-size=6144 pnpm exec tsc --noEmit | Passed.                                                                                                                                                                                                                    |
| pnpm exec tsc -p tsconfig.scripts.json --noEmit               | Passed.                                                                                                                                                                                                                    |
| pnpm lint                                                     | ESLint passed with 17 existing warnings; architecture, filename and component/server gates passed. Its final tsx CLI step cannot create an IPC pipe (EPERM). The same product-state script passed using node --import tsx. |
| node --import tsx scripts/check-migration-journal.ts          | Passed: 93 entries, 92 existing entries unchanged.                                                                                                                                                                         |
| pnpm exec prettier --check on every existing changed file     | SQL and e2e/stack.env have no installed Prettier parser. All supported TypeScript, TSX, Markdown and JSON files passed separately.                                                                                         |
| pnpm exec fallow audit --base origin/main --gate new-only     | Cannot create its temporary base worktree in this sandbox. Local Fallow health analysis found no changed function above cognitive complexity 20. Full dead-code/duplication attribution remains for CI.                    |
| Test quality, file length, product-state consistency          | Passed with direct Node execution where the tsx CLI's IPC pipe is blocked.                                                                                                                                                 |
| Changed-code ownership                                        | Normal check passed (uncommitted additions are outside its committed diff); applying the same import-graph check to the 64 untracked src files found every runtime module within one import of a test.                     |
| git diff --check                                              | Passed.                                                                                                                                                                                                                    |

The PostgreSQL integration and browser tests above remain unrun. No remote service, commit, push, staging, checkout or branch operation was performed. Existing Guest-fact retention enforcement gaps remain documented in the inventory; this PR adds no retention pipeline.

## Changed files

Each production/document file is listed once below. Tests are grouped separately.

| File                                                                                   | Why                                                                                     |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| CONTEXT.md                                                                             | Define Member, Staff Participant, personal Portal and immutable Portal kind.            |
| docs/BETA.md                                                                           | Record the disabled foundation, capability counts and dated release entry.              |
| docs/adr/0033-authorization-policy.md                                                  | Add the dated ADR 0076 amendment while retaining the original decision.                 |
| docs/adr/0049-beta-local-acceptance.md                                                 | Add the dated ADR 0076 amendment while retaining the original decision.                 |
| docs/adr/0052-beta-people-access-attribution-and-manager-responsibility.md             | Add the dated ADR 0076 amendment while retaining the original decision.                 |
| docs/adr/0064-sealed-portal-address-and-download-again.md                              | Add the dated ADR 0076 amendment while retaining the original decision.                 |
| docs/adr/0068-monthly-portal-goal.md                                                   | Add the dated ADR 0076 amendment while retaining the original decision.                 |
| docs/adr/0076-staff-accounts-and-personal-portals.md                                   | Retain the provided binding ADR; format consistently.                                   |
| docs/adr/README.md                                                                     | Regenerate the ADR index with 0076.                                                     |
| docs/external/google/google-business-profile-ai-policy-response-2026-07-14.md          | Add the dated scans-only target note without changing the verbatim response.            |
| docs/operations/runbooks.md                                                            | Document the default-off scan-target flag and migration rebase.                         |
| docs/plan/staff-accounts-foundation.md                                                 | Record UI contracts, decisions, checks and the complete file manifest.                  |
| docs/plan/staff-accounts.md                                                            | Retain the provided binding delivery plan; format consistently.                         |
| docs/security/data-inventory.md                                                        | Inventory new Staff rows, columns, notices and worker-linked Portal numbers.            |
| drizzle/0093_staff_accounts.sql                                                        | Add personal Portal, staff notice, invitation binding, onboarding and settings schema.  |
| drizzle/meta/_journal.json                                                             | Append 0093 without changing existing entries.                                          |
| e2e/stack.env                                                                          | Keep staff scan targets explicitly off in the browser stack.                            |
| scripts/ci/product-state-consistency-ledger.json                                       | Own the staff query-key family and its later UI lifecycle.                              |
| src/components/features/identity/registration/shared-types.ts                          | Allow the backend preview data type to describe a bound staff invitation.               |
| src/components/features/portal/portal-overview/portal-overview-fixtures.ts             | Supply place kind in the existing overview fixture.                                     |
| src/composition.ts                                                                     | Wire Identity to Portal through the provisioner, policy and invitation budget.          |
| src/composition/read-and-notify-contexts.ts                                            | Inject the scan-target flag into Reporting.                                             |
| src/contexts/guest/CONTEXT.md                                                          | Document the Staff foundation and its context boundary/invariants.                      |
| src/contexts/guest/server/count-guest-visit.ts                                         | Exclude own-Organization authenticated visits, with no anonymous lookup.                |
| src/contexts/guest/server/guest-scans.ts                                               | Suppress signed-in own-Organization scan observations.                                  |
| src/contexts/guest/server/public.ts                                                    | Suppress own-Organization Google opens/link taps while navigation works.                |
| src/contexts/identity/CONTEXT.md                                                       | Document the Staff foundation and its context boundary/invariants.                      |
| src/contexts/identity/application/ports/identity-command-store.port.ts                 | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/application/ports/invitation-email.port.ts                       | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/application/ports/invitation-read-model.port.ts                  | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/application/ports/staff-account-store.port.ts                    | Define Identity-owned Staff management, provisioner and self-read seams.                |
| src/contexts/identity/application/ports/staff-management-store.port.ts                 | Define Identity-owned Staff management, provisioner and self-read seams.                |
| src/contexts/identity/application/ports/staff-portal-provisioner.port.ts               | Define Identity-owned Staff management, provisioner and self-read seams.                |
| src/contexts/identity/application/ports/staff-self-reader.port.ts                      | Define Identity-owned Staff management, provisioner and self-read seams.                |
| src/contexts/identity/application/public-api.ts                                        | Expose typed Staff/personal Portal facts and the new public seam.                       |
| src/contexts/identity/application/staff-accounts-api.ts                                | Declare the public management facade contract.                                          |
| src/contexts/identity/application/staff-self-context.ts                                | Define session-person and owned-participation checks for public composition.            |
| src/contexts/identity/application/use-cases/add-staff-member.ts                        | Run stable, locked, persisted onboarding checkpoints with fresh authority.              |
| src/contexts/identity/application/use-cases/get-invitation-preview.ts                  | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/application/use-cases/manage-staff-accounts.ts                   | Implement batch preflight, safe removal, rename, list, resend and settings.             |
| src/contexts/identity/application/use-cases/staff-participations.ts                    | Carry personal ownership and lock ordinary participation/responsibility changes.        |
| src/contexts/identity/build-staff-accounts.ts                                          | Compose resumable Staff management and shared invitation budgets lazily.                |
| src/contexts/identity/build.ts                                                         | Expose frozen staff facades and gate bound staff invitation acceptance.                 |
| src/contexts/identity/domain/invitation-store-rules.ts                                 | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/domain/people-errors.ts                                          | Carry personal ownership and lock ordinary participation/responsibility changes.        |
| src/contexts/identity/domain/staff-account.ts                                          | Define notice version, stable operation steps, errors and result DTO.                   |
| src/contexts/identity/domain/staff-participation.ts                                    | Carry personal ownership and lock ordinary participation/responsibility changes.        |
| src/contexts/identity/infrastructure/adapters/grant-access-lookup.adapter.ts           | Accept a narrow SQL executor for fresh grants on the reserved connection.               |
| src/contexts/identity/infrastructure/adapters/staff-management.store.ts                | Store offboarding, canonical name changes, access states and settings.                  |
| src/contexts/identity/infrastructure/adapters/staff-organization-export-collections.ts | Include new Staff rows/columns in the organization export, split within file limits.    |
| src/contexts/identity/infrastructure/adapters/staff-organization-export-format.ts      | Include new Staff rows/columns in the organization export, split within file limits.    |
| src/contexts/identity/infrastructure/adapters/staff-organization-export.adapter.ts     | Include new Staff rows/columns in the organization export, split within file limits.    |
| src/contexts/identity/infrastructure/adapters/staff-organization-lifecycle.adapter.ts  | Purge Staff onboarding/settings in FK-safe lifecycle order.                             |
| src/contexts/identity/infrastructure/adapters/staff-self.reader.ts                     | Read only accepted session-linked personal participations and colleagues.               |
| src/contexts/identity/infrastructure/identity-command-store.ts                         | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/infrastructure/identity-organization-export-contributor.ts       | Carry the expanded Staff export collection.                                             |
| src/contexts/identity/infrastructure/invitation-read-model.ts                          | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/infrastructure/invited-registration-store.ts                     | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/infrastructure/repositories/property-access-grant.repository.ts  | Accept a narrow SQL executor for fresh grants on the reserved connection.               |
| src/contexts/identity/infrastructure/repositories/staff-participation.repository.ts    | Carry personal ownership and lock ordinary participation/responsibility changes.        |
| src/contexts/identity/infrastructure/staff-account-store.ts                            | Persist reservations, checkpoints, person/Portal binding and fixed-role access.         |
| src/contexts/identity/infrastructure/staff-invitation-link.ts                          | Create/reuse the active login link within invitation acceptance transactions.           |
| src/contexts/identity/server/invitation-rate-limit.server.ts                           | Support only bound Member invitations and atomic, grant-free staff acceptance.          |
| src/contexts/identity/server/staff-account-errors.ts                                   | Map tagged Staff and Portal refusals once at the Staff server boundary.                 |
| src/contexts/identity/server/staff-accounts.ts                                         | Expose Property-scoped management functions behind staff.accounts.                      |
| src/contexts/identity/server/staff-self-context.ts                                     | Resolve the active session link and enforce owned participation choices.                |
| src/contexts/identity/server/staff-self.ts                                             | Expose narrow home, audited own-code and notice functions.                              |
| src/contexts/identity/server/staff-shared.ts                                           | Map the tagged personal-ownership lifecycle refusal.                                    |
| src/contexts/portal/CONTEXT.md                                                         | Document the Staff foundation and its context boundary/invariants.                      |
| src/contexts/portal/application/create-portal-commit.ts                                | Reuse copy creation while carrying personal metadata and the checked source fence.      |
| src/contexts/portal/application/goal-readiness-facts.ts                                | Read all non-archived Portals instead of truncating recommendations at 100.             |
| src/contexts/portal/application/load-portal-print-kit-context.ts                       | Use the fixed public name in guest/publication/print data.                              |
| src/contexts/portal/application/portal-content-copy.ts                                 | Reuse copy creation while carrying personal metadata and the checked source fence.      |
| src/contexts/portal/application/portal-preview.ts                                      | Use the fixed public name in guest/publication/print data.                              |
| src/contexts/portal/application/ports/portal-address.repository.ts                     | Share own-code recovery and deduplicate user/token audit records.                       |
| src/contexts/portal/application/ports/portal-command-store.port.ts                     | Carry the personal source revision/snapshot fence to commit.                            |
| src/contexts/portal/application/public-api.ts                                          | Expose typed Staff/personal Portal facts and the new public seam.                       |
| src/contexts/portal/application/use-cases/archive-personal-portal.ts                   | Archive personal Portals idempotently with staff.remove.                                |
| src/contexts/portal/application/use-cases/create-personal-portal.ts                    | Preflight recovery/published sources and create a stable opaque personal copy.          |
| src/contexts/portal/application/use-cases/create-portal.ts                             | Reuse copy creation while carrying personal metadata and the checked source fence.      |
| src/contexts/portal/application/use-cases/get-own-personal-code.ts                     | Recover only an owned personal QR code without portal.update.                           |
| src/contexts/portal/application/use-cases/issue-portal-token.ts                        | Make a code-step retry reuse a recoverable existing token.                              |
| src/contexts/portal/application/use-cases/list-portal-overview.ts                      | Carry kind on overview rows without changing list behavior.                             |
| src/contexts/portal/application/use-cases/manage-portal-experience.ts                  | Refuse staff names in directly edited personal guest wording.                           |
| src/contexts/portal/application/use-cases/publish-portal-changes.ts                    | Keep manager-entered staff names out of every publication path.                         |
| src/contexts/portal/application/use-cases/rename-personal-portal-labels.ts             | Provide the Portal side of the canonical name transaction.                              |
| src/contexts/portal/application/use-cases/reveal-portal-address.ts                     | Share own-code recovery and deduplicate user/token audit records.                       |
| src/contexts/portal/application/use-cases/rollback-portal-publication.ts               | Keep manager-entered staff names out of every publication path.                         |
| src/contexts/portal/application/use-cases/soft-delete-portal.ts                        | Prevent ordinary Delete bypassing staff removal.                                        |
| src/contexts/portal/application/use-cases/update-portal.ts                             | Lock personal rename/archive/restore and publish only the fixed public name.            |
| src/contexts/portal/build-address-operations.ts                                        | Share sealing/print-code bindings across manager and own-code commands.                 |
| src/contexts/portal/build.ts                                                           | Wire personal Portal commands and split address composition to stay within limits.      |
| src/contexts/portal/domain/constructors.ts                                             | Carry Portal kind and separate manager/public names.                                    |
| src/contexts/portal/domain/errors.ts                                                   | Declare/map actionable tagged personal Portal refusals.                                 |
| src/contexts/portal/domain/personal-portal-public-text.ts                              | Refuse name words in a personal Portal public experience.                               |
| src/contexts/portal/domain/types.ts                                                    | Carry Portal kind and separate manager/public names.                                    |
| src/contexts/portal/infrastructure/adapters/personal-portal-labels.writer.ts           | Rename manager labels atomically with Identity, advancing Portal revisions.             |
| src/contexts/portal/infrastructure/adapters/portal-organization-export.adapter.ts      | Export Portal kind and public name.                                                     |
| src/contexts/portal/infrastructure/mappers/portal.mapper.ts                            | Carry Portal kind and separate manager/public names.                                    |
| src/contexts/portal/infrastructure/personal-portal-group-guard.ts                      | Refuse personal membership in a Group with a non-scan target.                           |
| src/contexts/portal/infrastructure/personal-portal-source-fence.ts                     | Recheck the reviewed copy under publication transaction fences.                         |
| src/contexts/portal/infrastructure/portal-create-command.ts                            | Verify the checked personal source before the copy transaction inserts.                 |
| src/contexts/portal/infrastructure/portal-group-writes.ts                              | Check personal scan-target compatibility before Group membership insertion.             |
| src/contexts/portal/infrastructure/portal-working-copy.reader.ts                       | Use the fixed public name in guest/publication/print data.                              |
| src/contexts/portal/infrastructure/repositories/portal-address.repository.ts           | Share own-code recovery and deduplicate user/token audit records.                       |
| src/contexts/portal/server/portals.ts                                                  | Declare/map actionable tagged personal Portal refusals.                                 |
| src/contexts/reporting/CONTEXT.md                                                      | Document the Staff foundation and its context boundary/invariants.                      |
| src/contexts/reporting/application/dashboard-property-access.ts                        | Correct the stale comment about Member dashboard permissions.                           |
| src/contexts/reporting/application/ports/staff-results-reader.port.ts                  | Declare the allowlisted staff results/targets/batched scans reader.                     |
| src/contexts/reporting/application/use-cases/get-staff-dashboard-data.ts               | Delete the dormant dashboard that mixed person scope with Property-wide Google ratings. |
| src/contexts/reporting/application/use-cases/goal-program-shared.ts                    | Limit targets involving personal Portals to enabled qualified scans.                    |
| src/contexts/reporting/build.ts                                                        | Remove dormant staff dashboard wiring and inject narrow self readers.                   |
| src/contexts/reporting/domain/dashboard-types.ts                                       | Remove the unused dormant staff dashboard DTO.                                          |
| src/contexts/reporting/domain/metric-registry.ts                                       | Govern the permitted staff-self audience and worker-linked classification.              |
| src/contexts/reporting/domain/staff-results-window.ts                                  | Resolve Property-local day/week/month and US week starts.                               |
| src/contexts/reporting/infrastructure/adapters/goal-program-subject-reader.ts          | Limit targets involving personal Portals to enabled qualified scans.                    |
| src/contexts/reporting/infrastructure/repositories/goal-program.repository.ts          | Fence Goal definition commits against concurrent personal Group moves.                  |
| src/contexts/reporting/infrastructure/repositories/personal-goal-assignment-guard.ts   | Recheck personal target compatibility under the shared commit fence.                    |
| src/contexts/reporting/infrastructure/repositories/staff-goals.reader.ts               | Read only active personal/Group qualified-scan target progress.                         |
| src/contexts/reporting/infrastructure/repositories/staff-results.reader.ts             | Read live own scans and cutoff private ratings, plus batched scan counts.               |
| src/contexts/reporting/server/staff-self-context.ts                                    | Resolve session-owned staff scope and map ownership refusals.                           |
| src/contexts/reporting/server/staff-self-results.ts                                    | Expose allowlisted results, targets and optional colleague reads.                       |
| src/shared/auth/auth.ts                                                                | Document the server-owned staff invitation additional field.                            |
| src/shared/auth/beta-capabilities.ts                                                   | Advance the beta policy version for the new disabled capability.                        |
| src/shared/auth/capability-for-permission.ts                                           | Map new staff actions to staff.accounts.                                                |
| src/shared/auth/emails.ts                                                              | Render/deliver the fixed staff invitation and short code-ready email.                   |
| src/shared/auth/execution-policy.ts                                                    | Admit staff.self without manager Property grants; retain other policy checks.           |
| src/shared/auth/invitation-send-budget.ts                                              | Share invitation spend limits and a read-only remaining-budget view.                    |
| src/shared/auth/org-schema.ts                                                          | Declare staffParticipationId as non-input invitation metadata.                          |
| src/shared/auth/permissions.ts                                                         | Restrict Member to self/identity actions; add scoped staff actions.                     |
| src/shared/auth/session-organization.ts                                                | Share session and sole-Organization-membership admission.                               |
| src/shared/auth/staff-resolver.ts                                                      | Resolve fresh staff role/membership and enforce the disabled capability.                |
| src/shared/auth/tenant-resolver.ts                                                     | Share stage-one admission while retaining Member refusal.                               |
| src/shared/config/env.ts                                                               | Parse STAFF_SCAN_TARGETS_ENABLED strictly, default off.                                 |
| src/shared/db/schema/auth.ts                                                           | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/schema/index.ts                                                          | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/schema/migratable.ts                                                     | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/schema/people-access.schema.ts                                           | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/schema/portal.schema.ts                                                  | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/schema/staff-accounts.schema.ts                                          | Model and export the new Staff/personal Portal database contract.                       |
| src/shared/db/staff-target-lock.ts                                                     | Serialize personal Group membership with Goal definition decisions.                     |
| src/shared/domain/permissions.ts                                                       | Extend the typed permission union for staff self and management.                        |
| src/shared/email/index.ts                                                              | Render/deliver the fixed staff invitation and short code-ready email.                   |
| src/shared/email/transactional.tsx                                                     | Render/deliver the fixed staff invitation and short code-ready email.                   |
| src/shared/governance/capability-fate.ts                                               | Keep staff.accounts beta_disabled until the final plan PR.                              |
| src/shared/governance/data-fate-authority.ts                                           | Register onboarding and Property settings lifecycle ownership.                          |
| src/shared/queries/query-keys.ts                                                       | Separate staff cache identities by person, participation, period and cutoff.            |
| src/shared/rate-limit/middleware.ts                                                    | Read remaining budget without incrementing counters.                                    |
| src/shared/testing/fixtures.ts                                                         | Support personal Portal fixtures and cross-surface/privacy assertions.                  |
| src/shared/testing/in-memory-portal-address-repo.ts                                    | Support personal Portal fixtures and cross-surface/privacy assertions.                  |
| src/shared/testing/personal-portal-public-assertions.ts                                | Support personal Portal fixtures and cross-surface/privacy assertions.                  |
| src/shared/testing/staff-account-fixture.ts                                            | Support personal Portal fixtures and cross-surface/privacy assertions.                  |

## Tests and browser fixtures

Identity: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- src/contexts/identity/application/use-cases/add-staff-member.test.ts
- src/contexts/identity/application/use-cases/manage-staff-accounts.test.ts
- src/contexts/identity/application/use-cases/staff-participations.test.ts
- src/contexts/identity/domain/invitation-store-rules.test.ts
- src/contexts/identity/infrastructure/adapters/staff-organization-export.adapter.test.ts
- src/contexts/identity/infrastructure/adapters/staff-organization-lifecycle.adapter.test.ts
- src/contexts/identity/infrastructure/repositories/staff-participation.repository.test.ts
- src/contexts/identity/infrastructure/staff-account-store.integration.test.ts
- src/contexts/identity/infrastructure/staff-account-store.test.ts
- src/contexts/identity/infrastructure/staff-invitation-acceptance.integration.test.ts
- src/contexts/identity/public-api-shape.test.ts
- src/contexts/identity/server/staff-accounts.test.ts
- src/contexts/identity/server/staff-self.test.ts
- src/contexts/identity/server/staff-shared.test.ts

Portal: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- src/contexts/portal/application/goal-readiness-facts.test.ts
- src/contexts/portal/application/use-cases/add-portal-to-group.test.ts
- src/contexts/portal/application/use-cases/create-personal-portal.test.ts
- src/contexts/portal/application/use-cases/create-portal-group.test.ts
- src/contexts/portal/application/use-cases/get-portal-review.test.ts
- src/contexts/portal/application/use-cases/issue-portal-token.test.ts
- src/contexts/portal/application/use-cases/list-portal-overview.test.ts
- src/contexts/portal/application/use-cases/manage-portal-experience.test.ts
- src/contexts/portal/application/use-cases/rename-personal-portal-labels.test.ts
- src/contexts/portal/application/use-cases/reveal-portal-address.test.ts
- src/contexts/portal/application/use-cases/soft-delete-portal.test.ts
- src/contexts/portal/application/use-cases/update-portal.test.ts
- src/contexts/portal/domain/personal-portal-public-text.test.ts
- src/contexts/portal/infrastructure/mappers/portal.mapper.test.ts
- src/contexts/portal/infrastructure/personal-portal-group-guard.test.ts
- src/contexts/portal/infrastructure/personal-portal-source-fence.test.ts

Reporting: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- src/contexts/reporting/application/dashboard-property-access.test.ts
- src/contexts/reporting/application/use-cases/get-staff-dashboard-data.test.ts — removed with the dormant implementation.
- src/contexts/reporting/domain/metric-registry.test.ts
- src/contexts/reporting/domain/staff-results-window.test.ts
- src/contexts/reporting/infrastructure/adapters/goal-program-subject-reader.test.ts
- src/contexts/reporting/infrastructure/metric-registry.repository.test.ts
- src/contexts/reporting/infrastructure/repositories/personal-goal-assignment-guard.test.ts
- src/contexts/reporting/infrastructure/repositories/staff-results.reader.integration.test.ts
- src/contexts/reporting/server/staff-self-results.test.ts

Guest: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- src/contexts/guest/server/count-guest-visit.test.ts
- src/contexts/guest/server/public.test.ts

Shared and tooling: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- src/contexts/inbox/application/use-cases/add-inbox-note.test.ts
- src/contexts/inbox/application/use-cases/assign-inbox-item.test.ts
- src/contexts/inbox/application/use-cases/bulk-update-inbox-status.test.ts
- src/contexts/inbox/application/use-cases/get-inbox-item-detail.test.ts
- src/contexts/inbox/application/use-cases/get-inbox-items.test.ts
- src/contexts/inbox/application/use-cases/get-inbox-property-counts.test.ts
- src/contexts/property/application/use-cases/list-properties.test.ts
- src/shared/auth/google-content-capabilities.test.ts
- src/shared/auth/permissions.test.ts
- src/shared/auth/staff-permissions.test.ts
- src/shared/auth/staff-resolver.test.ts
- src/shared/config/env.test.ts
- src/shared/db/schema/staff-accounts.schema.test.ts
- src/shared/queries/query-keys.test.ts

Browser: authorization, privacy, retry, acceptance and regression coverage appropriate to the changed behavior.

- e2e/critical/guest-portal.spec.ts
